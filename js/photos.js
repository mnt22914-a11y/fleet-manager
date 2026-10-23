// 写真の保存。
// ローカルモード: localStorage には入りきらないので IndexedDB に Blob で持つ。
// クラウドモード: Supabase Storage のバケット photos に `<id>.jpg` で置き、署名付き URL(期限つき)で表示する。
// どちらも、画面からは url(id) で同期的に参照できるよう、先に URL を用意しておく。
// 保存時に長辺 1280px の JPEG に縮小する。

import { uid, nowISO } from './logic.js';

const DB = 'fleet-photos';
const STORE = 'photos';
const BUCKET = 'photos';
const SIGNED_TTL = 60 * 60 * 12; // 署名付き URL の有効期間(秒)。半分過ぎたら取り直す

let db = null;
let sb = null;             // クラウドのときだけ Supabase クライアント
const urls = new Map();    // id → 表示用 URL(object URL か署名付き URL)
const memory = new Map();  // IndexedDB が使えない環境のための退避先
let signedAt = 0;
let onLoaded = () => {};

function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return resolve(null);
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(fn ? fn(null) : null);
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

function getAll() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([...memory.values()]);
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

const path = (id) => `${id}.jpg`;

/**
 * 起動時に呼ぶ。client が null ならローカル(IndexedDB)、あれば Supabase Storage。
 * クラウドのときは ids(state に出てくる写真 ID)の署名付き URL をまとめて取る。
 */
export async function init(client = null, ids = []) {
  sb = client || null;
  if (sb) {
    await ensure(ids, true);
    return;
  }
  try { db = await open(); } catch { db = null; }
  for (const p of await getAll()) urls.set(p.id, URL.createObjectURL(p.blob));
}

/** 新しい写真 ID が画面に出てきて URL が取れたら呼ばれる(再描画のため)。 */
export function setOnLoaded(fn) {
  onLoaded = fn || (() => {});
}

/** クラウド: まだ URL を持っていない id の署名付き URL を取る。期限が近ければ全部取り直す。 */
export async function ensure(ids, force = false) {
  if (!sb) return;
  const stale = Date.now() - signedAt > (SIGNED_TTL / 2) * 1000;
  const want = force || stale ? [...new Set(ids)] : [...new Set(ids)].filter((id) => !urls.has(id));
  if (!want.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(want.map(path), SIGNED_TTL);
  if (error) throw error;
  let added = false;
  for (const row of data || []) {
    if (!row.signedUrl) continue; // 無いファイルは飛ばす(error が入る)
    const id = row.path.replace(/\.jpg$/, '');
    if (!urls.has(id)) added = true;
    urls.set(id, row.signedUrl);
  }
  signedAt = Date.now();
  if (added) onLoaded();
}

export function url(id) {
  return urls.get(id) || '';
}

export function has(id) {
  return urls.has(id);
}

async function shrink(file, max = 1280) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.82));
}

async function put(rec) {
  if (sb) {
    const { error } = await sb.storage.from(BUCKET).upload(path(rec.id), rec.blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`写真を保存できませんでした: ${error.message}`);
    const { data, error: e2 } = await sb.storage.from(BUCKET).createSignedUrl(path(rec.id), SIGNED_TTL);
    if (e2) throw e2;
    urls.set(rec.id, data.signedUrl);
    return;
  }
  if (db) await tx('readwrite', (s) => s.put(rec));
  else memory.set(rec.id, rec);
  urls.set(rec.id, URL.createObjectURL(rec.blob));
}

export async function addFile(file) {
  const blob = await shrink(file);
  const id = uid();
  await put({ id, blob, createdAt: nowISO() });
  return id;
}

export async function remove(id) {
  if (!id) return;
  if (sb) {
    await sb.storage.from(BUCKET).remove([path(id)]);
  } else if (db) await tx('readwrite', (s) => s.delete(id));
  else memory.delete(id);
  const u = urls.get(id);
  if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
  urls.delete(id);
}

export async function removeMany(ids) {
  if (sb && ids?.length) {
    await sb.storage.from(BUCKET).remove(ids.map(path));
    for (const id of ids) urls.delete(id);
    return;
  }
  for (const id of ids || []) await remove(id);
}

async function listCloud() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 1000, offset });
    if (error) throw error;
    out.push(...(data || []).filter((f) => f.name.endsWith('.jpg')).map((f) => f.name.replace(/\.jpg$/, '')));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function clear() {
  if (sb) {
    const ids = await listCloud();
    for (let i = 0; i < ids.length; i += 100) await sb.storage.from(BUCKET).remove(ids.slice(i, i + 100).map(path));
    urls.clear();
    return;
  }
  if (db) await tx('readwrite', (s) => s.clear());
  memory.clear();
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

function blobToDataURL(blob) {
  return new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(blob); });
}

/** バックアップ用: [{ id, createdAt, dataUrl }] */
export async function exportAll() {
  const out = [];
  if (sb) {
    for (const id of await listCloud()) {
      const { data, error } = await sb.storage.from(BUCKET).download(path(id));
      if (error || !data) continue;
      out.push({ id, createdAt: '', dataUrl: await blobToDataURL(data) });
    }
    return out;
  }
  for (const p of await getAll()) out.push({ id: p.id, createdAt: p.createdAt, dataUrl: await blobToDataURL(p.blob) });
  return out;
}

export async function importAll(list) {
  if (!Array.isArray(list)) return;
  for (const p of list) {
    if (!p?.id || !p?.dataUrl) continue;
    const blob = await (await fetch(p.dataUrl)).blob();
    await put({ id: p.id, blob, createdAt: p.createdAt || nowISO() });
  }
}
