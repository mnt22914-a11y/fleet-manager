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

// ---- 寸法(m)。三面図(reference/)から読み取り: 全長 3,395 / 全幅 1,475 / 全高 1,895 / WB 2,450 / 前オーバーハング 550 / 後 395 ----
// 側面図の座標(前端を z=+1.6975、後端を z=-1.6975 とする):
//   フロントガラス 付け根 (1.20, 1.16) → 上端 (0.85, 1.72) / ボンネット面 (1.20,1.16)→(1.62,1.03) / ヘッドライト面 (1.62,1.03)→(1.70,0.74)
//   前ドア z 0.08〜1.02 / スライドドア z -0.86〜0.08 / リアクォーター窓 z -1.49〜-0.94 / ベルトライン 1.16 / 窓上端 1.68
const DIM = {
  W: 1.475, L: 3.395, H: 1.895,
  front: 1.6975, rear: -1.6975,
  wheelF: 1.6975 - 0.55, wheelR: -1.6975 + 0.395,
  tireR: 0.268, rimR: 0.152, tireW: 0.145,
  tread: 1.31, clearance: 0.165,
  floor: 0.26, belt: 1.16, winTop: 1.68,
  arch: 0.33,
  bevel: 0.06,
  wsBase: [1.20, 1.16], wsTop: [0.85, 1.72],      // フロントガラス(z, y)
  hoodFront: [1.62, 1.03], bumperTop: 0.74,       // ボンネット前端 / ヘッドライト面の下端
  doorB: 0.08, doorC: -0.86, doorFront: 1.02,     // B ピラー / C ピラー / 前ドア前縁
};

// カメラの向きはページを再描画しても保つ
const view = { yaw: -0.75, pitch: 1.15, radius: 0 }; // radius 0 = 最初の表示時に画面に合わせて決める
globalThis.__van3dView = view; // 動作確認用(テストから視点を指定する)
let renderer = null;

function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.cursor = 'grab';
  return renderer;
}

// ---- 材質 ----
const MAT = {
  paint: () => new THREE.MeshPhysicalMaterial({ color: COLORS.paint, roughness: 0.3, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.9 }),
  paintDim: () => new THREE.MeshPhysicalMaterial({ color: 0xe4e8ec, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  bumper: () => new THREE.MeshPhysicalMaterial({ color: COLORS.bumper, roughness: 0.5, metalness: 0.0, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.6 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x3f5f7c, roughness: 0.05, metalness: 0.05, transparent: true, opacity: 0.82, clearcoat: 1, envMapIntensity: 1.0 }),
  trim: () => new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7, envMapIntensity: 0.4 }),
  dark: () => new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.85, metalness: 0.05 }),
  grey: () => new THREE.MeshStandardMaterial({ color: 0x8e969e, roughness: 0.7 }),
  tire: () => new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.95, envMapIntensity: 0.3 }),
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
  const { front, rear, floor, wheelF, wheelR, arch, bevel: B, wsBase, wsTop, hoodFront, bumperTop } = DIM;
  const R = arch + B;
  const fl = floor + B;
  const s = new THREE.Shape();
  s.moveTo(front - 0.12, fl);                       // 前バンパー下端
  s.lineTo(front - B, fl + 0.07);
  s.lineTo(front - B, bumperTop - 0.02);            // バンパー前面(縦)
  s.lineTo(hoodFront[0] - 0.05, hoodFront[1] - 0.02); // ヘッドライトの面(後傾)
  s.lineTo(wsBase[0], wsBase[1] - B);               // ボンネット(前下がり)
  s.lineTo(wsTop[0] - 0.03, wsTop[1] - 0.05);       // フロントガラス(約 32°)
  s.quadraticCurveTo(wsTop[0] - 0.18, 1.895 - B, wsTop[0] - 0.42, 1.895 - B); // 屋根前端の丸み
  s.lineTo(rear + 0.36, 1.895 - B);                 // 屋根
  s.quadraticCurveTo(rear + B + 0.02, 1.895 - B, rear + B, 1.68); // 屋根後端
  s.lineTo(rear + B, 0.52);                         // バックドア
  s.lineTo(rear + B + 0.02, fl + 0.06);             // 後バンパー
  s.lineTo(rear + 0.12, fl);
  s.lineTo(wheelR - R, fl);
  s.absarc(wheelR, floor, R, Math.PI, 0, true);     // 後ホイールアーチ
  s.lineTo(wheelF - R, fl);
  s.absarc(wheelF, floor, R, Math.PI, 0, true);     // 前ホイールアーチ
  s.lineTo(front - 0.12, fl);
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

