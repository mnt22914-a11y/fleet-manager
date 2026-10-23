// 画面。状態は store.js、計算は logic.js に任せ、ここでは HTML を組んでイベントを捌くだけ。

import * as store from './store.js';
import * as L from './logic.js';
import { buildSample } from './sample.js';
import * as photos from './photos.js';
import { renderViews, renderPickView, viewsForPart, VIEWS } from './views2d.js';

const $app = document.getElementById('app');
const $dialogRoot = document.getElementById('dialog-root');
const $toast = document.getElementById('toast');

// 画面ごとの UI 状態(フィルタや並び順)。保存はしない。
const ui = {
  vehicles: { q: '', base: '', status: '', onlyAlert: false, sortKey: 'driverName', sortDir: 'asc', view: 'lot' },
  maintenance: { q: '', ym: '', vehicleId: '', type: '' },
  detail: { part: '' },
};

// ---- ユーティリティ ----

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.className = ''), 2600);
}

function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function vehicleLabel(v) {
  if (!v) return '(削除された車両)';
  return `${v.driverName || '(名前なし)'}`;
}

function badgeLevel(level) {
  return `<span class="badge ${level}">${L.LEVEL_LABEL[level]}</span>`;
}

function badgeSeverity(sev) {
  return `<span class="badge plain sev-${sev}">${L.SEVERITY[sev]?.label || sev}</span>`;
}

function badgeStatus(status) {
  return `<span class="badge plain status-${status}">${esc(L.STATUS[status] || status)}</span>`;
}

function deadlineCell(date, settings, today) {
  if (!date) return '<span class="muted">—</span>';
  const level = L.deadlineLevel(date, settings, today);
  const days = L.daysUntil(date, today);
  return `<div class="deadline ${level}"><span class="d">${L.fmtDate(date)}</span><span class="rel">${L.fmtDays(days)}</span></div>`;
}

function opt(value, label, selected) {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

// ---- ルーティング ----

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'vehicles' && parts[1]) return { name: 'vehicle', id: decodeURIComponent(parts[1]) };
  if (['vehicles', 'maintenance', 'settings'].includes(parts[0])) return { name: parts[0] };
  return { name: 'home' };
}

function render() {
  const route = parseRoute();
  const state = store.getState();
  const today = L.todayISO();
  const alerts = L.allAlerts(state.vehicles, state.records, state.settings, today);
  const urgent = alerts.filter((a) => a.level === 'expired' || a.level === 'critical').length;

  // ナビの状態
  const navKey = route.name === 'vehicle' ? 'vehicles' : route.name;
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
  const $count = document.getElementById('nav-alert-count');
  $count.textContent = urgent;
  $count.classList.toggle('hidden', urgent === 0);
  document.getElementById('brand-company').textContent = state.settings.companyName || '配送車両の台帳と整備記録';

  let html = '';
  switch (route.name) {
    case 'vehicles': html = renderVehicles(state, today); break;
    case 'vehicle': html = renderVehicleDetail(state, route.id, today); break;
    case 'maintenance': html = renderMaintenance(state, today); break;
    case 'settings': html = renderSettings(state); break;
    default: html = renderHome(state, alerts, today);
  }
  $app.innerHTML = html;
  $app.scrollTop = 0;
}

// ---- ダッシュボード ----

function lastBackupText(settings, today) {
  const d = L.daysSinceBackup(settings.lastBackupAt, today);
  if (d == null) return 'まだ一度も書き出していません';
  return `最終バックアップ: ${L.fmtDate(String(settings.lastBackupAt).slice(0, 10))}(${d === 0 ? '今日' : `${d} 日前`})`;
}

function backupInterval() {
  return store.mode() === 'cloud' ? L.BACKUP_INTERVAL_DAYS_CLOUD : L.BACKUP_INTERVAL_DAYS;
}

function backupBanner(settings, vehicleCount, today) {
  if (!L.backupDue(settings.lastBackupAt, vehicleCount, today, backupInterval())) return '';
  const cloud = store.mode() === 'cloud';
  const why = cloud
    ? 'データはクラウドに保存されていますが、念のため月 1 回は手元にも残してください。ファイルは会社の共有フォルダなどに置きます。'
    : 'データはこの PC のブラウザにだけ保存されています。週 1 回を目安に書き出し、ファイルは会社の共有フォルダなどに置いてください。';
  return `<div class="banner backup" style="margin-bottom:16px">
    <div><strong>バックアップを書き出してください</strong><div class="muted" style="font-size:12.5px">${esc(lastBackupText(settings, today))}。${why}</div></div>
    <button class="btn primary" data-action="export-json">いまバックアップを書き出す</button>
  </div>`;
}

function renderHome(state, alerts, today) {
  const { vehicles, records, settings, issues } = state;
  const openIssues = L.sortIssues(L.openIssues(issues));
  if (vehicles.length === 0) {
    return `
      <div class="page-head"><div><h1>ダッシュボード</h1><p class="sub">${L.fmtDate(today)}</p></div></div>
      <div class="card"><div class="empty" style="padding:48px 18px">
        <strong style="font-size:16px">まだ車両が登録されていません</strong>
        <p style="margin:6px 0 18px">車両を 1 台ずつ登録するか、まずサンプルデータで画面を試せます。</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn primary" data-action="add-vehicle">＋ 車両を追加</button>
          <label class="btn">CSV で一括登録<input type="file" accept=".csv,text/csv" data-action-file="import-vehicles-csv" hidden></label>
          <button class="btn" data-action="load-sample">サンプルデータを入れる</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:14px">一括登録は、設定 →「車両 CSV のテンプレート」を Excel で埋めてから読み込みます。</p>
      </div></div>`;
  }
  const counts = L.countByStatus(vehicles);
  const urgent = alerts.filter((a) => a.level === 'expired' || a.level === 'critical');
  const warn = alerts.filter((a) => a.level === 'warning');
  const ym = today.slice(0, 7);
  const monthCost = L.sumCost(records, { ym });
  const recent = [...records].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 6);
  const months = L.monthlyCosts(records, 6, today);
  const max = Math.max(1, ...months.map((m) => m.total));
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  return `
    <div class="page-head">
      <div><h1>ダッシュボード</h1><p class="sub">${L.fmtDate(today)} 時点</p></div>
      <div class="actions">
        <button class="btn" data-action="add-record">＋ 整備を記録</button>
        <button class="btn primary" data-action="add-vehicle">＋ 車両を追加</button>
      </div>
    </div>
    ${backupBanner(settings, vehicles.length, today)}
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">車両数(廃車を除く)</div><div class="value">${vehicles.length - counts.retired}<small>台</small></div>
        <div class="sub">稼働 ${counts.active} / 修理中 ${counts.repair} / 休車 ${counts.idle}</div></div>
      <div class="card kpi ${urgent.length ? 'tone-critical' : 'tone-ok'}"><div class="label">要対応(期限切れ・${settings.alertDays}日以内)</div><div class="value">${urgent.length}<small>件</small></div>
        <div class="sub">${urgent.length ? '早めに手配してください' : '差し迫った期限はありません'}</div></div>
      <div class="card kpi"><div class="label">注意(${settings.warnDays}日以内)</div><div class="value">${warn.length}<small>件</small></div>
        <div class="sub">予定を立てておく目安</div></div>
      <div class="card kpi"><div class="label">今月の整備費</div><div class="value">${L.fmtYen(monthCost)}</div>
        <div class="sub">${records.filter((r) => L.yearMonth(r.date) === ym).length} 件の記録</div></div>
    </div>
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head"><h2>期限と整備のアラート</h2><span class="muted">${alerts.length} 件</span></div>
        ${alerts.length === 0 ? '<div class="empty"><strong>アラートはありません</strong>車検・保険・次回整備の目安がすべて余裕のある状態です。</div>' : `
        <div class="alert-list">
          ${alerts.slice(0, 30).map((a) => {
            const v = byId.get(a.vehicleId);
            const when = a.days != null ? `<div class="d">${L.fmtDate(a.date)}</div><div class="rel">${L.fmtDays(a.days)}</div>`
              : `<div class="d">目安まで</div><div class="rel">${a.km < 0 ? `${L.fmtKm(-a.km)} 超過` : `あと ${L.fmtKm(a.km)}`}</div>`;
            return `<div class="alert-item ${a.level}" data-action="open-vehicle" data-id="${esc(a.vehicleId)}">
              <div class="bar"></div>
              <div><div class="what">${esc(a.label)} ${badgeLevel(a.level)}</div><div class="who">${esc(vehicleLabel(v))} ・ ${esc(v?.plate || '')}${v?.base ? ' ・ ' + esc(v.base) : ''}</div></div>
              <div class="when">${when}</div>
            </div>`;
          }).join('')}
          ${alerts.length > 30 ? `<div class="empty">ほか ${alerts.length - 30} 件は車両台帳で確認できます</div>` : ''}
        </div>`}
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>未対応の異常</h2><span class="muted">${openIssues.length} 件</span></div>
          <div class="card-body" style="padding-top:4px;padding-bottom:4px">
            ${openIssues.length === 0 ? '<div class="empty">未対応の異常はありません</div>' : `<div class="issue-list">${openIssues.slice(0, 6).map((i) => issueItem(i, { showVehicle: true })).join('')}</div>${openIssues.length > 6 ? `<div class="muted" style="font-size:12px;padding:8px 0">ほか ${openIssues.length - 6} 件</div>` : ''}`}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>月別の整備費</h2><span class="muted">直近 6 か月</span></div>
          <div class="card-body">
            <div class="bars">
              ${months.map((m) => `<div class="bar-col"><div class="bar-v">${m.total ? '¥' + Math.round(m.total / 1000).toLocaleString() + 'k' : ''}</div><div class="bar-b" style="height:${Math.max(2, Math.round((m.total / max) * 100))}%"></div><div class="bar-l">${Number(m.ym.slice(5))}月</div></div>`).join('')}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>最近の整備記録</h2><a href="#/maintenance" class="muted" style="font-size:12.5px">すべて見る</a></div>
          <div class="card-body" style="padding-top:6px;padding-bottom:6px">
            ${recent.length === 0 ? '<div class="empty">まだ記録がありません</div>' : `<div class="list-rows">${recent.map((r) => `
              <div class="list-row"><div><div><strong>${esc(r.type)}</strong> <span class="muted">${esc(r.title && r.title !== r.type ? r.title : '')}</span></div><div class="muted" style="font-size:12px">${L.fmtDate(r.date)} ・ ${esc(vehicleLabel(byId.get(r.vehicleId)))}</div></div><div class="num nowrap">${L.fmtYen(r.cost)}</div></div>`).join('')}</div>`}
          </div>
        </div>
      </div>
    </div>`;
}

// ---- 車両台帳 ----

