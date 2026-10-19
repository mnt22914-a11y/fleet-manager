// 純粋関数だけを置く。DOM・localStorage には触らない(テストしやすくするため)。

export const STATUS = {
  active: '稼働中',
  repair: '修理中',
  idle: '休車',
  retired: '廃車',
};

export const DEFAULT_TYPES = [
  '車検', '法定点検', 'オイル交換', 'タイヤ交換', 'ブレーキ', 'バッテリー',
  '修理', '事故修理', '洗車・清掃', 'その他',
];

export const DEFAULT_SETTINGS = {
  alertDays: 30,        // この日数以内 → 要対応(赤)
  warnDays: 60,         // この日数以内 → 注意(黄)
  odometerWarnKm: 1000, // 次回整備の目安距離まで残りこの km 以内 → 要対応
  bases: ['本社'],
  types: DEFAULT_TYPES,
  companyName: '',
};

export const LEVEL_ORDER = { expired: 0, critical: 1, warning: 2, ok: 3, none: 4 };
export const LEVEL_LABEL = { expired: '期限切れ', critical: '要対応', warning: '注意', ok: '問題なし', none: '未登録' };

export const ALERT_KIND_LABEL = {
  inspection: '車検',
  jibaiseki: '自賠責',
  insurance: '任意保険',
  maintenance: '次回整備',
};

// ---- 日付 ----

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISO(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function isValidDate(s) {
  return parseISO(s) !== null;
}

/** 今日から dateStr までの日数。過去なら負、不正なら null。 */
export function daysUntil(dateStr, today = todayISO()) {
  const a = parseISO(dateStr);
  const b = parseISO(today);
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}

/** 月を足す。月末を越える日は末日に丸める(1/31 + 1か月 = 2/28)。 */
export function addMonths(dateStr, n) {
  const d = parseISO(dateStr);
  if (!d) return '';
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return todayISO(target);
}

export function yearMonth(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : '';
}

/** 期限日から警告レベルを決める。 */
export function deadlineLevel(dateStr, settings = DEFAULT_SETTINGS, today = todayISO()) {
  const days = daysUntil(dateStr, today);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= settings.alertDays) return 'critical';
  if (days <= settings.warnDays) return 'warning';
  return 'ok';
}

/** 残り距離から警告レベルを決める。 */
export function odometerLevel(remainingKm, settings = DEFAULT_SETTINGS) {
  if (remainingKm === null || remainingKm === undefined || Number.isNaN(remainingKm)) return 'none';
  if (remainingKm < 0) return 'expired';
  if (remainingKm <= settings.odometerWarnKm) return 'critical';
  if (remainingKm <= settings.odometerWarnKm * 2) return 'warning';
  return 'ok';
}

// ---- アラート ----

/** 種別ごとに最新の整備記録だけを返す(古い記録の「次回目安」で鳴り続けないように)。 */
export function latestByType(records) {
  const map = new Map();
  for (const r of records) {
    const cur = map.get(r.type);
    if (!cur || r.date > cur.date || (r.date === cur.date && (r.createdAt || '') > (cur.createdAt || ''))) {
      map.set(r.type, r);
    }
  }
  return [...map.values()];
}

/** 1 台分のアラート。廃車は対象外。 */
export function vehicleAlerts(vehicle, records, settings = DEFAULT_SETTINGS, today = todayISO()) {
  if (vehicle.status === 'retired') return [];
  const out = [];
  const deadlines = [
    ['inspection', vehicle.inspectionExpiry],
    ['jibaiseki', vehicle.jibaisekiExpiry],
    ['insurance', vehicle.insuranceExpiry],
  ];
  for (const [kind, date] of deadlines) {
    const level = deadlineLevel(date, settings, today);
    if (level === 'none' || level === 'ok') continue;
    out.push({
      kind, level, date,
      days: daysUntil(date, today),
      vehicleId: vehicle.id,
      label: `${ALERT_KIND_LABEL[kind]}満了`,
    });
  }
  for (const r of latestByType(records.filter((x) => x.vehicleId === vehicle.id))) {
    if (r.nextDate) {
      const level = deadlineLevel(r.nextDate, settings, today);
      if (level !== 'none' && level !== 'ok') {
        out.push({
          kind: 'maintenance', level, date: r.nextDate,
          days: daysUntil(r.nextDate, today),
          vehicleId: vehicle.id, recordId: r.id,
          label: `${r.type}の目安日`,
        });
      }
    }
    if (r.nextOdometer && vehicle.odometer != null) {
      const remaining = Number(r.nextOdometer) - Number(vehicle.odometer);
      const level = odometerLevel(remaining, settings);
      if (level !== 'none' && level !== 'ok') {
        out.push({
          kind: 'maintenance', level,
          km: remaining,
          vehicleId: vehicle.id, recordId: r.id,
          label: `${r.type}の目安距離`,
        });
      }
    }
  }
  return out;
}