/** 面に貼るパネル(x/y で指定、z は面の位置)。 */
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
  const { W, front, rear, belt, winTop, bevel, floor, wheelF, wheelR, arch, wsBase, wsTop, hoodFront, bumperTop, doorB, doorC, doorFront } = DIM;
  const half = W / 2;

  // 車体本体: 側面シルエットを幅方向に押し出し、角を丸める
  const body = mesh(smoothGeometry(new THREE.ExtrudeGeometry(sideProfile(), { depth: W - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 7, curveSegments: 24 })), MAT.paint(), null);
  body.rotation.y = -Math.PI / 2;            // 押し出し方向(+z) → -x
  body.position.x = half - bevel;
  g.add(body);

  // 下回り・シャシー(アーチの向こうが見えないように)
  const under = mesh(new THREE.BoxGeometry(W - 0.16, floor + 0.04 - DIM.clearance, Math.abs(front - rear) - 0.3), MAT.dark(), 'underbody');
  under.position.set(0, (floor + 0.04 + DIM.clearance) / 2, (front + rear) / 2); g.add(under);
  const tank = mesh(new THREE.BoxGeometry(0.55, 0.12, 0.5), MAT.grey(), 'underbody');
  tank.position.set(0.05, DIM.clearance + 0.07, -0.55); g.add(tank);
  // リアアクスル・デフ・リーフスプリング(背面図の下回り)
  const axle = mesh(new THREE.CylinderGeometry(0.035, 0.035, DIM.tread - 0.1, 12), MAT.grey(), 'underbody');
  axle.rotation.z = Math.PI / 2; axle.position.set(0, DIM.tireR, wheelR); g.add(axle);
  const diff = mesh(new THREE.SphereGeometry(0.11, 16, 12), MAT.grey(), 'underbody'); diff.position.set(0.05, DIM.tireR, wheelR); g.add(diff);
  for (const sx of [-1, 1]) {
    const leaf = mesh(new THREE.BoxGeometry(0.06, 0.02, 1.0), MAT.dark(), 'underbody'); leaf.position.set(sx * 0.55, DIM.tireR + 0.05, wheelR); g.add(leaf);
    const shackle = mesh(new THREE.BoxGeometry(0.04, 0.10, 0.04), MAT.dark(), 'underbody'); shackle.position.set(sx * 0.55, DIM.tireR + 0.10, wheelR + 0.48); g.add(shackle);
  }
  const muffler = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 14), MAT.grey(), 'underbody');
  muffler.rotation.x = Math.PI / 2; muffler.position.set(0.40, 0.19, rear + 0.40); g.add(muffler);
  const tip = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 10), MAT.chrome(), 'underbody');
  tip.rotation.x = Math.PI / 2; tip.position.set(0.40, 0.19, rear + 0.12); g.add(tip);

  // ---- 側面(左右) ----
  const doorBottom = 0.42;
  const pillarTopZ = wsTop[0] - 0.08;   // A ピラー上端(ドア枠側)
  for (const side of [-1, 1]) {
    const partSide = side < 0 ? 'side_l' : 'side_r';
    // 前ドア(z 0.08〜1.02): 下辺は前アーチをよけ、前縁の上部は A ピラーに沿って寝る
    const aDoor = Math.acos((doorFront - wheelF) / 0.44) * 180 / Math.PI; // ドア前縁がアーチ円と交わる角度
    g.add(sidePanel([[doorB + 0.01, doorBottom], [wheelF - 0.44, doorBottom], ...arcPts(wheelF, floor, 0.44, 180, aDoor), [doorFront, belt - 0.02], [doorFront - 0.03, belt], [pillarTopZ, winTop + 0.04], [doorB + 0.01, winTop + 0.04]], side, MAT.paint(), 'cabin', 0.006));
    // 前ドア窓(前縁は A ピラーに沿う) + 三角窓
    sideGlass([[doorB + 0.05, belt], [doorFront - 0.08, belt], [pillarTopZ + 0.02, winTop], [doorB + 0.05, winTop]], side, 'cabin').forEach((m) => g.add(m));
    sideGlass([[doorFront - 0.06, belt + 0.01], [doorFront - 0.005, belt + 0.01], [doorFront - 0.20, belt + 0.30]], side, 'cabin', 0.013).forEach((m) => g.add(m));
    // スライドドア(z -0.86〜0.08)+ 窓(スライド窓の桟つき)
    g.add(sidePanel([[doorC, doorBottom], [doorB, doorBottom], [doorB, winTop + 0.04], [doorC, winTop + 0.04]], side, MAT.paint(), partSide, 0.008));
    sideGlass([[doorC + 0.08, belt], [doorB - 0.06, belt], [doorB - 0.06, winTop], [doorC + 0.08, winTop]], side, partSide, 0.014).forEach((m) => g.add(m));
    g.add(sidePanel([[-0.41, belt], [-0.39, belt], [-0.39, winTop], [-0.41, winTop]], side, MAT.trim(), partSide, 0.016));
    g.add(sidePanel([[doorC + 0.08, belt + 0.26], [doorB - 0.06, belt + 0.26], [doorB - 0.06, belt + 0.275], [doorC + 0.08, belt + 0.275]], side, MAT.trim(), partSide, 0.016));
    // リアクォーター(荷室側面): 下辺は後アーチをよける
    const aQ0 = Math.asin((doorBottom - floor) / 0.44) * 180 / Math.PI;
    const aQ1 = Math.acos((rear + 0.07 - wheelR) / 0.44) * 180 / Math.PI;
    g.add(sidePanel([[doorC - 0.01, doorBottom], [wheelR + 0.44 * Math.cos(aQ0 * Math.PI / 180), doorBottom], ...arcPts(wheelR, floor, 0.44, aQ0, aQ1), [rear + 0.07, winTop + 0.04], [doorC - 0.01, winTop + 0.04]], side, MAT.paint(), 'cargo', 0.006));
    sideGlass([[-1.49, belt], [-0.94, belt], [-0.94, winTop], [-1.44, winTop], [-1.49, winTop - 0.06]], side, 'cargo').forEach((m) => g.add(m));
    // ドアの継ぎ目(B ピラー・C ピラー)
    for (const z of [doorB + 0.005, doorC - 0.005]) g.add(sidePanel([[z - 0.005, doorBottom], [z + 0.005, doorBottom], [z + 0.005, winTop + 0.04], [z - 0.005, winTop + 0.04]], side, MAT.trim(), partSide, 0.011));
    // スライドドアのレール(窓下の溝)
    g.add(sidePanel([[doorC, belt - 0.07], [doorB, belt - 0.07], [doorB, belt - 0.05], [doorC, belt - 0.05]], side, MAT.trim(), partSide, 0.012));
    // キャラクターライン(窓下 0.87m を前後に走る)と、ドア下のサイドシル
    g.add(sidePanel([[rear + 0.12, 0.862], [1.30, 0.862], [1.30, 0.878], [rear + 0.12, 0.878]], side, MAT.paint(), 'cargo', 0.004, 0.008));
    g.add(sidePanel([[1.30, 0.862], [hoodFront[0] - 0.03, 0.772], [hoodFront[0] - 0.03, 0.788], [1.30, 0.878]], side, MAT.paint(), 'hood', 0.004, 0.008));
    // スライドドアのレールカバー(リアクォーター上部の帯)
    g.add(sidePanel([[rear + 0.10, 0.80], [doorC - 0.02, 0.80], [doorC - 0.02, 0.86], [rear + 0.10, 0.86]], side, MAT.bumper(), 'cargo', 0.006, 0.012));
    g.add(sidePanel([[doorC, floor + 0.03], [wheelF - arch - 0.03, floor + 0.03], [wheelF - arch - 0.03, doorBottom - 0.005], [doorC, doorBottom - 0.005]], side, MAT.bumper(), partSide, 0.005));
    // ホイールアーチのモールと泥よけ
    for (const wz of [wheelF, wheelR]) {
      g.add(sidePanel([...arcPts(wz, floor, arch + 0.015, 180, 0, 16), ...arcPts(wz, floor, arch + 0.06, 0, 180, 16)], side, MAT.bumper(), wz > 0 ? 'cabin' : 'cargo', 0.004, 0.022));
      const flap = mesh(new THREE.BoxGeometry(0.015, 0.15, 0.10), MAT.trim(), 'underbody');
      flap.position.set(side * (half - 0.09), floor + 0.075, wz - arch - 0.02); g.add(flap);
    }
    // ドアハンドル: 前ドアは横、スライドドアは縦グリップ(どちらもベルトラインの少し下)
    const h1 = mesh(new THREE.BoxGeometry(0.02, 0.035, 0.15), MAT.trim(), 'cabin'); h1.position.set(side * (half + 0.02), belt - 0.11, doorB + 0.22); g.add(h1);
    const h2 = mesh(new THREE.BoxGeometry(0.03, 0.14, 0.045), MAT.trim(), partSide); h2.position.set(side * (half + 0.025), belt - 0.12, doorB - 0.09); g.add(h2);
    // 給油口(左のみ)
    if (side > 0) g.add(sidePanel([[-1.36, 0.95], [-1.22, 0.95], [-1.22, 1.08], [-1.36, 1.08]], side, MAT.paintDim(), 'cargo', 0.008));
    // ドアミラー(前ドアの前上に取り付け、ウインカー付き)
    const mirrorPart = side < 0 ? 'mirror_l' : 'mirror_r';
    const mz = doorFront - 0.12;
    const arm = mesh(new THREE.BoxGeometry(0.11, 0.03, 0.06), MAT.trim(), mirrorPart);
    arm.position.set(side * (half + 0.055), belt + 0.06, mz); g.add(arm);
    const mir = mesh(new THREE.BoxGeometry(0.085, 0.20, 0.19), MAT.paint(), mirrorPart);
    mir.position.set(side * (half + 0.135), belt + 0.08, mz - 0.02); g.add(mir);
    const mg = mesh(new THREE.BoxGeometry(0.012, 0.17, 0.16), MAT.glass(), mirrorPart);
    mg.position.set(side * (half + 0.135), belt + 0.08, mz - 0.07); mg.material.opacity = 0.95; g.add(mg);
    const mt = mesh(new THREE.BoxGeometry(0.06, 0.02, 0.012), MAT.amber(), 'lights');
    mt.position.set(side * (half + 0.15), belt + 0.04, mz + 0.08); g.add(mt);
    // ヘッドライトの回り込み(側面側、ライト面の傾きに沿う)
    g.add(sidePanel([[front - 0.22, bumperTop + 0.03], [front - bevel - 0.004, bumperTop + 0.03], [hoodFront[0] - 0.02, hoodFront[1] - 0.03], [front - 0.30, hoodFront[1] - 0.03]], side, MAT.lamp(), 'lights', 0.004));
  }

  // ---- フロントガラス(付け根 (1.20,1.16) → 上端 (0.85,1.72)。上がやや狭い台形、ゴム枠付き) ----
  const wsLen = Math.hypot(wsTop[0] - wsBase[0], wsTop[1] - wsBase[1]);
  const wsShape = new THREE.Shape();
  wsShape.moveTo(-0.70, -wsLen / 2); wsShape.lineTo(0.70, -wsLen / 2); wsShape.lineTo(0.64, wsLen / 2 - 0.04);
  wsShape.quadraticCurveTo(0.62, wsLen / 2, 0.56, wsLen / 2); wsShape.lineTo(-0.56, wsLen / 2); wsShape.quadraticCurveTo(-0.62, wsLen / 2, -0.64, wsLen / 2 - 0.04); wsShape.closePath();
  const wsAngle = -Math.atan2(wsBase[0] - wsTop[0], wsTop[1] - wsBase[1]);
  const wsNormal = new THREE.Vector3(0, Math.sin(-wsAngle), Math.cos(-wsAngle));
  const wsMid = new THREE.Vector3(0, (wsBase[1] + wsTop[1]) / 2, (wsBase[0] + wsTop[0]) / 2);
  const wsTrim = mesh(new THREE.ShapeGeometry(wsShape), MAT.trim(), 'windshield');
  wsTrim.scale.set(1.04, 1.05, 1); wsTrim.position.copy(wsMid).addScaledVector(wsNormal, bevel + 0.004); wsTrim.rotation.x = wsAngle; g.add(wsTrim);
  const ws = mesh(new THREE.ExtrudeGeometry(wsShape, { depth: 0.012, bevelEnabled: false }), MAT.glass(), 'windshield');
  ws.position.copy(wsMid).addScaledVector(wsNormal, bevel + 0.007); ws.rotation.x = wsAngle; g.add(ws);
  for (const [x, rz] of [[-0.40, 0.42], [0.14, 0.32]]) { // ワイパー(2 本)
    const wp = mesh(new THREE.BoxGeometry(0.46, 0.012, 0.018), MAT.trim(), 'windshield');
    const local = new THREE.Vector3(x + 0.12, -wsLen / 2 + 0.07, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), wsAngle);
    wp.position.copy(wsMid).addScaledVector(wsNormal, bevel + 0.03).add(local); wp.rotation.z = rz; wp.rotation.x = wsAngle; g.add(wp);
  }

  // ---- ボンネット面とヘッドライト面(どちらも傾いた面なので、面ごとに Group を傾けて貼る) ----
  const hoodLine = mesh(new THREE.BoxGeometry(1.24, 0.008, 0.008), MAT.trim(), 'hood');
  hoodLine.position.set(0, hoodFront[1] + bevel - 0.01, hoodFront[0] + 0.04); g.add(hoodLine);
  // ヘッドライト面: (1.62,1.03) → (1.6975, 0.74) の斜面
  const lf = new THREE.Group();
  const lfAngle = Math.atan2(front - hoodFront[0], hoodFront[1] - bumperTop); // 後傾の角度
  lf.position.set(0, (hoodFront[1] + bumperTop) / 2, (hoodFront[0] + front) / 2 + bevel * 0.5);
  lf.rotation.x = -lfAngle;
  g.add(lf);
  const lfH = Math.hypot(front - hoodFront[0], hoodFront[1] - bumperTop);
  lf.add(facePanel(1.30, lfH - 0.02, 0.02, MAT.paint(), 'hood', 0, 0, 0.004));
  for (const sgn of [-1, 1]) {
    const hlShape = new THREE.Shape(); hlShape.moveTo(0, -0.11); hlShape.lineTo(sgn * 0.34, -0.11); hlShape.lineTo(sgn * 0.34, 0.11); hlShape.lineTo(sgn * 0.06, 0.11); hlShape.quadraticCurveTo(0, 0.11, 0, 0.05); hlShape.closePath();
    const hl = mesh(new THREE.ExtrudeGeometry(hlShape, { depth: 0.02, bevelEnabled: false }), MAT.lamp(), 'lights');
    hl.position.set(sgn * 0.34, 0.02, 0.006); lf.add(hl);
    const ring = mesh(new THREE.TorusGeometry(0.055, 0.008, 8, 24), MAT.chrome(), 'lights'); ring.position.set(sgn * 0.56, 0.03, 0.028); lf.add(ring);
    const proj = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 20), MAT.trim(), 'lights'); proj.rotation.x = Math.PI / 2; proj.position.set(sgn * 0.56, 0.03, 0.024); lf.add(proj);
    lf.add(facePanel(0.12, 0.05, 0.015, MAT.amber(), 'lights', sgn * 0.43, -0.05, 0.028));
    lf.add(facePanel(0.20, 0.018, 0.005, MAT.lamp(), 'lights', sgn * 0.46, 0.085, 0.028));   // LED ポジションのバー
    lf.add(facePanel(0.36, 0.23, 0.02, MAT.trim(), 'lights', sgn * 0.52, 0.0, 0.003));       // ユニットの黒い枠
  }
  const emblem = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 24), MAT.chrome(), 'hood');
  emblem.rotation.x = Math.PI / 2; emblem.position.set(0, 0.03, 0.012); lf.add(emblem);
  lf.add(facePanel(0.60, 0.06, 0.015, MAT.trim(), 'hood', 0, -0.09, 0.008)); // ライト間の上段グリル
  for (const dy of [-0.108, -0.09, -0.072]) lf.add(facePanel(0.56, 0.005, 0.002, MAT.grey(), 'hood', 0, dy, 0.010));

  // ---- 前バンパー(縦の面 z=front): 中央の大きな開口と横バー、フォグ、下中央にナンバー ----
  const fz = front + 0.002;
  const bH = bumperTop - 0.02 - (floor - 0.02), bY = (bumperTop - 0.02 + floor - 0.02) / 2;
  g.add(facePanel(W - 0.02, bH, 0.07, MAT.bumper(), 'front_bumper', 0, bY, fz + 0.004, 1, 0.035));
  g.add(facePanel(0.78, 0.20, 0.03, MAT.trim(), 'front_bumper', 0, 0.53, fz + 0.041));
  for (const y of [0.47, 0.51, 0.55, 0.59]) g.add(facePanel(0.74, 0.014, 0.004, MAT.bumper(), 'front_bumper', 0, y, fz + 0.043));
  for (const x of [-0.30, -0.15, 0, 0.15, 0.30]) g.add(facePanel(0.012, 0.18, 0.003, MAT.grey(), 'front_bumper', x, 0.53, fz + 0.044));
  g.add(facePanel(0.64, 0.045, 0.015, MAT.trim(), 'front_bumper', 0, bumperTop - 0.05, fz + 0.041)); // 上のグリル
  g.add(facePanel(0.33, 0.165, 0.01, MAT.plate(), 'front_bumper', 0, 0.345, fz + 0.046));
  for (const sgn of [-1, 1]) {
    const house = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20), MAT.trim(), 'front_bumper');
    house.rotation.x = Math.PI / 2; house.position.set(sgn * 0.56, 0.48, fz + 0.045); g.add(house);
    const fog = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), MAT.lamp(), 'front_bumper');
    fog.rotation.x = Math.PI / 2; fog.position.set(sgn * 0.56, 0.48, fz + 0.055); g.add(fog);
  }

  // ---- 後面(背面図: バックドアに大きな窓、最上部にハイマウント、ナンバーの凹み、バンパー両端に横長のランプ) ----
  const rz = rear - 0.002;
  g.add(facePanel(1.28, 1.32, 0.05, MAT.paint(), 'rear', 0, 1.08, rz - 0.002, -1));              // バックドア
  g.add(facePanel(1.26, 0.52, 0.09, MAT.trim(), 'rear', 0, 1.435, rz - 0.006, -1));              // リアガラスの枠
  g.add(facePanel(1.20, 0.46, 0.08, MAT.glass(), 'rear', 0, 1.435, rz - 0.009, -1));
  g.add(facePanel(0.28, 0.035, 0.012, MAT.tail(), 'lights', 0, 1.74, rz - 0.010, -1, 0.012));     // ハイマウントストップランプ
  const rwiper = mesh(new THREE.BoxGeometry(0.012, 0.34, 0.02), MAT.trim(), 'rear'); rwiper.position.set(0.14, 1.34, rz - 0.018); rwiper.rotation.z = -0.55; g.add(rwiper);
  const remblem = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 24), MAT.chrome(), 'rear'); remblem.rotation.x = Math.PI / 2; remblem.position.set(0, 1.06, rz - 0.012); g.add(remblem);
  const rhandle = mesh(new THREE.BoxGeometry(0.18, 0.03, 0.02), MAT.trim(), 'rear'); rhandle.position.set(0, 0.95, rz - 0.014); g.add(rhandle);
  g.add(facePanel(0.50, 0.26, 0.03, MAT.paintDim(), 'rear', 0, 0.745, rz - 0.006, -1));          // ナンバーの凹み
  g.add(facePanel(0.33, 0.165, 0.01, MAT.plate(), 'rear', 0, 0.745, rz - 0.014, -1));
  g.add(facePanel(W - 0.02, 0.22, 0.05, MAT.bumper(), 'rear', 0, 0.435, rz - 0.004, -1, 0.035));  // 後バンパー
  for (const sgn of [-1, 1]) {                                                                   // バンパー両端の横長ランプ
    g.add(facePanel(0.28, 0.13, 0.02, MAT.trim(), 'lights', sgn * 0.56, 0.435, rz - 0.040, -1, 0.006));   // ユニットの枠
    g.add(facePanel(0.10, 0.10, 0.01, MAT.tail(), 'lights', sgn * 0.64, 0.435, rz - 0.050, -1));          // ブレーキ
    g.add(facePanel(0.07, 0.10, 0.01, MAT.amber(), 'lights', sgn * 0.55, 0.435, rz - 0.050, -1));         // ウインカー
    g.add(facePanel(0.07, 0.10, 0.01, MAT.lamp(), 'lights', sgn * 0.475, 0.435, rz - 0.050, -1));         // バックランプ
    g.add(facePanel(0.015, 0.50, 0.005, MAT.trim(), 'rear', sgn * 0.645, 0.95, rz - 0.006, -1)); // バックドアの縁
  }

  // ---- 屋根 ----
  const roofY = 1.895;
  for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) {        // ルーフの縦リブ
    const rib = mesh(new THREE.BoxGeometry(0.03, 0.006, 1.9), MAT.paintDim(), 'cargo');
    rib.position.set(x, roofY + 0.003, -0.55); g.add(rib);
  }
  for (const sgn of [-1, 1]) {                           // ドリップレール
    const rail = mesh(new THREE.BoxGeometry(0.014, 0.014, 2.3), MAT.trim(), 'cargo');
    rail.position.set(sgn * (half - 0.05), roofY - 0.004, -0.55); g.add(rail);
  }
  const antBase = mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.03, 10), MAT.trim(), 'cabin'); antBase.position.set(-0.30, roofY + 0.015, 0.15); g.add(antBase);
  const antenna = mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.34, 8), MAT.trim(), 'cabin');
  antenna.position.set(-0.30, roofY + 0.14, 0.04); antenna.rotation.x = 0.7; g.add(antenna);

  // ---- タイヤ ----
  const wx = DIM.tread / 2;
  g.add(wheel('wheel_fl', -wx, wheelF), wheel('wheel_fr', wx, wheelF));
  g.add(wheel('wheel_rl', -wx, wheelR), wheel('wheel_rr', wx, wheelR));

  // 元の色を控える(ハイライト解除用)
  g.traverse((o) => { if (o.isMesh) o.userData.base = o.material.color.getHex(); });
  return g;
}

