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

/** 図 1 枚を SVG にする。mirror=true で左右反転(左側面用)。 */
function imageView(key, status, selected, { side = null, mirror = false } = {}) {
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
    if (st && !markers.has(part)) markers.set(part, c);
    return `<g class="${cls}" data-action="select-part" data-part="${part}"><title>${esc(label)}</title>${shape}</g>`;
  }).join('');
  // 印の大きさは画像の幅に合わせる(画像ごとに解像度が違うため)
  const mr = Math.round(w / 38);
  const markerSVG = [...markers.entries()].map(([part, [px, py]]) => {
    const st = status[part];
    return `<g class="marker sev-${st.severity}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><circle class="ring" r="${mr}"/><circle class="ring ring-2" r="${mr}"/><circle class="dot" r="${mr}"/><text y="${Math.round(mr * 0.38)}" font-size="${Math.round(mr * 1.3)}">${st.count}</text></g>`;
  }).join('');
  const imageTag = `<image href="${v.img}" width="${w}" height="${h}" preserveAspectRatio="none"${mirror ? ` transform="scale(-1 1) translate(-${w} 0)"` : ''}/>`;
  return `<svg viewBox="0 0 ${w} ${h}" class="view-svg view-img" role="img">${imageTag}${parts}${markerSVG}</svg>`;
}

/** その面に描かれている部位の一覧(面ごとの異常件数に使う)。 */
function partsOf(key, side) {
  return [...new Set(IMAGE_VIEWS[key].parts.map((p) => resolvePart(p.part, side)))];
}

/** 5 面をまとめた HTML。 */
export function renderViews(issues, selected = '') {
  const status = partStatus(issues);
  const open = issues.filter((i) => i.status === 'open');
  const views = [
    { key: 'left', title: '左側面', note: '前は左', parts: partsOf('side', 'l'), svg: imageView('side', status, selected, { side: 'l', mirror: true }) },
    { key: 'right', title: '右側面', note: '前は右', parts: partsOf('side', 'r'), svg: imageView('side', status, selected, { side: 'r' }) },
    { key: 'top', title: '上面', note: '前が上 ・ 左右はそのまま', parts: partsOf('top'), svg: imageView('top', status, selected) },
    { key: 'front', title: '正面', note: '向かって右が車の左', parts: partsOf('front'), svg: imageView('front', status, selected) },
    { key: 'rear', title: '背面', note: '向かって左が車の左', parts: partsOf('rear'), svg: imageView('rear', status, selected) },
  ];
  return `<div class="views">${views.map((v) => {
    const n = open.filter((i) => v.parts.includes(i.part)).length;
    return `<section class="view view-${v.key} ${n ? 'has-issue' : ''}"><div class="view-title"><span>${v.title} <small class="muted">${v.note}</small></span><span class="view-count">${n ? `異常 ${n} 件` : '異常なし'}</span></div>${v.svg}</section>`;
  }).join('')}</div>`;
}
