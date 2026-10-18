// 軽バンの 3D モデル(Three.js)。ドラッグ/スワイプで回転、ピンチ/ホイールで拡大、タップで部位を選ぶ。
// Three.js は index.html で読み込む(window.THREE)。読めていなければ mount は null を返し、呼び出し側は 2D 図に切り替える。

const COLORS = {
  paint: 0xf4f6f8,       // スペリアホワイト
  bumper: 0xdfe3e7,      // 樹脂バンパー(ややグレー)
  glass: 0x4f7593,
  dark: 0x22262b,        // 黒樹脂・タイヤ
  rim: 0xb9c0c7,
  chrome: 0xd8dde2,
  lamp: 0xe9eef2,
  tail: 0xc6281c,
  amber: 0xe79a2f,
  plate: 0xf7f7f2,
  issue: 0xe0352b, issueEmissive: 0x7a0a05, selected: 0x1f4e79,
};

// ---- 寸法(m)。三面図より: 全長 3,395 / 全幅 1,475 / 全高 1,895 / ホイールベース 2,450 / 前オーバーハング 550 / 後 395 / タイヤ 145/80R12 ----
const DIM = {
  W: 1.475, L: 3.395, H: 1.895,
  front: 1.6975, rear: -1.6975,       // z(前が +)
  wheelF: 1.6975 - 0.55, wheelR: -1.6975 + 0.395,
  tireR: 0.268, rimR: 0.152, tireW: 0.145,
  floor: 0.30, belt: 1.06, winTop: 1.70,
  arch: 0.31,                          // ホイールアーチの半径(仕上がり)
  bevel: 0.06,                         // 車体の角の丸み。輪郭はこの分だけ内側に描き、押し出し時に膨らませる
};

// カメラの向きはページを再描画しても保つ
const view = { yaw: -0.75, pitch: 1.15, radius: 0 }; // radius 0 = 最初の表示時に画面に合わせて決める
let renderer = null;

function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.cursor = 'grab';
  return renderer;
}

// ---- 材質 ----
const MAT = {
  paint: () => new THREE.MeshPhysicalMaterial({ color: COLORS.paint, roughness: 0.32, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08 }),
  paintDim: () => new THREE.MeshPhysicalMaterial({ color: 0xe4e8ec, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  bumper: () => new THREE.MeshPhysicalMaterial({ color: COLORS.bumper, roughness: 0.5, metalness: 0.0, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: COLORS.glass, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.8, clearcoat: 1 }),
  trim: () => new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7 }),
  dark: () => new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.85, metalness: 0.05 }),
  grey: () => new THREE.MeshStandardMaterial({ color: 0x8e969e, roughness: 0.7 }),
  tire: () => new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.95 }),
  rim: () => new THREE.MeshStandardMaterial({ color: COLORS.rim, roughness: 0.35, metalness: 0.7 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: COLORS.chrome, roughness: 0.2, metalness: 0.9 }),
  lamp: () => new THREE.MeshPhysicalMaterial({ color: COLORS.lamp, roughness: 0.1, metalness: 0.3, emissive: 0x334455, emissiveIntensity: 0.25, clearcoat: 1 }),
  tail: () => new THREE.MeshPhysicalMaterial({ color: COLORS.tail, roughness: 0.15, metalness: 0.1, emissive: 0x5a0a05, emissiveIntensity: 0.4, clearcoat: 1 }),
  amber: () => new THREE.MeshPhysicalMaterial({ color: COLORS.amber, roughness: 0.2, emissive: 0x6a3a00, emissiveIntensity: 0.3, clearcoat: 1 }),
  plate: () => new THREE.MeshStandardMaterial({ color: COLORS.plate, roughness: 0.6 }),
};