function renderVehicles(state, today) {
  const { vehicles, records, settings, issues } = state;
  const u = ui.vehicles;
  const issueStatus = new Map(vehicles.map((v) => [v.id, L.partStatus(issues.filter((i) => i.vehicleId === v.id))]));
  let list = L.filterVehicles(vehicles, { q: u.q, base: u.base, status: u.status === '__all' || u.status === '' ? '' : u.status });
  if (u.status === '') list = list.filter((v) => v.status !== 'retired');
  const withLevel = list.map((v) => ({ ...v, _level: L.vehicleLevel(v, records, settings, today), _levelOrder: L.LEVEL_ORDER[L.vehicleLevel(v, records, settings, today)] }));
  let rows = u.onlyAlert ? withLevel.filter((v) => v._level !== 'ok') : withLevel;
  rows = L.sortBy(rows, u.sortKey === '_level' ? '_levelOrder' : u.sortKey, u.sortDir);

  const alertsByVehicle = new Map();
  for (const a of L.allAlerts(rows, records, settings, today)) {
    const cur = alertsByVehicle.get(a.vehicleId) || [];
    cur.push(a);
    alertsByVehicle.set(a.vehicleId, cur);
  }
  const th = (key, label, cls = '') => {
    const active = u.sortKey === key;
    return `<th class="sortable ${cls}" data-action="sort" data-key="${key}">${label}<span class="sort-ind">${active ? (u.sortDir === 'asc' ? '▲' : '▼') : ''}</span></th>`;
  };

  return `
    <div class="page-head">
      <div><h1>車両台帳</h1><p class="sub">全 ${vehicles.length} 台(廃車 ${vehicles.filter((v) => v.status === 'retired').length} 台を含む)</p></div>
      <div class="actions">
        <label class="btn">CSV 読み込み<input type="file" accept=".csv,text/csv" data-action-file="import-vehicles-csv" hidden></label>
        <button class="btn" data-action="export-vehicles-csv">CSV 書き出し</button>
        <button class="btn primary" data-action="add-vehicle">＋ 車両を追加</button>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="ドライバー名・ナンバー・車両QRで検索" value="${esc(u.q)}" data-filter="vehicles.q">
        <select data-filter="vehicles.base">${opt('', 'すべてのチーム', !u.base)}${settings.bases.map((b) => opt(b, b, u.base === b)).join('')}</select>
        <select data-filter="vehicles.status">
          ${opt('', '廃車以外', u.status === '')}
          ${Object.entries(L.STATUS).map(([k, v]) => opt(k, v, u.status === k)).join('')}
          ${opt('__all', 'すべて', u.status === '__all')}
        </select>
        <label class="inline-check"><input type="checkbox" data-filter="vehicles.onlyAlert" ${u.onlyAlert ? 'checked' : ''}>アラートのある車両だけ</label>
        <span class="spacer"></span>
        <span class="count">${rows.length} 台を表示</span>
        <div class="seg view-seg">
          <button type="button" class="seg-btn ${u.view === 'lot' ? 'on' : ''}" data-action="set-view" data-view="lot" title="駐車場">駐車場</button>
          <button type="button" class="seg-btn ${u.view === 'table' ? 'on' : ''}" data-action="set-view" data-view="table" title="一覧表">一覧表</button>
        </div>
      </div>
      ${rows.length === 0 ? `<div class="empty"><strong>該当する車両がありません</strong>${vehicles.length === 0 ? '「＋ 車両を追加」から登録してください。' : '検索条件を変えてみてください。'}</div>` : u.view === 'lot' ? renderLot(rows, issueStatus, alertsByVehicle, settings) : `
      <div class="table-wrap"><table>
        <thead><tr>
          ${th('driverName', 'ドライバー')}
          ${th('plate', 'ナンバー')}
          ${th('base', 'チーム')}
          ${th('status', 'ステータス')}
          <th>異常</th>
          ${th('inspectionExpiry', '車検満了')}
          ${th('jibaisekiExpiry', '自賠責')}
          ${th('insuranceExpiry', '任意保険')}
          ${th('odometer', '走行距離', 'right')}
          ${th('_level', '状態')}
        </tr></thead>
        <tbody>
          ${rows.map((v) => `<tr class="clickable" data-action="open-vehicle" data-id="${esc(v.id)}">
            <td><div class="primary">${esc(v.driverName)}</div>${v.loaner ? `<div class="secondary">代車使用中: ${esc(L.loanerLabel(v.loaner, vehicles))}</div>` : ''}</td>
            <td class="nowrap">${esc(v.plate)}</td>
            <td class="nowrap">${esc(v.base || '—')}</td>
            <td>${badgeStatus(v.status)}</td>
            <td>${(() => { const st = Object.values(issueStatus.get(v.id) || {}); if (!st.length) return '<span class="muted">—</span>'; const n = st.reduce((a, x) => a + x.count, 0); const sev = st.map((x) => x.severity).sort((a, b) => L.SEVERITY[a].order - L.SEVERITY[b].order)[0]; return `<span class="badge plain sev-${sev}">${n} 件</span>`; })()}</td>
            <td>${deadlineCell(v.inspectionExpiry, settings, today)}</td>
            <td>${deadlineCell(v.jibaisekiExpiry, settings, today)}</td>
            <td>${deadlineCell(v.insuranceExpiry, settings, today)}</td>
            <td class="right num nowrap">${L.fmtKm(v.odometer)}</td>
            <td>${v.status === 'retired' ? '<span class="muted">—</span>' : badgeLevel(v._level)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>`;
}

// ---- 駐車場ビュー ----

/** 小さな軽バン(上面図)。status と level で色を変える。 */
function miniVan(v, level) {
  const cls = `van st-${v.status} level-${level}`;
  return `<svg class="${cls}" viewBox="0 0 64 120" aria-hidden="true">
    <path class="van-body" d="M 14 2 H 50 Q 62 2 62 14 V 108 Q 62 118 52 118 H 12 Q 2 118 2 108 V 14 Q 2 2 14 2 Z"/>
    <rect class="van-wheel" x="-2" y="22" width="8" height="18" rx="3"/><rect class="van-wheel" x="58" y="22" width="8" height="18" rx="3"/>
    <rect class="van-wheel" x="-2" y="84" width="8" height="18" rx="3"/><rect class="van-wheel" x="58" y="84" width="8" height="18" rx="3"/>
    <path class="van-glass" d="M 10 16 H 54 L 50 34 H 14 Z"/>
    <rect class="van-roof" x="10" y="42" width="44" height="60" rx="4"/>
    <path class="van-line" d="M 16 50 V 94 M 48 50 V 94"/>
    <rect class="van-lamp" x="8" y="4" width="10" height="4" rx="2"/><rect class="van-lamp" x="46" y="4" width="10" height="4" rx="2"/>
    <rect class="van-tail" x="8" y="112" width="10" height="4" rx="2"/><rect class="van-tail" x="46" y="112" width="10" height="4" rx="2"/>
  </svg>`;
}

function renderLot(rows, issueStatus, alertsByVehicle, settings) {
  const lentTo = new Map(); // 自社代車として貸し出している車 → 使っているドライバー
  for (const v of store.getState().vehicles) if (v.loaner?.type === 'own' && v.loaner.vehicleId) lentTo.set(v.loaner.vehicleId, v.driverName);
  const groups = new Map();
  for (const v of rows) {
    const key = v.base || '(チーム未設定)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  // 設定のチーム順 → それ以外
  const order = [...settings.bases.filter((b) => groups.has(b)), ...[...groups.keys()].filter((k) => !settings.bases.includes(k))];
  let idx = 0;
  return `<div class="lot">${order.map((base) => {
    const list = groups.get(base);
    return `<section class="lot-area">
      <div class="lot-sign"><span class="p">P</span><span class="name">${esc(base)}</span><span class="n">${list.length} 台</span></div>
      <div class="lot-row">
        ${list.map((v) => {
          const i = idx++;
          const alerts = alertsByVehicle.get(v.id) || [];
          const worst = alerts[0]?.level || 'ok';
          const st = Object.values(issueStatus.get(v.id) || {});
          const issueCount = st.reduce((a, x) => a + x.count, 0);
          const issueSev = st.map((x) => x.severity).sort((a, b) => L.SEVERITY[a].order - L.SEVERITY[b].order)[0];
          const chips = [];
          for (const a of alerts.slice(0, 2)) chips.push(`<span class="lot-chip ${a.level}">${esc(a.label.replace('の目安距離', '').replace('の目安日', ''))}${a.days != null ? ' ' + L.fmtDays(a.days) : ''}</span>`);
          if (alerts.length > 2) chips.push(`<span class="lot-chip more">+${alerts.length - 2}</span>`);
          return `<div class="slot st-${v.status}" data-action="open-vehicle" data-id="${esc(v.id)}" style="--i:${Math.min(i, 30)}" title="${esc(vehicleLabel(v))}">
            <div class="slot-van">
              ${miniVan(v, v.status === 'retired' ? 'none' : worst)}
              ${issueCount ? `<span class="slot-issue sev-${issueSev}" title="未対応の異常 ${issueCount} 件">${issueCount}</span>` : ''}
              ${v.status === 'repair' ? '<span class="slot-flag repair">修理中</span>' : v.status === 'idle' ? '<span class="slot-flag idle">休車</span>' : v.status === 'retired' ? '<span class="slot-flag retired">廃車</span>' : ''}
            </div>
            <div class="slot-code">${esc(v.driverName)}</div>
            <div class="slot-plate">${esc(v.plate)}</div>
            ${v.loaner ? `<div class="slot-loaner">🚗 代車 ${esc(L.loanerLabel(v.loaner, rows).replace(/^(自社代車|借代車) ?/, ''))}</div>` : ''}
            ${lentTo.get(v.id) ? `<div class="slot-loaner lent">${esc(lentTo.get(v.id))} の代車</div>` : ''}
            <div class="slot-chips">${chips.join('')}</div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
  }).join('')}</div>`;
}

// ---- 車両詳細 ----

function renderVehicleDetail(state, id, today) {
  const { records, settings } = state;
  const v = store.getVehicle(id);
  if (!v) {
    return `<a class="back" href="#/vehicles">← 車両台帳へ</a><div class="card"><div class="empty"><strong>車両が見つかりません</strong>削除された可能性があります。</div></div>`;
  }
  const recs = store.recordsOf(v.id);
  const issues = store.issuesOf(v.id);
  const alerts = L.sortAlerts(L.vehicleAlerts(v, records, settings, today));
  const nextList = L.latestByType(recs).filter((r) => r.nextDate || r.nextOdometer);
  const thisYear = today.slice(0, 4);
  const yearCost = recs.filter((r) => r.date.startsWith(thisYear)).reduce((a, r) => a + (Number(r.cost) || 0), 0);
  const totalCost = recs.reduce((a, r) => a + (Number(r.cost) || 0), 0);

  const tile = (label, date) => {
    const level = date ? L.deadlineLevel(date, settings, today) : 'none';
    const days = L.daysUntil(date, today);
    return `<div class="deadline-tile ${level}"><div class="k">${label}</div><div class="v">${L.fmtDate(date)}</div><div>${date ? badgeLevel(level) + ' <span class="muted" style="font-size:12px">' + L.fmtDays(days) + '</span>' : '<span class="muted">未登録</span>'}</div></div>`;
  };
  const kv = (k, val) => `<div><div class="k">${k}</div><div class="v">${val || '<span class="muted">—</span>'}</div></div>`;

  return `
    <a class="back" href="#/vehicles">← 車両台帳へ</a>
    <div class="detail-head" style="margin-bottom:16px">
      <div>
        <div class="title"><h1>${esc(v.driverName)}</h1>${badgeStatus(v.status)}</div>
        <div class="plate">${esc(v.plate)} <span class="muted" style="font-weight:500">${v.maker ? '・ ' + esc(v.maker) : ''}${v.base ? ' ・ ' + esc(v.base) : ''}</span></div>
      </div>
      <div class="actions">
        <button class="btn danger" data-action="delete-vehicle" data-id="${esc(v.id)}">削除</button>
        <button class="btn" data-action="edit-vehicle" data-id="${esc(v.id)}">編集</button>
        <button class="btn primary" data-action="add-record" data-vehicle="${esc(v.id)}">＋ 整備を記録</button>
      </div>
    </div>
    <div class="stack">
      ${renderLoanerBanner(v, state.vehicles)}
      <div class="deadline-tiles">
        ${tile('車検満了日', v.inspectionExpiry)}
        ${tile('自賠責満了日', v.jibaisekiExpiry)}
        ${tile('任意保険満了日' + (v.insuranceCompany ? '(' + esc(v.insuranceCompany) + ')' : ''), v.insuranceExpiry)}
      </div>
      <div class="card">
        <div class="card-head"><h2>車体の状態</h2><span class="muted">${L.openIssues(issues).length ? `未対応の異常 ${L.openIssues(issues).length} 件` : '未対応の異常はありません'}</span></div>
        <div class="card-body body-stack">
          <div class="views-head">
            <span class="muted" style="font-size:12px">部位をクリックすると、その部位の異常だけを表示します。赤 = 未対応の異常あり、青枠 = 選択中</span>
            ${ui.detail.part ? '<button class="btn ghost small" data-action="select-part" data-part="">選択を解除</button>' : ''}
          </div>
          ${renderViews(issues, ui.detail.part)}
          ${renderPartChips(L.partStatus(issues), ui.detail.part)}
          ${renderIssuePanel(v, issues, ui.detail.part, today)}
        </div>
      </div>
      <div class="grid grid-main">
        <div class="card">
          <div class="card-head"><h2>車両情報</h2></div>
          <div class="card-body"><div class="kv">
            ${kv('車両QR', esc(v.qr))}
            ${kv('メーカー', esc(v.maker))}
            ${kv('型式', esc(v.modelCode))}
            ${kv('初度登録', v.firstRegistration ? esc(v.firstRegistration.replace('-', '/')) : '')}
            ${kv('チーム', esc(v.base))}
            ${kv('任意保険の連絡先', v.insurancePhone ? `<a href="tel:${esc(v.insurancePhone)}">${esc(v.insurancePhone)}</a>` : '')}
            ${kv('走行距離', v.odometer != null && v.odometer !== '' ? `${L.fmtKm(v.odometer)} <span class="muted" style="font-weight:400;font-size:12px">(${L.fmtDate(v.odometerDate)} 時点)</span>` : '')}
            ${kv('登録日', v.createdAt ? L.fmtDate(v.createdAt.slice(0, 10)) : '')}
          </div>
          ${v.note ? `<div style="margin-top:14px"><div class="k muted" style="font-size:11.5px">備考</div><div style="white-space:pre-wrap">${esc(v.note)}</div></div>` : ''}
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>次回整備の目安</h2></div>
            <div class="card-body" style="padding-top:6px;padding-bottom:6px">
              ${nextList.length === 0 ? '<div class="empty">目安が登録された整備はありません<br><span style="font-size:12px">整備記録に「次回目安」を入れると、ここに出ます</span></div>' : `<div class="list-rows">${nextList.map((r) => {
                const a = alerts.find((x) => x.recordId === r.id);
                const level = a ? a.level : 'ok';
                const parts = [];
                if (r.nextDate) parts.push(`${L.fmtDate(r.nextDate)}(${L.fmtDays(L.daysUntil(r.nextDate, today))})`);
                if (r.nextOdometer) { const rem = Number(r.nextOdometer) - Number(v.odometer || 0); parts.push(`${L.fmtKm(r.nextOdometer)}(${rem < 0 ? L.fmtKm(-rem) + ' 超過' : 'あと ' + L.fmtKm(rem)})`); }
                return `<div class="list-row"><div><strong>${esc(r.type)}</strong><div class="muted" style="font-size:12px">前回 ${L.fmtDate(r.date)}</div></div><div style="text-align:right"><div class="num" style="font-size:12.5px">${parts.join('<br>')}</div>${badgeLevel(level)}</div></div>`;
              }).join('')}</div>`}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>整備費</h2></div>
            <div class="card-body"><div class="kv">
              ${kv(`${thisYear}年の整備費`, `<span class="num">${L.fmtYen(yearCost)}</span>`)}
              ${kv('累計', `<span class="num">${L.fmtYen(totalCost)}</span>`)}
              ${kv('記録件数', `${recs.length} 件`)}
            </div></div>
          </div>
        </div>
      </div>
      ${renderAccidentCard(v, issues)}
      <div class="card">
        <div class="card-head"><h2>整備履歴</h2><span class="muted">${recs.length} 件</span></div>
        ${recs.length === 0 ? '<div class="empty"><strong>まだ整備記録がありません</strong>「＋ 整備を記録」から追加してください。</div>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>実施日</th><th>種別</th><th>内容</th><th>業者</th><th class="right">走行距離</th><th class="right">費用</th><th>次回目安</th><th></th></tr></thead>
          <tbody>${recs.map((r) => recordRow(r, null)).join('')}</tbody>
        </table></div>`}
      </div>
    </div>`;
}

function renderLoanerBanner(v, vehicles) {
  const parts = [];
  if (v.status === 'repair') {
    if (v.loaner) {
      parts.push(`<div class="banner repair"><div><strong>修理中 ・ 代車使用中</strong><div class="muted">${esc(L.loanerLabel(v.loaner, vehicles))}${v.loaner.since ? ` ・ ${L.fmtDate(v.loaner.since)} から` : ''}${v.loaner.note ? ` ・ ${esc(v.loaner.note)}` : ''}</div></div>
        <button class="btn primary" data-action="return-loaner" data-id="${esc(v.id)}">代車を返却して稼働に戻す</button></div>`);
    } else {
      parts.push(`<div class="banner repair"><div><strong>修理中</strong><div class="muted">代車があれば「編集」から登録できます</div></div>
        <button class="btn" data-action="return-loaner" data-id="${esc(v.id)}">修理完了(稼働に戻す)</button></div>`);
    }
  }
  const lentTo = vehicles.filter((x) => x.loaner?.type === 'own' && x.loaner.vehicleId === v.id);
  for (const x of lentTo) {
    parts.push(`<div class="banner lent"><div><strong>${esc(x.driverName)} の代車として貸出中</strong><div class="muted">${esc(x.driverName)} の車両(${esc(x.plate)})が修理中${x.loaner.since ? ` ・ ${L.fmtDate(x.loaner.since)} から` : ''}</div></div>
      <a class="btn" href="#/vehicles/${encodeURIComponent(x.id)}">${esc(x.driverName)} の車両を見る</a></div>`);
  }
  return parts.join('');
}

function renderAccidentCard(v, issues) {
  const list = L.sortIssues(issues.filter((i) => i.accident));
  if (!list.length) return '';
  return `<div class="card">
    <div class="card-head"><h2>事故記録</h2><span class="muted">${list.filter((i) => i.status === 'open').length} 件が未修理 ・ 全 ${list.length} 件</span></div>
    <div class="accident-list">${list.map((i) => accidentItem(i)).join('')}</div>
  </div>`;
}

function accidentItem(i) {
  const a = i.accident || {};
  const dt = a.datetime ? a.datetime.replace('T', ' ').replace(/-/g, '/') : L.fmtDate(i.reportedAt);
  const cell = (k, val) => `<div><div class="k">${k}</div><div class="v">${val || '<span class="muted">—</span>'}</div></div>`;
  return `<div class="accident-item ${i.status}">
    <div class="accident-head">
      <div><span class="badge plain ${i.status === 'open' ? 'sev-high' : ''}">${i.status === 'open' ? '未修理' : '修理済み'}</span> <strong>${esc(i.title)}</strong>
        <span class="muted" style="font-size:12px">・ ${esc(L.partLabel(i.part))}${(i.pins || []).length ? ` ・ 📍 ${i.pins.length} か所` : ''}</span></div>
      <div style="display:flex;gap:6px">${i.status === 'open' ? `<button class="btn small" data-action="fix-issue" data-id="${esc(i.id)}">修理済みにする</button>` : ''}<button class="btn small ghost" data-action="edit-issue" data-id="${esc(i.id)}">編集</button></div>
    </div>
    <div class="accident-grid">
      <div class="accident-sec"><h4>事故の状況</h4>${cell('日時', esc(dt))}${cell('場所', esc(a.place))}${cell('形態', esc(a.type))}${cell('管轄警察署', esc(a.police))}</div>
      <div class="accident-sec"><h4>自分の情報</h4>${cell('運転手', esc(a.driverName))}${cell('車両ナンバー', esc(a.plate))}${cell('自車の損傷', esc(a.ownDamage))}</div>
      <div class="accident-sec"><h4>相手の情報</h4>${cell('氏名', esc(a.otherName))}${cell('電話番号', a.otherPhone ? `<a href="tel:${esc(a.otherPhone)}">${esc(a.otherPhone)}</a>` : '')}${cell('車両ナンバー', esc(a.otherPlate))}${cell('相手の損傷', esc(a.otherDamage))}</div>
    </div>
    ${i.detail ? `<div class="muted" style="font-size:12.5px;white-space:pre-wrap">${esc(i.detail)}</div>` : ''}
    ${photoStrip(i.photos)}
  </div>`;
}

function recordRow(r, vehicle) {
  const next = [r.nextDate ? L.fmtDate(r.nextDate) : '', r.nextOdometer ? L.fmtKm(r.nextOdometer) : ''].filter(Boolean).join(' / ');
  return `<tr class="clickable" data-action="edit-record" data-id="${esc(r.id)}">
    <td class="nowrap num">${L.fmtDate(r.date)}</td>
    ${vehicle === null ? '' : `<td><div class="primary">${esc(vehicle?.driverName || '')}</div><div class="secondary">${esc(vehicle?.plate || '(削除された車両)')}</div></td>`}
    <td class="nowrap"><span class="badge plain">${esc(r.type)}</span></td>
    <td><div>${esc(r.title && r.title !== r.type ? r.title : '')}${r.photos?.length ? ` <span class="muted" title="写真 ${r.photos.length} 枚">📷${r.photos.length}</span>` : ''}</div>${r.detail ? `<div class="secondary">${esc(r.detail)}</div>` : ''}</td>
    <td>${esc(r.vendor || '—')}</td>
    <td class="right num nowrap">${L.fmtKm(r.odometer)}</td>
    <td class="right num nowrap">${L.fmtYen(r.cost)}</td>
    <td class="nowrap muted" style="font-size:12.5px">${next || '—'}</td>
    <td class="right"><button class="btn small ghost" data-action="edit-record" data-id="${esc(r.id)}">編集</button></td>
  </tr>`;
}

// ---- 車体の図と異常 ----

function renderPartChips(status, selected) {
  const chips = L.PARTS.filter((p) => !p.onBody).map((p) => {
    const st = status[p.id];
    return `<button type="button" class="part-chip ${st ? `sev-${st.severity}` : ''} ${selected === p.id ? 'selected' : ''}" data-action="select-part" data-part="${p.id}">${esc(p.short)}${st ? ` <b>${st.count}</b>` : ''}</button>`;
  });
  return `<div class="part-chips">${chips.join('')}</div>`;
}

function issueItem(i, { showVehicle = false, showPart = true } = {}) {
  const v = showVehicle ? store.getVehicle(i.vehicleId) : null;
  const pinViews = [...new Set((i.pins || []).map((pn) => VIEWS[pn.view]?.title).filter(Boolean))];
  const meta = [showVehicle ? esc(vehicleLabel(v)) : '', showPart ? esc(L.partLabel(i.part)) : '', pinViews.length ? `📍 ${pinViews.join('・')}${(i.pins || []).length > 1 ? `(${i.pins.length} か所)` : ''}` : '', `発生 ${L.fmtDate(i.reportedAt)}`, i.status === 'fixed' ? `${i.accident ? '修理' : '対応'} ${L.fmtDate(i.fixedAt)}` : ''].filter(Boolean).join(' ・ ');
  const action = showVehicle ? `data-action="open-vehicle-part" data-id="${esc(i.vehicleId)}" data-part="${esc(i.part)}"` : `data-action="edit-issue" data-id="${esc(i.id)}"`;
  const num = i.status === 'open' && !showVehicle && i._num ? `<span class="issue-num">${i._num}</span>` : '';
  return `<div class="issue-item ${i.status}" ${action}>
    <div><div class="t">${num}${badgeSeverity(i.severity)}${i.accident ? ' <span class="badge plain accident-badge">事故</span>' : ''} ${esc(i.title)}</div>${i.detail ? `<div class="d">${esc(i.detail)}</div>` : ''}<div class="m">${meta}</div>${showVehicle ? '' : photoStrip(i.photos)}</div>
    ${i.status === 'open' && !showVehicle ? `<div><button class="btn small" data-action="fix-issue" data-id="${esc(i.id)}">${i.accident ? '修理済みにする' : '対応済みにする'}</button></div>` : ''}
  </div>`;
}

function renderIssuePanel(v, issues, selected, today) {
  // 図のピンの番号 = 未対応の異常の通し番号(views2d と同じ並び)
  issues.filter((i) => i.status === 'open').forEach((i, idx) => { i._num = idx + 1; });
  const list = L.sortIssues(selected ? issues.filter((i) => i.part === selected) : issues);
  const open = list.filter((i) => i.status === 'open');
  const fixed = list.filter((i) => i.status === 'fixed');
  const title = selected ? esc(L.partLabel(selected)) : 'すべての部位';
  return `<div class="issue-panel">
    <div class="issue-panel-head">
      <div><h3>${title}</h3>${selected ? '<button class="btn ghost small" data-action="select-part" data-part="">すべて表示</button>' : ''}</div>
      <button class="btn primary small" data-action="add-issue" data-vehicle="${esc(v.id)}" data-part="${esc(selected)}">＋ 異常を登録</button>
    </div>
    ${open.length === 0 ? `<div class="empty" style="padding:24px 8px"><strong>未対応の異常はありません</strong>${selected ? 'この部位は問題ありません。' : '異常を見つけたら「＋ 異常を登録」で部位ごとに記録できます。'}</div>` : `<div class="issue-list">${open.map((i) => issueItem(i, { showPart: !selected })).join('')}</div>`}
    ${fixed.length ? `<details class="issue-fixed"><summary>対応済み ${fixed.length} 件</summary><div class="issue-list">${fixed.map((i) => issueItem(i, { showPart: !selected })).join('')}</div></details>` : ''}
  </div>`;
}

// ---- 整備記録 ----

function renderMaintenance(state, today) {
  const { vehicles, records, settings } = state;
  const u = ui.maintenance;
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const nq = u.q.trim().toLowerCase();
  let rows = records.filter((r) => {
    if (u.ym && L.yearMonth(r.date) !== u.ym) return false;
    if (u.vehicleId && r.vehicleId !== u.vehicleId) return false;
    if (u.type && r.type !== u.type) return false;
    if (nq) {
      const v = byId.get(r.vehicleId);
      const hay = [r.title, r.detail, r.vendor, r.note, v?.driverName, v?.plate].join(' ').toLowerCase();
      if (!hay.includes(nq)) return false;
    }
    return true;
  });
  rows.sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
  const total = rows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
  const sortedVehicles = L.sortBy(vehicles, 'driverName');

  return `
    <div class="page-head">
      <div><h1>整備記録</h1><p class="sub">全 ${records.length} 件</p></div>
      <div class="actions">
        <button class="btn" data-action="export-records-csv">CSV 書き出し</button>
        <button class="btn primary" data-action="add-record" ${vehicles.length === 0 ? 'disabled title="先に車両を登録してください"' : ''}>＋ 整備を記録</button>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="内容・業者・車両で検索" value="${esc(u.q)}" data-filter="maintenance.q">
        <input type="month" value="${esc(u.ym)}" data-filter="maintenance.ym" title="月で絞る" style="width:auto">
        <select data-filter="maintenance.vehicleId">${opt('', 'すべての車両', !u.vehicleId)}${sortedVehicles.map((v) => opt(v.id, vehicleLabel(v), u.vehicleId === v.id)).join('')}</select>
        <select data-filter="maintenance.type">${opt('', 'すべての種別', !u.type)}${settings.types.map((t) => opt(t, t, u.type === t)).join('')}</select>
        <span class="spacer"></span>
        <span class="count">${rows.length} 件 ・ 合計 <strong class="num">${L.fmtYen(total)}</strong></span>
      </div>
      ${rows.length === 0 ? `<div class="empty"><strong>該当する記録がありません</strong>${records.length === 0 ? '「＋ 整備を記録」から追加してください。' : '絞り込み条件を変えてみてください。'}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>実施日</th><th>車両</th><th>種別</th><th>内容</th><th>業者</th><th class="right">走行距離</th><th class="right">費用</th><th>次回目安</th><th></th></tr></thead>
        <tbody>${rows.map((r) => recordRow(r, byId.get(r.vehicleId) || {})).join('')}</tbody>
      </table></div>`}
    </div>`;
}

// ---- 設定 ----

function renderSettings(state) {
  const s = state.settings;
  const cloud = store.mode() === 'cloud';
  const account = cloud ? `
        <div class="card">
          <div class="card-head"><h2>アカウント</h2></div>
          <div class="card-body">
            <div class="settings-row"><div><div>ログイン中</div><div class="desc">${esc(store.auth()?.userEmail() || '')}</div></div><button class="btn small" data-action="sign-out">ログアウト</button></div>
            <div class="settings-row"><div><div>パスワードを変更</div><div class="desc">このアカウントのパスワードを変えます</div></div><button class="btn small" data-action="change-password">変更</button></div>
            <div class="settings-row"><div><div>利用者を追加する</div><div class="desc">管理者が Supabase の Authentication → Users → Add user でメールアドレスとパスワードを登録します</div></div></div>
          </div>
        </div>` : '';
  const chips = (items, kind) => `<div class="chips">${items.map((x) => `<span class="chip">${esc(x)}<button type="button" title="削除" data-action="remove-${kind}" data-value="${esc(x)}">×</button></span>`).join('')}</div>
    <form class="add-row" data-form="add-${kind}"><input type="text" name="value" placeholder="${kind === 'base' ? 'チーム名を追加' : '種別を追加'}" required><button class="btn" type="submit">追加</button></form>`;
  return `
    <div class="page-head"><div><h1>設定</h1><p class="sub">アラートの基準、チーム、データの保管</p></div></div>
    <div class="grid grid-2">
      <div class="stack">
        ${account}
        <div class="card">
          <div class="card-head"><h2>基本</h2></div>
          <div class="card-body">
            <div class="settings-row"><div><div>会社名</div><div class="desc">左上に表示されます(任意)</div></div><input type="text" value="${esc(s.companyName || '')}" data-setting="companyName" style="width:200px"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>アラートの基準</h2></div>
          <div class="card-body">
            <div class="settings-row"><div><div>要対応(赤)にする日数</div><div class="desc">期限までこの日数以内なら「要対応」</div></div><input type="number" min="1" value="${s.alertDays}" data-setting="alertDays"></div>
            <div class="settings-row"><div><div>注意(黄)にする日数</div><div class="desc">期限までこの日数以内なら「注意」</div></div><input type="number" min="1" value="${s.warnDays}" data-setting="warnDays"></div>
            <div class="settings-row"><div><div>次回整備の目安距離</div><div class="desc">残りがこの km 以内なら「要対応」、2 倍以内なら「注意」</div></div><input type="number" min="100" step="100" value="${s.odometerWarnKm}" data-setting="odometerWarnKm"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>チーム</h2></div>
          <div class="card-body">${chips(s.bases, 'base')}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>整備の種別</h2></div>
          <div class="card-body">${chips(s.types, 'type')}<p class="muted" style="font-size:12px;margin-top:10px">「車検」の記録を付けると、車検満了日を台帳に反映できます。</p></div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>データ</h2></div>
          <div class="card-body">
            <div class="settings-row"><div><div>バックアップを書き出す</div><div class="desc">車両・整備記録・写真・設定をまとめた JSON。別の PC に移すときにも使います<br><strong>${esc(lastBackupText(s, L.todayISO()))}</strong></div></div><button class="btn ${L.backupDue(s.lastBackupAt, state.vehicles.length, L.todayISO(), backupInterval()) ? 'primary' : ''}" data-action="export-json">書き出す</button></div>
            <div class="settings-row"><div><div>バックアップを読み込む</div><div class="desc">${cloud ? '共有データ全体がバックアップの内容に置き換わります(全員に影響)' : '今のデータは上書きされます'}</div></div><label class="btn">読み込む<input type="file" accept="application/json,.json" data-action-file="import-json" hidden></label></div>
            <div class="settings-row"><div><div>CSV で書き出す</div><div class="desc">Excel で開けます</div></div><div style="display:flex;gap:6px"><button class="btn small" data-action="export-vehicles-csv">車両</button><button class="btn small" data-action="export-records-csv">整備記録</button></div></div>
            <div class="settings-row"><div><div>車両を CSV で一括登録</div><div class="desc">テンプレートを Excel で埋めて読み込みます。ドライバー名とナンバーは必須、ほかは空欄でも可。同じナンバーの車両があれば上書きします</div></div><div style="display:flex;gap:6px"><button class="btn small" data-action="download-vehicle-template">テンプレート</button><label class="btn small">読み込む<input type="file" accept=".csv,text/csv" data-action-file="import-vehicles-csv" hidden></label></div></div>
            <div class="settings-row"><div><div>サンプルデータを入れる</div><div class="desc">試作用の 24 台と整備履歴。${cloud ? '共有データ全体が置き換わります(全員に影響)' : '今のデータは上書きされます'}</div></div><button class="btn" data-action="load-sample">入れる</button></div>
            <div class="settings-row"><div><div>すべて削除</div><div class="desc">${cloud ? '共有している全データを消します(全員に影響)' : 'このブラウザに保存した全データを消します'}</div></div><button class="btn danger" data-action="clear-all">削除</button></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>このアプリについて</h2></div>
          <div class="card-body muted" style="font-size:13px;line-height:1.7">
            ${cloud
              ? 'データはクラウド(Supabase)に保存され、ログインした人全員で同じ内容を見ます。誰かが変更すると他の画面にもすぐ反映されます。<br>写真もクラウドに保存されます。念のため月に 1 回は「バックアップを書き出す」で手元にも残してください。'
              : 'データはこのブラウザの中(localStorage)だけに保存され、サーバーには送られません。<br>ブラウザのデータを消すと失われるので、定期的に「バックアップを書き出す」を使ってください。<br>複数人で共有するときは js/config.js に Supabase の設定を入れます(docs/運用手順.md)。'}
          </div>
        </div>
      </div>
    </div>`;
}

// ---- ダイアログ ----

function openDialog(html, onSubmit, onAction) {
  $dialogRoot.innerHTML = `<dialog>${html}</dialog>`;
  const dlg = $dialogRoot.querySelector('dialog');
  const form = dlg.querySelector('form');
  const close = () => { dlg.close(); $dialogRoot.innerHTML = ''; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type=submit]');
    if (submitBtn?.disabled) return;
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    if (submitBtn) submitBtn.disabled = true;
    let errors;
    try {
      errors = await onSubmit(data, form);
    } catch (err) {
      errors = [err?.message || '保存に失敗しました'];
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    if (errors && errors.length) {
      const box = form.querySelector('.form-errors');
      box.innerHTML = `<ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
      box.classList.remove('hidden');
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    close();
  });
  dlg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dlg]');
    if (!btn) return;
    if (btn.dataset.dlg === 'cancel') close();
    else if (onAction) onAction(btn.dataset.dlg, close, form);
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.showModal();
  const first = form.querySelector('input:not([type=hidden]), select');
  if (first) first.focus();
  return { dlg, form, close };
}

function field(name, label, input, { required = false, full = false, hint = '' } = {}) {
  return `<div class="field ${required ? 'required' : ''} ${full ? 'full' : ''}"><label for="f-${name}">${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}
const text = (name, value, attrs = '') => `<input type="text" id="f-${name}" name="${name}" value="${esc(value ?? '')}" ${attrs}>`;
const num = (name, value, attrs = '') => `<input type="number" id="f-${name}" name="${name}" value="${esc(value ?? '')}" min="0" ${attrs}>`;
const date = (name, value, attrs = '') => `<input type="date" id="f-${name}" name="${name}" value="${esc(value ?? '')}" ${attrs}>`;

function openVehicleForm(existing) {
  const s = store.getState().settings;
  const v = existing || { status: 'active', base: s.bases[0] || '' };
  const isNew = !existing;
  const html = `
    <form>
      <div class="dlg-head"><h2>${isNew ? '車両を追加' : '車両を編集'}</h2><button type="button" class="btn ghost small" data-dlg="cancel">閉じる</button></div>
      <div class="dlg-body">
        <div class="form-errors hidden"></div>
        <input type="hidden" name="id" value="${esc(v.id || '')}">
        <div class="form-grid">
          <legend>基本情報</legend>
          ${field('driverName', 'ドライバー名', text('driverName', v.driverName, 'placeholder="佐藤 太郎" required'), { required: true })}
          ${field('plate', 'ナンバー', text('plate', v.plate, 'placeholder="品川 480 あ 12-34" required'), { required: true })}
          ${field('status', 'ステータス', `<select id="f-status" name="status">${Object.entries(L.STATUS).map(([k, l]) => opt(k, l, v.status === k)).join('')}</select>`, { required: true })}
          ${field('qr', '車両QR', text('qr', v.qr, 'placeholder="QR の中身(車両コード)"'), { hint: '車両に貼った QR を読んだ文字列' })}
          ${field('maker', 'メーカー', text('maker', v.maker, 'placeholder="スズキ"'))}
          ${field('modelCode', '型式', text('modelCode', v.modelCode, 'placeholder="3BD-DA17V"'))}
          ${field('firstRegistration', '初度登録年月', `<input type="month" id="f-firstRegistration" name="firstRegistration" value="${esc(v.firstRegistration || '')}">`)}
          ${field('base', 'チーム', `<select id="f-base" name="base">${s.bases.map((b) => opt(b, b, v.base === b)).join('')}${v.base && !s.bases.includes(v.base) ? opt(v.base, v.base, true) : ''}</select>`, { hint: 'チームは設定画面で追加できます' })}
          <fieldset class="full" id="loaner-field" ${v.status === 'repair' ? '' : 'hidden'}>
            <div class="form-grid">
              <legend>代車(修理中のとき)</legend>
              ${field('loanerType', '代車', `<select id="f-loanerType" name="loanerType">${opt('', '代車なし', !v.loaner)}${opt('own', '自社代車(管理している車両から選ぶ)', v.loaner?.type === 'own')}${opt('rental', '借代車(ナンバーだけ記録)', v.loaner?.type === 'rental')}</select>`)}
              ${field('loanerSince', '使い始めた日', date('loanerSince', v.loaner?.since || ''))}
              <div class="field" id="loaner-own" ${v.loaner?.type === 'own' ? '' : 'hidden'}><label for="f-loanerVehicleId">自社代車の車両</label><select id="f-loanerVehicleId" name="loanerVehicleId">${opt('', '選んでください', !v.loaner?.vehicleId)}${L.sortBy(store.getState().vehicles.filter((x) => x.id !== v.id && x.status !== 'retired'), 'driverName').map((x) => opt(x.id, `${x.plate} ・ ${x.driverName}`, v.loaner?.vehicleId === x.id)).join('')}</select></div>
              <div class="field" id="loaner-rental" ${v.loaner?.type === 'rental' ? '' : 'hidden'}><label for="f-loanerPlate">借代車のナンバー</label>${text('loanerPlate', v.loaner?.plate || '', 'placeholder="品川 480 い 56-78"')}</div>
              ${field('loanerNote', 'メモ', text('loanerNote', v.loaner?.note || '', 'placeholder="○○レンタカー、11/5 返却予定"'), { full: true })}
            </div>
          </fieldset>
          <legend>期限</legend>
          ${field('inspectionExpiry', '車検満了日', date('inspectionExpiry', v.inspectionExpiry))}
          ${field('jibaisekiExpiry', '自賠責満了日', date('jibaisekiExpiry', v.jibaisekiExpiry))}
          ${field('insuranceExpiry', '任意保険満了日', date('insuranceExpiry', v.insuranceExpiry))}
          ${field('insuranceCompany', '任意保険の会社', text('insuranceCompany', v.insuranceCompany))}
          ${field('insurancePhone', '保険会社の電話番号', `<input type="tel" id="f-insurancePhone" name="insurancePhone" value="${esc(v.insurancePhone || '')}" placeholder="0120-000-000">`, { hint: '事故のときにすぐ電話できるように' })}
          <legend>走行距離</legend>
          ${field('odometer', '現在の走行距離(km)', num('odometer', v.odometer, 'step="1"'))}
          ${field('odometerDate', '記録日', date('odometerDate', v.odometerDate || (isNew ? L.todayISO() : '')))}
          ${field('note', '備考', `<textarea id="f-note" name="note">${esc(v.note || '')}</textarea>`, { full: true })}
        </div>
      </div>
      <div class="dlg-foot">
        <div class="right-group"><button type="button" class="btn" data-dlg="cancel">キャンセル</button><button type="submit" class="btn primary">${isNew ? '追加する' : '保存する'}</button></div>
      </div>
    </form>`;
  const { form: vform } = openDialog(html, (d) => {
    const { loanerType, loanerSince, loanerVehicleId, loanerPlate, loanerNote, ...rest } = d;
    const vehicle = {
      ...rest,
      id: d.id || undefined,
      driverName: d.driverName.trim(),
      plate: d.plate.trim(),
      odometer: d.odometer === '' ? null : Number(d.odometer),
      loaner: d.status === 'repair' && loanerType ? { type: loanerType, since: loanerSince || '', vehicleId: loanerType === 'own' ? loanerVehicleId : '', plate: loanerType === 'rental' ? (loanerPlate || '').trim() : '', note: (loanerNote || '').trim() } : null,
    };
    const errors = L.validateVehicle(vehicle);
    if (errors.length) return errors;
    const id = store.upsertVehicle(vehicle);
    toast(isNew ? `${vehicle.driverName} の車両を追加しました` : '保存しました');
    if (isNew) location.hash = `#/vehicles/${encodeURIComponent(id)}`;
  });
  // ステータスが修理中のときだけ代車欄を出す
  const statusSel = vform.querySelector('#f-status'), loanerFs = vform.querySelector('#loaner-field'), loanerType = vform.querySelector('#f-loanerType');
  const syncLoaner = () => {
    loanerFs.hidden = statusSel.value !== 'repair';
    vform.querySelector('#loaner-own').hidden = loanerType.value !== 'own';
    vform.querySelector('#loaner-rental').hidden = loanerType.value !== 'rental';
    if (loanerType.value && !vform.querySelector('#f-loanerSince').value) vform.querySelector('#f-loanerSince').value = L.todayISO();
  };
  statusSel.addEventListener('change', syncLoaner);
  loanerType.addEventListener('change', syncLoaner);
  syncLoaner();
}

