// 軽バンの 3D モデル(Three.js)。ドラッグ/スワイプで回転、ピンチ/ホイールで拡大、タップで部位を選ぶ。
// Three.js は index.html で読み込む(window.THREE)。読めていなければ mount は null を返し、呼び出し側は 2D 図に切り替える。

const COLORS = {
  body: 0xf2f4f6, roof: 0xe6eaee, glass: 0x8fb5d8, wheel: 0x1b1f24, bumper: 0x2e3338,
  lamp: 0xffe9a8, tail: 0xe0574a, ground: 0xdde3ea,
  issue: 0xe0352b, issueEmissive: 0x7a0a05, selected: 0x1f4e79,
};

// カメラの向きはページを再描画しても保つ
const view = { yaw: -0.7, pitch: 0.95, radius: 0 }; // radius 0 = 最初の表示時に画面に合わせて決める
let renderer = null;

function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.cursor = 'grab';
  return renderer;
}

function box(w, h, d, color, opts = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.55, metalness: opts.metalness ?? 0.05, transparent: !!opts.opacity, opacity: opts.opacity ?? 1 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function cylinder(r, len, color) {
  const geo = new THREE.CylinderGeometry(r, r, len, 28);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.z = Math.PI / 2;
  m.castShadow = true;
  return m;
}

/** 軽バンを組み立てる。各メッシュの userData.part に部位 ID を入れる。 */
function buildVan() {
  const g = new THREE.Group();
  const add = (mesh, part, x, y, z) => { mesh.position.set(x, y, z); mesh.userData.part = part; mesh.userData.base = mesh.material.color.getHex(); g.add(mesh); return mesh; };
  const W = 1.48, Y0 = 0.36, TOP = 1.9;
  // 前が +z
  add(box(W, TOP - Y0, 1.0, COLORS.body), 'cabin', 0, (TOP + Y0) / 2, 0.98);           // 運転席まわり z 0.48..1.48
  add(box(W, TOP - Y0, 2.12, COLORS.body), 'cargo', 0, (TOP + Y0) / 2, -0.58);         // 荷室 z -1.64..0.48
  add(box(W + 0.02, 0.06, 3.1, COLORS.roof), 'cargo', 0, TOP + 0.02, -0.1);            // 屋根
  add(box(W, 0.6, 0.26, COLORS.body), 'hood', 0, Y0 + 0.3, 1.6);                       // 短いノーズ
  const ws = add(box(1.32, 1.0, 0.05, COLORS.glass, { opacity: 0.85, roughness: 0.15 }), 'windshield', 0, 1.42, 1.6);
  ws.rotation.x = -0.28;
  add(box(0.05, 0.5, 0.62, 0x6f8fab, { opacity: 0.9, roughness: 0.2 }), 'cabin', -W / 2 - 0.005, 1.45, 0.98); // 側面窓
  add(box(0.05, 0.5, 0.62, 0x6f8fab, { opacity: 0.9, roughness: 0.2 }), 'cabin', W / 2 + 0.005, 1.45, 0.98);
  add(box(0.04, 1.3, 1.3, COLORS.body), 'side_l', -W / 2 - 0.01, 1.1, -0.2);          // スライドドア
  add(box(0.04, 1.3, 1.3, COLORS.body), 'side_r', W / 2 + 0.01, 1.1, -0.2);
  add(box(0.02, 0.45, 0.7, 0x6f8fab, { opacity: 0.9, roughness: 0.2 }), 'side_l', -W / 2 - 0.035, 1.45, -0.25); // ドア窓
  add(box(0.02, 0.45, 0.7, 0x6f8fab, { opacity: 0.9, roughness: 0.2 }), 'side_r', W / 2 + 0.035, 1.45, -0.25);
  add(box(W - 0.04, TOP - Y0 - 0.1, 0.06, COLORS.body), 'rear', 0, (TOP + Y0) / 2, -1.67); // バックドア
  add(box(1.1, 0.5, 0.02, 0x6f8fab, { opacity: 0.9, roughness: 0.2 }), 'rear', 0, 1.45, -1.705); // リアガラス
  add(box(W + 0.06, 0.26, 0.14, COLORS.bumper), 'front_bumper', 0, 0.42, 1.78);
  add(box(W + 0.06, 0.26, 0.14, COLORS.bumper), 'rear', 0, 0.42, -1.74);
  add(box(0.3, 0.12, 0.06, COLORS.lamp, { roughness: 0.2 }), 'lights', -0.5, 0.78, 1.75); // ヘッドライト
  add(box(0.3, 0.12, 0.06, COLORS.lamp, { roughness: 0.2 }), 'lights', 0.5, 0.78, 1.75);
  add(box(0.14, 0.5, 0.04, COLORS.tail, { roughness: 0.3 }), 'lights', -0.62, 1.0, -1.72); // テールランプ
  add(box(0.14, 0.5, 0.04, COLORS.tail, { roughness: 0.3 }), 'lights', 0.62, 1.0, -1.72);
  add(box(0.08, 0.14, 0.2, COLORS.body), 'mirror_l', -W / 2 - 0.1, 1.3, 1.25);
  add(box(0.08, 0.14, 0.2, COLORS.body), 'mirror_r', W / 2 + 0.1, 1.3, 1.25);
  const wheel = (part, x, z) => { const w = cylinder(0.27, 0.16, COLORS.wheel); add(w, part, x, 0.27, z); const cap = cylinder(0.12, 0.17, 0x9aa3ad); add(cap, part, x, 0.27, z); };
  wheel('wheel_fl', -0.68, 1.1); wheel('wheel_fr', 0.68, 1.1);
  wheel('wheel_rl', -0.68, -1.05); wheel('wheel_rr', 0.68, -1.05);
  add(box(W - 0.2, 0.1, 2.9, 0x3a3f47), 'underbody', 0, Y0 - 0.02, 0); // 下回り
  return g;
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
  const target = new THREE.Vector3(0, 0.85, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4; sun.shadow.camera.right = 4; sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.1, 3.2, 64), new THREE.MeshBasicMaterial({ color: COLORS.ground, transparent: true, opacity: 0.6 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
  scene.add(ring);

  const van = buildVan();
  scene.add(van);
  const parts = van.children.filter((m) => m.userData.part);

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
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), new THREE.LineBasicMaterial({ color: COLORS.selected }));
      edges.position.copy(m.position); edges.rotation.copy(m.rotation); edges.scale.multiplyScalar(1.02);
      van.add(edges); outlines.push(edges);
      if (!st) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(COLORS.selected); m.material.emissiveIntensity = 0.18; }
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
    const hit = raycaster.intersectObjects(parts, false)[0];
    return hit ? hit.object : null;
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
      if (m !== hovered) { hovered = m; el.style.cursor = m ? 'pointer' : 'grab'; el.title = m ? '' : ''; }
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
    return 2.3 / Math.sin(Math.min(vFov, hFov)) * 1.02;
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
    if (now - lastInteract > 4000) view.yaw += 0.0025; // 触っていないときはゆっくり回る
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
