// 車体の 2D 図(左側面・右側面・上面・正面・背面)。寸法は reference/ の三面図(エブリイ DA17V)に合わせたメートル値。
// 画面側は renderViews(issues, selected) を呼ぶだけ。部位は <g class="part" data-action="select-part" data-part="..."> で描く。

import { PARTS, PART_BY_ID, partStatus } from './logic.js';

const S = 78; // 1m あたりの px
const D = {
  L: 3.395, W: 1.475, H: 1.895,
  front: 1.6975, rear: -1.6975,
  wheelF: 1.6975 - 0.55, wheelR: -1.6975 + 0.395,
  tireR: 0.268, arch: 0.33, floor: 0.26,
  belt: 1.16, winTop: 1.68, doorB: 0.08, doorC: -0.86, doorFront: 1.02,
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const f = (n) => Number(n.toFixed(1));

/** 2 次ベジェを点列にする */
function quad(p0, p1, p2, n = 8) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]);
  }
  return out;
}
/** 円弧を点列にする(角度は度、u 軸が cos、v 軸が sin) */
function arc(cu, cv, r, a0, a1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = ((a0 + (a1 - a0) * i / n) * Math.PI) / 180; out.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); }
  return out;
}
function rectPts(u0, v0, u1, v1) { return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; }
function center(pts) {
  const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]);
  return [(Math.min(...us) + Math.max(...us)) / 2, (Math.min(...vs) + Math.max(...vs)) / 2];
}

/**
 * 図 1 枚を SVG にする。
 * map: { X(u), Y(v) }  shapes: [{ part, pts | circle:{c,r}, label, at, size, glass }]  deco: 装飾 SVG 文字列の配列
 */
function drawView({ viewBox, map, body, shapes, deco, status, selected, decoTop = [] }) {
  const { X, Y } = map;
  const P = (pts) => pts.map(([u, v]) => `${f(X(u))},${f(Y(v))}`).join(' ');
  const markers = new Map(); // part → [px, py]
  const partSVG = shapes.map((sh) => {
    if (sh.raw) return sh.raw;
    const st = status[sh.part];
    const cls = ['part', st ? 'has-issue' : '', selected === sh.part ? 'selected' : ''].filter(Boolean).join(' ');
    const label = PART_BY_ID[sh.part]?.label || sh.part;
    let shape;
    if (sh.circle) shape = `<circle class="shape ${sh.cls || ''}" cx="${f(X(sh.circle.c[0]))}" cy="${f(Y(sh.circle.c[1]))}" r="${f(sh.circle.r * S)}"/>`;
    else shape = `<polygon class="shape ${sh.cls || ''}" points="${P(sh.pts)}"/>`;
    const c = sh.circle ? sh.circle.c : center(sh.pts);
    if (st && !markers.has(sh.part)) markers.set(sh.part, [X(sh.at ? sh.at[0] : c[0]), Y(sh.at ? sh.at[1] : c[1])]);
    const text = sh.label ? `<text class="plabel" x="${f(X(sh.at ? sh.at[0] : c[0]))}" y="${f(Y(sh.at ? sh.at[1] : c[1])) + 3}" font-size="${sh.size || 8}"${sh.vertical ? ' writing-mode="tb"' : ''}>${esc(sh.label)}</text>` : '';
    return `<g class="${cls}" data-action="select-part" data-part="${sh.part}"><title>${esc(label)}</title>${shape}${text}</g>`;
  }).join('');
  const markerSVG = [...markers.entries()].map(([part, [px, py]]) => {
    const st = status[part];
    return `<g class="marker sev-${st.severity}" transform="translate(${f(px)} ${f(py)})"><circle class="ring" r="8"/><circle class="ring ring-2" r="8"/><circle class="dot" r="8"/><text y="3">${st.count}</text></g>`;
  }).join('');
  return `<svg viewBox="${viewBox}" class="view-svg" role="img">
    <polygon class="body-bg" points="${P(body)}"/>
    ${partSVG}
    ${deco.join('')}
    ${decoTop.join('')}
    ${markerSVG}
  </svg>`;
}