function openRecordForm(existing, presetVehicleId) {
  const state = store.getState();
  const s = state.settings;
  const r = existing || { vehicleId: presetVehicleId || '', date: L.todayISO(), type: s.types[0] || '' };
  const isNew = !existing;
  const vehicles = L.sortBy(state.vehicles.filter((v) => v.status !== 'retired' || v.id === r.vehicleId), 'driverName');
  const lockVehicle = Boolean(presetVehicleId) || !isNew;
  const types = s.types.includes(r.type) || !r.type ? s.types : [...s.types, r.type];
  const html = `
    <form>
      <div class="dlg-head"><h2>${isNew ? '整備を記録' : '整備記録を編集'}</h2><button type="button" class="btn ghost small" data-dlg="cancel">閉じる</button></div>
      <div class="dlg-body">
        <div class="form-errors hidden"></div>
        <input type="hidden" name="id" value="${esc(r.id || '')}">
        <div class="form-grid">
          ${field('vehicleId', '車両', `<select id="f-vehicleId" name="vehicleId" ${lockVehicle ? 'disabled' : ''} required>${!r.vehicleId ? opt('', '選んでください', true) : ''}${vehicles.map((v) => opt(v.id, `${vehicleLabel(v)}(${v.plate})`, v.id === r.vehicleId)).join('')}</select>${lockVehicle ? `<input type="hidden" name="vehicleId" value="${esc(r.vehicleId)}">` : ''}`, { required: true })}
          ${field('date', '実施日', date('date', r.date, 'required'), { required: true })}
          ${field('type', '種別', `<select id="f-type" name="type" required>${types.map((t) => opt(t, t, t === r.type)).join('')}</select>`, { required: true })}
          ${field('title', '内容(見出し)', text('title', r.title, 'placeholder="オイル・エレメント交換"'))}
          ${field('vendor', '業者', text('vendor', r.vendor, 'placeholder="〇〇モータース"'))}
          ${field('cost', '費用(円・税込)', num('cost', r.cost, 'step="1"'))}
          ${field('odometer', '実施時の走行距離(km)', num('odometer', r.odometer, 'step="1"'), { hint: '車両の現在値より大きければ台帳も更新します' })}
          <legend>次回の目安(任意)</legend>
          ${field('nextDate', '次回目安日', date('nextDate', r.nextDate))}
          ${field('nextOdometer', '次回目安距離(km)', num('nextOdometer', r.nextOdometer, 'step="100"'), { hint: '例: オイル交換なら +5,000 km' })}
          <fieldset class="full" id="inspection-extra" ${r.type === '車検' ? '' : 'hidden'}>
            <div class="form-grid">
              <legend>車検の結果を台帳に反映(任意)</legend>
              ${field('newInspectionExpiry', '新しい車検満了日', date('newInspectionExpiry', ''), { hint: '空欄なら更新しません' })}
              ${field('newJibaisekiExpiry', '新しい自賠責満了日', date('newJibaisekiExpiry', ''))}
            </div>
          </fieldset>
          ${field('detail', '詳細・メモ', `<textarea id="f-detail" name="detail">${esc(r.detail || '')}</textarea>`, { full: true })}
          ${photoFieldHTML(r.photos || [])}
        </div>
      </div>
      <div class="dlg-foot">
        ${isNew ? '' : '<button type="button" class="btn danger" data-dlg="delete">この記録を削除</button>'}
        <div class="right-group"><button type="button" class="btn" data-dlg="cancel">キャンセル</button><button type="submit" class="btn primary">${isNew ? '記録する' : '保存する'}</button></div>
      </div>
    </form>`;
  let recPhotos;
  const { form } = openDialog(html, async (d) => {
    const vehicleId = d.vehicleId || r.vehicleId;
    const rec = {
      id: d.id || undefined,
      vehicleId,
      date: d.date,
      type: d.type,
      title: d.title.trim(),
      detail: d.detail.trim(),
      vendor: d.vendor.trim(),
      cost: d.cost === '' ? '' : Number(d.cost),
      odometer: d.odometer === '' ? '' : Number(d.odometer),
      nextDate: d.nextDate || '',
      nextOdometer: d.nextOdometer === '' ? '' : Number(d.nextOdometer),
      note: r.note || '',
    };
    const errors = L.validateRecord(rec);
    if (d.type === '車検') {
      if (d.newInspectionExpiry && !L.isValidDate(d.newInspectionExpiry)) errors.push('新しい車検満了日の日付が正しくありません');
      if (d.newJibaisekiExpiry && !L.isValidDate(d.newJibaisekiExpiry)) errors.push('新しい自賠責満了日の日付が正しくありません');
    }
    if (errors.length) return errors;
    rec.photos = await recPhotos.collect();
    store.upsertRecord(rec);
    await recPhotos.cleanup();
    if (d.type === '車検' && (d.newInspectionExpiry || d.newJibaisekiExpiry)) {
      const v = store.getVehicle(vehicleId);
      if (v) {
        store.upsertVehicle({
          id: v.id,
          inspectionExpiry: d.newInspectionExpiry || v.inspectionExpiry,
          jibaisekiExpiry: d.newJibaisekiExpiry || v.jibaisekiExpiry,
        });
      }
    }
    toast(isNew ? '整備を記録しました' : '保存しました');
  }, async (action, close) => {
    if (action === 'delete' && confirm('この整備記録を削除します。元に戻せません。')) {
      store.removeRecord(r.id);
      await photos.removeMany(r.photos);
      toast('削除しました');
      close();
    }
  });
  recPhotos = attachPhotoField(form, r.photos || []);

  // 種別が「車検」のときだけ台帳反映の欄を出し、満了日の候補を入れる
  const typeSel = form.querySelector('#f-type');
  const extra = form.querySelector('#inspection-extra');
  const syncExtra = () => {
    const isInspection = typeSel.value === '車検';
    extra.hidden = !isInspection;
    if (isInspection && isNew) {
      const v = store.getVehicle(form.querySelector('#f-vehicleId').value || r.vehicleId);
      // 満了日の 1 か月前以内に受検したときは旧満了日から、それ以外は受検日から 1 年
      const d = form.date.value;
      const untilExpiry = v?.inspectionExpiry ? L.daysUntil(v.inspectionExpiry, d) : null;
      const baseDate = untilExpiry !== null && untilExpiry >= 0 && untilExpiry <= 31 ? v.inspectionExpiry : d;
      const f = form.querySelector('#f-newInspectionExpiry');
      if (f && !f.value) f.value = L.addMonths(baseDate, 12);
      const j = form.querySelector('#f-newJibaisekiExpiry');
      if (j && !j.value && f?.value) j.value = L.addMonths(f.value, 1);
    }
  };
  typeSel.addEventListener('change', syncExtra);
  syncExtra();
}

