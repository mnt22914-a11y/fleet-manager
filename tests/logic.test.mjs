// node --test tests/*.test.mjs で実行。logic.js の純粋関数だけを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const S = { ...L.DEFAULT_SETTINGS, alertDays: 30, warnDays: 60, odometerWarnKm: 1000 };
const T = '2026-10-18';

test('daysUntil: 今日は 0、未来は正、過去は負、不正は null', () => {
  assert.equal(L.daysUntil('2026-10-18', T), 0);
  assert.equal(L.daysUntil('2026-11-17', T), 30);
  assert.equal(L.daysUntil('2026-10-01', T), -17);
  assert.equal(L.daysUntil('', T), null);
  assert.equal(L.daysUntil('2026-02-30', T), null);
});

test('addMonths: 月末を丸める', () => {
  assert.equal(L.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(L.addMonths('2026-10-18', 12), '2027-10-18');
  assert.equal(L.addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(L.addMonths('bad', 1), '');
});

test('deadlineLevel: 期限切れ / 要対応 / 注意 / 問題なし / 未登録', () => {
  assert.equal(L.deadlineLevel('2026-10-17', S, T), 'expired');
  assert.equal(L.deadlineLevel('2026-10-18', S, T), 'critical');
  assert.equal(L.deadlineLevel('2026-11-17', S, T), 'critical');
  assert.equal(L.deadlineLevel('2026-11-18', S, T), 'warning');
  assert.equal(L.deadlineLevel('2026-12-17', S, T), 'warning');
  assert.equal(L.deadlineLevel('2026-12-18', S, T), 'ok');
  assert.equal(L.deadlineLevel('', S, T), 'none');
});

test('odometerLevel: 残り距離で判定', () => {
  assert.equal(L.odometerLevel(-1, S), 'expired');
  assert.equal(L.odometerLevel(0, S), 'critical');
  assert.equal(L.odometerLevel(1000, S), 'critical');
  assert.equal(L.odometerLevel(1001, S), 'warning');
  assert.equal(L.odometerLevel(2001, S), 'ok');
  assert.equal(L.odometerLevel(null, S), 'none');
});

const car = (over = {}) => ({
  id: 'v1', code: 'V-001', plate: '品川 400 あ 12-34', status: 'active',
  inspectionExpiry: '2027-06-01', jibaisekiExpiry: '2027-06-20', insuranceExpiry: '2027-01-15',
  odometer: 50000, ...over,
});

test('vehicleAlerts: 期限が近いものだけ、廃車は出ない', () => {
  const v = car({ inspectionExpiry: '2026-10-10', insuranceExpiry: '2026-12-01' });
  const alerts = L.vehicleAlerts(v, [], S, T);
  assert.deepEqual(alerts.map((a) => [a.kind, a.level]), [['inspection', 'expired'], ['insurance', 'warning']]);
  assert.deepEqual(L.vehicleAlerts({ ...v, status: 'retired' }, [], S, T), []);
});

test('vehicleAlerts: 整備の次回目安は種別ごとに最新の記録だけ見る', () => {
  const v = car({ odometer: 50000 });
  const records = [
    { id: 'r1', vehicleId: 'v1', type: 'オイル交換', date: '2026-01-10', nextOdometer: 45000 }, // 古い記録: 超過しているが無視される
    { id: 'r2', vehicleId: 'v1', type: 'オイル交換', date: '2026-08-10', nextOdometer: 50800 }, // 最新: 残り 800 → 要対応
    { id: 'r3', vehicleId: 'v1', type: '法定点検', date: '2026-05-01', nextDate: '2026-11-01' },  // あと 14 日 → 要対応
    { id: 'r4', vehicleId: 'v2', type: '法定点検', date: '2026-05-01', nextDate: '2026-10-01' },  // 別の車
  ];
  const alerts = L.vehicleAlerts(v, records, S, T);
  assert.equal(alerts.length, 2);
  const oil = alerts.find((a) => a.recordId === 'r2');
  assert.equal(oil.level, 'critical');
  assert.equal(oil.km, 800);
  const insp = alerts.find((a) => a.recordId === 'r3');
  assert.equal(insp.level, 'critical');
  assert.equal(insp.days, 14);
});

test('sortAlerts: 重いもの → 日数が少ないもの の順', () => {
  const sorted = L.sortAlerts([
    { level: 'warning', days: 40 }, { level: 'expired', days: -3 }, { level: 'critical', days: 20 }, { level: 'critical', days: 5 },
  ]);
  assert.deepEqual(sorted.map((a) => a.days), [-3, 5, 20, 40]);
});

test('filterVehicles: 空白とハイフンを無視して検索、拠点・ステータスで絞る', () => {
  const list = [
    car({ id: 'a', code: 'V-001', plate: '品川 400 あ 12-34', base: '本社', driver: '佐藤' }),
    car({ id: 'b', code: 'V-002', plate: '横浜 100 か 56-78', base: '横浜', status: 'repair' }),
  ];
  assert.deepEqual(L.filterVehicles(list, { q: '1234' }).map((v) => v.id), ['a']);
  assert.deepEqual(L.filterVehicles(list, { q: 'v002' }).map((v) => v.id), ['b']);
  assert.deepEqual(L.filterVehicles(list, { q: '佐藤' }).map((v) => v.id), ['a']);
  assert.deepEqual(L.filterVehicles(list, { base: '横浜' }).map((v) => v.id), ['b']);
  assert.deepEqual(L.filterVehicles(list, { status: 'repair' }).map((v) => v.id), ['b']);
});

test('sortBy: 数値・文字列・空の扱い', () => {
  const list = [{ k: 300 }, { k: null }, { k: 100 }, { k: 200 }];
  assert.deepEqual(L.sortBy(list, 'k').map((x) => x.k), [100, 200, 300, null]);
  assert.deepEqual(L.sortBy(list, 'k', 'desc').map((x) => x.k), [300, 200, 100, null]);
});

test('sumCost / monthlyCosts / costByType', () => {
  const records = [
    { date: '2026-10-02', type: 'オイル交換', cost: 7000, vehicleId: 'a' },
    { date: '2026-10-20', type: 'タイヤ交換', cost: 50000, vehicleId: 'b' },
    { date: '2026-09-15', type: 'オイル交換', cost: 6500, vehicleId: 'a' },
    { date: '2026-09-16', type: '修理', cost: '', vehicleId: 'a' },
  ];
  assert.equal(L.sumCost(records, { ym: '2026-10' }), 57000);
  assert.equal(L.sumCost(records, { vehicleId: 'a' }), 13500);
  const months = L.monthlyCosts(records, 3, T);
  assert.deepEqual(months, [{ ym: '2026-08', total: 0 }, { ym: '2026-09', total: 6500 }, { ym: '2026-10', total: 57000 }]);
  assert.deepEqual(L.costByType(records)[0], { type: 'タイヤ交換', total: 50000 });
});

test('validateVehicle / validateRecord', () => {
  assert.deepEqual(L.validateVehicle(car()), []);
  const errs = L.validateVehicle({ code: '', plate: '', status: 'x', inspectionExpiry: '2026-13-01', odometer: -5 });
  assert.equal(errs.length, 5);
  assert.deepEqual(L.validateRecord({ vehicleId: 'v1', date: '2026-10-18', type: 'オイル交換', cost: 7000, odometer: 50000, nextDate: '2027-04-18', nextOdometer: 55000 }), []);
  const rErrs = L.validateRecord({ vehicleId: '', date: 'x', type: '', cost: -1, odometer: '', nextDate: '2026-01-01', nextOdometer: 'abc' });
  assert.ok(rErrs.length >= 5);
  assert.ok(L.validateRecord({ vehicleId: 'v1', date: '2026-10-18', type: 'a', nextDate: '2026-10-18' }).some((e) => e.includes('後に')));
});

test('toCSV: BOM、CRLF、カンマや改行を含むセルの引用', () => {
  const csv = L.toCSV([{ a: 'x,y', b: 'line\nbreak', c: 'say "hi"' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv, '﻿A,B,C\r\n"x,y","line\nbreak","say ""hi"""\r\n');
});

test('書式', () => {
  assert.equal(L.fmtDate('2026-10-18'), '2026/10/18');
  assert.equal(L.fmtDate(''), '—');
  assert.equal(L.fmtYen(1234567), '¥1,234,567');
  assert.equal(L.fmtKm(50000), '50,000 km');
  assert.equal(L.fmtDays(-3), '3日超過');
  assert.equal(L.fmtDays(0), '今日');
  assert.equal(L.fmtDays(12), 'あと12日');
});
