/* ==================================================================== *
 * Microduck 外观评审台
 *
 * 这里做三件事：
 *   1. 把 model.js 的参数化几何体放进一个真实的 three.js 场景里
 *      （环境光、阴影、PBR 材质），而不是光栅预览图。
 *   2. 自己写一套轨道相机 —— 不引 addon，避免多一个要加载的文件。
 *   3. 四视图用同一台 renderer 的 scissor viewport 一次画四个机位，
 *      这是"多视角可见"最直接的做法。
 * ==================================================================== */

import * as THREE from 'three';
import { buildMicroduck, COLORWAYS, POSES, applyPose, waddleFrame } from './model.js';
import { renderWiring, busLegend } from './wiring.js';

const canvas = document.getElementById('gl');

/* 出错就把话说在屏幕上，别留一块黑屏让人猜 */
window.addEventListener('error', (e) => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.remove('hide');
  boot.innerHTML = '<div class="fail">渲染出错：<br><code>' +
    String(e.message || e).replace(/</g, '&lt;') + '</code></div>';
});

/* ---------- 渲染器 ---------- */
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 剖切要用到 per-material clipping，不开这个开关 clippingPlanes 会被忽略
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();

/* ---------- 环境光照：一张程序生成的影棚渐变，喂给 PMREM ----------
 * 哑光塑料没有环境反射就会显得像纸片，而加载 HDR 文件又要多一个资源。
 * 64×256 的竖直渐变已经足够给出"上亮下暗"的柔光箱效果。 */
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
  // 一块更亮的"灯", 让塑料上有一条明确的高光带
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
scene.environmentIntensity = 0.85;

const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x2a2622, 0.5);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff4e6, 2.5);
key.position.set(-28, 52, 34);
key.castShadow = true;
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

const fill = new THREE.DirectionalLight(0xcfe0ff, 0.75);
fill.position.set(42, 22, 26);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffd9b0, 1.25);
rim.position.set(6, 26, -46);
scene.add(rim);

/* ---------- 地面 ---------- */
function groundTexture() {
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
  return t;
}
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(78, 96),
  new THREE.MeshStandardMaterial({
    map: groundTexture(), roughness: 0.95, metalness: 0.0,
  })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.position.y = -0.02;
scene.add(floor);

/* ---------- 模型 ---------- */
const duck = buildMicroduck(THREE, { colorway: 'cream' });
scene.add(duck.root);
const dof = duck.dof;

/* 轮滑时整机抬到板面上 */
const LIFT = 1.19;

/* ---------- 轨道相机 ---------- */
const camera = new THREE.PerspectiveCamera(32, 1, 0.4, 700);
const orbit = {
  // theta 绕 Y, phi 从 +Y 算起的极角
  t: 0.72, p: 1.29, d: 66,
  wt: 0.72, wp: 1.29, wd: 66,
  target: new THREE.Vector3(0, 12.6, 0),
  want: new THREE.Vector3(0, 12.6, 0),
};

function applyOrbit() {
  const sp = Math.sin(orbit.p), cp = Math.cos(orbit.p);
  camera.position.set(
    orbit.target.x + orbit.d * sp * Math.sin(orbit.t),
    orbit.target.y + orbit.d * cp,
    orbit.target.z + orbit.d * sp * Math.cos(orbit.t)
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
  orbit.wd = Math.min(150, Math.max(26, orbit.wd * Math.exp(e.deltaY * 0.0011)));
}, { passive: false });
canvas.addEventListener('dblclick', () => resetView());

function resetView() {
  orbit.wt = 0.72; orbit.wp = 1.29; orbit.wd = 66;
  orbit.want.set(0, 12.6, 0);
}