// ---- 側面(側 'l' は前が左、'r' は前が右) ----
function sideView(side, status, selected) {
  const dir = side === 'r' ? 1 : -1;
  const X = (z) => 150 + dir * z * S, Y = (y) => 166 - y * S;
  const { front, rear, wheelF, wheelR, arch, floor, belt, winTop, doorB, doorC, doorFront } = D;
  const wheelFront = side === 'l' ? 'wheel_fl' : 'wheel_fr', wheelRear = side === 'l' ? 'wheel_rl' : 'wheel_rr';
  const mirror = side === 'l' ? 'mirror_l' : 'mirror_r', slide = side === 'l' ? 'side_l' : 'side_r';
  const body = [
    [1.60, floor], [front, 0.34], [front, 0.74], [1.62, 1.03], [1.20, 1.16], [0.85, 1.72],
    ...quad([0.85, 1.72], [0.70, 1.895], [0.45, 1.895]), [-1.40, 1.895], ...quad([-1.40, 1.895], [rear, 1.895], [rear, 1.70]),
    [rear, 0.52], [-1.68, 0.34], [-1.60, floor],
    [wheelR - arch, floor], ...arc(wheelR, floor, arch, 180, 0), [wheelF - arch, floor], ...arc(wheelF, floor, arch, 180, 0),
  ];
  const shapes = [
    { part: 'cargo', pts: [[-1.62, floor], [doorC, floor], [doorC, 1.72], [doorB, 1.72], [doorB, 1.895], [-1.40, 1.895], ...quad([-1.40, 1.895], [-1.62, 1.895], [-1.62, 1.72])], label: '荷室', at: [-1.25, 0.72] },
    { part: slide, pts: rectPts(doorC, floor, doorB, 1.72), label: 'スライドドア', at: [-0.39, 0.72] },
    { part: 'cabin', pts: [[doorB, floor], [doorFront, floor], [doorFront, belt], [0.74, 1.72], [0.85, 1.72], ...quad([0.85, 1.72], [0.70, 1.895], [0.45, 1.895]), [doorB, 1.895]], label: '前ドア', at: [0.55, 0.72] },
    { part: 'hood', pts: [[doorFront, belt], [1.20, belt], [1.62, 1.03], [front, 0.74], [1.42, 0.74], [1.42, floor], [doorFront, floor]], label: 'フロント', at: [1.20, 1.00], size: 7 },
    { part: 'front_bumper', pts: [[1.42, floor], [1.60, floor], [front, 0.34], [front, 0.74], [1.42, 0.74]] },
    { part: 'rear', pts: [[-1.56, floor], [-1.60, floor], [-1.68, 0.34], [rear, 0.52], [rear, 1.70], [-1.62, 1.72], [-1.62, 0.54], [-1.56, 0.54]] },
    { part: 'windshield', pts: [[1.20, belt], [0.85, 1.72], [0.74, 1.72], [1.06, belt]], cls: 'glass' },
    { part: 'underbody', pts: rectPts(wheelR + 0.40, 0.10, wheelF - 0.40, floor), label: '下回り', at: [-0.08, 0.18], size: 7 },
  ];
  // アーチの切り欠き(背景色)→ タイヤ → ミラー・ランプ
  const archCut = [wheelF, wheelR].map((wz) => `<circle class="arch" cx="${f(X(wz))}" cy="${f(Y(floor))}" r="${f(arch * S)}"/>`);
  const shapes2 = [
    { part: wheelFront, circle: { c: [wheelF, D.tireR + 0.005], r: D.tireR }, cls: 'tire' },
    { part: wheelRear, circle: { c: [wheelR, D.tireR + 0.005], r: D.tireR }, cls: 'tire' },
    { part: mirror, pts: rectPts(0.80, 1.12, 0.98, 1.34), cls: 'trim' },
    { part: 'lights', pts: [[1.50, 0.80], [1.68, 0.80], [1.63, 1.00], [1.50, 1.00]], cls: 'lamp' },
    { part: 'lights', pts: rectPts(-1.6975, 0.38, -1.60, 0.50), cls: 'tail' },
  ];
  const line = (z0, y0, z1, y1, cls = 'line') => `<line class="${cls}" x1="${f(X(z0))}" y1="${f(Y(y0))}" x2="${f(X(z1))}" y2="${f(Y(y1))}"/>`;
  const poly = (pts, cls) => `<polygon class="${cls}" points="${pts.map(([u, v]) => `${f(X(u))},${f(Y(v))}`).join(' ')}"/>`;
  const deco = [
    poly([[doorB + 0.05, belt], [doorFront - 0.10, belt], [0.72, winTop], [doorB + 0.05, winTop]], 'glass deco'),        // 前ドア窓
    poly(rectPts(doorC + 0.06, belt, doorB - 0.06, winTop), 'glass deco'),                                                // スライド窓
    line(-0.40, belt, -0.40, winTop, 'seam'),
    poly(rectPts(-1.49, belt, -0.94, winTop), 'glass deco'),                                                              // クォーター窓
    line(doorB, floor, doorB, 1.72, 'seam'), line(doorC, floor, doorC, 1.72, 'seam'),                                     // ドアの継ぎ目
    line(-1.62, 0.87, 1.30, 0.87, 'crease'),                                                                              // プレスライン
    poly(rectPts(doorB + 0.15, 1.00, doorB + 0.30, 1.035), 'trim deco'), poly(rectPts(doorB - 0.12, 0.96, doorB - 0.07, 1.10), 'trim deco'), // ハンドル
    ...[wheelF, wheelR].map((wz) => `<path class="moulding" d="M ${f(X(wz - arch - 0.03))} ${f(Y(floor))} A ${f((arch + 0.03) * S)} ${f((arch + 0.03) * S)} 0 0 ${dir > 0 ? 1 : 0} ${f(X(wz + arch + 0.03))} ${f(Y(floor))}"/>`),
    `<circle class="rim" cx="${f(X(wheelF))}" cy="${f(Y(D.tireR + 0.005))}" r="${f(0.15 * S)}"/>`, `<circle class="rim" cx="${f(X(wheelR))}" cy="${f(Y(D.tireR + 0.005))}" r="${f(0.15 * S)}"/>`,
    line(-0.30, 1.895, -0.30, 1.895 + 0.25, 'seam'),                                                                      // アンテナ
    `<text class="dirlabel" x="${f(X(front))}" y="${f(Y(0.05))}" text-anchor="${dir > 0 ? 'end' : 'start'}">前 ${dir > 0 ? '▶' : '◀'}</text>`,
  ];
  return drawView({ viewBox: '0 0 300 180', map: { X, Y }, body, shapes: [...shapes, ...archCut.map((raw) => ({ raw })), ...shapes2], deco: [], decoTop: deco, status, selected });
}