export function sortAlerts(alerts) {
  return [...alerts].sort((a, b) => {
    const l = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (l !== 0) return l;
    const da = a.days ?? (a.km != null ? a.km / 100 : 9999);
    const db = b.days ?? (b.km != null ? b.km / 100 : 9999);
    return da - db;
  });
}

export function allAlerts(vehicles, records, settings = DEFAULT_SETTINGS, today = todayISO()) {
  return sortAlerts(vehicles.flatMap((v) => vehicleAlerts(v, records, settings, today)));
}

/** 車両の総合レベル(一覧の色分け用)。 */
export function vehicleLevel(vehicle, records, settings, today) {
  const alerts = vehicleAlerts(vehicle, records, settings, today);
  if (alerts.length === 0) return 'ok';
  return sortAlerts(alerts)[0].level;
}

// ---- 検索・並び替え ----

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[\s\-ー－]/g, '');
}

export function filterVehicles(vehicles, { q = '', base = '', status = '' } = {}) {
  const nq = norm(q);
  return vehicles.filter((v) => {
    if (base && v.base !== base) return false;
    if (status && v.status !== status) return false;
    if (!nq) return true;
    const hay = norm([v.driverName, v.plate, v.maker, v.modelCode, v.qr, v.note, v.loaner?.plate].join(' '));
    return hay.includes(nq);
  });
}

export function sortBy(list, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null || x === '') return 1;
    if (y == null || y === '') return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y), 'ja') * sign;
  });
}

// ---- 集計 ----

export function sumCost(records, { ym = '', vehicleId = '', type = '' } = {}) {
  return records.reduce((acc, r) => {
    if (ym && yearMonth(r.date) !== ym) return acc;
    if (vehicleId && r.vehicleId !== vehicleId) return acc;
    if (type && r.type !== type) return acc;
    return acc + (Number(r.cost) || 0);
  }, 0);
}

/** 直近 n か月の月別整備費。古い月から順に返す。 */
export function monthlyCosts(records, n = 6, today = todayISO()) {
  const out = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ ym, total: sumCost(records, { ym }) });
  }
  return out;
}

export function costByType(records) {
  const map = new Map();
  for (const r of records) map.set(r.type, (map.get(r.type) || 0) + (Number(r.cost) || 0));
  return [...map.entries()].map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total);
}

export function countByStatus(vehicles) {
  const out = { active: 0, repair: 0, idle: 0, retired: 0 };
  for (const v of vehicles) if (out[v.status] != null) out[v.status]++;
  return out;
}

// ---- 検証 ----

export const ACCIDENT_TYPES = ['追突(自車が後ろから)', '追突された', '接触(すれ違い・車線変更)', '出会い頭', '右左折時', 'バック時', '自損(単独)', '駐車中(当て逃げ含む)', 'その他'];

export const LOANER_TYPE = { own: '自社代車', rental: '借代車' };

/** 代車の表示名。own は車両一覧から探して渡す。 */
export function loanerLabel(loaner, vehicles = []) {
  if (!loaner) return '';
  if (loaner.type === 'rental') return `借代車 ${loaner.plate || ''}`.trim();
  const v = vehicles.find((x) => x.id === loaner.vehicleId);
  return v ? `自社代車 ${v.plate}` : '自社代車';
}