/* ---------- 多视角机位 ---------- */
const TARGET = new THREE.Vector3(0, 12.4, 0);
const viewCams = {
  front: { pos: [0, 13.2, 62], fov: 30 },
  side: { pos: [62, 13.2, 0], fov: 30 },
  top: { pos: [0.01, 64, 0.6], fov: 30 },
  hero: { pos: [-34, 27, 44], fov: 30 },
};
const quadCams = Object.keys(viewCams).map((k) => {
  const v = viewCams[k];
  const c = new THREE.PerspectiveCamera(v.fov, 1, 0.4, 700);
  c.position.set(v.pos[0], v.pos[1], v.pos[2]);
  c.lookAt(TARGET);
  c.userData.name = k;
  return c;
});

/* ---------- 状态 ---------- */
const state = {
  colorway: 'cream',
  pose: 'stand',
  multi: false,
  spin: false,
  marks: true,
  skate: false,
  wire: false,
  // solid 外观 / xray 透视 / cut 剖切 —— 后两种才看得到内部
  mode: 'solid',
  harness: true,       // 内部模式下是否画线束
  blink: 0,
  nextBlink: 2.6,
  timeline: null,
  tTimeline: 0,
  waddlePhase: 0,
};

const POSE_LABEL = {
  stand: '站立', crouch: '蹲下', waddle: '摇摆行走',
  grip: '嘴部抓取', kick: '踢球', recover: '跌倒爬起',
};

/* ---------- 面板 ---------- */
const swWrap = document.getElementById('swatches');
const cwName = document.getElementById('cwname');
Object.entries(COLORWAYS).forEach(([k, v]) => {
  const d = document.createElement('div');
  d.className = 'sw' + (k === state.colorway ? ' on' : '');
  d.style.background = `linear-gradient(145deg, ${v.shell} 58%, ${v.accent} 58%)`;
  d.title = v.name;
  d.onclick = () => {
    state.colorway = k;
    duck.setColorway(k);
    cwName.textContent = v.name;
    [...swWrap.children].forEach((c, i) => c.classList.toggle('on', Object.keys(COLORWAYS)[i] === k));
  };
  swWrap.appendChild(d);
});

const poseWrap = document.getElementById('poses');
Object.keys(POSE_LABEL).forEach((k) => {
  const b = document.createElement('button');
  b.textContent = POSE_LABEL[k];
  b.dataset.pose = k;
  if (k === state.pose) b.classList.add('on');
  b.onclick = () => selectPose(k);
  poseWrap.appendChild(b);
});

function selectPose(k) {
  state.pose = k;
  [...poseWrap.children].forEach((b) => b.classList.toggle('on', b.dataset.pose === k));
  state.waddlePhase = 0;
  if (k === 'recover') {
    state.timeline = {
      t: 0,
      segs: [
        { pose: POSES.lying, dur: 0.9 },
        { pose: POSES.crouch, dur: 0.75 },
        { pose: POSES.stand, dur: 1.1 },
      ],
    };
  } else {
    state.timeline = null;
  }
}

const viewWrap = document.getElementById('views');
[['三分之四', 0.72, 1.29, 66], ['正面', 0, 1.42, 62], ['侧面', Math.PI / 2, 1.42, 62],
 ['背面', Math.PI, 1.36, 64], ['俯视', 0.5, 0.18, 70], ['仰视', 0.55, 1.52, 58]]
  .forEach(([label, t, p, d]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { orbit.wt = t; orbit.wp = p; orbit.wd = d; };
    viewWrap.appendChild(b);
  });

const btnMulti = document.getElementById('btnMulti');
const btnSpin = document.getElementById('btnSpin');
const btnMarks = document.getElementById('btnMarks');
const btnSkate = document.getElementById('btnSkate');
const btnWire = document.getElementById('btnWire');
const btnTurn = document.getElementById('btnTurn');

