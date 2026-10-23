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
  id: 'v1', driverName: '佐藤 太郎', plate: '品川 400 あ 12-34', status: 'active',
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
    car({ id: 'a', driverName: '佐藤 太郎', plate: '品川 400 あ 12-34', base: '本社', qr: 'KV-1001' }),
    car({ id: 'b', driverName: '鈴木 花子', plate: '横浜 100 か 56-78', base: '横浜', status: 'repair', qr: 'KV-1002' }),
  ];
  assert.deepEqual(L.filterVehicles(list, { q: '1234' }).map((v) => v.id), ['a']);
  assert.deepEqual(L.filterVehicles(list, { q: 'kv1002' }).map((v) => v.id), ['b']);
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
  const errs = L.validateVehicle({ driverName: '', plate: '', status: 'x', inspectionExpiry: '2026-13-01', odometer: -5 });
  assert.equal(errs.length, 5);
  assert.ok(L.validateVehicle(car({ loaner: { type: 'rental', plate: '' } })).some((e) => e.includes('借代車')));
  assert.ok(L.validateVehicle(car({ loaner: { type: 'own', vehicleId: 'v1' } })).some((e) => e.includes('自分自身')));
  assert.deepEqual(L.validateVehicle(car({ loaner: { type: 'own', vehicleId: 'v2' } })), []);
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

test('partStatus: 部位ごとに未対応の最重要度と件数', () => {
  const issues = [
    { part: 'side_l', severity: 'low', status: 'open' },
    { part: 'side_l', severity: 'high', status: 'open' },
    { part: 'hood', severity: 'mid', status: 'open' },
    { part: 'rear', severity: 'high', status: 'fixed' },
  ];
  const st = L.partStatus(issues);
  assert.deepEqual(st.side_l, { count: 2, severity: 'high' });
  assert.deepEqual(st.hood, { count: 1, severity: 'mid' });
  assert.equal(st.rear, undefined);
});

test('sortIssues: 未対応 → 緊急度 → 新しい順', () => {
  const sorted = L.sortIssues([
    { id: 'a', status: 'fixed', severity: 'high', reportedAt: '2026-10-10' },
    { id: 'b', status: 'open', severity: 'low', reportedAt: '2026-10-17' },
    { id: 'c', status: 'open', severity: 'high', reportedAt: '2026-10-01' },
    { id: 'd', status: 'open', severity: 'high', reportedAt: '2026-10-15' },
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ['d', 'c', 'b', 'a']);
});

test('validateIssue', () => {
  assert.deepEqual(L.validateIssue({ vehicleId: 'v', part: 'hood', severity: 'mid', title: 'x', reportedAt: '2026-10-18', status: 'open' }), []);
  assert.equal(L.validateIssue({ vehicleId: '', part: 'nope', severity: 'z', title: '', reportedAt: '' }).length, 5);
});

test('loanerLabel', () => {
  const vs = [{ id: 'x', plate: '品川 480 い 1-23', driverName: '鈴木' }];
  assert.equal(L.loanerLabel({ type: 'rental', plate: '足立 480 れ 12-34' }), '借代車 足立 480 れ 12-34');
  assert.equal(L.loanerLabel({ type: 'own', vehicleId: 'x' }, vs), '自社代車 品川 480 い 1-23');
  assert.equal(L.loanerLabel(null), '');
});

test('validateIssue: 事故記録の日時', () => {
  const base = { vehicleId: 'v', part: 'rear', severity: 'high', title: 'x', reportedAt: '2026-10-18', status: 'open' };
  assert.deepEqual(L.validateIssue({ ...base, accident: { datetime: '2026-10-18T10:40' } }), []);
  assert.deepEqual(L.validateIssue({ ...base, accident: { datetime: '' } }), []);
  assert.ok(L.validateIssue({ ...base, accident: { datetime: '18/10/2026' } }).some((e) => e.includes('日時')));
});

test('parseCSV: 引用符・改行入りセル・BOM・CRLF を読める', () => {
  const rows = L.parseCSV('﻿a,b\r\n1,"x, ""y""\nz"\r\n\r\n2,\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', 'x, "y"\nz'], ['2', '']]);
});

