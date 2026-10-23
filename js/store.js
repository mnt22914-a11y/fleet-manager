// 保存層。画面側はこのモジュールの関数だけを呼ぶ(直接 localStorage や Supabase を触らない)。
// 中身はメモリ上の state。保存先(backend)は js/config.js が空ならローカル(localStorage)、
// Supabase の URL とキーが入っていればクラウド(ログインした人全員で共有)。
// 読み書きの手順:
//   1. 画面の操作 → state を先に書き換えて購読者に通知(すぐ画面が変わる)
//   2. その後ろで backend に書く(失敗したら onError に知らせる)
//   3. 他の端末の変更は backend.onChange → applyRemoteChange で state に反映

import { DEFAULT_SETTINGS, uid, nowISO, applyRemoteChange } from './logic.js';
import { createLocalBackend } from './backend-local.js';

function emptyState() {
  return { version: 1, vehicles: [], records: [], issues: [], settings: { ...DEFAULT_SETTINGS } };
}

function normalize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  s.vehicles = Array.isArray(raw.vehicles) ? raw.vehicles : [];
  s.records = Array.isArray(raw.records) ? raw.records : [];
  s.issues = Array.isArray(raw.issues) ? raw.issues : [];
  // 2026-10-19: 「ランプ類」を左右前後の 4 部位に分けた。古い記録は「その他」に移し、内容に印を付ける
  for (const i of s.issues) {
    if (i.part === 'lights') { i.part = 'other'; if (!/^\(ランプ\)/.test(i.title || '')) i.title = `(ランプ) ${i.title || ''}`.trim(); }
  }
  // 2026-10-19: 車両の項目変更(管理番号→ドライバー名、車台番号→車両QR)。ピンは配列に
  for (const v of s.vehicles) {
    if (v.driverName == null) v.driverName = v.driver || v.code || '';
    if (v.qr == null && v.vin) v.qr = v.vin;
    if (v.insurancePhone == null) v.insurancePhone = '';
    if (v.loaner === undefined) v.loaner = null;
    delete v.code; delete v.name; delete v.model; delete v.driver; delete v.vin;
  }
  for (const i of s.issues) {
    if (!Array.isArray(i.pins)) i.pins = i.pin ? [i.pin] : [];
    delete i.pin;
    if (i.accident === undefined) i.accident = null;
  }
  s.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  if (!Array.isArray(s.settings.bases) || s.settings.bases.length === 0) s.settings.bases = [...DEFAULT_SETTINGS.bases];
  if (!Array.isArray(s.settings.types) || s.settings.types.length === 0) s.settings.types = [...DEFAULT_SETTINGS.types];
  return s;
}

let state = emptyState();
let backend = null;
const listeners = new Set();
const errorListeners = new Set();

function notify() {
  for (const fn of listeners) fn(state);
}

// backend への書き込みは順番を守る(前の書き込みが終わってから次を送る)
let queue = Promise.resolve();
function write(fn) {
  queue = queue.then(fn).catch((e) => {
    const msg = e?.message || '保存に失敗しました';
    for (const fn of errorListeners) fn(`保存に失敗しました: ${msg}`);
  });
  return queue;
}

// ---- 起動 ----

function readConfig() {
  const c = globalThis.FLEET_CONFIG || {};
  const url = String(c.SUPABASE_URL || '').trim();
  const key = String(c.SUPABASE_ANON_KEY || '').trim();
  return url && key ? { url, key } : null;
}

/** 'ready' | 'needs-auth' | 'needs-join' | 'offline' を返す。ready のときは state が読み込み済み。 */
export async function init() {
  const cfg = readConfig();
  if (cfg) {
    const { createSupabaseBackend } = await import('./backend-supabase.js');
    backend = await createSupabaseBackend(cfg.url, cfg.key);
  } else {
    backend = createLocalBackend(() => state);
  }
  const status = await backend.init();
  if (status !== 'ready') return status;
  return loadFromBackend();
}

async function loadFromBackend() {
  try {
    state = normalize(await backend.loadAll());
  } catch (e) {
    if (e?.offline) return 'offline';
    throw e;
  }
  backend.onChange((change) => {
    const next = applyRemoteChange(state, change);
    if (next === state) return;
    state = normalize(next);
    notify();
  });
  notify();
  return 'ready';
}

/** ログイン直後など、backend はそのままで読み直す。メンバーでなければ 'needs-join'。 */
export async function reload() {
  if (backend.mode === 'cloud') {
    const status = await backend.init();
    if (status !== 'ready') return status;
  }
  return loadFromBackend();
}

/** クラウドのメンバー管理(招待コード・メンバー一覧)。ローカルでは null。 */
export function cloud() {
  if (backend?.mode !== 'cloud') return null;
  return {
    company: () => backend.company(),
    members: () => backend.members(),
    removeMember: (id) => backend.removeMember(id),
    regenerateInviteCode: () => backend.regenerateInviteCode(),
  };
}

export function mode() {
  return backend?.mode || 'local';
}

export function auth() {
  return backend?.auth || null;
}