// ---- 正面・背面 ----
function endView(kind, status, selected) {
  const isFront = kind === 'front';
  // 正面は向かって右が車の左。背面はそのまま
  const X = (x) => 150 + (isFront ? -1 : 1) * x * S, Y = (y) => 166 - y * S;
  const { W, floor } = D;
  const hw = W / 2;
  const body = [[-hw, floor], [hw, floor], [hw, 1.70], ...quad([hw, 1.70], [hw, 1.895], [hw - 0.20, 1.895]), [-hw + 0.20, 1.895], ...quad([-hw + 0.20, 1.895], [-hw, 1.895], [-hw, 1.70])];
  const roofPart = isFront ? 'cabin' : 'cargo';
  const shapes = [
    { part: roofPart, pts: [[-hw + 0.02, 1.72], [hw - 0.02, 1.72], [hw - 0.02, 1.76], ...quad([hw - 0.02, 1.76], [hw - 0.02, 1.88], [hw - 0.22, 1.88]), [-hw + 0.22, 1.88], ...quad([-hw + 0.22, 1.88], [-hw + 0.02, 1.88], [-hw + 0.02, 1.76])], label: isFront ? '運転席(ルーフ)' : '荷室(ルーフ)', at: [0, 1.80], size: 7 },
  ];
  if (isFront) {
    shapes.push(
      { part: 'windshield', pts: [[-0.68, D.belt], [0.68, D.belt], [0.64, 1.66], ...quad([0.64, 1.66], [0.62, 1.70], [0.56, 1.70]), [-0.56, 1.70], ...quad([-0.56, 1.70], [-0.62, 1.70], [-0.64, 1.66])], cls: 'glass', label: 'フロントガラス', at: [0, 1.45] },
      { part: 'hood', pts: rectPts(-hw, 0.74, hw, D.belt), label: 'フロント', at: [0, 1.07], size: 7 },
      { part: 'lights', pts: rectPts(0.34, 0.78, 0.72, 1.00), cls: 'lamp' },
      { part: 'lights', pts: rectPts(-0.72, 0.78, -0.34, 1.00), cls: 'lamp' },
      { part: 'front_bumper', pts: rectPts(-hw, floor - 0.02, hw, 0.74), label: '前バンパー', at: [0, 0.68], size: 7 },
      { part: 'mirror_r', pts: rectPts(0.76, 1.10, 0.96, 1.36), cls: 'trim' },
      { part: 'mirror_l', pts: rectPts(-0.96, 1.10, -0.76, 1.36), cls: 'trim' },
      { part: 'wheel_fr', pts: rectPts(0.58, 0.02, 0.73, floor - 0.02), cls: 'tire' },
      { part: 'wheel_fl', pts: rectPts(-0.73, 0.02, -0.58, floor - 0.02), cls: 'tire' },
      { part: 'underbody', pts: rectPts(-0.52, 0.10, 0.52, floor - 0.02), label: '下回り', at: [0, 0.17], size: 6 },
    );
  } else {
    shapes.push(
      { part: 'rear', pts: rectPts(-0.63, 0.54, 0.63, 1.72), label: 'バックドア', at: [0, 0.98] },
      { part: 'rear', pts: rectPts(-hw, floor - 0.02, hw, 0.54), label: '後バンパー', at: [0, 0.30], size: 7 },
      { part: 'lights', pts: rectPts(0.42, 0.37, 0.70, 0.50), cls: 'tail' },
      { part: 'lights', pts: rectPts(-0.70, 0.37, -0.42, 0.50), cls: 'tail' },
      { part: 'mirror_r', pts: rectPts(0.76, 1.10, 0.96, 1.36), cls: 'trim' },
      { part: 'mirror_l', pts: rectPts(-0.96, 1.10, -0.76, 1.36), cls: 'trim' },
      { part: 'wheel_rr', pts: rectPts(0.58, 0.02, 0.73, floor - 0.02), cls: 'tire' },
      { part: 'wheel_rl', pts: rectPts(-0.73, 0.02, -0.58, floor - 0.02), cls: 'tire' },
      { part: 'underbody', pts: rectPts(-0.52, 0.08, 0.52, floor - 0.02), label: '下回り', at: [0, 0.16], size: 6 },
    );
  }
  const poly = (pts, cls) => `<polygon class="${cls}" points="${pts.map(([u, v]) => `${f(X(u))},${f(Y(v))}`).join(' ')}"/>`;
  const line = (x0, y0, x1, y1, cls = 'line') => `<line class="${cls}" x1="${f(X(x0))}" y1="${f(Y(y0))}" x2="${f(X(x1))}" y2="${f(Y(y1))}"/>`;
  const deco = isFront ? [
    line(-0.70, 1.03, 0.70, 1.03, 'seam'),                                                   // フードライン
    `<circle class="trim deco" cx="${f(X(0))}" cy="${f(Y(0.90))}" r="4"/>`,                  // エンブレム
    poly(rectPts(-0.30, 0.78, 0.30, 0.86), 'trim deco'),                                     // 上段グリル
    poly(rectPts(-0.38, 0.44, 0.38, 0.64), 'trim deco'),                                     // 開口
    ...[0.49, 0.54, 0.59].map((y) => line(-0.36, y, 0.36, y, 'bar')),
    poly(rectPts(-0.165, 0.27, 0.165, 0.42), 'plate deco'),                                  // ナンバー
    `<circle class="lamp deco" cx="${f(X(0.56))}" cy="${f(Y(0.50))}" r="4"/>`, `<circle class="lamp deco" cx="${f(X(-0.56))}" cy="${f(Y(0.50))}" r="4"/>`,
    line(-0.45, 1.19, -0.10, 1.32, 'seam'), line(0.05, 1.19, 0.40, 1.32, 'seam'),             // ワイパー
    `<circle class="rim deco" cx="${f(X(0.52))}" cy="${f(Y(0.90))}" r="3.5"/>`, `<circle class="rim deco" cx="${f(X(-0.52))}" cy="${f(Y(0.90))}" r="3.5"/>`,
  ] : [
    poly([[-0.60, 1.21], [0.60, 1.21], [0.60, 1.60], ...quad([0.60, 1.60], [0.60, 1.66], [0.54, 1.66]), [-0.54, 1.66], ...quad([-0.54, 1.66], [-0.60, 1.66], [-0.60, 1.60])], 'glass deco'), // リアガラス
    poly(rectPts(-0.14, 1.73, 0.14, 1.76), 'tail deco'),                                     // ハイマウント
    poly(rectPts(-0.25, 0.63, 0.25, 0.87), 'recess deco'), poly(rectPts(-0.165, 0.67, 0.165, 0.83), 'plate deco'),
    poly(rectPts(-0.09, 0.93, 0.09, 0.96), 'trim deco'),                                     // ハンドル
    line(0.14, 1.26, 0.02, 1.56, 'seam'),                                                    // リアワイパー
    `<circle class="trim deco" cx="${f(X(0))}" cy="${f(Y(1.06))}" r="3.5"/>`,
    `<circle class="rim deco" cx="${f(X(0.40))}" cy="${f(Y(0.17))}" r="3.5"/>`,              // マフラー
    line(-0.63, 0.54, -0.63, 1.72, 'seam'), line(0.63, 0.54, 0.63, 1.72, 'seam'),
  ];
  const labels = [`<text class="dirlabel" x="${f(X(-hw))}" y="${f(Y(0.05))}" text-anchor="start">${isFront ? '車の右' : '車の左'}</text>`,
    `<text class="dirlabel" x="${f(X(hw))}" y="${f(Y(0.05))}" text-anchor="end">${isFront ? '車の左' : '車の右'}</text>`];
  return drawView({ viewBox: '0 0 300 180', map: { X, Y }, body, shapes, deco: [], decoTop: [...deco, ...labels], status, selected });
}