function syncToggles() {
  btnMulti.classList.toggle('on', state.multi);
  btnSpin.classList.toggle('on', state.spin);
  btnMarks.classList.toggle('on', state.marks);
  btnSkate.classList.toggle('on', state.skate);
  btnWire.classList.toggle('on', state.wire);
  btnHarness.classList.toggle('on', state.harness);
  btnHarness.disabled = state.mode === 'solid';
  marksEl.style.display = state.marks && !state.multi ? 'block' : 'none';
  vpLabels.style.display = state.multi ? 'block' : 'none';
}
btnMulti.onclick = () => { state.multi = !state.multi; syncToggles(); resize(); };
btnSpin.onclick = () => { state.spin = !state.spin; syncToggles(); };
btnMarks.onclick = () => { state.marks = !state.marks; syncToggles(); };
btnSkate.onclick = () => {
  state.skate = !state.skate;
  dof.skateboard.visible = state.skate;
  duck.root.position.y = state.skate ? LIFT : 0;
  dof.skateboard.position.y = state.skate ? -LIFT : 0;
  syncToggles();
};
btnWire.onclick = () => {
  state.wire = !state.wire;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => { m.wireframe = state.wire; });
  });
  syncToggles();
};
btnTurn.onclick = () => { resetView(); state.spin = false; syncToggles(); };

/* ---------- 连接拓扑图 ----------
 * 3D 线束回答"线怎么走"，这张图回答"接到哪个口、走什么总线"。
 * 第一次打开时才渲染 —— 不打开就不花这笔 DOM。 */
const wiringPanel = document.getElementById('wiringPanel');
const wiringSvg = document.getElementById('wiringSvg');
const wiringLegend = document.getElementById('wiringLegend');
document.getElementById('btnWiring').onclick = () => {
  wiringPanel.classList.add('open');
  if (!wiringSvg.dataset.ready) {
    const st = renderWiring(wiringSvg);
    busLegend().forEach((b) => {
      const sp = document.createElement('span');
      sp.innerHTML = `<i style="background:${b.color}"></i>${b.name}`;
      wiringLegend.appendChild(sp);
    });
    wiringSvg.dataset.ready = '1';
    console.log('连接图：%d 个节点 / %d 条总线', st.nodes, st.edges);
  }
};
document.getElementById('wpClose').onclick = () => wiringPanel.classList.remove('open');
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') wiringPanel.classList.remove('open');
});

/* ---------- 外观 / 透视 / 剖切 ----------
 * 只做外观的话，这个评审台和一张 PNG 没区别 —— 装机能不能装下、
 * 线怎么走、器件之间有没有打架，全看不见。所以补两层：
 *   xray 透视：外壳降到 14% 不透明，内部件与线束照常遮挡，
 *   cut  剖切：把靠近观察者的一半外壳真的切掉（per-material clipping），
 *              内部件保持完整 —— 这才是工程上看的剖视图。
 * 剖切面每帧跟着相机转，所以从任何角度切开的都是"挡在眼前的"那半边。 */
const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
const SHELL_KEYS = ['shell', 'shell2', 'accent', 'tpu'];
const modeBtns = {
  solid: document.getElementById('btnSolid'),
  xray: document.getElementById('btnXray'),
  cut: document.getElementById('btnCut'),
};
const btnHarness = document.getElementById('btnHarness');
const legend = document.getElementById('legend');

function applyMode(m) {
  state.mode = m;
  const inner = m !== 'solid';

  dof.internals.visible = inner;
  dof.wires.visible = inner && state.harness;
  dof.pulses.forEach((p) => { p.mesh.visible = inner && state.harness; });
  legend.style.display = inner && state.harness ? 'block' : 'none';

  SHELL_KEYS.forEach((k) => {
    const mat = duck.materials[k];
    const xray = m === 'xray';
    mat.transparent = xray;
    mat.opacity = xray ? 0.14 : 1;
    mat.depthWrite = !xray;
    mat.clippingPlanes = m === 'cut' ? [clipPlane] : null;
    mat.clipShadows = m === 'cut';
    mat.needsUpdate = true;
  });

  // 透视时外壳不该再投射实心阴影，否则地上是一个完整的鸭子影
  duck.root.traverse((o) => {
    if (!o.isMesh) return;
    const isShell = SHELL_KEYS.some((k) => o.material === duck.materials[k]);
    if (isShell) o.castShadow = m !== 'xray';
  });

  Object.entries(modeBtns).forEach(([k, b]) => b.classList.toggle('on', k === m));
  if (m !== 'solid') state.marks = true;
  syncToggles();
}

