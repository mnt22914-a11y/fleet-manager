// 保存層。いまは localStorage だが、将来 Supabase に差し替えられるよう
// 画面側はこのモジュールの関数だけを呼ぶ(直接 localStorage を触らない)。

import { DEFAULT_SETTINGS, uid, nowISO } from './logic.js';

const KEY = 'fleet.v1';

function emptyState() {
  return { version: 1, vehicles: [], records: [], settings: { ...DEFAULT_SETTINGS } };
}

function normalize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  s.vehicles = Array.isArray(raw.vehicles) ? raw.vehicles : [];
  s.records = Array.isArray(raw.records) ? raw.records : [];
  s.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  if (!Array.isArray(s.settings.bases) || s.settings.bases.length === 0) s.settings.bases = [...DEFAULT_SETTINGS.bases];
  if (!Array.isArray(s.settings.types) || s.settings.types.length === 0) s.settings.types = [...DEFAULT_SETTINGS.types];
  return s;
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return emptyState();
  }
}

let state = load();
const listeners = new Set();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(state));
  for (const fn of listeners) fn(state);
}

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

export function upsertVehicle(input) {
  const now = nowISO();
  const i = state.vehicles.findIndex((v) => v.id === input.id);
  if (i >= 0) {
    state.vehicles[i] = { ...state.vehicles[i], ...input, updatedAt: now };
  } else {
    state.vehicles.push({ ...input, id: input.id || uid(), createdAt: now, updatedAt: now });
  }
  persist();
  return input.id || state.vehicles[state.vehicles.length - 1].id;
}

export function removeVehicle(id) {
  state.vehicles = state.vehicles.filter((v) => v.id !== id);
  state.records = state.records.filter((r) => r.vehicleId !== id);
  persist();
}

export function upsertRecord(input) {
  const now = nowISO();
  const i = state.records.findIndex((r) => r.id === input.id);
  let id = input.id;
  if (i >= 0) {
    state.records[i] = { ...state.records[i], ...input, updatedAt: now };
  } else {
    id = input.id || uid();
    state.records.push({ ...input, id, createdAt: now, updatedAt: now });
  }
  // 整備時の走行距離が車両の現在値より大きければ車両側も更新する
  const v = getVehicle(input.vehicleId);
  if (v && input.odometer !== '' && input.odometer != null) {
    const km = Number(input.odometer);
    if (!Number.isNaN(km) && (v.odometer == null || v.odometer === '' || km > Number(v.odometer))) {
      v.odometer = km;
      v.odometerDate = input.date;
      v.updatedAt = now;
    }
  }
  persist();
  return id;
}

export function removeRecord(id) {
  state.records = state.records.filter((r) => r.id !== id);
  persist();
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist();
}

export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: nowISO() }, null, 2);
}

/** バックアップ JSON を読み込む。形が違えば例外。 */
export function importJSON(text) {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.vehicles) || !Array.isArray(raw.records)) {
    throw new Error('車両管理アプリのバックアップファイルではありません');
  }
  state = normalize(raw);
  persist();
}

export function replaceAll(data) {
  state = normalize(data);
  persist();
}

export function clearAll() {
  state = emptyState();
  persist();
}