function openIssueForm(existing, presetVehicleId, presetPart) {
  const state = store.getState();
  const i = existing || { vehicleId: presetVehicleId || '', part: presetPart || '', severity: 'mid', status: 'open', reportedAt: L.todayISO() };
  const isNew = !existing;
  const vehicles = L.sortBy(state.vehicles.filter((v) => v.status !== 'retired' || v.id === i.vehicleId), 'driverName');
  const a = i.accident || {};
  const vehicleOf = store.getVehicle(i.vehicleId);
  const lockVehicle = Boolean(presetVehicleId) || !isNew;
  const g0 = L.groupOfPart(i.part);
  const html = `
    <form>
      <div class="dlg-head"><h2>${isNew ? '異常を登録' : '異常を編集'}</h2><button type="button" class="btn ghost small" data-dlg="cancel">閉じる</button></div>
      <div class="dlg-body">
        <div class="form-errors hidden"></div>
        <input type="hidden" name="id" value="${esc(i.id || '')}">
        <div class="form-grid">
          ${field('vehicleId', '車両', `<select id="f-vehicleId" name="vehicleId" ${lockVehicle ? 'disabled' : ''} required>${!i.vehicleId ? opt('', '選んでください', true) : ''}${vehicles.map((v) => opt(v.id, `${vehicleLabel(v)}(${v.plate})`, v.id === i.vehicleId)).join('')}</select>${lockVehicle ? `<input type="hidden" name="vehicleId" value="${esc(i.vehicleId)}">` : ''}`, { required: true })}
          ${field('group', '場所', `<select id="f-group" name="group" required>${!g0 ? opt('', '選んでください', true) : ''}${L.PART_GROUPS.map((g) => opt(g.id, g.label, g0 && g.id === g0.id)).join('')}</select>`, { required: true, hint: '種類を選ぶと、次に左右前後を選べます' })}
          <div class="field" id="variant-field"></div>
          <input type="hidden" name="part" id="f-part" value="${esc(i.part || '')}">
          <input type="hidden" name="pins" id="f-pins" value="${esc(JSON.stringify(i.pins || []))}">
          <div class="field full" id="pick-field"></div>
          ${field('severity', '緊急度', `<div class="seg">${Object.entries(L.SEVERITY).map(([k, v]) => `<label class="seg-item sev-${k}"><input type="radio" name="severity" value="${k}" ${i.severity === k ? 'checked' : ''}>${v.label}</label>`).join('')}</div>`, { required: true, hint: '至急 = 走行に支障 / 早めに = 近いうちに修理 / 様子見 = 記録のみ' })}
          ${field('reportedAt', '発生日', date('reportedAt', i.reportedAt, 'required'), { required: true })}
          <div class="field full"><label class="inline-check accident-check"><input type="checkbox" name="isAccident" id="f-isAccident" ${i.accident ? 'checked' : ''}> <strong>事故記録として残す</strong><span class="muted">(保険で使う情報を記録。傷の場所は図に複数ピンを打てます)</span></label></div>
          <fieldset class="full accident-fs" id="accident-field" ${i.accident ? '' : 'hidden'}>
            <div class="accident-form">
              <div class="accident-sec">
                <h4>◆ 事故の状況</h4>
                ${field('acDatetime', '日時', `<input type="datetime-local" id="f-acDatetime" name="acDatetime" value="${esc(a.datetime || '')}">`)}
                ${field('acPlace', '場所', text('acPlace', a.place, 'placeholder="○○市△△ 交差点"'))}
                ${field('acType', '事故の形態', `<select id="f-acType" name="acType">${opt('', '選んでください', !a.type)}${L.ACCIDENT_TYPES.map((t) => opt(t, t, a.type === t)).join('')}</select>`)}
                ${field('acPolice', '管轄警察署', text('acPolice', a.police, 'placeholder="○○警察署"'))}
              </div>
              <div class="accident-sec">
                <h4>◆ 自分の情報</h4>
                ${field('acDriverName', '運転手氏名', text('acDriverName', a.driverName ?? vehicleOf?.driverName ?? ''))}
                ${field('acPlate', '車両ナンバー', text('acPlate', a.plate ?? vehicleOf?.plate ?? ''))}
                ${field('acOwnDamage', '自車の損傷状況', `<textarea id="f-acOwnDamage" name="acOwnDamage" rows="2" placeholder="左後バンパー凹み、テールランプ割れ">${esc(a.ownDamage || '')}</textarea>`)}
              </div>
              <div class="accident-sec">
                <h4>◆ 相手の情報</h4>
                ${field('acOtherName', '氏名', text('acOtherName', a.otherName))}
                ${field('acOtherPhone', '電話番号', `<input type="tel" id="f-acOtherPhone" name="acOtherPhone" value="${esc(a.otherPhone || '')}">`)}
                ${field('acOtherPlate', '車両ナンバー', text('acOtherPlate', a.otherPlate))}
                ${field('acOtherDamage', '相手の損傷状況', `<textarea id="f-acOtherDamage" name="acOtherDamage" rows="2">${esc(a.otherDamage || '')}</textarea>`)}
              </div>
            </div>
          </fieldset>
          ${field('title', '異常の内容', text('title', i.title, 'placeholder="左スライドドアが閉まりにくい" required'), { required: true, full: true })}
          ${field('detail', '詳しく(任意)', `<textarea id="f-detail" name="detail" placeholder="いつから、どんな状況で、誰が気づいたか">${esc(i.detail || '')}</textarea>`, { full: true })}
          ${photoFieldHTML(i.photos || [])}
          ${isNew ? '' : `${field('status', '状態', `<select id="f-status" name="status">${opt('open', i.accident ? '未修理' : '未対応', i.status === 'open')}${opt('fixed', i.accident ? '修理済み' : '対応済み', i.status === 'fixed')}</select>`)}
          ${field('fixedAt', i.accident ? '修理日' : '対応日', date('fixedAt', i.fixedAt || ''), { hint: '済みにするときに入れます' })}`}
        </div>
      </div>
      <div class="dlg-foot">
        ${isNew ? '' : '<button type="button" class="btn danger" data-dlg="delete">この異常を削除</button>'}
        <div class="right-group"><button type="button" class="btn" data-dlg="cancel">キャンセル</button><button type="submit" class="btn primary">${isNew ? '登録する' : '保存する'}</button></div>
      </div>
    </form>`;
  let photoField;
  openDialog(html, async (d) => {
    const issue = {
      id: d.id || undefined,
      vehicleId: d.vehicleId || i.vehicleId,
      part: d.part,
      severity: d.severity,
      title: (d.title || '').trim(),
      detail: (d.detail || '').trim(),
      reportedAt: d.reportedAt,
      status: d.status || 'open',
      fixedAt: d.status === 'fixed' ? (d.fixedAt || L.todayISO()) : '',
      pins: [],
      accident: d.isAccident ? {
        datetime: d.acDatetime || '', place: (d.acPlace || '').trim(), type: d.acType || '', police: (d.acPolice || '').trim(),
        driverName: (d.acDriverName || '').trim(), plate: (d.acPlate || '').trim(), ownDamage: (d.acOwnDamage || '').trim(),
        otherName: (d.acOtherName || '').trim(), otherPhone: (d.acOtherPhone || '').trim(), otherPlate: (d.acOtherPlate || '').trim(), otherDamage: (d.acOtherDamage || '').trim(),
      } : null,
    };
    try {
      const arr = d.pins ? JSON.parse(d.pins) : [];
      issue.pins = (Array.isArray(arr) ? arr : []).filter((pn) => VIEWS[pn.view] && pn.x >= 0 && pn.x <= 1 && pn.y >= 0 && pn.y <= 1).map((pn) => ({ view: pn.view, x: Number(Number(pn.x).toFixed(4)), y: Number(Number(pn.y).toFixed(4)) }));
    } catch { issue.pins = []; }
    const errors = L.validateIssue(issue);
    const grp = L.PART_GROUPS.find((x) => x.id === d.group);
    if (grp && grp.variants.length > 1 && !grp.variants.some(([id]) => id === issue.part)) errors.unshift('左右(前後)を選んでください');
    if (errors.length) return errors;
    issue.photos = await photoField.collect();
    store.upsertIssue(issue);
    await photoField.cleanup();
    ui.detail.part = issue.part;
    toast(isNew ? '異常を登録しました' : '保存しました');
  }, async (action, close) => {
    if (action === 'delete' && confirm('この異常の記録を削除します。元に戻せません。')) {
      store.removeIssue(i.id);
      await photos.removeMany(i.photos);
      toast('削除しました');
      close();
    }
  });
  const form = $dialogRoot.querySelector('form');
  photoField = attachPhotoField(form, i.photos || []);
  const acCheck = form.querySelector('#f-isAccident'), acFs = form.querySelector('#accident-field');
  const syncAccident = () => { acFs.hidden = !acCheck.checked; picker.setMulti(acCheck.checked); };
  const picker = attachPartPicker(form);
  acCheck.addEventListener('change', syncAccident);
  syncAccident();
}