function updateClip() {
  if (state.mode !== 'cut') return;
  // 法线背对相机 → dot(n, p) < 0 的那半（近侧）被裁掉
  const n = tmpV.copy(camera.position).sub(TARGET).setY(0);
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  n.normalize().negate();
  clipPlane.normal.copy(n);
  clipPlane.constant = -n.dot(TARGET);
}

modeBtns.solid.onclick = () => applyMode('solid');
modeBtns.xray.onclick = () => applyMode('xray');
modeBtns.cut.onclick = () => applyMode('cut');
btnHarness.onclick = () => { state.harness = !state.harness; applyMode(state.mode); };

/* ---------- 标注 ----------
 * 两套锚点：外观模式指外壳上的功能窗口，内部模式指腔体里真实的器件。
 * 同一时刻只显示一套，否则标签会叠在一起看不出重点。 */
const marksEl = document.getElementById('marks');

function buildMarks(list, extraClass) {
  return list.map((h) => {
    const el = document.createElement('div');
    el.className = 'mark' + (extraClass ? ' ' + extraClass : '');
    el.innerHTML = `<div class="dot"></div><div class="stem"></div>
      <div class="tag">${h.label}<i>${h.note}</i></div>`;
    el.style.display = 'none';
    marksEl.appendChild(el);
    return { el, anchor: h.anchor };
  });
}
const markSets = {
  solid: buildMarks(duck.hotspots, ''),
  inner: buildMarks(duck.internalHotspots, 'inner'),
};
function activeMarks() {
  return state.mode === 'solid' ? markSets.solid : markSets.inner;
}

/* ---------- 四视图标签 ---------- */
const vpLabels = document.getElementById('vpLabels');
['正视图', '侧视图', '俯视图', '三分之四'].forEach((name, i) => {
  const el = document.createElement('div');
  el.className = 'vp';
  el.textContent = name;
  el.style.left = (i % 2) * 50 + '%';
  el.style.top = Math.floor(i / 2) * 50 + '%';
  vpLabels.appendChild(el);

  const fr = document.createElement('div');
  fr.className = 'frame';
  fr.style.left = (i % 2) * 50 + '%';
  fr.style.top = Math.floor(i / 2) * 50 + '%';
  fr.style.width = '50%';
  fr.style.height = '50%';
  vpLabels.appendChild(fr);
});

/* ---------- 尺寸 ---------- */
function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  quadCams.forEach((c) => { c.aspect = w / h; c.updateProjectionMatrix(); });
}
window.addEventListener('resize', resize);

/* ---------- 循环 ---------- */
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();

function stepPose(dt) {
  if (state.pose === 'waddle') {
    state.waddlePhase += dt * 3.4;
    waddleFrame(dof, state.waddlePhase);
    return;
  }
  let target = POSES[state.pose] || POSES.stand;
  if (state.timeline) {
    const tl = state.timeline;
    tl.t += dt;
    let acc = 0, cur = null;
    for (const seg of tl.segs) {
      if (tl.t < acc + seg.dur) { cur = seg; break; }
      acc += seg.dur;
    }
    if (cur) {
      target = cur.pose;
    } else {
      // 爬起来之后回到站立，按钮也跟着回到"站立"
      state.timeline = null;
      state.pose = 'stand';
      [...poseWrap.children].forEach((b) => b.classList.toggle('on', b.dataset.pose === 'stand'));
    }
  }
  // 指数逼近：k 只跟帧时间有关，跟当前姿态无关，
  // 所以任意两个姿态之间切都是同一条缓动曲线。
  const k = 1 - Math.pow(0.0008, dt);
  applyPose(dof, target, k);
}

