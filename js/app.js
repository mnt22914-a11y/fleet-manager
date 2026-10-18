// 画面。状態は store.js、計算は logic.js に任せ、ここでは HTML を組んでイベントを捌くだけ。

import * as store from './store.js';
import * as L from './logic.js';
import { buildSample } from './sample.js';

const $app = document.getElementById('app');
const $dialogRoot = document.getElementById('dialog-root');
const $toast = document.getElementById('toast');

// 画面ごとの UI 状態(フィルタや並び順)。保存はしない。
const ui = {
  vehicles: { q: '', base: '', status: '', onlyAlert: false, sortKey: 'code', sortDir: 'asc' },
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
  return `${v.code} ${v.name || v.model || ''}`.trim();
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
          <button class="btn" data-action="load-sample">サンプルデータを入れる</button>
        </div>
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

  const th = (key, label, cls = '') => {
    const active = u.sortKey === key;
    return `<th class="sortable ${cls}" data-action="sort" data-key="${key}">${label}<span class="sort-ind">${active ? (u.sortDir === 'asc' ? '▲' : '▼') : ''}</span></th>`;
  };

  return `
    <div class="page-head">
      <div><h1>車両台帳</h1><p class="sub">全 ${vehicles.length} 台(廃車 ${vehicles.filter((v) => v.status === 'retired').length} 台を含む)</p></div>
      <div class="actions">
        <button class="btn" data-action="export-vehicles-csv">CSV 書き出し</button>
        <button class="btn primary" data-action="add-vehicle">＋ 車両を追加</button>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="search" placeholder="管理番号・ナンバー・車種・担当者で検索" value="${esc(u.q)}" data-filter="vehicles.q">
        <select data-filter="vehicles.base">${opt('', 'すべての拠点', !u.base)}${settings.bases.map((b) => opt(b, b, u.base === b)).join('')}</select>
        <select data-filter="vehicles.status">
          ${opt('', '廃車以外', u.status === '')}
          ${Object.entries(L.STATUS).map(([k, v]) => opt(k, v, u.status === k)).join('')}
          ${opt('__all', 'すべて', u.status === '__all')}
        </select>
        <label class="inline-check"><input type="checkbox" data-filter="vehicles.onlyAlert" ${u.onlyAlert ? 'checked' : ''}>アラートのある車両だけ</label>
        <span class="spacer"></span>
        <span class="count">${rows.length} 台を表示</span>
      </div>
      ${rows.length === 0 ? `<div class="empty"><strong>該当する車両がありません</strong>${vehicles.length === 0 ? '「＋ 車両を追加」から登録してください。' : '検索条件を変えてみてください。'}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr>
          ${th('code', '管理番号 / 車両名')}
          ${th('plate', 'ナンバー')}
          ${th('model', '車種')}
          ${th('base', '拠点')}
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
            <td><div class="primary">${esc(v.code)}</div><div class="secondary">${esc(v.name || '')}${v.driver ? ' ・ ' + esc(v.driver) : ''}</div></td>
            <td class="nowrap">${esc(v.plate)}</td>
            <td><div>${esc(v.model || '—')}</div><div class="secondary">${esc(v.maker || '')}</div></td>
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
        <div class="title"><h1>${esc(v.code)}${v.name ? ' ' + esc(v.name) : ''}</h1>${badgeStatus(v.status)}</div>
        <div class="plate">${esc(v.plate)} <span class="muted" style="font-weight:500">・ ${esc(v.maker || '')} ${esc(v.model || '')}${v.base ? ' ・ ' + esc(v.base) : ''}</span></div>
      </div>
      <div class="actions">
        <button class="btn danger" data-action="delete-vehicle" data-id="${esc(v.id)}">削除</button>
        <button class="btn" data-action="edit-vehicle" data-id="${esc(v.id)}">編集</button>
        <button class="btn primary" data-action="add-record" data-vehicle="${esc(v.id)}">＋ 整備を記録</button>
      </div>
    </div>
    <div class="stack">
      <div class="deadline-tiles">
        ${tile('車検満了日', v.inspectionExpiry)}
        ${tile('自賠責満了日', v.jibaisekiExpiry)}
        ${tile('任意保険満了日' + (v.insuranceCompany ? '(' + esc(v.insuranceCompany) + ')' : ''), v.insuranceExpiry)}
      </div>
      <div class="card">
        <div class="card-head"><h2>車体の状態</h2><span class="muted">${L.openIssues(issues).length ? `未対応の異常 ${L.openIssues(issues).length} 件` : '未対応の異常はありません'}</span></div>
        <div class="card-body body-wrap">
          ${renderDiagram(issues, ui.detail.part)}
          ${renderIssuePanel(v, issues, ui.detail.part, today)}
        </div>
      </div>
      <div class="grid grid-main">
        <div class="card">
          <div class="card-head"><h2>車両情報</h2></div>
          <div class="card-body"><div class="kv">
            ${kv('メーカー / 車種', esc([v.maker, v.model].filter(Boolean).join(' ')))}
            ${kv('型式', esc(v.modelCode))}
            ${kv('車台番号', esc(v.vin))}
            ${kv('初度登録', v.firstRegistration ? esc(v.firstRegistration.replace('-', '/')) : '')}
            ${kv('拠点', esc(v.base))}
            ${kv('主担当ドライバー', esc(v.driver))}
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

function recordRow(r, vehicle) {
  const next = [r.nextDate ? L.fmtDate(r.nextDate) : '', r.nextOdometer ? L.fmtKm(r.nextOdometer) : ''].filter(Boolean).join(' / ');
  return `<tr class="clickable" data-action="edit-record" data-id="${esc(r.id)}">
    <td class="nowrap num">${L.fmtDate(r.date)}</td>
    ${vehicle === null ? '' : `<td><div class="primary">${esc(vehicle?.code || '')}</div><div class="secondary">${esc(vehicle?.plate || '(削除された車両)')}</div></td>`}
    <td class="nowrap"><span class="badge plain">${esc(r.type)}</span></td>
    <td><div>${esc(r.title && r.title !== r.type ? r.title : '')}</div>${r.detail ? `<div class="secondary">${esc(r.detail)}</div>` : ''}</td>
    <td>${esc(r.vendor || '—')}</td>
    <td class="right num nowrap">${L.fmtKm(r.odometer)}</td>
    <td class="right num nowrap">${L.fmtYen(r.cost)}</td>
    <td class="nowrap muted" style="font-size:12.5px">${next || '—'}</td>
    <td class="right"><button class="btn small ghost" data-action="edit-record" data-id="${esc(r.id)}">編集</button></td>
  </tr>`;
}

// ---- 車体の図と異常 ----

function renderDiagram(issues, selected) {
  const status = L.partStatus(issues);
  const onBody = L.PARTS.filter((p) => p.spot);
  const offBody = L.PARTS.filter((p) => !p.spot);
  const shapes = onBody.map((p) => {
    const st = status[p.id];
    const cls = ['part', p.id.startsWith('wheel') ? 'wheel' : '', st ? `has-issue sev-${st.severity}` : '', selected === p.id ? 'selected' : ''].filter(Boolean).join(' ');
    const { x, y, w, h, rx } = p.spot;
    const cx = x + w / 2, cy = y + h / 2;
    const label = w >= 100 ? `<text class="plabel" x="${cx}" y="${st ? cy + 24 : cy + 4}">${esc(p.short)}</text>` : '';
    const marker = st ? `<g class="marker" transform="translate(${cx} ${cy})"><circle class="ring" r="9"/><circle class="ring ring-2" r="9"/><circle class="dot" r="9"/><text y="3.5">${st.count}</text></g>` : '';
    return `<g class="${cls}" data-action="select-part" data-part="${p.id}"><title>${esc(p.label)}</title><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>${label}${marker}</g>`;
  });
  const chips = offBody.map((p) => {
    const st = status[p.id];
    return `<button type="button" class="part-chip ${st ? `sev-${st.severity}` : ''} ${selected === p.id ? 'selected' : ''}" data-action="select-part" data-part="${p.id}">${esc(p.short)}${st ? ` <b>${st.count}</b>` : ''}</button>`;
  });
  return `<div class="diagram">
    <svg viewBox="20 0 260 460" role="img" aria-label="車両の上面図">
      <rect class="body-shadow" x="64" y="12" width="172" height="436" rx="26"/>
      <text class="dir" x="150" y="8">▲ 前</text>
      ${shapes.join('')}
    </svg>
    <div class="part-chips">${chips.join('')}</div>
    <p class="muted" style="font-size:11.5px;text-align:center;margin-top:8px">部位をクリックすると、その部位の異常だけを表示します</p>
  </div>`;
}

function issueItem(i, { showVehicle = false, showPart = true } = {}) {
  const v = showVehicle ? store.getVehicle(i.vehicleId) : null;
  const meta = [showVehicle ? esc(vehicleLabel(v)) : '', showPart ? esc(L.partLabel(i.part)) : '', `発見 ${L.fmtDate(i.reportedAt)}`, i.status === 'fixed' ? `対応 ${L.fmtDate(i.fixedAt)}` : ''].filter(Boolean).join(' ・ ');
  const action = showVehicle ? `data-action="open-vehicle-part" data-id="${esc(i.vehicleId)}" data-part="${esc(i.part)}"` : `data-action="edit-issue" data-id="${esc(i.id)}"`;
  return `<div class="issue-item ${i.status}" ${action}>
    <div><div class="t">${badgeSeverity(i.severity)} ${esc(i.title)}</div>${i.detail ? `<div class="d">${esc(i.detail)}</div>` : ''}<div class="m">${meta}</div></div>
    ${i.status === 'open' && !showVehicle ? `<div><button class="btn small" data-action="fix-issue" data-id="${esc(i.id)}">対応済みにする</button></div>` : ''}
  </div>`;
}

function renderIssuePanel(v, issues, selected, today) {
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
      const hay = [r.title, r.detail, r.vendor, r.note, v?.code, v?.plate, v?.name].join(' ').toLowerCase();
      if (!hay.includes(nq)) return false;
    }
    return true;
  });
  rows.sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
  const total = rows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
  const sortedVehicles = L.sortBy(vehicles, 'code');

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
  const chips = (items, kind) => `<div class="chips">${items.map((x) => `<span class="chip">${esc(x)}<button type="button" title="削除" data-action="remove-${kind}" data-value="${esc(x)}">×</button></span>`).join('')}</div>
    <form class="add-row" data-form="add-${kind}"><input type="text" name="value" placeholder="${kind === 'base' ? '拠点名を追加' : '種別を追加'}" required><button class="btn" type="submit">追加</button></form>`;
  return `
    <div class="page-head"><div><h1>設定</h1><p class="sub">アラートの基準、拠点、データの保管</p></div></div>
    <div class="grid grid-2">
      <div class="stack">
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
          <div class="card-head"><h2>拠点</h2></div>
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
            <div class="settings-row"><div><div>バックアップを書き出す</div><div class="desc">車両・整備記録・設定をまとめた JSON。別の PC に移すときにも使います</div></div><button class="btn" data-action="export-json">書き出す</button></div>
            <div class="settings-row"><div><div>バックアップを読み込む</div><div class="desc">今のデータは上書きされます</div></div><label class="btn">読み込む<input type="file" accept="application/json,.json" data-action-file="import-json" hidden></label></div>
            <div class="settings-row"><div><div>CSV で書き出す</div><div class="desc">Excel で開けます</div></div><div style="display:flex;gap:6px"><button class="btn small" data-action="export-vehicles-csv">車両</button><button class="btn small" data-action="export-records-csv">整備記録</button></div></div>
            <div class="settings-row"><div><div>サンプルデータを入れる</div><div class="desc">試作用の 24 台と整備履歴。今のデータは上書きされます</div></div><button class="btn" data-action="load-sample">入れる</button></div>
            <div class="settings-row"><div><div>すべて削除</div><div class="desc">このブラウザに保存した全データを消します</div></div><button class="btn danger" data-action="clear-all">削除</button></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>このアプリについて</h2></div>
          <div class="card-body muted" style="font-size:13px;line-height:1.7">
            データはこのブラウザの中(localStorage)だけに保存され、サーバーには送られません。<br>
            ブラウザのデータを消すと失われるので、定期的に「バックアップを書き出す」を使ってください。<br>
            複数人で共有するときは、クラウド同期版(Supabase)に切り替える予定です。
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
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const errors = onSubmit(data, form);
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
          ${field('code', '管理番号', text('code', v.code, 'placeholder="V-001" required'), { required: true, hint: '社内で呼ぶ番号。重複しないように' })}
          ${field('name', '車両名(呼び名)', text('name', v.name, 'placeholder="ハイエース 1号車"'))}
          ${field('plate', 'ナンバー', text('plate', v.plate, 'placeholder="品川 400 あ 12-34" required'), { required: true })}
          ${field('status', 'ステータス', `<select id="f-status" name="status">${Object.entries(L.STATUS).map(([k, l]) => opt(k, l, v.status === k)).join('')}</select>`, { required: true })}
          ${field('maker', 'メーカー', text('maker', v.maker, 'placeholder="トヨタ"'))}
          ${field('model', '車種', text('model', v.model, 'placeholder="ハイエースバン"'))}
          ${field('modelCode', '型式', text('modelCode', v.modelCode, 'placeholder="3BF-GDH201V"'))}
          ${field('vin', '車台番号', text('vin', v.vin))}
          ${field('firstRegistration', '初度登録年月', `<input type="month" id="f-firstRegistration" name="firstRegistration" value="${esc(v.firstRegistration || '')}">`)}
          ${field('base', '拠点', `<select id="f-base" name="base">${s.bases.map((b) => opt(b, b, v.base === b)).join('')}${v.base && !s.bases.includes(v.base) ? opt(v.base, v.base, true) : ''}</select>`, { hint: '拠点は設定画面で追加できます' })}
          ${field('driver', '主担当ドライバー', text('driver', v.driver))}
          <legend>期限</legend>
          ${field('inspectionExpiry', '車検満了日', date('inspectionExpiry', v.inspectionExpiry))}
          ${field('jibaisekiExpiry', '自賠責満了日', date('jibaisekiExpiry', v.jibaisekiExpiry))}
          ${field('insuranceExpiry', '任意保険満了日', date('insuranceExpiry', v.insuranceExpiry))}
          ${field('insuranceCompany', '任意保険の会社', text('insuranceCompany', v.insuranceCompany))}
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
  openDialog(html, (d) => {
    const vehicle = {
      ...d,
      id: d.id || undefined,
      code: d.code.trim(),
      plate: d.plate.trim(),
      odometer: d.odometer === '' ? null : Number(d.odometer),
    };
    const errors = L.validateVehicle(vehicle);
    const dup = store.getState().vehicles.find((x) => x.code === vehicle.code && x.id !== vehicle.id);
    if (dup) errors.push(`管理番号「${vehicle.code}」はすでに使われています`);
    if (errors.length) return errors;
    const id = store.upsertVehicle(vehicle);
    toast(isNew ? `${vehicle.code} を追加しました` : '保存しました');
    if (isNew) location.hash = `#/vehicles/${encodeURIComponent(id)}`;
  });
}

