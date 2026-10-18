// 試作用のサンプルデータ。設定画面の「サンプルデータを入れる」から使う。
// 乱数は固定シードなので、何度入れても同じ内容になる。

import { addMonths, todayISO, uid, nowISO } from './logic.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MODELS = [
  { maker: 'スズキ', model: 'エブリイ', cls: '480' },
  { maker: 'ダイハツ', model: 'ハイゼットカーゴ', cls: '480' },
  { maker: 'ホンダ', model: 'N-VAN', cls: '480' },
  { maker: '日産', model: 'クリッパーバン', cls: '480' },
  { maker: '三菱', model: 'ミニキャブバン', cls: '480' },
  { maker: 'スズキ', model: 'エブリイ', cls: '480' },
  { maker: 'ダイハツ', model: 'ハイゼットカーゴ', cls: '480' },
  { maker: 'トヨタ', model: 'ピクシスバン', cls: '480' },
];
const REGIONS = ['品川', '足立', '横浜', '川崎', '千葉', '大宮'];
const KANA = ['あ', 'い', 'う', 'か', 'き', 'く', 'さ', 'す'];
const DRIVERS = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田'];
const VENDORS = ['（株）東都モータース', 'オートバックス 環七店', 'いすゞ自動車 首都圏', 'トヨタモビリティ東京', 'タイヤ館 戸田', '自社整備'];