/** 場所 → 左右前後 → 図でピン、の 3 段を動かす。値は hidden の part / pin に入る。 */
function attachPartPicker(form) {
  const groupSel = form.querySelector('#f-group');
  const partIn = form.querySelector('#f-part');
  const pinIn = form.querySelector('#f-pins');
  const variantBox = form.querySelector('#variant-field');
  const pickBox = form.querySelector('#pick-field');
  let pickView = '';
  let multi = false; // 事故記録のときは複数ピン
  const getPins = () => { try { const v = pinIn.value ? JSON.parse(pinIn.value) : []; return Array.isArray(v) ? v : []; } catch { return []; } };
  const setPins = (arr) => { pinIn.value = JSON.stringify(arr); };

  function renderVariants() {
    const grp = L.PART_GROUPS.find((x) => x.id === groupSel.value);
    if (!grp) { variantBox.innerHTML = ''; return; }
    if (grp.variants.length === 1) {
      partIn.value = grp.variants[0][0];
      variantBox.innerHTML = '';
      return;
    }
    if (!grp.variants.some(([id]) => id === partIn.value)) partIn.value = '';
    variantBox.innerHTML = `<label>左右・前後</label><div class="seg variants">${grp.variants.map(([id, label]) => `<button type="button" class="seg-btn ${partIn.value === id ? 'on' : ''}" data-variant="${id}">${esc(label)}</button>`).join('')}</div>`;
  }
  function renderPick() {
    const part = partIn.value;
    const views = part ? viewsForPart(part) : [];
    if (!views.length) { pickBox.innerHTML = ''; return; }
    const pins = getPins();
    if (!views.includes(pickView)) pickView = (pins[0] && views.includes(pins[0].view)) ? pins[0].view : views[0];
    const here = pins.filter((pn) => pn.view === pickView).length;
    const hint = multi ? '傷の場所をクリックするたびにピンが増えます(複数可)' : '青い部位の中をクリックすると、その位置にピンを打ちます';
    pickBox.innerHTML = `<label>${multi ? '傷の場所を図で指す(複数可・任意)' : '図で場所を指す(任意)'}</label>
      <div class="pick-tabs">${views.map((k) => { const n = pins.filter((pn) => pn.view === k).length; return `<button type="button" class="seg-btn ${k === pickView ? 'on' : ''}" data-pick-tab="${k}">${VIEWS[k].title}${n ? ` <b>${n}</b>` : ''}</button>`; }).join('')}
        <span class="spacer"></span>${pins.length ? `<span class="muted" style="font-size:12px">📍 ${pins.length} か所</span> ${here ? `<button type="button" class="btn ghost small" data-pick-undo>この面の最後のピンを消す</button>` : ''}<button type="button" class="btn ghost small" data-pick-clear>すべて消す</button>` : `<span class="muted" style="font-size:12px">${hint}</span>`}
      </div>
      <div class="pick-wrap">${renderPickView(pickView, part, pins)}</div>`;
  }
  groupSel.addEventListener('change', () => { partIn.value = ''; setPins([]); pickView = ''; renderVariants(); renderPick(); });
  form.addEventListener('click', (e) => {
    const vb = e.target.closest('[data-variant]');
    if (vb) { partIn.value = vb.dataset.variant; setPins([]); pickView = ''; renderVariants(); renderPick(); return; }
    const tb = e.target.closest('[data-pick-tab]');
    if (tb) { pickView = tb.dataset.pickTab; renderPick(); return; }
    if (e.target.closest('[data-pick-clear]')) { setPins([]); renderPick(); return; }
    if (e.target.closest('[data-pick-undo]')) {
      const pins = getPins(); const idx = pins.map((pn) => pn.view).lastIndexOf(pickView);
      if (idx >= 0) pins.splice(idx, 1);
      setPins(pins); renderPick(); return;
    }
    const svg = e.target.closest('svg[data-pick-view]');
    if (svg) {
      const r = svg.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      const pn = { view: svg.dataset.pickView, x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
      setPins(multi ? [...getPins(), pn] : [pn]);
      renderPick();
    }
  });
  renderVariants();
  renderPick();
  return { setMulti(on) { multi = on; if (!on) { const pins = getPins(); if (pins.length > 1) setPins([pins[0]]); } renderPick(); } };
}

// ---- 写真 ----

function photoFieldHTML(ids = []) {
  return `<div class="field full"><label>写真</label>
    <div class="photo-grid" data-photo-grid>
      ${ids.filter((id) => photos.has(id)).map((id) => `<div class="photo-thumb" data-photo-id="${esc(id)}"><img src="${photos.url(id)}" alt=""><button type="button" class="photo-x" data-photo-remove="${esc(id)}" title="外す">×</button></div>`).join('')}
      <label class="photo-add" title="写真を追加"><input type="file" accept="image/*" multiple hidden data-photo-input><span>＋</span><small>写真を追加</small></label>
    </div>
    <div class="hint">長辺 1280px に縮小して、このブラウザに保存します。スマホならカメラでそのまま撮れます</div>
  </div>`;
}

/** フォーム内の写真欄を動かす。保存時に collect() を呼ぶと、新しい写真を保存して ID の配列を返す。 */
function attachPhotoField(form, existing = []) {
  const grid = form.querySelector('[data-photo-grid]');
  const input = form.querySelector('[data-photo-input]');
  const pending = [];          // { file, url, el }
  const removed = new Set();
  if (!grid || !input) return { collect: async () => existing, cleanup: async () => {} };
  input.addEventListener('change', () => {
    for (const file of input.files || []) {
      if (!file.type.startsWith('image/')) continue;
      const url = URL.createObjectURL(file);
      const el = document.createElement('div');
      el.className = 'photo-thumb pending';
      el.innerHTML = `<img src="${url}" alt=""><button type="button" class="photo-x" title="外す">×</button>`;
      const item = { file, url, el };
      el.querySelector('button').addEventListener('click', () => { URL.revokeObjectURL(url); el.remove(); item.file = null; });
      pending.push(item);
      grid.insertBefore(el, input.closest('.photo-add'));
    }
    input.value = '';
  });
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-photo-remove]');
    if (!btn) return;
    removed.add(btn.dataset.photoRemove);
    btn.closest('.photo-thumb').remove();
  });
  return {
    async collect() {
      const kept = existing.filter((id) => !removed.has(id));
      for (const item of pending) if (item.file) kept.push(await photos.addFile(item.file));
      return kept;
    },
    async cleanup() {
      for (const id of removed) await photos.remove(id);
    },
  };
}