// ---- 環境の映り込み(スタジオ風のライトボックスを PMREM にする) ----
let envMap = null;
function getEnvironment(r) {
  if (envMap) return envMap;
  const pmrem = new THREE.PMREMGenerator(r);
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.36, 0.40, 0.46), side: THREE.BackSide })));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.14, 0.15, 0.17) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; sc.add(floor);
  const soft = (w, h, x, y, z, b) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(b, b, b), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 1, 0); sc.add(m); };
  soft(10, 4, 0, 9, 0, 1.6);     // 真上の大きなライト
  soft(6, 5, -9, 4, 5, 1.2);     // 左前
  soft(6, 5, 9, 4, -3, 0.9);     // 右後ろ
  soft(5, 3, 2, 3, -10, 0.7);    // 後ろ
  envMap = pmrem.fromScene(sc, 0.05).texture;
  pmrem.dispose();
  return envMap;
}

/** 重なった頂点をまとめて法線を平均し、押し出しの角を滑らかに見せる。 */
function smoothGeometry(geo, tol = 1e-4) {
  const pos = geo.attributes.position;
  const map = new Map(), index = [], verts = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x / tol)}_${Math.round(y / tol)}_${Math.round(z / tol)}`;
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(x, y, z); }
    index.push(id);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ---- 部位の範囲(車両座標 m)。GLB モデルのハイライトと、車体に描けない部位(電装など)の表示に使う ----
const REGIONS = {
  front_bumper: [[-0.74, 0.22, 1.44, 0.74, 0.76, 1.76]],
  hood: [[-0.72, 0.76, 1.16, 0.72, 1.22, 1.72]],
  windshield: [[-0.70, 1.12, 0.78, 0.70, 1.78, 1.26]],
  cabin: [[-0.78, 0.40, 0.08, 0.78, 1.92, 1.06]],
  cargo: [[-0.78, 0.40, -1.66, 0.78, 1.92, -0.86]],
  side_l: [[-0.82, 0.40, -0.86, -0.68, 1.78, 0.08]],
  side_r: [[0.68, 0.40, -0.86, 0.82, 1.78, 0.08]],
  rear: [[-0.74, 0.22, -1.80, 0.74, 1.84, -1.62]],
  mirror_l: [[-0.92, 1.08, 0.78, -0.72, 1.42, 1.02]],
  mirror_r: [[0.72, 1.08, 0.78, 0.92, 1.42, 1.02]],
  wheel_fl: [[-0.80, 0.0, DIM.wheelF - 0.30, -0.50, 0.58, DIM.wheelF + 0.30]],
  wheel_fr: [[0.50, 0.0, DIM.wheelF - 0.30, 0.80, 0.58, DIM.wheelF + 0.30]],
  wheel_rl: [[-0.80, 0.0, DIM.wheelR - 0.30, -0.50, 0.58, DIM.wheelR + 0.30]],
  wheel_rr: [[0.50, 0.0, DIM.wheelR - 0.30, 0.80, 0.58, DIM.wheelR + 0.30]],
  lights: [[-0.74, 0.76, 1.50, -0.30, 1.06, 1.76], [0.30, 0.76, 1.50, 0.74, 1.06, 1.76], [-0.72, 0.34, -1.80, -0.40, 0.54, -1.62], [0.40, 0.34, -1.80, 0.72, 0.54, -1.62]],
  battery: [[-0.60, 0.30, -0.35, 0.10, 0.70, 0.35]],
  underbody: [[-0.62, 0.08, -1.40, 0.62, 0.30, 1.10]],
  other: [[-0.40, 0.90, -0.50, 0.40, 1.30, 0.30]],
};
const XRAY_PARTS = new Set(['battery', 'underbody', 'other']);   // 車体の中なので透けて見せる

/** 範囲ボックスのハイライト(半透明の赤 / 選択は青い縁取り)。 */
function regionHighlights(part, kind, severity) {
  const out = [];
  for (const [x0, y0, z0, x1, y1, z1] of REGIONS[part] || []) {
    const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    const center = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    if (kind === 'issue') {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLORS.issue, transparent: true, opacity: 0.35, depthTest: !XRAY_PARTS.has(part), depthWrite: false }));
      m.position.set(...center); m.userData.severity = severity; m.userData.highlight = true; m.renderOrder = 10;
      out.push(m);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: kind === 'issue' ? COLORS.issue : COLORS.selected, depthTest: !XRAY_PARTS.has(part) }));
    edges.position.set(...center); edges.renderOrder = 11;
    out.push(edges);
  }
  return out;
}

// ---- 実車の GLB モデル(models/van.glb)があればそれを使う ----
const GLB_URL = 'models/van.glb', GLB_CFG = 'models/van.json';
let glbCache = null; // null=未確認 / false=なし / { scene, cfg }
async function loadGLB() {
  if (glbCache !== null) return glbCache;
  try {
    if (!THREE.GLTFLoader) throw new Error('no loader');
    const head = await fetch(GLB_URL, { method: 'HEAD' });
    if (!head.ok) throw new Error('no glb');
    let cfg = {};
    try { const c = await fetch(GLB_CFG); if (c.ok) cfg = await c.json(); } catch { /* 設定なしでもよい */ }
    const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(GLB_URL, res, undefined, rej));
    glbCache = { scene: gltf.scene, cfg };
  } catch {
    glbCache = false;
  }
  return glbCache;
}

/** GLB を車両座標(前 +z、全長 3.395m、床 y=0)に合わせる。van.json で { rotationY: 度, front: "+z"|"-z", scale: 倍率 } を指定できる。 */
function buildFromGLB({ scene, cfg }) {
  const g = new THREE.Group();
  const model = scene.clone(true);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.part = null; if (o.material) { o.material = o.material.clone(); o.material.side = THREE.DoubleSide; } } });
  const inner = new THREE.Group();
  inner.add(model);
  if (cfg.rotationY != null) inner.rotation.y = (cfg.rotationY * Math.PI) / 180;
  else {
    const b0 = new THREE.Box3().setFromObject(model); const s0 = b0.getSize(new THREE.Vector3());
    if (s0.x > s0.z) inner.rotation.y = Math.PI / 2;   // 長手方向を z に
  }
  if (cfg.front === '-z') inner.rotation.y += Math.PI;
  g.add(inner);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const k = (cfg.scale || 1) * (DIM.L / Math.max(size.z, 1e-6));
  g.scale.setScalar(k);
  const box2 = new THREE.Box3().setFromObject(g);
  const c = box2.getCenter(new THREE.Vector3());
  g.position.set(-c.x, -box2.min.y, -c.z);
  const holder = new THREE.Group();
  holder.add(g);
  holder.userData.isGLB = true;
  return holder;
}

/** 車体本体(part=null)に当たったとき、位置から部位を決める。 */
function partFromPoint(p) {
  const { front, rear, W, wsBase, doorB, doorC, bumperTop } = DIM;
  if (p.y > 1.80) return p.z > doorB ? 'cabin' : 'cargo';
  if (p.z > wsBase[0]) return p.y > bumperTop + 0.02 ? 'hood' : 'front_bumper';   // ボンネット・ライト面 / バンパー
  if (p.z > wsBase[0] - 0.4 && p.y > wsBase[1] - 0.05) return 'windshield';
  if (p.z < rear + 0.1) return 'rear';
  if (Math.abs(p.x) > W / 2 - 0.1) {
    if (p.z > doorB) return 'cabin';
    if (p.z > doorC) return p.x < 0 ? 'side_l' : 'side_r';
    return 'cargo';
  }
  return p.y < 0.45 ? 'underbody' : p.z > doorB ? 'cabin' : 'cargo';
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
  scene.environment = getEnvironment(r);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const target = new THREE.Vector3(0, 0.95, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa5b1, 0.35));
  const fill = new THREE.DirectionalLight(0xdce8ff, 0.2); fill.position.set(-4, 3, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.2); rim.position.set(0, 5, -6); scene.add(rim);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
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

  // 車体は GLB があればそれ、なければ手作りモデル。GLB の読み込みは非同期なので、できてから差し込む
  let van = null;
  let meshes = [];
  const issueMeshes = [];
  const highlights = [];
  let alive = true;
  function setupVan(built) {
    if (!alive) return;
    van = built;
    scene.add(van);
    van.traverse((o) => { if (o.isMesh && !o.userData.highlight) meshes.push(o); });
    const isGLB = Boolean(van.userData.isGLB);
    const partIds = new Set(meshes.map((m) => m.userData.part).filter(Boolean));
    // 異常のある部位は赤、選択中は青い縁取り(メッシュがある部位は色を変え、ない部位は範囲ボックスで示す)
    for (const m of meshes) {
      const st = status[m.userData.part];
      if (st) {
        m.material = m.material.clone();
        m.material.color.setHex(COLORS.issue);
        if ('emissive' in m.material) { m.material.emissive = new THREE.Color(COLORS.issueEmissive); m.material.emissiveIntensity = 0.35; }
        m.userData.severity = st.severity;
        issueMeshes.push(m);
      }
      if (selected && m.userData.part === selected) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), new THREE.LineBasicMaterial({ color: COLORS.selected }));
        edges.position.copy(m.position); edges.rotation.copy(m.rotation); edges.scale.copy(m.scale).multiplyScalar(1.01);
        m.parent.add(edges); highlights.push(edges);
        if (!st && 'emissive' in m.material) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(COLORS.selected); m.material.emissiveIntensity = 0.22; }
      }
    }
    for (const [part, st] of Object.entries(status)) {
      if (isGLB || !partIds.has(part)) for (const h of regionHighlights(part, 'issue', st.severity)) { van.add(h); highlights.push(h); }
    }
    if (selected && (isGLB || !partIds.has(selected))) for (const h of regionHighlights(selected, 'select')) { van.add(h); highlights.push(h); }
  }
  loadGLB().then((glb) => setupVan(glb ? buildFromGLB(glb) : buildVan()));

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
    if (!van) return null;
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
  let raf = 0;
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
      if ('emissiveIntensity' in m.material) m.material.emissiveIntensity = 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(t * speed));
    }
    for (const h of highlights) {
      if (h.userData.highlight) h.material.opacity = 0.22 + 0.22 * (0.5 + 0.5 * Math.sin(t * (h.userData.severity === 'high' ? 4 : 2.2)));
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