function mesh(geo, mat, part) {
  mat.side = THREE.DoubleSide; // 貼り付けパネルは向きを気にせず表示する
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.part = part;
  return m;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** 側面のシルエット(x=z, y=y)。bevel 分だけ内側に描く(押し出しで外へ膨らむ)。ホイールアーチも輪郭に含める。 */
function sideProfile() {
  const { front, rear, floor, wheelF, wheelR, arch, bevel: B } = DIM;
  const R = arch + B;                      // 内側に描くのでアーチは大きく
  const fl = floor + B;
  const s = new THREE.Shape();
  s.moveTo(front - 0.10, fl);              // 前バンパー下端
  s.lineTo(front - B, fl + 0.07);
  s.lineTo(front - B, 0.78);               // バンパー前面(縦)
  s.lineTo(front - 0.13, 0.97);            // ノーズ(ヘッドライトの面)は少し後傾
  s.lineTo(front - 0.47, 1.67);            // フロントガラス(約 26°)
  s.quadraticCurveTo(front - 0.60, 1.895 - B, front - 0.82, 1.895 - B); // 屋根前端の丸み
  s.lineTo(rear + 0.34, 1.895 - B);        // 屋根
  s.quadraticCurveTo(rear + B + 0.02, 1.895 - B, rear + B, 1.68); // 屋根後端
  s.lineTo(rear + B, 0.54);                // バックドア
  s.lineTo(rear + B + 0.02, fl + 0.06);    // 後バンパー
  s.lineTo(rear + 0.10, fl);
  s.lineTo(wheelR - R, fl);
  s.absarc(wheelR, floor, R, Math.PI, 0, true);  // 後ホイールアーチ
  s.lineTo(wheelF - R, fl);
  s.absarc(wheelF, floor, R, Math.PI, 0, true);  // 前ホイールアーチ
  s.lineTo(front - 0.10, fl);
  return s;
}

/** 側面に貼るパネル。pts は (z, y) の列。side = -1 左 / +1 右。 */
function sidePanel(pts, side, mat, part, offset = 0.004, depth = 0) {
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => { const x = -side * z; if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); });
  shape.closePath();
  const geo = depth ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  const m = mesh(geo, mat, part);
  m.rotation.y = side * Math.PI / 2;
  m.position.x = side * (DIM.W / 2 + offset);
  return m;
}

/** 黒いゴム枠付きのガラス。 */
function sideGlass(pts, side, part, offset = 0.012) {
  const cz = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const grow = (k) => pts.map(([z, y]) => [cz + (z - cz) * k, cy + (y - cy) * k]);
  return [sidePanel(grow(1.06), side, MAT.trim(), part, offset - 0.003), sidePanel(pts, side, MAT.glass(), part, offset)];
}

/** 前後の面に貼るパネル(z 固定、x/y で指定)。 */
function facePanel(w, h, r, mat, part, x, y, z, facing = 1, depth = 0) {
  const shape = roundedRectShape(w, h, r);
  const geo = depth ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  const m = mesh(geo, mat, part);
  m.position.set(x, y, z);
  if (facing < 0) m.rotation.y = Math.PI;
  return m;
}