function photoStrip(ids = []) {
  const list = ids.filter((id) => photos.has(id));
  if (!list.length) return '';
  return `<div class="issue-photos">${list.map((id) => `<img src="${photos.url(id)}" alt="" data-action="view-photo" data-photo="${esc(id)}">`).join('')}</div>`;
}

function openLightbox(id) {
  const u = photos.url(id);
  if (!u) return;
  $dialogRoot.innerHTML = `<dialog class="lightbox"><form method="dialog"><img src="${u}" alt=""><button class="btn" type="submit">閉じる</button></form></dialog>`;
  const dlg = $dialogRoot.querySelector('dialog');
  dlg.addEventListener('close', () => { $dialogRoot.innerHTML = ''; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}

// ---- CSV ----

const VEHICLE_COLUMNS = [
  { key: 'driverName', label: 'ドライバー名' }, { key: 'plate', label: 'ナンバー' }, { key: 'qr', label: '車両QR' },
  { key: 'maker', label: 'メーカー' }, { key: 'modelCode', label: '型式' }, { key: 'firstRegistration', label: '初度登録' },
  { key: 'status', label: 'ステータス', get: (v) => L.STATUS[v.status] || v.status }, { key: 'base', label: 'チーム' },
  { key: 'loaner', label: '代車', get: (v) => L.loanerLabel(v.loaner, store.getState().vehicles) },
  { key: 'inspectionExpiry', label: '車検満了日' }, { key: 'jibaisekiExpiry', label: '自賠責満了日' },
  { key: 'insuranceExpiry', label: '任意保険満了日' }, { key: 'insuranceCompany', label: '任意保険会社' }, { key: 'insurancePhone', label: '保険会社電話' },
  { key: 'odometer', label: '走行距離(km)' }, { key: 'odometerDate', label: '走行距離記録日' }, { key: 'note', label: '備考' },
];

function exportVehiclesCSV() {
  const vehicles = L.sortBy(store.getState().vehicles, 'driverName');
  download(`車両台帳_${L.todayISO()}.csv`, L.toCSV(vehicles, VEHICLE_COLUMNS), 'text/csv');
  toast('CSV を書き出しました');
}

function exportRecordsCSV() {
  const { vehicles, records } = store.getState();
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const cols = [
    { key: 'date', label: '実施日' },
    { key: 'vehicle', label: 'ドライバー名', get: (r) => byId.get(r.vehicleId)?.driverName || '' },
    { key: 'plate', label: 'ナンバー', get: (r) => byId.get(r.vehicleId)?.plate || '' },
    { key: 'type', label: '種別' }, { key: 'title', label: '内容' }, { key: 'detail', label: '詳細' },
    { key: 'vendor', label: '業者' }, { key: 'cost', label: '費用(円)' }, { key: 'odometer', label: '走行距離(km)' },
    { key: 'nextDate', label: '次回目安日' }, { key: 'nextOdometer', label: '次回目安距離(km)' },
  ];
  const rows = [...records].sort((a, b) => a.date.localeCompare(b.date));
  download(`整備記録_${L.todayISO()}.csv`, L.toCSV(rows, cols), 'text/csv');
  toast('CSV を書き出しました');
}

function downloadVehicleTemplate() {
  const cols = L.VEHICLE_CSV_FIELDS.map(([key, label]) => ({ key, label }));
  const bases = store.getState().settings.bases;
  const example = {
    driverName: '山田 太郎', plate: '品川 480 あ 12-34', qr: 'KV-0001', maker: 'スズキ', modelCode: 'DA17V', firstRegistration: '2023-04',
    status: '稼働中', base: bases[0] || '', inspectionExpiry: '2027-03-31', jibaisekiExpiry: '2027-04-30', insuranceExpiry: '2027-01-31',
    insuranceCompany: '○○損保', insurancePhone: '0120-000-000', odometer: 45000, odometerDate: L.todayISO(), note: '例の行です。消して使ってください',
  };
  download('車両CSVテンプレート.csv', L.toCSV([example], cols), 'text/csv');
  toast('テンプレートを書き出しました。Excel で開いて 2 行目から入力してください');
}

function openCSVImportDialog(text) {
  const state = store.getState();
  const { vehicles, errors } = L.vehiclesFromCSV(text, state.vehicles, state.settings);
  const added = vehicles.filter((v) => !v.id).length;
  const updated = vehicles.length - added;
  const ok = errors.length === 0 && vehicles.length > 0;
  const byId = new Map(state.vehicles.map((v) => [v.id, v]));
  const preview = vehicles.slice(0, 8).map((v) => (v.id ? { ...byId.get(v.id), ...v } : v));
  openDialog(`
    <form novalidate>
      <div class="dlg-head"><h2>車両 CSV の読み込み</h2><button type="button" class="btn ghost small" data-dlg="cancel">閉じる</button></div>
      <div class="dlg-body">
        <div class="form-errors hidden"></div>
        <p style="margin:0 0 10px"><strong>${vehicles.length} 台</strong>を読み取りました(新規 ${added} 台・ナンバーが同じで上書き ${updated} 台)。</p>
        ${errors.length ? `<div class="form-errors" style="margin-bottom:10px"><strong>${errors.length} 件の問題があります。CSV を直して読み込み直してください。</strong><ul>${errors.slice(0, 12).map((e) => `<li>${esc(e)}</li>`).join('')}${errors.length > 12 ? `<li>ほか ${errors.length - 12} 件</li>` : ''}</ul></div>` : ''}
        ${preview.length ? `<div class="table-wrap"><table><thead><tr><th>ドライバー名</th><th>ナンバー</th><th>チーム</th><th>ステータス</th><th>車検満了</th><th></th></tr></thead><tbody>
          ${preview.map((v) => `<tr><td>${esc(v.driverName)}</td><td>${esc(v.plate)}</td><td>${esc(v.base)}</td><td>${esc(L.STATUS[v.status] || v.status || '')}</td><td>${esc(v.inspectionExpiry || '')}</td><td class="muted">${v.id ? '上書き' : '新規'}</td></tr>`).join('')}
        </tbody></table></div>${vehicles.length > preview.length ? `<div class="muted" style="font-size:12px;margin-top:6px">ほか ${vehicles.length - preview.length} 台</div>` : ''}` : ''}
      </div>
      <div class="dlg-foot">
        <button type="button" class="btn" data-dlg="cancel">キャンセル</button>
        <div class="right-group"><button type="submit" class="btn primary" ${ok ? '' : 'disabled'}>${vehicles.length} 台を登録する</button></div>
      </div>
    </form>`, () => {
    if (!ok) return ['CSV の問題を直してから読み込んでください'];
    const r = store.upsertVehicles(vehicles);
    toast(`車両を登録しました(新規 ${r.added} 台・上書き ${r.updated} 台)`);
    location.hash = '#/vehicles';
  });
}

// ---- イベント ----

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.closest('dialog')) return;
  // 行の中のボタンを押したときは、行のクリックとして二重に処理しない
  const action = el.dataset.action;
  const id = el.dataset.id;
  switch (action) {
    case 'add-vehicle': openVehicleForm(null); break;
    case 'edit-vehicle': openVehicleForm(store.getVehicle(id)); break;
    case 'delete-vehicle': {
      const v = store.getVehicle(id);
      if (!v) break;
      const n = store.recordsOf(id).length;
      if (confirm(`${vehicleLabel(v)} を削除します。${n ? `整備記録 ${n} 件も一緒に消えます。` : ''}元に戻せません。`)) {
        const ids = [...store.recordsOf(id), ...store.issuesOf(id)].flatMap((x) => x.photos || []);
        store.removeVehicle(id);
        photos.removeMany(ids).catch(() => {});
        toast('削除しました');
        location.hash = '#/vehicles';
      }
      break;
    }
    case 'open-vehicle': ui.detail.part = ''; location.hash = `#/vehicles/${encodeURIComponent(id)}`; break;
    case 'open-vehicle-part': ui.detail.part = el.dataset.part || ''; location.hash = `#/vehicles/${encodeURIComponent(id)}`; break;
    case 'select-part': {
      const part = el.dataset.part || '';
      ui.detail.part = ui.detail.part === part ? '' : part;
      render();
      break;
    }
    case 'add-issue': openIssueForm(null, el.dataset.vehicle || '', el.dataset.part || ''); break;
    case 'edit-issue': {
      const i = store.getState().issues.find((x) => x.id === id);
      if (i) openIssueForm(i);
      break;
    }
    case 'fix-issue': {
      const it = store.getState().issues.find((x) => x.id === id);
      store.upsertIssue({ id, status: 'fixed', fixedAt: L.todayISO() });
      toast(it?.accident ? '修理済みにしました' : '対応済みにしました');
      break;
    }
    case 'return-loaner': {
      const v = store.getVehicle(id);
      if (!v) break;
      const msg = v.loaner ? `代車(${L.loanerLabel(v.loaner, store.getState().vehicles)})を返却し、${v.driverName} の車両を「稼働中」に戻します。` : `${v.driverName} の車両を「稼働中」に戻します。`;
      if (confirm(msg)) {
        store.upsertVehicle({ id, status: 'active', loaner: null });
        toast('稼働中に戻しました');
      }
      break;
    }
    case 'add-record': openRecordForm(null, el.dataset.vehicle || ui.maintenance.vehicleId || ''); break;
    case 'edit-record': {
      e.stopPropagation();
      const r = store.getState().records.find((x) => x.id === id);
      if (r) openRecordForm(r);
      break;
    }
    case 'sort': {
      const key = el.dataset.key;
      const u = ui.vehicles;
      if (u.sortKey === key) u.sortDir = u.sortDir === 'asc' ? 'desc' : 'asc';
      else { u.sortKey = key; u.sortDir = 'asc'; }
      render();
      break;
    }
    case 'set-view': ui.vehicles.view = el.dataset.view; render(); break;
    case 'view-photo': openLightbox(el.dataset.photo); break;
    case 'export-vehicles-csv': exportVehiclesCSV(); break;
    case 'sign-out':
      if (confirm('ログアウトしますか?')) store.auth()?.signOut();
      break;
    case 'change-password': openPasswordDialog(false); break;
    case 'reload-page': location.reload(); break;
    case 'forgot-password': {
      const email = (document.getElementById('login-email')?.value || '').trim() || prompt('登録しているメールアドレスを入力してください');
      if (!email) break;
      store.auth().resetPassword(email).then(() => toast('パスワード再設定のメールを送りました。届いたリンクを開いてください')).catch((err) => toast(err.message, true));
      break;
    }
    case 'download-vehicle-template': downloadVehicleTemplate(); break;
    case 'export-records-csv': exportRecordsCSV(); break;
    case 'export-json':
      toast('書き出しています…');
      photos.exportAll().then((list) => {
        const data = JSON.parse(store.exportJSON());
        data.photos = list;
        download(`車両管理バックアップ_${L.todayISO()}.json`, JSON.stringify(data), 'application/json');
        store.updateSettings({ lastBackupAt: L.nowISO() });
        toast(`バックアップを書き出しました(写真 ${list.length} 枚を含む)`);
      });
      break;
    case 'load-sample': {
      const has = store.getState().vehicles.length > 0;
      const cloud = store.mode() === 'cloud';
      if (!has || confirm(cloud ? '共有している全員のデータをサンプルデータで置き換えます。よろしいですか?' : '今のデータをサンプルデータで上書きします。よろしいですか?')) {
        toast('入れています…');
        (async () => {
          await photos.clear().catch(() => {});
          await store.replaceAll(buildSample());
          toast('サンプルデータを入れました');
          location.hash = '#/';
        })();
      }
      break;
    }
    case 'clear-all': {
      const cloud = store.mode() === 'cloud';
      if (confirm(cloud ? '共有している車両・整備記録・写真・設定をすべて削除します。全員の画面から消え、元に戻せません。' : 'このブラウザに保存した車両・整備記録・設定をすべて削除します。元に戻せません。')) {
        toast('削除しています…');
        (async () => {
          await photos.clear().catch(() => {});
          await store.clearAll();
          toast('すべて削除しました');
          location.hash = '#/';
        })();
      }
      break;
    }
    case 'remove-base': {
      const s = store.getState().settings;
      if (s.bases.length <= 1) { toast('チームは 1 つ以上必要です', true); break; }
      store.updateSettings({ bases: s.bases.filter((b) => b !== el.dataset.value) });
      break;
    }
    case 'remove-type': {
      const s = store.getState().settings;
      if (s.types.length <= 1) { toast('種別は 1 つ以上必要です', true); break; }
      store.updateSettings({ types: s.types.filter((t) => t !== el.dataset.value) });
      break;
    }
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const value = form.value.value.trim();
  if (!value) return;
  const s = store.getState().settings;
  if (form.dataset.form === 'add-base') {
    if (s.bases.includes(value)) return toast('同じチームがあります', true);
    store.updateSettings({ bases: [...s.bases, value] });
  } else if (form.dataset.form === 'add-type') {
    if (s.types.includes(value)) return toast('同じ種別があります', true);
    store.updateSettings({ types: [...s.types, value] });
  }
});

