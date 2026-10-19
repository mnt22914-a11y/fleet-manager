// 車体の 2D 図(左側面・右側面・上面・正面・背面)。reference/ の図面画像(img/)をそのまま使い、
// その上に透明な部位の領域(js/regions2d.js)を重ねる。異常のある部位は赤、選択中は青枠。
// 画面側は renderViews(issues, selected) を呼ぶだけ。

import { PART_BY_ID, partStatus } from './logic.js';
import { IMAGE_VIEWS } from './regions2d.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 側面の汎用 ID(wheel_f など)を、左右に応じた部位 ID にする。 */
function resolvePart(id, side) {
  if (!side) return id;
  if (id === 'wheel_f') return side === 'l' ? 'wheel_fl' : 'wheel_fr';
  if (id === 'wheel_r') return side === 'l' ? 'wheel_rl' : 'wheel_rr';
  if (id === 'mirror') return side === 'l' ? 'mirror_l' : 'mirror_r';
  if (id === 'side') return side === 'l' ? 'side_l' : 'side_r';
  if (id === 'lamp_f') return side === 'l' ? 'lamp_fl' : 'lamp_fr';
  if (id === 'lamp_r') return side === 'l' ? 'lamp_rl' : 'lamp_rr';
  return id;
}

/** 5 つの面の定義。key は画面上の面、img は regions2d.js の画像キー。 */
export const VIEWS = {
  left: { title: '左側面', note: '前は左', img: 'side', side: 'l', mirror: true },
  right: { title: '右側面', note: '前は右', img: 'side', side: 'r', mirror: false },
  top: { title: '上面', note: '前が上 ・ 左右はそのまま', img: 'top', side: null, mirror: false },
  front: { title: '正面', note: '向かって右が車の左', img: 'front', side: null, mirror: false },
  rear: { title: '背面', note: '向かって左が車の左', img: 'rear', side: null, mirror: false },
};

/** その部位が描かれている面のキー一覧(記録のときに図を選ぶ順)。 */
export function viewsForPart(part) {
  return Object.keys(VIEWS).filter((k) => partsOf(VIEWS[k].img, VIEWS[k].side).includes(part));
}

/** ピン(地図のマーカー形)。x, y は面の画像に対する 0〜1 の相対位置。 */
function pinSVG(w, h, pin, cls = '', label = '') {
  const px = pin.x * w, py = pin.y * h;
  const r = Math.round(w / 40);
  return `<g class="pin ${cls}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">
    <circle class="pin-pulse" r="${r}"/>
    <path class="pin-body" d="M0 0 C ${-r * 0.9} ${-r * 1.1}, ${-r * 1.4} ${-r * 2.2}, 0 ${-r * 3.2} C ${r * 1.4} ${-r * 2.2}, ${r * 0.9} ${-r * 1.1}, 0 0 Z"/>
    <circle class="pin-dot" cx="0" cy="${-r * 2.1}" r="${r * 0.55}"/>
    ${label ? `<text class="pin-label" y="${-r * 2.1 + r * 0.4}" font-size="${r * 1.1}">${esc(label)}</text>` : ''}
  </g>`;
}