function arcPts(cz, cy, r, a0, a1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; out.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

function wheel(part, x, z) {
  const g = new THREE.Group();
  const tire = mesh(new THREE.CylinderGeometry(DIM.tireR, DIM.tireR, DIM.tireW, 40), MAT.tire(), part);
  tire.rotation.z = Math.PI / 2;
  const rim = mesh(new THREE.CylinderGeometry(DIM.rimR, DIM.rimR, DIM.tireW + 0.012, 28), MAT.rim(), part);
  rim.rotation.z = Math.PI / 2;
  const cap = mesh(new THREE.CylinderGeometry(0.05, 0.05, DIM.tireW + 0.03, 16), MAT.chrome(), part);
  cap.rotation.z = Math.PI / 2;
  g.add(tire, rim, cap);
  for (let i = 0; i < 8; i++) {   // スチールホイールの穴
    const hole = mesh(new THREE.CylinderGeometry(0.018, 0.018, DIM.tireW + 0.02, 10), MAT.dark(), part);
    hole.rotation.z = Math.PI / 2;
    const a = (i / 8) * Math.PI * 2;
    hole.position.set(0, Math.cos(a) * 0.105, Math.sin(a) * 0.105);
    g.add(hole);
  }
  for (let i = 0; i < 4; i++) {   // ハブナット
    const nut = mesh(new THREE.CylinderGeometry(0.01, 0.01, DIM.tireW + 0.04, 6), MAT.chrome(), part);
    nut.rotation.z = Math.PI / 2;
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    nut.position.set(0, Math.cos(a) * 0.05, Math.sin(a) * 0.05);
    g.add(nut);
  }
  g.position.set(x, DIM.tireR + 0.005, z);
  return g;
}

/** エブリイ バンを組み立てる。各メッシュの userData.part に部位 ID を入れる(車体本体は null → 位置から判定)。 */
function buildVan() {
  const g = new THREE.Group();
  const { W, front, rear, belt, winTop, bevel, floor, wheelF, wheelR, arch } = DIM;
  const half = W / 2;

  // 車体本体: 側面シルエットを幅方向に押し出し、角を丸める
  const body = mesh(new THREE.ExtrudeGeometry(sideProfile(), { depth: W - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 18 }), MAT.paint(), null);
  body.rotation.y = -Math.PI / 2;            // 押し出し方向(+z) → -x
  body.position.x = half - bevel;
  g.add(body);

  // 下回り・シャシー(アーチの向こうが見えないように)
  const under = mesh(new THREE.BoxGeometry(W - 0.16, 0.22, Math.abs(front - rear) - 0.3), MAT.dark(), 'underbody');
  under.position.set(0, floor + 0.05, (front + rear) / 2); g.add(under);
  const tank = mesh(new THREE.BoxGeometry(0.55, 0.16, 0.5), MAT.grey(), 'underbody');
  tank.position.set(0.05, 0.24, -0.55); g.add(tank);
  const muffler = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 14), MAT.grey(), 'underbody');
  muffler.rotation.x = Math.PI / 2; muffler.position.set(0.40, 0.21, rear + 0.40); g.add(muffler);
  const tip = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 10), MAT.chrome(), 'underbody');
  tip.rotation.x = Math.PI / 2; tip.position.set(0.40, 0.21, rear + 0.12); g.add(tip);

  // ---- 側面(左右) ----
  const doorBottom = 0.44;
  for (const side of [-1, 1]) {
    const partSide = side < 0 ? 'side_l' : 'side_r';
    // 前ドア: 下辺は前アーチをよける。前縁は A ピラーに沿って寝る
    g.add(sidePanel([[0.53, doorBottom], [wheelF - 0.42, doorBottom], ...arcPts(wheelF, floor, 0.42, 180, 50), [1.46, 0.74], [1.46, 0.96], [1.30, 1.02], [1.00, winTop + 0.04], [0.53, winTop + 0.04]], side, MAT.paint(), 'cabin', 0.006));
    // 前ドア窓 + 三角窓
    sideGlass([[0.57, belt], [1.20, belt + 0.02], [0.98, winTop], [0.57, winTop]], side, 'cabin').forEach((m) => g.add(m));
    sideGlass([[1.23, belt + 0.02], [1.33, belt + 0.02], [1.05, winTop - 0.05]], side, 'cabin').forEach((m) => g.add(m));
    // スライドドア + 窓(スライド窓の桟つき)
    g.add(sidePanel([[-0.83, doorBottom], [0.51, doorBottom], [0.51, winTop + 0.04], [-0.83, winTop + 0.04]], side, MAT.paint(), partSide, 0.008));
    sideGlass([[-0.79, belt], [0.47, belt], [0.47, winTop], [-0.79, winTop]], side, partSide, 0.014).forEach((m) => g.add(m));
    g.add(sidePanel([[-0.18, belt], [-0.16, belt], [-0.16, winTop], [-0.18, winTop]], side, MAT.trim(), partSide, 0.016));
    g.add(sidePanel([[-0.79, belt + 0.30], [0.47, belt + 0.30], [0.47, belt + 0.315], [-0.79, belt + 0.315]], side, MAT.trim(), partSide, 0.016));
    // リアクォーター(荷室側面): 下辺は後アーチをよける
    g.add(sidePanel([[-0.85, doorBottom], [wheelR + 0.42, doorBottom], ...arcPts(wheelR, floor, 0.42, 0, 175), [rear + bevel + 0.01, 0.47], [rear + bevel + 0.01, winTop + 0.04], [-0.85, winTop + 0.04]], side, MAT.paint(), 'cargo', 0.006));
    sideGlass([[rear + 0.14, belt], [-0.89, belt], [-0.89, winTop], [rear + 0.20, winTop], [rear + 0.15, winTop - 0.06]], side, 'cargo').forEach((m) => g.add(m));
    // ドアの継ぎ目
    for (const z of [0.52, -0.84]) g.add(sidePanel([[z - 0.005, doorBottom], [z + 0.005, doorBottom], [z + 0.005, winTop + 0.04], [z - 0.005, winTop + 0.04]], side, MAT.trim(), partSide, 0.011));
    // スライドドアのレール(窓下の溝)
    g.add(sidePanel([[-0.83, belt - 0.07], [0.51, belt - 0.07], [0.51, belt - 0.05], [-0.83, belt - 0.05]], side, MAT.trim(), partSide, 0.012));
    // キャラクターライン(窓下を前後に走る折れ線)と、ドア下のサイドシル
    g.add(sidePanel([[rear + 0.12, 0.775], [1.30, 0.775], [1.30, 0.79], [rear + 0.12, 0.79]], side, MAT.paintDim(), 'cargo', 0.009));
    g.add(sidePanel([[-0.83, floor + 0.03], [wheelF - arch - 0.03, floor + 0.03], [wheelF - arch - 0.03, doorBottom - 0.005], [-0.83, doorBottom - 0.005]], side, MAT.bumper(), partSide, 0.005));
    // ホイールアーチのモール
    for (const wz of [wheelF, wheelR]) {
      g.add(sidePanel([...arcPts(wz, floor, arch + 0.015, 180, 0, 14), ...arcPts(wz, floor, arch + 0.05, 0, 180, 14)], side, MAT.bumper(), wz > 0 ? 'cabin' : 'cargo', 0.010));
      const flap = mesh(new THREE.BoxGeometry(0.015, 0.16, 0.10), MAT.trim(), 'underbody'); // 泥よけ
      flap.position.set(side * (half - 0.09), floor + 0.08, wz - arch - 0.02); g.add(flap);
    }
    // ドアハンドル: 前ドアは横、スライドドアは縦グリップ
    const h1 = mesh(new THREE.BoxGeometry(0.02, 0.035, 0.15), MAT.trim(), 'cabin'); h1.position.set(side * (half + 0.02), 0.985, 0.70); g.add(h1);
    const h2 = mesh(new THREE.BoxGeometry(0.03, 0.14, 0.045), MAT.trim(), partSide); h2.position.set(side * (half + 0.025), 0.98, 0.42); g.add(h2);
    // 給油口(左のみ)
    if (side < 0) g.add(sidePanel([[-1.36, 0.86], [-1.22, 0.86], [-1.22, 0.99], [-1.36, 0.99]], side, MAT.paintDim(), 'cargo', 0.008));
    // ドアミラー(ドア取り付け、ウインカー付き)
    const mirrorPart = side < 0 ? 'mirror_l' : 'mirror_r';
    const arm = mesh(new THREE.BoxGeometry(0.11, 0.03, 0.06), MAT.trim(), mirrorPart);
    arm.position.set(side * (half + 0.055), 1.16, 1.18); g.add(arm);
    const mir = mesh(new THREE.BoxGeometry(0.085, 0.19, 0.24), MAT.paint(), mirrorPart);
    mir.position.set(side * (half + 0.135), 1.24, 1.16); g.add(mir);
    const mg = mesh(new THREE.BoxGeometry(0.012, 0.16, 0.21), MAT.glass(), mirrorPart);
    mg.position.set(side * (half + 0.135), 1.24, 1.10); mg.material.opacity = 0.95; g.add(mg);
    const mt = mesh(new THREE.BoxGeometry(0.06, 0.02, 0.012), MAT.amber(), 'lights');
    mt.position.set(side * (half + 0.15), 1.20, 1.285); g.add(mt);
    // ヘッドライトの回り込み(側面側)
    g.add(sidePanel([[front - 0.19, 0.80], [front - bevel - 0.004, 0.80], [front - 0.14, 0.99], [front - 0.27, 0.99]], side, MAT.lamp(), 'lights', 0.004));
  }

  // ---- 前面 ----
  const fz = front + 0.002;
  // フロントガラス(上がやや狭い台形、ゴム枠付き)
  const wsShape = new THREE.Shape(); wsShape.moveTo(-0.66, -0.37); wsShape.lineTo(0.66, -0.37); wsShape.lineTo(0.60, 0.37); wsShape.quadraticCurveTo(0.56, 0.40, 0.52, 0.40); wsShape.lineTo(-0.52, 0.40); wsShape.quadraticCurveTo(-0.56, 0.40, -0.60, 0.37); wsShape.closePath();
  const wsAngle = -Math.atan2(0.34, 0.70);
  const wsNormal = new THREE.Vector3(0, Math.sin(-wsAngle), Math.cos(-wsAngle));
  const wsMid = new THREE.Vector3(0, 1.35, front - 0.245);
  const wsTrim = mesh(new THREE.ShapeGeometry(wsShape), MAT.trim(), 'windshield');
  wsTrim.scale.set(1.045, 1.06, 1); wsTrim.position.copy(wsMid).addScaledVector(wsNormal, 0.006); wsTrim.rotation.x = wsAngle; g.add(wsTrim);
  const ws = mesh(new THREE.ExtrudeGeometry(wsShape, { depth: 0.012, bevelEnabled: false }), MAT.glass(), 'windshield');
  ws.position.copy(wsMid).addScaledVector(wsNormal, 0.009); ws.rotation.x = wsAngle; g.add(ws);
  // ワイパー(2 本、左寄り)
  for (const [x, rz] of [[-0.42, 0.40], [0.12, 0.30]]) {
    const wp = mesh(new THREE.BoxGeometry(0.46, 0.012, 0.018), MAT.trim(), 'windshield');
    wp.position.copy(wsMid).addScaledVector(wsNormal, 0.03).add(new THREE.Vector3(x + 0.1, -0.30, 0.14)); wp.rotation.z = rz; wp.rotation.x = wsAngle; g.add(wp);
  }
  // ノーズ(ボンネット相当の短い面)とフードライン、エンブレム
  g.add(facePanel(1.28, 0.17, 0.03, MAT.paint(), 'hood', 0, 0.885, fz + 0.002));
  const hoodLine = mesh(new THREE.BoxGeometry(1.26, 0.006, 0.008), MAT.trim(), 'hood'); hoodLine.position.set(0, 0.80, fz + 0.006); g.add(hoodLine);
  const emblem = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 24), MAT.chrome(), 'hood');
  emblem.rotation.x = Math.PI / 2; emblem.position.set(0, 0.90, fz + 0.012); g.add(emblem);
  // ヘッドライト(角へ回り込む台形。プロジェクター + ウインカー)
  for (const sgn of [-1, 1]) {
    const hlShape = new THREE.Shape(); hlShape.moveTo(0, 0); hlShape.lineTo(sgn * 0.33, 0); hlShape.lineTo(sgn * 0.33, 0.19); hlShape.lineTo(sgn * 0.05, 0.19); hlShape.quadraticCurveTo(0, 0.19, 0, 0.14); hlShape.closePath();
    const hl = mesh(new THREE.ExtrudeGeometry(hlShape, { depth: 0.02, bevelEnabled: false }), MAT.lamp(), 'lights');
    hl.position.set(sgn * 0.35, 0.80, fz + 0.004); g.add(hl);
    const ring = mesh(new THREE.TorusGeometry(0.055, 0.008, 8, 24), MAT.chrome(), 'lights');
    ring.position.set(sgn * 0.57, 0.90, fz + 0.026); g.add(ring);
    const proj = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 20), MAT.trim(), 'lights');
    proj.rotation.x = Math.PI / 2; proj.position.set(sgn * 0.57, 0.90, fz + 0.022); g.add(proj);
    g.add(facePanel(0.12, 0.05, 0.015, MAT.amber(), 'lights', sgn * 0.44, 0.845, fz + 0.026));
  }
  // グリル(ヘッドライト間の横長スリット)
  g.add(facePanel(0.60, 0.05, 0.015, MAT.trim(), 'hood', 0, 0.835, fz + 0.008));
  // バンパー: 樹脂、中央の大きな開口と横バー、フォグ、ナンバー
  g.add(facePanel(W - 0.02, 0.47, 0.07, MAT.bumper(), 'front_bumper', 0, 0.555, fz + 0.004, 1, 0.035));
  g.add(facePanel(0.74, 0.17, 0.03, MAT.trim(), 'front_bumper', 0, 0.665, fz + 0.041));
  for (const y of [0.63, 0.70]) g.add(facePanel(0.70, 0.02, 0.005, MAT.bumper(), 'front_bumper', 0, y, fz + 0.043));
  g.add(facePanel(0.66, 0.06, 0.02, MAT.trim(), 'front_bumper', 0, 0.395, fz + 0.041));
  g.add(facePanel(0.33, 0.165, 0.01, MAT.plate(), 'front_bumper', 0, 0.47, fz + 0.046));
  for (const sgn of [-1, 1]) {
    const house = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20), MAT.trim(), 'front_bumper');
    house.rotation.x = Math.PI / 2; house.position.set(sgn * 0.56, 0.50, fz + 0.045); g.add(house);
    const fog = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), MAT.lamp(), 'front_bumper');
    fog.rotation.x = Math.PI / 2; fog.position.set(sgn * 0.56, 0.50, fz + 0.055); g.add(fog);
  }

  // ---- 後面 ----
  const rz = rear - 0.002;
  g.add(facePanel(1.24, 1.28, 0.05, MAT.paint(), 'rear', 0, 1.14, rz - 0.002, -1));              // バックドア
  g.add(facePanel(1.16, 0.66, 0.09, MAT.trim(), 'rear', 0, 1.42, rz - 0.006, -1));               // リアガラスの枠
  g.add(facePanel(1.10, 0.60, 0.08, MAT.glass(), 'rear', 0, 1.42, rz - 0.009, -1));
  const hms = facePanel(0.28, 0.035, 0.012, MAT.tail(), 'lights', 0, 1.80, rz - 0.010, -1, 0.012); g.add(hms); // ハイマウントストップランプ
  const rwiper = mesh(new THREE.BoxGeometry(0.012, 0.38, 0.02), MAT.trim(), 'rear'); rwiper.position.set(0.12, 1.30, rz - 0.018); rwiper.rotation.z = -0.55; g.add(rwiper);
  const remblem = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 24), MAT.chrome(), 'rear'); remblem.rotation.x = Math.PI / 2; remblem.position.set(0, 0.98, rz - 0.012); g.add(remblem);
  g.add(facePanel(0.48, 0.24, 0.03, MAT.paintDim(), 'rear', 0, 0.70, rz - 0.006, -1));           // ナンバーの凹み
  g.add(facePanel(0.33, 0.165, 0.01, MAT.plate(), 'rear', 0, 0.70, rz - 0.014, -1));
  const rhandle = mesh(new THREE.BoxGeometry(0.18, 0.03, 0.02), MAT.trim(), 'rear'); rhandle.position.set(0, 0.86, rz - 0.014); g.add(rhandle);
  g.add(facePanel(W - 0.02, 0.24, 0.05, MAT.bumper(), 'rear', 0, 0.42, rz - 0.004, -1, 0.035));  // 後バンパー
  for (const sgn of [-1, 1]) {
    g.add(facePanel(0.16, 0.60, 0.03, MAT.tail(), 'lights', sgn * 0.645, 0.86, rz - 0.006, -1, 0.015)); // 縦長テールランプ
    g.add(facePanel(0.12, 0.13, 0.02, MAT.lamp(), 'lights', sgn * 0.645, 0.70, rz - 0.024, -1));
    g.add(facePanel(0.12, 0.13, 0.02, MAT.amber(), 'lights', sgn * 0.645, 1.02, rz - 0.024, -1));
    g.add(facePanel(0.14, 0.06, 0.015, MAT.tail(), 'lights', sgn * 0.52, 0.42, rz - 0.041, -1));      // バンパーのリフレクター
  }

  // ---- 屋根 ----
  const roofY = 1.895;
  for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) {        // ルーフの縦リブ
    const rib = mesh(new THREE.BoxGeometry(0.03, 0.006, 2.1), MAT.paintDim(), 'cargo');
    rib.position.set(x, roofY + 0.003, -0.42); g.add(rib);
  }
  for (const sgn of [-1, 1]) {                           // ドリップレール
    const rail = mesh(new THREE.BoxGeometry(0.014, 0.014, 2.6), MAT.trim(), 'cargo');
    rail.position.set(sgn * (half - 0.05), roofY - 0.004, -0.35); g.add(rail);
  }
  const antBase = mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.03, 10), MAT.trim(), 'cargo'); antBase.position.set(-0.50, roofY + 0.015, -1.25); g.add(antBase);
  const antenna = mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.34, 8), MAT.trim(), 'cargo');
  antenna.position.set(-0.50, roofY + 0.14, -1.14); antenna.rotation.x = -0.7; g.add(antenna);

  // ---- タイヤ ----
  const wx = half - DIM.tireW / 2 - 0.03;
  g.add(wheel('wheel_fl', -wx, wheelF), wheel('wheel_fr', wx, wheelF));
  g.add(wheel('wheel_rl', -wx, wheelR), wheel('wheel_rr', wx, wheelR));

  // 元の色を控える(ハイライト解除用)
  g.traverse((o) => { if (o.isMesh) o.userData.base = o.material.color.getHex(); });
  return g;
}

