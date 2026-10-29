/* ==================================================================== *
 * 两页共用的渲染骨架
 *
 * 外观图和器件图是两个独立页面，但相机、灯光、影棚、四视图、标注投影
 * 这些是同一套东西。抽出来一次，改一处两边都好 —— 上次把器件图塞进
 * 外观页当一个按钮，结果谁也没做透。
 * ==================================================================== */

export function createStudio(THREE, opts) {
  const o = opts || {};
  const canvas = o.canvas;

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure == null ? 1.02 : o.exposure;
  renderer.shadowMap.enabled = !!o.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 剖切 / 半透明外壳都靠 per-material clipping，不开这个开关会被忽略
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();

  /* ---------- 影棚环境 ---------- */
  function studioEnv() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0.0, '#e9eef6');
    grd.addColorStop(0.28, '#9aa6b6');
    grd.addColorStop(0.55, '#4a515c');
    grd.addColorStop(1.0, '#191c21');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = 'rgba(255,252,246,0.95)';
    g.fillRect(8, 34, 26, 26);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    return env;
  }
  scene.environment = studioEnv();
  scene.environmentIntensity = o.envIntensity == null ? 0.85 : o.envIntensity;

  scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x2a2622, o.shadows ? 0.5 : 0.75));

  const key = new THREE.DirectionalLight(0xfff4e6, 2.5);
  key.position.set(-28, 52, 34);
  key.castShadow = !!o.shadows;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 12;
  key.shadow.camera.far = 160;
  key.shadow.camera.left = -34;
  key.shadow.camera.right = 34;
  key.shadow.camera.top = 44;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0012;
  key.shadow.radius = 3;
  key.shadow.normalBias = 0.03;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xcfe0ff, o.shadows ? 0.75 : 0.95);
  fill.position.set(42, 22, 26);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd9b0, o.shadows ? 1.25 : 1.45);
  rim.position.set(6, 26, -46);
  scene.add(rim);

  /* ---------- 地面 ---------- */
  let floor = null;
  if (o.floor !== false) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(256, 256, 30, 256, 256, 250);
    grd.addColorStop(0, '#383f49');
    grd.addColorStop(0.55, '#242930');
    grd.addColorStop(1, '#12151a');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    floor = new THREE.Mesh(
      new THREE.CircleGeometry(78, 96),
      new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, metalness: 0.0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = -0.02;
    scene.add(floor);
  }

  /* ---------- 轨道相机 ---------- */
  const camera = new THREE.PerspectiveCamera(o.fov || 32, 1, 0.4, 700);
  const target = new THREE.Vector3(...(o.target || [0, 12.4, 0]));
  const orbit = {
    t: 0.72, p: 1.29, d: o.dist || 66,
    wt: 0.72, wp: 1.29, wd: o.dist || 66,
    target: target.clone(),
    want: target.clone(),
  };

  function applyOrbit() {
    const sp = Math.sin(orbit.p), cp = Math.cos(orbit.p);
    camera.position.set(
      orbit.target.x + orbit.d * sp * Math.sin(orbit.t),
      orbit.target.y + orbit.d * cp,
      orbit.target.z + orbit.d * sp * Math.cos(orbit.t),
    );
    camera.lookAt(orbit.target);
  }

  let dragging = null, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragging === 'orbit') {
      orbit.wt -= dx * 0.0072;
      orbit.wp = Math.min(1.56, Math.max(0.14, orbit.wp - dy * 0.0062));
    } else {
      const k = orbit.d * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      orbit.want.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    }
  });
  const endDrag = () => { dragging = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.wd = Math.min(220, Math.max(16, orbit.wd * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });
  canvas.addEventListener('dblclick', () => goHome());

  const home = { t: orbit.t, p: orbit.p, d: orbit.d, target: target.clone() };
  function goHome() {
    orbit.wt = home.t; orbit.wp = home.p; orbit.wd = home.d;
    orbit.want.copy(home.target);
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  /* ---------- 渲染循环 ---------- */
  const clock = new THREE.Clock();
  const hooks = { before: [], after: [] };

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    orbit.t += (orbit.wt - orbit.t) * 0.14;
    orbit.p += (orbit.wp - orbit.p) * 0.14;
    orbit.d += (orbit.wd - orbit.d) * 0.14;
    orbit.target.lerp(orbit.want, 0.14);
    applyOrbit();
    hooks.before.forEach((f) => f(dt));
    if (o.render) o.render(renderer, scene, camera);
    else renderer.render(scene, camera);
    hooks.after.forEach((f) => f(dt));
    requestAnimationFrame(frame);
  }

  return {
    THREE, renderer, scene, camera, orbit, floor, hooks,
    resize, start: () => { resize(); applyOrbit(); frame(); },
    goHome,
    setHome: (t, p, d) => { home.t = t; home.p = p; home.d = d; orbit.wt = t; orbit.wp = p; orbit.wd = d; },
    view: (t, p, d, tgt) => {
      orbit.wt = t; orbit.wp = p; orbit.wd = d;
      if (tgt) orbit.want.set(tgt[0], tgt[1], tgt[2]);
    },
  };
}

/* ---------- 四视图：一台 renderer，四个 scissor 视口 ---------- */
export function createQuadViews(THREE, renderer, canvas, views, target) {
  const cams = views.map((v) => {
    const c = new THREE.PerspectiveCamera(v.fov || 14, 1, 0.4, 900);
    c.position.set(...v.pos);
    c.lookAt(new THREE.Vector3(...(target || [0, 12.4, 0])));
    c.userData.name = v.name;
    return c;
  });

  function draw(scene, w, h) {
    const halfW = Math.floor(w / 2), halfH = Math.floor(h / 2);
    renderer.setScissorTest(true);
    cams.forEach((cam, i) => {
      const x = (i % 2) * halfW;
      const y = (i < 2 ? 1 : 0) * halfH;
      cam.aspect = halfW / halfH;
      cam.updateProjectionMatrix();
      renderer.setViewport(x, y, halfW, halfH);
      renderer.setScissor(x, y, halfW, halfH);
      renderer.render(scene, cam);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }
  return { cams, draw };
}

/* ---------- 标注：把 3D 锚点投影成 DOM 标签 ----------
 * 用 DOM 而不是 sprite：文字在任意缩放下都清晰，还能选中、能换行。 */
export function createMarks(THREE, canvas, camera, container) {
  const items = [];

  function add(list, cls, onClick) {
    list.forEach((h) => {
      const el = document.createElement('div');
      el.className = 'mark' + (cls ? ' ' + cls : '');
      el.innerHTML = `<div class="dot"></div><div class="stem"></div>
        <div class="tag">${h.label}<i>${h.note || ''}</i></div>`;
      el.style.display = 'none';
      if (onClick) el.onclick = () => onClick(h);
      container.appendChild(el);
      items.push({ el, anchor: h.anchor, set: cls || 'main', data: h });
    });
  }

  const v = new THREE.Vector3();
  function update(setName, root, enabled) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    items.forEach((it) => {
      if (!enabled || (setName && it.set !== setName)) { it.el.style.display = 'none'; return; }
      v.copy(it.anchor);
      if (root) root.localToWorld(v);
      v.project(camera);
      if (v.z > 1) { it.el.style.display = 'none'; return; }
      it.el.style.display = 'block';
      it.el.style.left = (v.x * 0.5 + 0.5) * w + 'px';
      it.el.style.top = (-v.y * 0.5 + 0.5) * h + 'px';
    });
  }

  function hideAll() { items.forEach((it) => { it.el.style.display = 'none'; }); }

  return { add, update, hideAll, items };
}