// フィルタ入力(検索は打つたび、セレクトは変更時)
function applyFilter(el) {
  const [page, key] = el.dataset.filter.split('.');
  ui[page][key] = el.type === 'checkbox' ? el.checked : el.value;
  render();
  // 検索欄はフォーカスを維持する
  if (el.type === 'search') {
    const again = $app.querySelector(`[data-filter="${el.dataset.filter}"]`);
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  }
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.filter && (el.type === 'search' || el.type === 'text')) applyFilter(el);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.filter && el.type !== 'search' && el.type !== 'text') applyFilter(el);
  if (el.dataset.setting) {
    const key = el.dataset.setting;
    let value = el.value;
    if (el.type === 'number') {
      value = Number(value);
      if (Number.isNaN(value) || value < Number(el.min || 0)) return toast('数値が正しくありません', true);
    }
    const patch = { [key]: value };
    if (key === 'alertDays' && value > store.getState().settings.warnDays) patch.warnDays = value;
    if (key === 'warnDays' && value < store.getState().settings.alertDays) patch.alertDays = value;
    store.updateSettings(patch);
    toast('設定を保存しました');
  }
  if (el.dataset.actionFile === 'import-vehicles-csv') {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((t) => openCSVImportDialog(t));
    el.value = '';
  }
  if (el.dataset.actionFile === 'import-json') {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      if (!confirm(store.mode() === 'cloud' ? '共有している全員のデータをバックアップの内容で置き換えます。よろしいですか?' : '今のデータをバックアップの内容で上書きします。よろしいですか?')) return;
      (async () => {
        try {
          const raw = JSON.parse(t);
          toast('読み込んでいます…');
          await photos.clear();
          await photos.importAll(raw.photos);
          await store.importJSON(t);
          toast('バックアップを読み込みました');
          location.hash = '#/';
        } catch (err) {
          toast(err.message || '読み込みに失敗しました', true);
        }
      })();
    });
    el.value = '';
  }
});