/** 写真の保存先(photos.js が使う)。クラウドなら Supabase クライアント、ローカルなら null。 */
export function cloudClient() {
  return backend?.client || null;
}

export function onError(fn) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

// ---- 読む ----

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getVehicle(id) {
  return state.vehicles.find((v) => v.id === id) || null;
}

export function recordsOf(vehicleId) {
  return state.records.filter((r) => r.vehicleId === vehicleId).sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
}

export function issuesOf(vehicleId) {
  return state.issues.filter((i) => i.vehicleId === vehicleId);
}

// ---- 書く ----

export function upsertVehicle(input) {
  const now = nowISO();
  const i = state.vehicles.findIndex((v) => v.id === input.id);
  let row;
  if (i >= 0) {
    row = state.vehicles[i] = { ...state.vehicles[i], ...input, updatedAt: now };
  } else {
    row = { ...input, id: input.id || uid(), createdAt: now, updatedAt: now };
    state.vehicles.push(row);
  }
  notify();
  write(() => backend.upsert('vehicles', [row]));
  return row.id;
}

/** CSV 取り込みなどで複数台をまとめて登録・更新する(保存は 1 回)。 */
export function upsertVehicles(list) {
  const now = nowISO();
  let added = 0, updated = 0;
  const rows = [];
  for (const input of list) {
    const i = input.id ? state.vehicles.findIndex((v) => v.id === input.id) : -1;
    let row;
    if (i >= 0) { row = state.vehicles[i] = { ...state.vehicles[i], ...input, updatedAt: now }; updated++; }
    else { row = { ...input, id: input.id || uid(), createdAt: now, updatedAt: now }; state.vehicles.push(row); added++; }
    rows.push(row);
  }
  notify();
  write(() => backend.upsert('vehicles', rows));
  return { added, updated };
}

export function removeVehicle(id) {
  const now = nowISO();
  state.vehicles = state.vehicles.filter((v) => v.id !== id);
  const touched = [];
  for (const v of state.vehicles) if (v.loaner?.type === 'own' && v.loaner.vehicleId === id) { v.loaner = null; v.updatedAt = now; touched.push(v); }
  const recIds = state.records.filter((r) => r.vehicleId === id).map((r) => r.id);
  const issueIds = state.issues.filter((i) => i.vehicleId === id).map((i) => i.id);
  state.records = state.records.filter((r) => r.vehicleId !== id);
  state.issues = state.issues.filter((i) => i.vehicleId !== id);
  notify();
  write(async () => {
    await backend.remove('records', recIds);
    await backend.remove('issues', issueIds);
    await backend.remove('vehicles', [id]);
    await backend.upsert('vehicles', touched);
  });
}

export function upsertRecord(input) {
  const now = nowISO();
  const i = state.records.findIndex((r) => r.id === input.id);
  let row;
  if (i >= 0) {
    row = state.records[i] = { ...state.records[i], ...input, updatedAt: now };
  } else {
    row = { ...input, id: input.id || uid(), createdAt: now, updatedAt: now };
    state.records.push(row);
  }
  // 整備時の走行距離が車両の現在値より大きければ車両側も更新する
  let touchedVehicle = null;
  const v = getVehicle(input.vehicleId);
  if (v && input.odometer !== '' && input.odometer != null) {
    const km = Number(input.odometer);
    if (!Number.isNaN(km) && (v.odometer == null || v.odometer === '' || km > Number(v.odometer))) {
      v.odometer = km;
      v.odometerDate = input.date;
      v.updatedAt = now;
      touchedVehicle = v;
    }
  }
  notify();
  write(async () => {
    await backend.upsert('records', [row]);
    if (touchedVehicle) await backend.upsert('vehicles', [touchedVehicle]);
  });
  return row.id;
}

export function removeRecord(id) {
  state.records = state.records.filter((r) => r.id !== id);
  notify();
  write(() => backend.remove('records', [id]));
}

export function upsertIssue(input) {
  const now = nowISO();
  const i = state.issues.findIndex((x) => x.id === input.id);
  let row;
  if (i >= 0) {
    row = state.issues[i] = { ...state.issues[i], ...input, updatedAt: now };
  } else {
    row = { ...input, id: input.id || uid(), createdAt: now, updatedAt: now };
    state.issues.push(row);
  }
  notify();
  write(() => backend.upsert('issues', [row]));
  return row.id;
}

export function removeIssue(id) {
  state.issues = state.issues.filter((i) => i.id !== id);
  notify();
  write(() => backend.remove('issues', [id]));
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  notify();
  const snapshot = state.settings;
  write(() => backend.saveSettings(snapshot));
}

export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: nowISO() }, null, 2);
}

/** バックアップ JSON を読み込む。形が違えば例外。保存が終わるまで待てる。 */
export function importJSON(text) {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.vehicles) || !Array.isArray(raw.records)) {
    throw new Error('車両管理アプリのバックアップファイルではありません');
  }
  return replaceAll(raw);
}

export function replaceAll(data) {
  state = normalize(data);
  notify();
  const snapshot = state;
  return write(() => backend.replaceAll(snapshot));
}

export function clearAll() {
  state = emptyState();
  notify();
  return write(() => backend.clearAll());
}