export function validateVehicle(v) {
  const errors = [];
  if (!v.driverName?.trim()) errors.push('ドライバー名を入力してください');
  if (!v.plate?.trim()) errors.push('ナンバーを入力してください');
  if (v.loaner) {
    if (!LOANER_TYPE[v.loaner.type]) errors.push('代車の種類を選んでください');
    if (v.loaner.type === 'rental' && !v.loaner.plate?.trim()) errors.push('借代車のナンバーを入力してください');
    if (v.loaner.type === 'own' && !v.loaner.vehicleId) errors.push('自社代車の車両を選んでください');
    if (v.loaner.type === 'own' && v.loaner.vehicleId === v.id) errors.push('自分自身を代車にはできません');
  }
  for (const [k, label] of [
    ['inspectionExpiry', '車検満了日'], ['jibaisekiExpiry', '自賠責満了日'],
    ['insuranceExpiry', '任意保険満了日'], ['odometerDate', '走行距離の記録日'],
  ]) {
    if (v[k] && !isValidDate(v[k])) errors.push(`${label}の日付が正しくありません`);
  }
  if (v.odometer != null && v.odometer !== '' && (Number.isNaN(Number(v.odometer)) || Number(v.odometer) < 0)) {
    errors.push('走行距離は 0 以上の数で入力してください');
  }
  if (!STATUS[v.status]) errors.push('ステータスを選んでください');
  return errors;
}

export function validateRecord(r) {
  const errors = [];
  if (!r.vehicleId) errors.push('車両を選んでください');
  if (!isValidDate(r.date)) errors.push('実施日を入力してください');
  if (!r.type?.trim()) errors.push('種別を選んでください');
  if (r.cost !== '' && r.cost != null && (Number.isNaN(Number(r.cost)) || Number(r.cost) < 0)) errors.push('費用は 0 以上の数で入力してください');
  if (r.odometer !== '' && r.odometer != null && (Number.isNaN(Number(r.odometer)) || Number(r.odometer) < 0)) errors.push('走行距離は 0 以上の数で入力してください');
  if (r.nextDate && !isValidDate(r.nextDate)) errors.push('次回目安日の日付が正しくありません');
  if (r.nextDate && isValidDate(r.date) && r.nextDate <= r.date) errors.push('次回目安日は実施日より後にしてください');
  if (r.nextOdometer !== '' && r.nextOdometer != null && Number.isNaN(Number(r.nextOdometer))) errors.push('次回目安距離は数で入力してください');
  return errors;
}

// ---- 書式 ----

export function fmtDate(iso) {
  if (!iso) return '—';
  return iso.replace(/-/g, '/');
}

export function fmtYen(n) {
  if (n == null || n === '') return '—';
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

export function fmtKm(n) {
  if (n == null || n === '') return '—';
  return `${Number(n).toLocaleString('ja-JP')} km`;
}

export function fmtDays(days) {
  if (days == null) return '';
  if (days < 0) return `${-days}日超過`;
  if (days === 0) return '今日';
  return `あと${days}日`;
}

// ---- CSV ----

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [{ key, label, get? }] 。Excel で開けるよう BOM + CRLF。 */
export function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.get ? c.get(r) : r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

// ---- その他 ----

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

// ---- 車体の部位と異常 ----

/** 上から見た車の図の部位。spot があるものは図の上に描き、ないものは図の下のチップで表す。 */
export const PARTS = [
  // onBody: 図(側面・正面・背面・上面)に描ける部位。描けないものはチップで表す
  { id: 'front_bumper', label: 'フロントバンパー', short: '前バンパー', onBody: true },
  { id: 'hood', label: 'フロント周り(エンジン・ラジエーター・ボンネット・フェンダー)', short: 'フロント', onBody: true },
  { id: 'windshield', label: 'フロントガラス・ワイパー', short: 'ガラス', onBody: true },
  { id: 'cabin', label: '運転席・助手席(前ドア・エアコン・計器)', short: '運転席', onBody: true },
  { id: 'cargo', label: '荷室(リアクォーター・ルーフ)', short: '荷室', onBody: true },
  { id: 'rear', label: 'バックドア・テールゲート・後バンパー', short: '後部', onBody: true },
  { id: 'side_l', label: '左スライドドア', short: '左スライド', onBody: true },
  { id: 'side_r', label: '右スライドドア', short: '右スライド', onBody: true },
  { id: 'mirror_l', label: '左ミラー', short: '左ミラー', onBody: true },
  { id: 'mirror_r', label: '右ミラー', short: '右ミラー', onBody: true },
  { id: 'wheel_fl', label: '左前タイヤ・ブレーキ', short: '左前', onBody: true },
  { id: 'wheel_fr', label: '右前タイヤ・ブレーキ', short: '右前', onBody: true },
  { id: 'wheel_rl', label: '左後タイヤ・ブレーキ', short: '左後', onBody: true },
  { id: 'wheel_rr', label: '右後タイヤ・ブレーキ', short: '右後', onBody: true },
  { id: 'lamp_fl', label: '左ヘッドライト(ウインカー・フォグ含む)', short: '左ヘッドライト', onBody: true },
  { id: 'lamp_fr', label: '右ヘッドライト(ウインカー・フォグ含む)', short: '右ヘッドライト', onBody: true },
  { id: 'lamp_rl', label: '左テールランプ(ブレーキ・ウインカー・バック)', short: '左テール', onBody: true },
  { id: 'lamp_rr', label: '右テールランプ(ブレーキ・ウインカー・バック)', short: '右テール', onBody: true },
  { id: 'underbody', label: '下回り・マフラー・足回り', short: '下回り', onBody: true },
  { id: 'battery', label: 'バッテリー・電装', short: '電装', onBody: false },
  { id: 'other', label: 'その他', short: 'その他', onBody: false },
];

export const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));

