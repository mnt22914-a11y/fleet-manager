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

// ---- 寸法(m)。スズキ エブリイ バン DA17V: 全長 3,395 / 全幅 1,475 / 全高 1,895(ハイルーフ) / ホイールベース 2,430 ----
const DIM = {
  W: 1.475, L: 3.395, H: 1.895,
  front: 1.70, rear: -1.695,          // z(前が +)
  wheelF: 1.13, wheelR: -1.30,        // 車軸位置 z
  wheelR_: 0.275, tireW: 0.15,         // 155/80R12 相当
  floor: 0.30, belt: 1.05, winTop: 1.72,
  bevel: 0.05,
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
  bumper: () => new THREE.MeshPhysicalMaterial({ color: COLORS.bumper, roughness: 0.5, metalness: 0.0, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: COLORS.glass, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.78, clearcoat: 1 }),
  dark: () => new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.85, metalness: 0.05 }),
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

/** 側面のシルエット(x=z, y=y)。ホイールアーチも輪郭に含める。 */
function sideProfile() {
  const { front, rear, floor, wheelF, wheelR } = DIM;
  const arch = 0.31;
  const s = new THREE.Shape();
  s.moveTo(front - 0.10, floor);            // 前バンパー下
  s.lineTo(front, floor + 0.08);
  s.lineTo(front, 0.96);                    // 立ったフロントパネル
  s.lineTo(front - 0.02, 1.00);
  s.lineTo(front - 0.36, 1.66);             // フロントガラス(約 25° 寝ている)
  s.quadraticCurveTo(front - 0.52, 1.895, front - 0.80, 1.895); // 屋根前端の丸み
  s.lineTo(rear + 0.30, 1.895);             // 屋根
  s.quadraticCurveTo(rear + 0.02, 1.895, rear, 1.66); // 屋根後端
  s.lineTo(rear, 0.56);                     // バックドア
  s.lineTo(rear + 0.02, floor + 0.06);      // 後バンパー
  s.lineTo(rear + 0.06, floor);
  s.lineTo(wheelR - arch, floor);
  s.absarc(wheelR, floor + 0.02, arch, Math.PI, 0, true); // 後ホイールアーチ
  s.lineTo(wheelF - arch, floor);
  s.absarc(wheelF, floor + 0.02, arch, Math.PI, 0, true); // 前ホイールアーチ
  s.lineTo(front - 0.10, floor);
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

/** 前後の面に貼るパネル(z 固定、x/y で指定)。 */
function facePanel(w, h, r, mat, part, x, y, z, facing = 1, depth = 0) {
  const shape = roundedRectShape(w, h, r);
  const geo = depth ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  const m = mesh(geo, mat, part);
  m.position.set(x, y, z);
  if (facing < 0) m.rotation.y = Math.PI;
  return m;
}

function wheel(part, x, z) {
  const g = new THREE.Group();
  const tire = mesh(new THREE.CylinderGeometry(DIM.wheelR_, DIM.wheelR_, DIM.tireW, 36), MAT.tire(), part);
  tire.rotation.z = Math.PI / 2;
  const rim = mesh(new THREE.CylinderGeometry(0.17, 0.17, DIM.tireW + 0.01, 24), MAT.rim(), part);
  rim.rotation.z = Math.PI / 2;
  const cap = mesh(new THREE.CylinderGeometry(0.06, 0.06, DIM.tireW + 0.03, 16), MAT.chrome(), part);
  cap.rotation.z = Math.PI / 2;
  // ホイールの穴(ホイールキャップの模様)
  for (let i = 0; i < 6; i++) {
    const hole = mesh(new THREE.CylinderGeometry(0.03, 0.03, DIM.tireW + 0.02, 10), MAT.dark(), part);
    hole.rotation.z = Math.PI / 2;
    const a = (i / 6) * Math.PI * 2;
    hole.position.set(0, Math.cos(a) * 0.11, Math.sin(a) * 0.11);
    g.add(hole);
  }
  g.add(tire, rim, cap);
  g.position.set(x, DIM.wheelR_ + 0.01, z);
  return g;
}

/** エブリイ バンを組み立てる。各メッシュの userData.part に部位 ID を入れる(車体本体は null → 位置から判定)。 */
function buildVan() {
  const g = new THREE.Group();
  const { W, front, rear, belt, winTop, bevel } = DIM;
  const half = W / 2;

  // 車体本体: 側面シルエットを幅方向に押し出し、角を丸める
  const body = mesh(new THREE.ExtrudeGeometry(sideProfile(), { depth: W - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 16 }), MAT.paint(), null);
  body.rotation.y = -Math.PI / 2;            // 押し出し方向(+z) → +x
  body.position.x = W / 2 - bevel;       // 押し出しは -x へ進むので、右端から始める
  g.add(body);

  // 下回り(ホイールアーチから向こうが見えないように)
  const under = mesh(new THREE.BoxGeometry(W - 0.2, 0.24, Math.abs(front - rear) - 0.3), MAT.dark(), 'underbody');
  under.position.set(0, DIM.floor + 0.06, (front + rear) / 2);
  g.add(under);
  const fuel = mesh(new THREE.BoxGeometry(0.6, 0.18, 0.5), MAT.dark(), 'underbody');
  fuel.position.set(0.1, 0.26, -0.5); g.add(fuel);
  const muffler = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12), MAT.chrome(), 'underbody');
  muffler.rotation.x = Math.PI / 2; muffler.position.set(0.45, 0.22, rear + 0.35); g.add(muffler);

  // ---- 側面(左右) ----
  for (const side of [-1, 1]) {
    const partSide = side < 0 ? 'side_l' : 'side_r';
    // 前ドア(パネル)と窓
    g.add(sidePanel([[0.52, 0.40], [0.760, 0.320], [0.773, 0.416], [0.810, 0.505], [0.868, 0.582], [0.945, 0.640], [1.034, 0.677], [1.130, 0.690], [1.226, 0.677], [1.315, 0.640], [1.392, 0.582], [1.40, 0.58], [1.40, 0.98], [1.30, 1.04], [1.02, winTop + 0.03], [0.52, winTop + 0.03]], side, MAT.paint(), 'cabin', 0.006));
    g.add(sidePanel([[0.56, belt], [1.27, belt], [1.02, winTop], [0.56, winTop]], side, MAT.glass(), 'cabin', 0.012));
    // スライドドアと窓
    g.add(sidePanel([[-0.82, 0.40], [0.50, 0.40], [0.50, winTop + 0.03], [-0.82, winTop + 0.03]], side, MAT.paint(), partSide, 0.008));
    g.add(sidePanel([[-0.78, belt], [0.46, belt], [0.46, winTop], [-0.78, winTop]], side, MAT.glass(), partSide, 0.014));
    // リアクォーター(荷室側面)と窓
    g.add(sidePanel([[-0.84, 0.40], [-0.930, 0.320], [-0.943, 0.416], [-0.980, 0.505], [-1.038, 0.582], [-1.115, 0.640], [-1.204, 0.677], [-1.300, 0.690], [-1.396, 0.677], [-1.485, 0.640], [-1.562, 0.582], [-1.620, 0.505], [-1.657, 0.416], [rear + 0.03, 0.40], [rear + 0.03, winTop + 0.03], [-0.84, winTop + 0.03]], side, MAT.paint(), 'cargo', 0.006));
    g.add(sidePanel([[rear + 0.10, belt], [-0.88, belt], [-0.88, winTop], [rear + 0.10, winTop]], side, MAT.glass(), 'cargo', 0.012));
    // ドアの継ぎ目(黒い細線)
    for (const z of [0.51, -0.83]) g.add(sidePanel([[z - 0.006, 0.40], [z + 0.006, 0.40], [z + 0.006, winTop + 0.03], [z - 0.006, winTop + 0.03]], side, MAT.dark(), partSide, 0.010));
    // スライドドアのレール(窓下の溝)
    g.add(sidePanel([[-0.82, belt - 0.08], [0.50, belt - 0.08], [0.50, belt - 0.06], [-0.82, belt - 0.06]], side, MAT.dark(), partSide, 0.010));
    // ドアハンドル
    for (const z of [0.66, 0.36]) {
      const h = mesh(new THREE.BoxGeometry(0.02, 0.03, 0.14), MAT.dark(), z > 0.5 ? 'cabin' : partSide);
      h.position.set(side * (half + 0.02), 0.98, z); g.add(h);
    }
    // ドアミラー(ステー付き)
    const mirrorPart = side < 0 ? 'mirror_l' : 'mirror_r';
    const arm = mesh(new THREE.BoxGeometry(0.10, 0.025, 0.05), MAT.dark(), mirrorPart);
    arm.position.set(side * (half + 0.05), 1.22, 1.22); g.add(arm);
    const mir = mesh(new THREE.BoxGeometry(0.075, 0.17, 0.21), MAT.paint(), mirrorPart);
    mir.position.set(side * (half + 0.12), 1.30, 1.20); g.add(mir);
    const mg = mesh(new THREE.BoxGeometry(0.01, 0.14, 0.18), MAT.glass(), mirrorPart);
    mg.position.set(side * (half + 0.12), 1.30, 1.16); mg.material.opacity = 0.95; g.add(mg);
    // 側面ウインカー
    const w = mesh(new THREE.BoxGeometry(0.01, 0.04, 0.08), MAT.amber(), 'lights');
    w.position.set(side * (half + 0.012), 0.92, 1.36); g.add(w);
  }

  // ---- 前面 ----
  const fz = front + bevel + 0.002;
  // フロントガラス(斜面に沿わせる)
  const ws = mesh(new THREE.ExtrudeGeometry(roundedRectShape(1.30, 0.74, 0.06), { depth: 0.012, bevelEnabled: false }), MAT.glass(), 'windshield');
  ws.position.set(0, 1.36, front - 0.19 + 0.055);
  ws.rotation.x = -Math.atan2(0.34, 0.66);
  g.add(ws);
  // ワイパー
  for (const x of [-0.25, 0.30]) {
    const wp = mesh(new THREE.BoxGeometry(0.42, 0.012, 0.02), MAT.dark(), 'windshield');
    wp.position.set(x, 1.03, front - 0.02 + bevel); wp.rotation.z = x < 0 ? 0.35 : 0.25; g.add(wp);
  }
  // フロントパネル(ボンネットにあたる短い面)
  g.add(facePanel(1.30, 0.18, 0.03, MAT.paint(), 'hood', 0, 0.90, fz + 0.002));
  const hoodLine = mesh(new THREE.BoxGeometry(1.2, 0.006, 0.006), MAT.dark(), 'hood'); hoodLine.position.set(0, 0.805, fz + 0.004); g.add(hoodLine);
  // ヘッドライト(左右、やや外側へ回り込む台形)
  for (const sgn of [-1, 1]) {
    const hl = facePanel(0.36, 0.17, 0.05, MAT.lamp(), 'lights', sgn * 0.50, 0.895, fz + 0.006, 1, 0.02);
    g.add(hl);
    const inner = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 20), MAT.chrome(), 'lights');
    inner.rotation.x = Math.PI / 2; inner.position.set(sgn * 0.58, 0.895, fz + 0.02); g.add(inner);
    const turn = facePanel(0.09, 0.06, 0.02, MAT.amber(), 'lights', sgn * 0.26, 0.86, fz + 0.03);
    g.add(turn);
  }
  // バンパー(前): 樹脂、グリル、ナンバー、フォグ
  g.add(facePanel(W - 0.02, 0.46, 0.06, MAT.bumper(), 'front_bumper', 0, 0.565, fz + 0.004, 1, 0.03));
  g.add(facePanel(0.86, 0.07, 0.02, MAT.dark(), 'front_bumper', 0, 0.735, fz + 0.036));
  g.add(facePanel(0.70, 0.10, 0.02, MAT.dark(), 'front_bumper', 0, 0.44, fz + 0.036));
  g.add(facePanel(0.33, 0.165, 0.01, MAT.plate(), 'front_bumper', 0, 0.60, fz + 0.04));
  for (const sgn of [-1, 1]) {
    const fog = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), MAT.lamp(), 'front_bumper');
    fog.rotation.x = Math.PI / 2; fog.position.set(sgn * 0.56, 0.42, fz + 0.04); g.add(fog);
  }
  // スズキのエンブレム
  const emblem = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 20), MAT.chrome(), 'hood');
  emblem.rotation.x = Math.PI / 2; emblem.position.set(0, 0.90, fz + 0.012); g.add(emblem);

  // ---- 後面 ----
  const rz = rear - bevel - 0.002;
  g.add(facePanel(1.22, 1.26, 0.04, MAT.paint(), 'rear', 0, 1.13, rz - 0.002, -1));              // バックドア
  g.add(facePanel(1.10, 0.62, 0.05, MAT.glass(), 'rear', 0, 1.40, rz - 0.008, -1));              // リアガラス
  const rwiper = mesh(new THREE.BoxGeometry(0.012, 0.36, 0.02), MAT.dark(), 'rear'); rwiper.position.set(0.1, 1.28, rz - 0.014); rwiper.rotation.z = -0.5; g.add(rwiper);
  const rhandle = mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), MAT.dark(), 'rear'); rhandle.position.set(0, 0.92, rz - 0.012); g.add(rhandle);
  g.add(facePanel(0.33, 0.165, 0.01, MAT.plate(), 'rear', 0, 0.66, rz - 0.012, -1));            // 後ナンバー
  g.add(facePanel(W - 0.02, 0.26, 0.05, MAT.bumper(), 'rear', 0, 0.44, rz - 0.004, -1, 0.03));  // 後バンパー
  for (const sgn of [-1, 1]) {                                                                   // 縦長テールランプ
    g.add(facePanel(0.15, 0.62, 0.03, MAT.tail(), 'lights', sgn * 0.64, 1.14, rz - 0.006, -1, 0.015));
    g.add(facePanel(0.11, 0.12, 0.02, MAT.lamp(), 'lights', sgn * 0.64, 1.00, rz - 0.024, -1));
    g.add(facePanel(0.11, 0.12, 0.02, MAT.amber(), 'lights', sgn * 0.64, 1.28, rz - 0.024, -1));
  }
  const hms = mesh(new THREE.BoxGeometry(0.30, 0.03, 0.02), MAT.tail(), 'lights'); hms.position.set(0, 1.78, rz - 0.01); g.add(hms); // ハイマウントストップランプ

  // ---- 屋根・その他 ----
  const antenna = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.28, 8), MAT.dark(), 'cabin');
  antenna.position.set(-0.55, 1.98, 0.75); antenna.rotation.x = -0.6; g.add(antenna);
  for (const sgn of [-1, 1]) { // ルーフ両端のドリップモール(前後方向)
    const rail = mesh(new THREE.BoxGeometry(0.012, 0.012, 2.3), MAT.dark(), 'cargo');
    rail.position.set(sgn * (half - 0.07), 1.895 + bevel - 0.004, -0.35); g.add(rail);
  }

  // ---- タイヤ ----
  const wx = half - DIM.tireW / 2 - 0.02;
  g.add(wheel('wheel_fl', -wx, DIM.wheelF), wheel('wheel_fr', wx, DIM.wheelF));
  g.add(wheel('wheel_rl', -wx, DIM.wheelR), wheel('wheel_rr', wx, DIM.wheelR));

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