// ---- 上面(前が上) ----
function topView(status, selected) {
  const X = (x) => 150 + x * S, Y = (z) => 150 - z * S;
  const { W, front, rear, wheelF, wheelR, doorB, doorC } = D;
  const hw = W / 2;
  const body = [
    [-hw + 0.18, front], [hw - 0.18, front], ...quad([hw - 0.18, front], [hw, front], [hw, front - 0.18]),
    [hw, rear + 0.12], ...quad([hw, rear + 0.12], [hw, rear], [hw - 0.12, rear]), [-hw + 0.12, rear], ...quad([-hw + 0.12, rear], [-hw, rear], [-hw, rear + 0.12]),
    [-hw, front - 0.18], ...quad([-hw, front - 0.18], [-hw, front], [-hw + 0.18, front]),
  ];
  const sw = 0.16; // 側面ストリップの幅(図の上で見える幅。実際より広めに取って押しやすく)
  const shapes = [
    { part: 'front_bumper', pts: rectPts(-hw, 1.58, hw, front), label: '前バンパー', at: [0, 1.64], size: 6.5 },
    { part: 'hood', pts: rectPts(-hw, 1.20, hw, 1.58), label: 'フロント', at: [0, 1.39], size: 7 },
    { part: 'windshield', pts: [[-0.66, 1.20], [0.66, 1.20], [0.60, 0.85], [-0.60, 0.85]], cls: 'glass', label: 'ガラス', at: [0, 1.02], size: 7 },
    { part: 'cabin', pts: rectPts(-hw, doorB, hw, 0.85), label: '運転席', at: [0, 0.47] },
    { part: 'cargo', pts: [[-hw, -1.62], [hw, -1.62], [hw, doorC], [hw - sw, doorC], [hw - sw, doorB], [-hw + sw, doorB], [-hw + sw, doorC], [-hw, doorC]], label: '荷室', at: [0, -0.77] },
    { part: 'side_l', pts: rectPts(-hw, doorC, -hw + sw, doorB), label: '左スライド', at: [-hw + sw / 2, -0.39], size: 6.5, vertical: true },
    { part: 'side_r', pts: rectPts(hw - sw, doorC, hw, doorB), label: '右スライド', at: [hw - sw / 2, -0.39], size: 6.5, vertical: true },
    { part: 'rear', pts: rectPts(-hw, rear, hw, -1.62), label: '後部', at: [0, -1.66], size: 6.5 },
    { part: 'mirror_l', pts: rectPts(-0.98, 0.80, -0.76, 1.00), cls: 'trim' },
    { part: 'mirror_r', pts: rectPts(0.76, 0.80, 0.98, 1.00), cls: 'trim' },
    { part: 'wheel_fl', pts: rectPts(-0.82, wheelF - 0.27, -0.70, wheelF + 0.27), cls: 'tire' },
    { part: 'wheel_fr', pts: rectPts(0.70, wheelF - 0.27, 0.82, wheelF + 0.27), cls: 'tire' },
    { part: 'wheel_rl', pts: rectPts(-0.82, wheelR - 0.27, -0.70, wheelR + 0.27), cls: 'tire' },
    { part: 'wheel_rr', pts: rectPts(0.70, wheelR - 0.27, 0.82, wheelR + 0.27), cls: 'tire' },
    { part: 'lights', pts: rectPts(0.36, 1.62, 0.70, front), cls: 'lamp' },
    { part: 'lights', pts: rectPts(-0.70, 1.62, -0.36, front), cls: 'lamp' },
    { part: 'lights', pts: rectPts(0.42, rear, 0.70, -1.64), cls: 'tail' },
    { part: 'lights', pts: rectPts(-0.70, rear, -0.42, -1.64), cls: 'tail' },
  ];
  const line = (x0, z0, x1, z1, cls = 'line') => `<line class="${cls}" x1="${f(X(x0))}" y1="${f(Y(z0))}" x2="${f(X(x1))}" y2="${f(Y(z1))}"/>`;
  const deco = [
    ...[-0.42, -0.21, 0, 0.21, 0.42].map((x) => line(x, -1.45, x, 0.30, 'bead')),            // ルーフのビード
    line(-0.69, -1.55, -0.69, 0.60, 'seam'), line(0.69, -1.55, 0.69, 0.60, 'seam'),           // ドリップレール
    line(-hw, doorB, hw, doorB, 'seam'), line(-hw, doorC, -hw + sw, doorC, 'seam'), line(hw - sw, doorC, hw, doorC, 'seam'),
    line(-0.40, 1.00, -0.12, 1.14, 'seam'), line(0.06, 1.00, 0.34, 1.14, 'seam'),             // ワイパー
    `<circle class="trim deco" cx="${f(X(-0.30))}" cy="${f(Y(0.15))}" r="2"/>`, line(-0.30, 0.15, -0.30, -0.12, 'seam'), // アンテナ
    `<text class="dirlabel" x="150" y="12" text-anchor="middle">▲ 前</text>`,
    `<text class="dirlabel" x="58" y="150" text-anchor="start">左</text>`, `<text class="dirlabel" x="242" y="150" text-anchor="end">右</text>`,
  ];
  return drawView({ viewBox: '52 0 196 300', map: { X, Y }, body, shapes, deco: [], decoTop: deco, status, selected });
}