/** 記録のときの選び方: まず場所の種類、次に左右前後(ある場合)。variants の 2 つ目が表示名。 */
export const PART_GROUPS = [
  { id: 'lamp', label: 'ランプ', variants: [['lamp_fl', '左前'], ['lamp_fr', '右前'], ['lamp_rl', '左後'], ['lamp_rr', '右後']] },
  { id: 'wheel', label: 'タイヤ・ブレーキ', variants: [['wheel_fl', '左前'], ['wheel_fr', '右前'], ['wheel_rl', '左後'], ['wheel_rr', '右後']] },
  { id: 'mirror', label: 'ミラー', variants: [['mirror_l', '左'], ['mirror_r', '右']] },
  { id: 'slide', label: 'スライドドア', variants: [['side_l', '左'], ['side_r', '右']] },
  { id: 'bumper', label: 'バンパー', variants: [['front_bumper', '前'], ['rear', '後(バックドア含む)']] },
  { id: 'windshield', label: 'フロントガラス・ワイパー', variants: [['windshield', '']] },
  { id: 'hood', label: 'フロント周り(エンジン・フェンダー)', variants: [['hood', '']] },
  { id: 'cabin', label: '運転席・前ドア', variants: [['cabin', '']] },
  { id: 'cargo', label: '荷室・ルーフ', variants: [['cargo', '']] },
  { id: 'underbody', label: '下回り・足回り', variants: [['underbody', '']] },
  { id: 'battery', label: 'バッテリー・電装', variants: [['battery', '']] },
  { id: 'other', label: 'その他', variants: [['other', '']] },
];

export function groupOfPart(partId) {
  return PART_GROUPS.find((g) => g.variants.some(([id]) => id === partId)) || null;
}

export const SEVERITY = {
  high: { label: '至急', order: 0 },   // 走行に支障がある
  mid: { label: '早めに', order: 1 },  // 近いうちに直す
  low: { label: '様子見', order: 2 },  // 記録しておく
};

export function partLabel(id) {
  return PART_BY_ID[id]?.label || id || '部位未設定';
}

export function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    const s = (SEVERITY[a.severity]?.order ?? 9) - (SEVERITY[b.severity]?.order ?? 9);
    if (s !== 0) return s;
    return (b.reportedAt || '').localeCompare(a.reportedAt || '');
  });
}

export function openIssues(issues, vehicleId) {
  return issues.filter((i) => i.status === 'open' && (!vehicleId || i.vehicleId === vehicleId));
}

/** 部位ごとの「いちばん重い未対応の異常」と件数。図の色分けに使う。 */
export function partStatus(issues) {
  const map = {};
  for (const i of issues) {
    if (i.status !== 'open') continue;
    const cur = map[i.part] || { count: 0, severity: null };
    cur.count++;
    if (!cur.severity || SEVERITY[i.severity].order < SEVERITY[cur.severity].order) cur.severity = i.severity;
    map[i.part] = cur;
  }
  return map;
}

export function validateIssue(i) {
  const errors = [];
  if (!i.vehicleId) errors.push('車両を選んでください');
  if (!PART_BY_ID[i.part]) errors.push('部位を選んでください');
  if (!SEVERITY[i.severity]) errors.push('緊急度を選んでください');
  if (!i.title?.trim()) errors.push('異常の内容を入力してください');
  if (!isValidDate(i.reportedAt)) errors.push('発生日を入力してください');
  if (i.accident) {
    if (i.accident.datetime && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(i.accident.datetime)) errors.push('事故の日時が正しくありません');
  }
  if (i.status === 'fixed' && i.fixedAt && !isValidDate(i.fixedAt)) errors.push('対応日の日付が正しくありません');
  return errors;
}