window.addEventListener('hashchange', () => { if (ready) render(); });
store.subscribe((s) => {
  if (!ready) return;
  render();
  if (store.mode() === 'cloud') photos.ensure(L.collectPhotoIds(s)).catch(() => {});
});
store.onError((msg) => toast(msg, true));
photos.setOnLoaded(() => { if (ready) render(); });

// ---- 起動・ログイン ----

let ready = false;

function updateFooter() {
  const $f = document.getElementById('sidebar-footer');
  if (!$f) return;
  if (store.mode() === 'cloud') {
    const email = store.auth()?.userEmail() || '';
    $f.innerHTML = `<div>保存先: クラウド(共有)</div><div class="footer-user" title="${esc(email)}">${esc(email)}</div><button type="button" class="btn ghost small" data-action="sign-out">ログアウト</button>`;
  } else {
    $f.textContent = '保存先: このブラウザ(ローカル)';
  }
}

function showAuthScreen(html) {
  document.body.classList.add('auth');
  $app.innerHTML = `<div class="login-wrap"><div class="card login-card">${html}</div></div>`;
  const first = $app.querySelector('input');
  if (first) first.focus();
}

function renderLogin(message = '') {
  showAuthScreen(`
    <div class="login-brand"><img src="icons/icon.svg" alt=""><div><strong>車両管理</strong><small>ログインして共有データを開く</small></div></div>
    ${message ? `<div class="form-errors" style="margin-bottom:12px"><ul><li>${esc(message)}</li></ul></div>` : ''}
    <form id="login-form" class="stack">
      <div class="field required"><label for="login-email">メールアドレス</label><input type="email" id="login-email" name="email" autocomplete="username" required></div>
      <div class="field required"><label for="login-password">パスワード</label><input type="password" id="login-password" name="password" autocomplete="current-password" required></div>
      <div class="form-errors hidden"></div>
      <button class="btn primary" type="submit" style="justify-content:center">ログイン</button>
      <button class="btn ghost small" type="button" data-action="forgot-password" style="justify-content:center">パスワードを忘れた</button>
    </form>
    <p class="muted" style="font-size:12px;margin-top:14px;line-height:1.6">利用者の追加は管理者が行います。ログインできないときは管理者に連絡してください。</p>`);
}

function renderOffline() {
  showAuthScreen(`
    <div class="login-brand"><img src="icons/icon.svg" alt=""><div><strong>車両管理</strong><small>通信できません</small></div></div>
    <p style="margin:8px 0 16px;line-height:1.7">サーバーにつながりませんでした。電波の状態を確認して、もう一度開いてください。</p>
    <button class="btn primary" type="button" data-action="reload-page" style="justify-content:center">もう一度試す</button>`);
}

function renderFatal(err) {
  showAuthScreen(`
    <div class="login-brand"><img src="icons/icon.svg" alt=""><div><strong>車両管理</strong><small>読み込みに失敗しました</small></div></div>
    <p style="margin:8px 0 16px;line-height:1.7">${esc(err?.message || String(err))}</p>
    <p class="muted" style="font-size:12px;line-height:1.6">設定(js/config.js)の URL とキー、Supabase 側のテーブル(supabase/schema.sql)を確認してください。</p>
    <button class="btn primary" type="button" data-action="reload-page" style="justify-content:center;margin-top:14px">もう一度試す</button>`);
}

async function enterApp() {
  ready = false;
  const status = await store.reload();
  if (status === 'offline') return renderOffline();
  await photos.init(store.cloudClient(), L.collectPhotoIds(store.getState()));
  document.body.classList.remove('auth');
  updateFooter();
  ready = true;
  render();
}

function openPasswordDialog(forced = false) {
  openDialog(`
    <form>
      <div class="dlg-head"><h2>${forced ? '新しいパスワードを設定' : 'パスワードを変更'}</h2>${forced ? '' : '<button type="button" class="btn ghost" data-dlg="cancel">閉じる</button>'}</div>
      <div class="dlg-body">
        ${forced ? '<p style="margin-bottom:12px">メールのリンクから開きました。新しいパスワードを決めてください。</p>' : ''}
        <div class="form-grid">
          ${field('password', '新しいパスワード(6 文字以上)', '<input type="password" id="f-password" name="password" minlength="6" autocomplete="new-password" required>', { required: true, full: true })}
          ${field('password2', '確認のためもう一度', '<input type="password" id="f-password2" name="password2" minlength="6" autocomplete="new-password" required>', { required: true, full: true })}
        </div>
        <div class="form-errors hidden"></div>
      </div>
      <div class="dlg-foot"><div class="right-group"><button class="btn primary" type="submit">保存</button></div></div>
    </form>`, async (data) => {
    if (data.password !== data.password2) return ['パスワードが一致しません'];
    await store.auth().updatePassword(data.password);
    toast('パスワードを変更しました');
    if (forced) { history.replaceState(null, '', location.pathname); enterApp(); }
  });
}

async function boot() {
  try {
    const status = await store.init();
    if (store.mode() === 'cloud') {
      store.auth().onChange((event) => {
        if (event === 'SIGNED_OUT') { ready = false; renderLogin(); }
        else if (event === 'PASSWORD_RECOVERY') openPasswordDialog(true);
      });
    }
    if (status === 'needs-auth') return renderLogin();
    if (status === 'offline') return renderOffline();
    await photos.init(store.cloudClient(), L.collectPhotoIds(store.getState()));
    document.body.classList.remove('auth');
    updateFooter();
    ready = true;
    render();
  } catch (err) {
    renderFatal(err);
  }
}

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.id !== 'login-form') return;
  e.preventDefault();
  const btn = form.querySelector('button[type=submit]');
  const box = form.querySelector('.form-errors');
  const fd = new FormData(form);
  btn.disabled = true;
  box.classList.add('hidden');
  try {
    await store.auth().signIn(String(fd.get('email')).trim(), String(fd.get('password')));
    await enterApp();
  } catch (err) {
    box.innerHTML = `<ul><li>${esc(err.message || 'ログインできませんでした')}</li></ul>`;
    box.classList.remove('hidden');
    btn.disabled = false;
  }
});

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
