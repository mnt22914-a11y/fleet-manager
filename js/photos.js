// 写真の保存。localStorage には入りきらないので IndexedDB に Blob で持つ。
// 保存時に長辺 1280px の JPEG に縮小する。画面からは url(id) で同期的に参照できるよう、起動時にまとめて読み込む。

import { uid, nowISO } from './logic.js';

const DB = 'fleet-photos';
const STORE = 'photos';
let db = null;
const urls = new Map();   // id → object URL
const memory = new Map(); // IndexedDB が使えない環境のための退避先

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

export async function init() {
  try { db = await open(); } catch { db = null; }
  for (const p of await getAll()) urls.set(p.id, URL.createObjectURL(p.blob));
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
  if (db) await tx('readwrite', (s) => s.delete(id));
  else memory.delete(id);
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
}

export async function removeMany(ids) {
  for (const id of ids || []) await remove(id);
}

export async function clear() {
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