/* 自动贴地：每帧量一次最低点，往 0 轻推。
 * 姿态角是手写的，靠 calibration 只能对齐姿态静止点，过渡途中还会浮一点；
 * 与其把几十个角度调到刚好，不如让机器自己贴住地面 —— 人也只看结果。 */
const groundBox = new THREE.Box3();
function groundClamp() {
  if (state.pose === 'waddle') return;          // 步态有自己的起伏，别去抵消它
  duck.root.updateMatrixWorld(true);
  groundBox.makeEmpty();
  duck.root.traverse((o) => {
    if (!o.isMesh) return;
    let q = o;
    while (q) { if (q.visible === false) return; q = q.parent; }
    groundBox.expandByObject(o);
  });
  const m = groundBox.min.y;
  if (Math.abs(m) > 0.015) dof.bodyPivot.position.y -= m * 0.4;
}

function stepBlink(dt) {
  state.nextBlink -= dt;
  if (state.nextBlink <= 0) {
    state.blink = 1;
    state.nextBlink = 3.2 + Math.random() * 4;
  }
  if (state.blink > 0) {
    state.blink -= dt * 7;
    const v = Math.max(0, state.blink);
    const s = 1 - Math.sin(v * Math.PI) * 0.88;
    dof.eyes.forEach((e) => { e.scale.y = s; });
  } else {
    dof.eyes.forEach((e) => { e.scale.y = 1; });
  }
}

/* 线束上跑的脉冲：一个点沿曲线匀速走，读得出"信号从哪流向哪"。
 * 比静止的管子信息量大，也顺便证明这条线是连通的而不是画上去的。 */
function stepPulses(dt) {
  if (!dof.internals.visible || !state.harness) return;
  dof.pulses.forEach((p, i) => {
    p.t = (p.t + dt * (0.3 + i * 0.012)) % 1;
    p.curve.getPoint(p.t, p.mesh.position);
  });
}

function updateMarks() {
  const active = activeMarks();
  if (!state.marks || state.multi) {
    if (state.multi) active.forEach(({ el }) => { el.style.display = 'none'; });
    return;
  }
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const other = state.mode === 'solid' ? markSets.inner : markSets.solid;
  other.forEach(({ el }) => { el.style.display = 'none'; });
  active.forEach(({ el, anchor }) => {
    tmpV.copy(anchor);
    duck.root.localToWorld(tmpV);
    tmpV.project(camera);
    if (tmpV.z > 1) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = (tmpV.x * 0.5 + 0.5) * w + 'px';
    el.style.top = (-tmpV.y * 0.5 + 0.5) * h + 'px';
  });
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state.spin) orbit.wt += dt * 0.32;

  // 阻尼：0.86 的插值系数让"松手后还会滑一下"，比硬跟手更稳
  orbit.t += (orbit.wt - orbit.t) * 0.14;
  orbit.p += (orbit.wp - orbit.p) * 0.14;
  orbit.d += (orbit.wd - orbit.d) * 0.14;
  orbit.target.lerp(orbit.want, 0.14);
  applyOrbit();

  stepPose(dt);
  groundClamp();
  stepBlink(dt);
  updateClip();
  stepPulses(dt);

  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (state.multi) {
    renderer.setScissorTest(true);
    const halfW = Math.floor(w / 2), halfH = Math.floor(h / 2);
    quadCams.forEach((cam, i) => {
      const x = (i % 2) * halfW;
      const y = (i < 2 ? 1 : 0) * halfH;   // WebGL 原点在左下
      renderer.setViewport(x, y, halfW, halfH);
      renderer.setScissor(x, y, halfW, halfH);
      renderer.render(scene, cam);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  } else {
    renderer.render(scene, camera);
  }
  updateMarks();
}

resize();
syncToggles();
animate();

// 让外层的兜底脚本知道模块已经跑起来了
window.__MD_OK = true;
document.getElementById('boot').classList.add('hide');