test('normalizeDateInput: Excel 風の日付を YYYY-MM-DD にする', () => {
  assert.equal(L.normalizeDateInput('2026/4/1'), '2026-04-01');
  assert.equal(L.normalizeDateInput('2026年4月1日'), '2026-04-01');
  assert.equal(L.normalizeDateInput('20260401'), '2026-04-01');
  assert.equal(L.normalizeDateInput('R8.4.1'), '2026-04-01');
  assert.equal(L.normalizeDateInput('2026-04-01'), '2026-04-01');
  assert.equal(L.normalizeDateInput(''), '');
});

test('vehiclesFromCSV: 見出しで列を対応づけ、同じナンバーは既存 id を引き継ぐ', () => {
  const csv = 'ドライバー名,ナンバー,ステータス,車検満了日,走行距離(km)\n佐藤,品川 480 あ 12-34,稼働中,2027/3/31,"12,345"\n鈴木,品川 480 い 56-78,,2027-01-10,\n';
  const existing = [{ id: 'v1', plate: '品川 480 あ 12-34' }];
  const { vehicles, errors } = L.vehiclesFromCSV(csv, existing, { ...L.DEFAULT_SETTINGS, bases: ['A'] });
  assert.deepEqual(errors, []);
  assert.equal(vehicles.length, 2);
  assert.equal(vehicles[0].id, 'v1');
  assert.equal(vehicles[0].inspectionExpiry, '2027-03-31');
  assert.equal(vehicles[0].odometer, 12345);
  assert.equal(vehicles[1].id, undefined);
  assert.equal(vehicles[1].status, 'active');
  assert.equal(vehicles[1].base, 'A');
});

test('vehiclesFromCSV: 上書きの行は空欄・列なしの項目を持たない(既存の値が残る)', () => {
  const csv = 'ドライバー名,ナンバー,車検満了日,走行距離(km)\n佐藤 新,品川 1,,\n';
  const existing = [{ id: 'v1', driverName: '佐藤', plate: '品川 1', status: 'repair', odometer: 100, inspectionExpiry: '2027-01-01' }];
  const { vehicles, errors } = L.vehiclesFromCSV(csv, existing);
  assert.deepEqual(errors, []);
  assert.deepEqual(vehicles[0], { id: 'v1', driverName: '佐藤 新', plate: '品川 1' });
});

test('vehiclesFromCSV: 必須列がない・値が不正なら行番号付きのエラー', () => {
  assert.match(L.vehiclesFromCSV('名前,番号\nA,B\n').errors[0], /ドライバー名/);
  const { errors } = L.vehiclesFromCSV('ドライバー名,ナンバー,ステータス\n,品川 1,稼働中\n佐藤,品川 2,運用中\n佐藤,品川 2,稼働中\n');
  assert.ok(errors.some((e) => e.startsWith('2 行目') && /ドライバー名/.test(e)));
  assert.ok(errors.some((e) => e.startsWith('3 行目') && /ステータス/.test(e)));
  assert.ok(errors.some((e) => e.startsWith('4 行目') && /重複/.test(e)));
});

test('backupDue: 未実施か 7 日以上前なら促す。車両がなければ促さない', () => {
  assert.equal(L.backupDue(null, 5, T), true);
  assert.equal(L.backupDue('2026-10-11T00:00:00Z', 5, T), true);
  assert.equal(L.backupDue('2026-10-12T00:00:00Z', 5, T), false);
  assert.equal(L.backupDue(null, 0, T), false);
  assert.equal(L.daysSinceBackup('2026-10-15', T), 3);
});

// ---- 共有(クラウド同期) ----

test('upsertById / removeById: 置き換え・追加・削除。元の配列は変えない', () => {
  const list = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  const up = L.upsertById(list, { id: 'a', n: 9 });
  assert.deepEqual(up, [{ id: 'a', n: 9 }, { id: 'b', n: 2 }]);
  assert.deepEqual(list[0], { id: 'a', n: 1 });
  assert.equal(L.upsertById(list, { id: 'c', n: 3 }).length, 3);
  assert.deepEqual(L.removeById(list, 'b'), [{ id: 'a', n: 1 }]);
});