/** 車体本体(part=null)に当たったとき、位置から部位を決める。 */
function partFromPoint(p) {
  const { front, rear, W } = DIM;
  if (p.y > 1.80) return p.z > 0.5 ? 'cabin' : 'cargo';
  if (p.z > front - 0.45) return p.y > 0.98 ? 'windshield' : p.y > 0.80 ? 'hood' : 'front_bumper';
  if (p.z < rear + 0.1) return 'rear';
  if (Math.abs(p.x) > W / 2 - 0.1) {
    if (p.z > 0.5) return 'cabin';
    if (p.z > -0.82) return p.x < 0 ? 'side_l' : 'side_r';
    return 'cargo';
  }
  return p.y < 0.45 ? 'underbody' : p.z > 0.5 ? 'cabin' : 'cargo';
}

/**
 * container に 3D 表示を取り付ける。
 * status: { partId: { count, severity } }、selected: 部位 ID、onSelect(partId)
 */
export function mountVan3D(container, { status = {}, selected = '', onSelect } = {}) {
  if (!globalThis.THREE) return null;
  const r = getRenderer();
  container.appendChild(r.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const target = new THREE.Vector3(0, 0.95, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa5b1, 0.75));
  const fill = new THREE.DirectionalLight(0xdce8ff, 0.35); fill.position.set(-4, 3, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.3); rim.position.set(0, 5, -6); scene.add(rim);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.left = -4; sun.shadow.camera.right = 4; sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.0, 64), new THREE.MeshBasicMaterial({ color: 0xe6ebf0, transparent: true, opacity: 0.55 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.001;
  scene.add(disc);

  const van = buildVan();
  scene.add(van);
  const meshes = [];
  van.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const parts = meshes.filter((m) => m.userData.part);

  // 異常のある部位は赤、選択中は青い縁取り
  const issueMeshes = [];
  const outlines = [];
  for (const m of parts) {
    const st = status[m.userData.part];
    if (st) {
      m.material = m.material.clone();
      m.material.color.setHex(COLORS.issue);
      m.material.emissive = new THREE.Color(COLORS.issueEmissive);
      m.material.emissiveIntensity = 0.35;
      m.userData.severity = st.severity;
      issueMeshes.push(m);
    }
    if (selected && m.userData.part === selected) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), new THREE.LineBasicMaterial({ color: COLORS.selected }));
      edges.position.copy(m.position); edges.rotation.copy(m.rotation); edges.scale.copy(m.scale).multiplyScalar(1.01);
      m.parent.add(edges); outlines.push(edges);
      if (!st) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(COLORS.selected); m.material.emissiveIntensity = 0.22; }
    }
  }

  // ---- 操作 ----
  const el = r.domElement;
  const pointers = new Map();
  let drag = null, pinch = null, lastInteract = performance.now() - 10000, hovered = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    if (hit.object.userData.part) return hit.object;
    // 車体本体: 当たった位置から部位を決めて、仮のオブジェクトとして返す
    const local = van.worldToLocal(hit.point.clone());
    return { userData: { part: partFromPoint(local) }, isBody: true };
  }
  function onDown(e) {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteract = performance.now();
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0 };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: view.radius }; drag = null; }
    el.style.cursor = 'grabbing';
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      view.radius = Math.min(16, Math.max(3.5, pinch.r * (pinch.d / Math.max(1, d))));
      lastInteract = performance.now();
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      view.yaw -= dx * 0.008;
      view.pitch = Math.min(1.45, Math.max(0.15, view.pitch - dy * 0.006));
      lastInteract = performance.now();
      return;
    }
    if (e.pointerType === 'mouse') {
      const m = pick(e.clientX, e.clientY);
      if (m !== hovered) { hovered = m; el.style.cursor = m ? 'pointer' : 'grab'; }
    }
  }
  function onUp(e) {
    const wasTap = drag && drag.moved < 6;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; el.style.cursor = 'grab'; }
    if (wasTap) {
      const m = pick(e.clientX, e.clientY);
      if (m && onSelect) onSelect(m.userData.part);
    }
  }
  function onWheel(e) {
    e.preventDefault();
    view.radius = Math.min(16, Math.max(3.5, view.radius + e.deltaY * 0.006));
    lastInteract = performance.now();
  }
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });

  // ---- サイズ ----
  function fitRadius() {
    // 車体(半径 2.3m の球とみなす)が縦横どちらでも収まる距離
    const vFov = (camera.fov * Math.PI) / 360;
    const hFov = Math.atan(Math.tan(vFov) * camera.aspect);
    return 2.25 / Math.sin(Math.min(vFov, hFov)) * 1.0;
  }
  function resize() {
    const w = container.clientWidth || 300, h = container.clientHeight || 320;
    r.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!view.radius) view.radius = fitRadius();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---- 描画ループ ----
  let raf = 0, alive = true;
  const t0 = performance.now();
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    camera.position.set(
      target.x + view.radius * Math.sin(view.pitch) * Math.sin(view.yaw),
      target.y + view.radius * Math.cos(view.pitch),
      target.z + view.radius * Math.sin(view.pitch) * Math.cos(view.yaw),
    );
    camera.lookAt(target);
    const t = (now - t0) / 1000;
    for (const m of issueMeshes) {
      const speed = m.userData.severity === 'high' ? 4 : 2.2;
      m.material.emissiveIntensity = 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(t * speed));
    }
    r.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose()); } });
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}