function openRecordForm(existing, presetVehicleId) {
  const state = store.getState();
  const s = state.settings;
  const r = existing || { vehicleId: presetVehicleId || '', date: L.todayISO(), type: s.types[0] || '' };
  const isNew = !existing;
  const vehicles = L.sortBy(state.vehicles.filter((v) => v.status !== 'retired' || v.id === r.vehicleId), 'code');
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
        </div>
      </div>
      <div class="dlg-foot">
        ${isNew ? '' : '<button type="button" class="btn danger" data-dlg="delete">この記録を削除</button>'}
        <div class="right-group"><button type="button" class="btn" data-dlg="cancel">キャンセル</button><button type="submit" class="btn primary">${isNew ? '記録する' : '保存する'}</button></div>
      </div>
    </form>`;
  const { form } = openDialog(html, (d) => {
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
    store.upsertRecord(rec);
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
  }, (action, close) => {
    if (action === 'delete' && confirm('この整備記録を削除します。元に戻せません。')) {
      store.removeRecord(r.id);
      toast('削除しました');
      close();
    }
  });

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
  const vehicles = L.sortBy(state.vehicles.filter((v) => v.status !== 'retired' || v.id === i.vehicleId), 'code');
  const lockVehicle = Boolean(presetVehicleId) || !isNew;
  const html = `
    <form>
      <div class="dlg-head"><h2>${isNew ? '異常を登録' : '異常を編集'}</h2><button type="button" class="btn ghost small" data-dlg="cancel">閉じる</button></div>
      <div class="dlg-body">
        <div class="form-errors hidden"></div>
        <input type="hidden" name="id" value="${esc(i.id || '')}">
        <div class="form-grid">
          ${field('vehicleId', '車両', `<select id="f-vehicleId" name="vehicleId" ${lockVehicle ? 'disabled' : ''} required>${!i.vehicleId ? opt('', '選んでください', true) : ''}${vehicles.map((v) => opt(v.id, `${vehicleLabel(v)}(${v.plate})`, v.id === i.vehicleId)).join('')}</select>${lockVehicle ? `<input type="hidden" name="vehicleId" value="${esc(i.vehicleId)}">` : ''}`, { required: true })}
          ${field('part', '部位', `<select id="f-part" name="part" required>${!i.part ? opt('', '選んでください', true) : ''}${L.PARTS.map((p) => opt(p.id, p.label, p.id === i.part)).join('')}</select>`, { required: true })}
          ${field('severity', '緊急度', `<div class="seg">${Object.entries(L.SEVERITY).map(([k, v]) => `<label class="seg-item sev-${k}"><input type="radio" name="severity" value="${k}" ${i.severity === k ? 'checked' : ''}>${v.label}</label>`).join('')}</div>`, { required: true, hint: '至急 = 走行に支障 / 早めに = 近いうちに修理 / 様子見 = 記録のみ' })}
          ${field('reportedAt', '発見日', date('reportedAt', i.reportedAt, 'required'), { required: true })}
          ${field('title', '異常の内容', text('title', i.title, 'placeholder="左スライドドアが閉まりにくい" required'), { required: true, full: true })}
          ${field('detail', '詳しく(任意)', `<textarea id="f-detail" name="detail" placeholder="いつから、どんな状況で、誰が気づいたか">${esc(i.detail || '')}</textarea>`, { full: true })}
          ${isNew ? '' : `${field('status', '状態', `<select id="f-status" name="status">${opt('open', '未対応', i.status === 'open')}${opt('fixed', '対応済み', i.status === 'fixed')}</select>`)}
          ${field('fixedAt', '対応日', date('fixedAt', i.fixedAt || ''), { hint: '対応済みにするときに入れます' })}`}
        </div>
      </div>
      <div class="dlg-foot">
        ${isNew ? '' : '<button type="button" class="btn danger" data-dlg="delete">この異常を削除</button>'}
        <div class="right-group"><button type="button" class="btn" data-dlg="cancel">キャンセル</button><button type="submit" class="btn primary">${isNew ? '登録する' : '保存する'}</button></div>
      </div>
    </form>`;
  openDialog(html, (d) => {
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
    };
    const errors = L.validateIssue(issue);
    if (errors.length) return errors;
    store.upsertIssue(issue);
    ui.detail.part = issue.part;
    toast(isNew ? '異常を登録しました' : '保存しました');
  }, (action, close) => {
    if (action === 'delete' && confirm('この異常の記録を削除します。元に戻せません。')) {
      store.removeIssue(i.id);
      toast('削除しました');
      close();
    }
  });
}

// ---- CSV ----

const VEHICLE_COLUMNS = [
  { key: 'code', label: '管理番号' }, { key: 'name', label: '車両名' }, { key: 'plate', label: 'ナンバー' },
  { key: 'maker', label: 'メーカー' }, { key: 'model', label: '車種' }, { key: 'modelCode', label: '型式' },
  { key: 'vin', label: '車台番号' }, { key: 'firstRegistration', label: '初度登録' },
  { key: 'status', label: 'ステータス', get: (v) => L.STATUS[v.status] || v.status }, { key: 'base', label: '拠点' },
  { key: 'driver', label: '主担当' }, { key: 'inspectionExpiry', label: '車検満了日' }, { key: 'jibaisekiExpiry', label: '自賠責満了日' },
  { key: 'insuranceExpiry', label: '任意保険満了日' }, { key: 'insuranceCompany', label: '任意保険会社' },
  { key: 'odometer', label: '走行距離(km)' }, { key: 'odometerDate', label: '走行距離記録日' }, { key: 'note', label: '備考' },
];

function exportVehiclesCSV() {
  const vehicles = L.sortBy(store.getState().vehicles, 'code');
  download(`車両台帳_${L.todayISO()}.csv`, L.toCSV(vehicles, VEHICLE_COLUMNS), 'text/csv');
  toast('CSV を書き出しました');
}

function exportRecordsCSV() {
  const { vehicles, records } = store.getState();
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const cols = [
    { key: 'date', label: '実施日' },
    { key: 'vehicle', label: '管理番号', get: (r) => byId.get(r.vehicleId)?.code || '' },
    { key: 'plate', label: 'ナンバー', get: (r) => byId.get(r.vehicleId)?.plate || '' },
    { key: 'type', label: '種別' }, { key: 'title', label: '内容' }, { key: 'detail', label: '詳細' },
    { key: 'vendor', label: '業者' }, { key: 'cost', label: '費用(円)' }, { key: 'odometer', label: '走行距離(km)' },
    { key: 'nextDate', label: '次回目安日' }, { key: 'nextOdometer', label: '次回目安距離(km)' },
  ];
  const rows = [...records].sort((a, b) => a.date.localeCompare(b.date));
  download(`整備記録_${L.todayISO()}.csv`, L.toCSV(rows, cols), 'text/csv');
  toast('CSV を書き出しました');
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
        store.removeVehicle(id);
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
      store.upsertIssue({ id, status: 'fixed', fixedAt: L.todayISO() });
      toast('対応済みにしました');
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
    case 'export-vehicles-csv': exportVehiclesCSV(); break;
    case 'export-records-csv': exportRecordsCSV(); break;
    case 'export-json':
      download(`車両管理バックアップ_${L.todayISO()}.json`, store.exportJSON(), 'application/json');
      toast('バックアップを書き出しました');
      break;
    case 'load-sample': {
      const has = store.getState().vehicles.length > 0;
      if (!has || confirm('今のデータをサンプルデータで上書きします。よろしいですか?')) {
        store.replaceAll(buildSample());
        toast('サンプルデータを入れました');
        location.hash = '#/';
      }
      break;
    }
    case 'clear-all':
      if (confirm('このブラウザに保存した車両・整備記録・設定をすべて削除します。元に戻せません。')) {
        store.clearAll();
        toast('すべて削除しました');
        location.hash = '#/';
      }
      break;
    case 'remove-base': {
      const s = store.getState().settings;
      if (s.bases.length <= 1) { toast('拠点は 1 つ以上必要です', true); break; }
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
    if (s.bases.includes(value)) return toast('同じ拠点があります', true);
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
  if (el.dataset.actionFile === 'import-json') {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      if (!confirm('今のデータをバックアップの内容で上書きします。よろしいですか?')) return;
      try {
        store.importJSON(t);
        toast('バックアップを読み込みました');
        location.hash = '#/';
      } catch (err) {
        toast(err.message || '読み込みに失敗しました', true);
      }
    });
    el.value = '';
  }
});

window.addEventListener('hashchange', render);
store.subscribe(render);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