test('applyRemoteChange: 追加・更新・削除を反映し、変化なしなら同じ state を返す', () => {
  const s0 = { vehicles: [{ id: 'v1', driverName: '佐藤', updatedAt: '2026-10-23T01:00:00Z' }], records: [], issues: [], settings: { ...L.DEFAULT_SETTINGS } };
  const s1 = L.applyRemoteChange(s0, { table: 'vehicles', type: 'INSERT', id: 'v2', data: { id: 'v2', driverName: '鈴木', updatedAt: '2026-10-23T02:00:00Z' } });
  assert.equal(s1.vehicles.length, 2);
  assert.equal(s0.vehicles.length, 1);
  const s2 = L.applyRemoteChange(s1, { table: 'vehicles', type: 'UPDATE', id: 'v1', data: { id: 'v1', driverName: '佐藤 改', updatedAt: '2026-10-23T03:00:00Z' } });
  assert.equal(s2.vehicles.find((v) => v.id === 'v1').driverName, '佐藤 改');
  const s3 = L.applyRemoteChange(s2, { table: 'vehicles', type: 'DELETE', id: 'v2', data: null });
  assert.equal(s3.vehicles.length, 1);
  assert.equal(L.applyRemoteChange(s3, { table: 'vehicles', type: 'DELETE', id: 'zzz', data: null }), s3);
  assert.equal(L.applyRemoteChange(s3, { table: 'vehicles', type: 'UPDATE', id: 'v1', data: s3.vehicles[0] }), s3);
  assert.equal(L.applyRemoteChange(s3, { table: 'nope', type: 'UPDATE', id: 'x', data: {} }), s3);
});

test('applyRemoteChange: 自分が後から書いた行は古い通知で上書きしない', () => {
  const s0 = { vehicles: [{ id: 'v1', driverName: '新しい', updatedAt: '2026-10-23T05:00:00Z' }], records: [], issues: [], settings: {} };
  const s1 = L.applyRemoteChange(s0, { table: 'vehicles', type: 'UPDATE', id: 'v1', data: { id: 'v1', driverName: '古い', updatedAt: '2026-10-23T04:00:00Z' } });
  assert.equal(s1, s0);
});

test('applyRemoteChange: 設定は既定値に重ねる。削除なら既定値に戻る', () => {
  const s0 = { vehicles: [], records: [], issues: [], settings: { ...L.DEFAULT_SETTINGS, alertDays: 10 } };
  const s1 = L.applyRemoteChange(s0, { table: 'settings', type: 'UPDATE', id: 'default', data: { alertDays: 20, companyName: 'テスト運輸' } });
  assert.equal(s1.settings.alertDays, 20);
  assert.equal(s1.settings.companyName, 'テスト運輸');
  assert.deepEqual(s1.settings.bases, L.DEFAULT_SETTINGS.bases);
  const s2 = L.applyRemoteChange(s1, { table: 'settings', type: 'DELETE', id: 'default', data: null });
  assert.equal(s2.settings.alertDays, L.DEFAULT_SETTINGS.alertDays);
});

test('collectPhotoIds: 整備記録と異常の写真 ID を重複なしで集める', () => {
  const s = { records: [{ id: 'r1', photos: ['p1', 'p2'] }, { id: 'r2' }], issues: [{ id: 'i1', photos: ['p2', 'p3'] }] };
  assert.deepEqual(L.collectPhotoIds(s).sort(), ['p1', 'p2', 'p3']);
  assert.deepEqual(L.collectPhotoIds({}), []);
});

test('jaAuthError: 既知のエラーは日本語、未知はそのまま', () => {
  assert.equal(L.jaAuthError({ message: 'Invalid login credentials' }).message, 'メールアドレスかパスワードが違います');
  assert.equal(L.jaAuthError(new Error('TypeError: Failed to fetch')).message, '通信できませんでした。電波の状態を確認してください');
  assert.equal(L.jaAuthError({ message: 'something else' }).message, 'something else');
});

test('backupDue: 間隔を渡せる(クラウドは 30 日)', () => {
  assert.equal(L.backupDue('2026-10-01T00:00:00Z', 5, '2026-10-20', L.BACKUP_INTERVAL_DAYS_CLOUD), false);
  assert.equal(L.backupDue('2026-09-01T00:00:00Z', 5, '2026-10-20', L.BACKUP_INTERVAL_DAYS_CLOUD), true);
  assert.equal(L.backupDue('2026-10-01T00:00:00Z', 5, '2026-10-20'), true);
});