function shift(today, days) {
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

export function buildSample(today = todayISO()) {
  const r = rng(20261018);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const bases = ['本社(足立)', '横浜営業所', '千葉営業所'];
  const vehicles = [];
  const records = [];
  const n = 24;

  for (let i = 0; i < n; i++) {
    const m = pick(MODELS);
    const base = bases[i % bases.length];
    const yearsOld = 1 + Math.floor(r() * 8);
    const firstReg = `${2026 - yearsOld}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}`;
    const odometer = Math.round((yearsOld * 25000 + r() * 20000) / 100) * 100;
    // 車検: 一部をあえて期限切れ・直近にしてアラートを見せる
    let inspDays;
    if (i === 2) inspDays = -12;
    else if (i === 5) inspDays = 8;
    else if (i === 9) inspDays = 25;
    else if (i === 13) inspDays = 47;
    else inspDays = 70 + Math.floor(r() * 290);
    const inspection = shift(today, inspDays);
    const jibaiseki = shift(inspection, Math.floor(r() * 30) + 1);
    const insurance = i === 7 ? shift(today, 15) : shift(today, 30 + Math.floor(r() * 330));
    let status = 'active';
    if (i === 11) status = 'repair';
    if (i === 17) status = 'idle';
    if (i === 23) status = 'retired';
    const plateCls = m.cls;
    const v = {
      id: uid(),
      code: `V-${String(i + 1).padStart(3, '0')}`,
      name: `${m.model.split(' ')[0]} ${i + 1}号車`,
      plate: `${pick(REGIONS)} ${plateCls} ${pick(KANA)} ${String(10 + Math.floor(r() * 89))}-${String(10 + Math.floor(r() * 89))}`,
      maker: m.maker,
      model: m.model,
      modelCode: '',
      vin: '',
      firstRegistration: firstReg,
      inspectionExpiry: status === 'retired' ? '' : inspection,
      jibaisekiExpiry: status === 'retired' ? '' : jibaiseki,
      insuranceExpiry: status === 'retired' ? '' : insurance,
      insuranceCompany: pick(['東京海上日動', '損保ジャパン', '三井住友海上', 'あいおいニッセイ同和']),
      base,
      odometer,
      odometerDate: shift(today, -Math.floor(r() * 20)),
      driver: pick(DRIVERS),
      status,
      note: i === 11 ? 'バンパー破損で入庫中。10/25 出庫予定' : '',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    vehicles.push(v);

    // 整備履歴: オイル交換は走行ペース(1 日 60 km 前後)に合わせて約 5,000 km ごと、
    // 最新の 1 回は直近 0〜85 日のどこか(目安を超えた車と余裕のある車が混ざる)
    const kmPerDay = 50 + Math.floor(r() * 25);
    const kmAt = (daysAgo) => Math.max(0, odometer - Math.round((daysAgo * kmPerDay) / 100) * 100);
    const oilCount = 2 + Math.floor(r() * 2);
    let daysAgo = Math.floor(r() * 85);
    for (let k = 0; k < oilCount; k++) {
      const date = shift(today, -daysAgo);
      const km = kmAt(daysAgo);
      records.push({
        id: uid(), vehicleId: v.id, date, type: 'オイル交換', title: k === 0 ? 'オイル・エレメント交換' : '',
        detail: '', vendor: pick(VENDORS), cost: 6000 + Math.floor(r() * 4) * 500, odometer: km,
        nextDate: '', nextOdometer: km + 5000, note: '', createdAt: nowISO(), updatedAt: nowISO(),
      });
      daysAgo += 70 + Math.floor(r() * 40);
    }
    // そのほかの整備をいくつか
    const count = 1 + Math.floor(r() * 4);
    for (let k = 0; k < count; k++) {
      const ago = Math.floor(r() * 365);
      const date = shift(today, -ago);
      const type = pick(['タイヤ交換', '法定点検', '修理', 'バッテリー', '洗車・清掃', '修理']);
      records.push({
        id: uid(), vehicleId: v.id, date, type,
        title: type === '修理' ? pick(['サイドミラー交換', 'ワイパーモーター交換', 'ブレーキランプ球切れ', 'エアコン修理']) : '',
        detail: '', vendor: pick(VENDORS),
        cost: type === 'タイヤ交換' ? 40000 + Math.floor(r() * 30) * 1000
          : type === '法定点検' ? 15000 + Math.floor(r() * 10) * 1000
          : type === 'バッテリー' ? 18000 + Math.floor(r() * 10) * 1000
          : type === '洗車・清掃' ? 2000
          : 8000 + Math.floor(r() * 40) * 1000,
        odometer: kmAt(ago),
        nextDate: type === '法定点検' ? addMonths(date, 6) : '',
        nextOdometer: '', note: '', createdAt: nowISO(), updatedAt: nowISO(),
      });
    }
    // 前回車検の記録
    records.push({
      id: uid(), vehicleId: v.id, date: addMonths(inspection, -12), type: '車検', title: '継続検査',
      detail: '', vendor: pick(VENDORS), cost: 90000 + Math.floor(r() * 60) * 1000,
      odometer: Math.max(0, odometer - 20000), nextDate: '', nextOdometer: '', note: '',
      createdAt: nowISO(), updatedAt: nowISO(),
    });
  }

  // 異常: 部位ごとに未対応のものをいくつか、対応済みも 1 件
  const issues = [];
  const addIssue = (idx, part, severity, title, detail, daysAgo, fixed = false) => issues.push({
    id: uid(), vehicleId: vehicles[idx].id, part, severity, title, detail,
    reportedAt: shift(today, -daysAgo), status: fixed ? 'fixed' : 'open',
    fixedAt: fixed ? shift(today, -Math.max(0, daysAgo - 4)) : '',
    createdAt: nowISO(), updatedAt: nowISO(),
  });
  addIssue(0, 'side_l', 'mid', '左スライドドアが閉まりにくい', 'レールにゴミが噛んでいる可能性。閉めるときに 2 回押す必要あり', 3);
  addIssue(0, 'wheel_rr', 'low', '右後タイヤの空気が抜けやすい', '週 1 回 20kPa ほど下がる。バルブか釘の可能性', 9);
  addIssue(0, 'lights', 'low', 'ナンバー灯が切れている', '', 1);
  addIssue(11, 'front_bumper', 'high', 'フロントバンパー破損(接触事故)', '10/14 荷下ろし時にポールへ接触。左角が割れて垂れ下がっている', 4);
  addIssue(11, 'hood', 'mid', 'アイドリングが不安定', '信号待ちで回転数が上下する', 12);
  addIssue(5, 'windshield', 'high', 'フロントガラスにヒビ(運転席側 15cm)', '飛び石。視界にかかるため早急に交換', 2);
  addIssue(8, 'cargo', 'mid', '荷室の床板がめくれている', '台車が引っかかる', 6);
  addIssue(14, 'battery', 'mid', '朝一のエンジン始動が弱い', 'バッテリー交換から 3 年', 5);
  addIssue(3, 'mirror_r', 'low', '右ミラーの電動格納が遅い', '', 20);
  addIssue(2, 'wheel_fl', 'high', 'ブレーキ時に左前から異音', 'キーキー音。パッド摩耗の疑い', 1);
  addIssue(6, 'rear', 'mid', 'バックランプ片側不点灯', '', 15, true);

  return {
    vehicles,
    records,
    issues,
    settings: { alertDays: 30, warnDays: 60, odometerWarnKm: 1000, bases, companyName: 'サンプル運送（株）' },
  };
}