/** 図 1 枚を SVG にする。mirror=true で左右反転(左側面用)。pins はこの面に打たれたピンの一覧。 */
function imageView(key, status, selected, { side = null, mirror = false, pins = [], unpinnedParts = null, target = '', pick = false } = {}) {
  const v = IMAGE_VIEWS[key];
  const { w, h } = v;
  const fx = (x) => (mirror ? w - x : x);
  const markers = new Map();
  const parts = v.parts.map((sh) => {
    const part = resolvePart(sh.part, side);
    const st = status[part];
    const cls = ['part', st ? 'has-issue' : '', selected === part ? 'selected' : ''].filter(Boolean).join(' ');
    const label = PART_BY_ID[part]?.label || part;
    let shape, c;
    if (sh.c) {
      shape = `<circle class="shape" cx="${fx(sh.c[0])}" cy="${sh.c[1]}" r="${sh.r}"/>`;
      c = [fx(sh.c[0]), sh.c[1]];
    } else {
      shape = `<polygon class="shape" points="${sh.pts.map(([x, y]) => `${fx(x)},${y}`).join(' ')}"/>`;
      const xs = sh.pts.map((p) => fx(p[0])), ys = sh.pts.map((p) => p[1]);
      c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }
    if (st && !markers.has(part) && (!unpinnedParts || unpinnedParts.has(part))) markers.set(part, c);
    const tcls = target && part === target ? ' target' : '';
    const act = pick ? '' : ` data-action="select-part" data-part="${part}"`;
    return `<g class="${cls}${tcls}"${act}><title>${esc(label)}</title>${shape}</g>`;
  }).join('');
  // 印の大きさは画像の幅に合わせる(画像ごとに解像度が違うため)
  const mr = Math.round(w / 38);
  const markerSVG = [...markers.entries()].map(([part, [px, py]]) => {
    const st = status[part];
    return `<g class="marker sev-${st.severity}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><circle class="ring" r="${mr}"/><circle class="ring ring-2" r="${mr}"/><circle class="dot" r="${mr}"/><text y="${Math.round(mr * 0.38)}" font-size="${Math.round(mr * 1.3)}">${st.count}</text></g>`;
  }).join('');
  const pinSVGs = pins.map((pn) => pinSVG(w, h, pn, `sev-${pn.severity || 'mid'}${pn.selected ? ' selected' : ''}`, pn.label || '')).join('');
  const imageTag = `<image href="${v.img}" width="${w}" height="${h}" preserveAspectRatio="none"${mirror ? ` transform="scale(-1 1) translate(-${w} 0)"` : ''}/>`;
  return `<svg viewBox="0 0 ${w} ${h}" class="view-svg view-img${pick ? ' pick-svg' : ''}" role="img"${pick ? ` data-pick-view="${key}"` : ''}>${imageTag}${parts}${markerSVG}${pinSVGs}</svg>`;
}

/** 記録フォーム用: 1 つの面を、対象の部位を青く示した状態で描く。pin があればそこにピン。 */
export function renderPickView(viewKey, part, pin) {
  const v = VIEWS[viewKey];
  if (!v) return '';
  return imageView(v.img, {}, '', { side: v.side, mirror: v.mirror, target: part, pick: true, pins: pin ? [{ ...pin, severity: 'pick' }] : [] });
}

/** その面に描かれている部位の一覧(面ごとの異常件数に使う)。 */
function partsOf(key, side) {
  return [...new Set(IMAGE_VIEWS[key].parts.map((p) => resolvePart(p.part, side)))];
}

/** 5 面をまとめた HTML。 */
export function renderViews(issues, selected = '') {
  const status = partStatus(issues);
  const open = issues.filter((i) => i.status === 'open');
  const unpinned = new Set(open.filter((i) => !i.pin).map((i) => i.part));
  const pinsByView = {};
  open.forEach((i, idx) => {
    if (!i.pin || !VIEWS[i.pin.view]) return;
    (pinsByView[i.pin.view] ||= []).push({ x: i.pin.x, y: i.pin.y, severity: i.severity, selected: selected && i.part === selected, label: String(open.indexOf(i) + 1) });
  });
  return `<div class="views">${Object.entries(VIEWS).map(([key, v]) => {
    const parts = partsOf(v.img, v.side);
    const n = open.filter((i) => parts.includes(i.part)).length;
    const svg = imageView(v.img, status, selected, { side: v.side, mirror: v.mirror, pins: pinsByView[key] || [], unpinnedParts: unpinned });
    return `<section class="view view-${key} ${n ? 'has-issue' : ''}"><div class="view-title"><span>${v.title} <small class="muted">${v.note}</small></span><span class="view-count">${n ? `異常 ${n} 件` : '異常なし'}</span></div>${svg}</section>`;
  }).join('')}</div>`;
}