/** 5 面をまとめた HTML。 */
export function renderViews(issues, selected = '') {
  const status = partStatus(issues);
  const open = issues.filter((i) => i.status === 'open');
  const viewParts = {
    left: ['cargo', 'side_l', 'cabin', 'hood', 'front_bumper', 'rear', 'windshield', 'underbody', 'wheel_fl', 'wheel_rl', 'mirror_l', 'lights'],
    right: ['cargo', 'side_r', 'cabin', 'hood', 'front_bumper', 'rear', 'windshield', 'underbody', 'wheel_fr', 'wheel_rr', 'mirror_r', 'lights'],
    top: ['front_bumper', 'hood', 'windshield', 'cabin', 'cargo', 'side_l', 'side_r', 'rear', 'mirror_l', 'mirror_r', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'lights'],
    front: ['cabin', 'windshield', 'hood', 'lights', 'front_bumper', 'mirror_l', 'mirror_r', 'wheel_fl', 'wheel_fr', 'underbody'],
    rear: ['cargo', 'rear', 'lights', 'mirror_l', 'mirror_r', 'wheel_rl', 'wheel_rr', 'underbody'],
  };
  const views = [
    { key: 'left', title: '左側面', svg: sideView('l', status, selected) },
    { key: 'right', title: '右側面', svg: sideView('r', status, selected) },
    { key: 'top', title: '上面', svg: topView(status, selected) },
    { key: 'front', title: '正面', svg: endView('front', status, selected) },
    { key: 'rear', title: '背面', svg: endView('rear', status, selected) },
  ];
  return `<div class="views">${views.map((v) => {
    const n = open.filter((i) => viewParts[v.key].includes(i.part)).length;
    return `<section class="view view-${v.key} ${n ? 'has-issue' : ''}"><div class="view-title"><span>${v.title}</span><span class="view-count">${n ? `異常 ${n} 件` : '異常なし'}</span></div>${v.svg}</section>`;
  }).join('')}</div>`;
}
