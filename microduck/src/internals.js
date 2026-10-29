/* ==================================================================== *
 * 器件图：装配关系 + 引脚 + 线束
 *
 * 这一页只做内部。外壳最多留 6% 的半影当空间参照，不当主角 ——
 * 外观图里那种"看着像鸭子"的成就感在这里没有用，这里要能数出
 * 主控板第几个脚、线接到舵机板的第几口。
 *
 * 三块信息互相咬合：
 *   3D    器件实体 + 插座 + 每根针（金属小柱）+ 落在这根针上的线
 *   放大镜 选中一个插座，右下角开一个近摄视口，pin 号与网名用 DOM 标在上面
 *   表    器件清单 / 网表，和 3D 双向联动
 * ==================================================================== */

import * as THREE from 'three';
import { buildMicroduck, POSES, applyPose } from './model.js';
import { buildPinout, buildHarness, netTable, bomRows, DEVICES } from './pinout.js';
import { bodyInnerR } from './fit.js';
import { createStudio, createQuadViews, createMarks } from './studio.js';

const canvas = document.getElementById('gl');
const $ = (id) => document.getElementById(id);

window.addEventListener('error', (e) => {
  const boot = $('boot');
  if (!boot) return;
  boot.classList.remove('hide');
  boot.innerHTML = '<div class="fail">渲染出错：<br><code>' +
    String(e.message || e).replace(/</g, '&lt;') + '</code></div>';
});

/* ---------- 场景 ---------- */
/* 主视图的绘制方式在初始化完了才知道（要不要四视图），
 * 先用一个间接层占位，避免每帧白画一遍单视图。 */
let drawFrame = null;
const studio = createStudio(THREE, {
  canvas, fov: 30, dist: 58, target: [0, 11.6, 0],
  shadows: false, floor: false,
  render: (R, s, c) => {
    if (drawFrame) drawFrame(R, s, c);
    else R.render(s, c);
  },
});
const { scene, camera } = studio;

/* 内部图不要地上的影子，换成一层淡网格：有水平面参照，
 * 又不会让人误以为这是成品渲染。 */
const grid = new THREE.GridHelper(80, 40, 0x2a3a46, 0x1b2229);
scene.add(grid);
grid.position.y = -0.01;

const duck = buildMicroduck(THREE, { colorway: 'cream' });
applyPose(duck.dof, POSES.stand, 1);
scene.add(duck.root);
duck.dof.internals.visible = true;
duck.dof.wires.visible = true;
duck.dof.pulses.forEach((p) => { p.mesh.visible = false; });
duck.dof.bodyPivot.rotation.set(0, 0, 0);
duck.root.updateMatrixWorld(true);

const pinout = buildPinout(THREE, duck);
const harness = buildHarness(THREE, duck, pinout, { innerR: bodyInnerR });
duck.root.updateMatrixWorld(true);

/* ---------- 外壳：只剩一层 6% 的影 ---------- */
const SHELL_MATS = [duck.materials.shell, duck.materials.shell2, duck.materials.accent, duck.materials.tpu];
const ghost = new THREE.MeshBasicMaterial({
  color: '#7fb6d8', transparent: true, opacity: 0.055,
  depthWrite: false, side: THREE.DoubleSide,
});
const shellMeshes = [];
duck.root.traverse((o) => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (mats.some((m) => SHELL_MATS.includes(m))) shellMeshes.push({ mesh: o, orig: o.material });
});
function setGhost(on) {
  shellMeshes.forEach(({ mesh, orig }) => { mesh.material = on ? ghost : orig; });
}

/* ---------- 器件登记（器件图的主角） ---------- */
const devMeshes = new Map();     // devId -> [mesh]
function register(devId, mesh) {
  const arr = devMeshes.get(devId) || [];
  arr.push({ mesh, orig: mesh.material });
  devMeshes.set(devId, arr);
}
DEVICES.forEach((d) => {
  const o = duck.root.getObjectByName(d.mesh);
  if (o) register(d.id, o);
});

/* 舵机：15 个独立器件，按 servoJoints 的名字找 */
const servoRows = [];
duck.dof.servoJoints.forEach((sj, i) => {
  const o = duck.root.getObjectByName(sj.servo);
  if (!o) return;
  const id = 'JS' + (i + 1);
  register(id, o);
  servoRows.push({ id, label: `${i + 1} ${sj.joint}${sj.id.slice(-1)}`, mesh: o, sj });
});

/* 器件清单：主件 + 15 个舵机 */
const devList = [];
DEVICES.forEach((d) => {
  const arr = devMeshes.get(d.id);
  if (!arr) return;
  devList.push({ id: d.id, label: d.label, cat: d.cat, spec: d.spec, meshes: arr.map((a) => a.mesh) });
});
servoRows.forEach((r) => {
  devList.push({
    id: r.id, label: '舵机 ' + r.label, cat: '关节', spec: r.sj.servo + ' · 3P',
    meshes: [r.mesh],
  });
});

/* ---------- 连接器与脚的选中状态 ---------- */
let selConn = null, selDev = null;
const connGroupById = new Map(pinout.connectors.map((c) => [c.id, c]));

/* 选中框：用一个线框盒子把选中的器件框出来 */
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0x4fd8ff);
selBox.visible = false;
selBox.material.transparent = true;
selBox.material.opacity = 0.8;
scene.add(selBox);

/* ---------- 放大镜：右下角一个近摄视口 ---------- */
/* 放大镜摆在左下、网表条上方：右侧是引脚表、左侧是控制面板，
 * 只有这块是空的。位置同时给 WebGL 视口和 DOM 边框用，免得两处对不上。 */
const INSET = { w: 300, h: 208, x: 246, bottom: 132 };
const insetCam = new THREE.PerspectiveCamera(26, INSET.w / INSET.h, 0.1, 300);
const pinLabelLayer = $('pinLabels');
let pinLabels = [];

function buildPinLabels(conn) {
  pinLabels.forEach((o) => o.el.remove());
  pinLabels = [];
  if (!conn) return;
  const pins = pinout.pins.filter((p) => p.conn === conn.id);
  const many = pins.length > 8;
  pins.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'plab';
    el.innerHTML = many
      ? `<b>${String(p.index).padStart(2, '0')}</b>`
      : `<b>${p.index}</b><s>${p.net.replace(/^#/, '').replace(/:.*/, '')}</s>`;
    pinLabelLayer.appendChild(el);
    pinLabels.push({ el, pin: p });
  });
}

function placeInset() {
  if (!selConn) return;
  const c = connGroupById.get(selConn);
  const body = c.group.getObjectByName('connBody:' + c.id);
  const box = new THREE.Box3().setFromObject(body);
  const ctr = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  // 沿插座法线外侧一点看进去，才能同时看见针和线头
  const n = c.edge;
  const dir = new THREE.Vector3(
    n === '+x' ? 1 : n === '-x' ? -1 : 0,
    n === '+y' ? 1 : n === '-y' ? -1 : 0,
    n === '+z' ? 1 : n === '-z' ? -1 : 0,
  );
  const d = Math.max(1.9, span * 2.1);
  const side = new THREE.Vector3(dir.z, 0.55, -dir.x).normalize();
  insetCam.position.copy(ctr).addScaledVector(dir, d * 0.86).addScaledVector(side, d * 0.36);
  insetCam.position.y += d * 0.22;
  insetCam.lookAt(ctr);
  insetCam.updateMatrixWorld(true);
}

/* pin 号标签要投到 inset 视口里：先投影，再按视口矩形换算成页面坐标 */
const v3 = new THREE.Vector3();
function updatePinLabels() {
  if (!selConn || !state.pinLabels) { pinLabelLayer.style.display = 'none'; return; }
  pinLabelLayer.style.display = 'block';
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const rx = INSET.x, ry = h - INSET.bottom - INSET.h;
  pinLabels.forEach(({ el, pin }) => {
    v3.copy(pin.pos);
    duck.dof.internals.localToWorld(v3);
    v3.project(insetCam);
    if (v3.z > 1) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = (rx + (v3.x * 0.5 + 0.5) * INSET.w) + 'px';
    el.style.top = (ry + (-v3.y * 0.5 + 0.5) * INSET.h) + 'px';
  });
}

/* ---------- 四视图（工程视角） ---------- */
const quad = createQuadViews(THREE, studio.renderer, canvas, [
  { name: '正', pos: [0, 11.8, 78], fov: 12 },
  { name: '侧', pos: [78, 11.8, 0], fov: 12 },
  { name: '俯', pos: [0.01, 86, 0.6], fov: 12 },
  { name: '轴测', pos: [-42, 34, 54], fov: 14 },
], [0, 11.8, 0]);

/* ---------- 状态 ---------- */
const state = {
  multi: false,
  ghost: true,
  harness: true,
  pinLabels: true,
  marks: false,
  filter: 'all',
  table: 'dev',
  spin: false,
};

/* ---------- 标注：几处最值得指的器件 ---------- */
const marks = createMarks(THREE, canvas, camera, $('marks'));
marks.add([
  { label: 'RK3566 主控', note: 'J1..J9 九个口', anchor: new THREE.Vector3(0, 11.2, -1.4) },
  { label: '舵机总线板', note: '16 口 × 3P', anchor: new THREE.Vector3(0, 6.7, 0.6) },
  { label: '电源分配板', note: '电池 → 5V/3.3V/6V', anchor: new THREE.Vector3(0, 8.1, -2.6) },
  { label: 'NP-F550 电池', note: '2P 触点', anchor: new THREE.Vector3(0, 10.6, -6.2) },
  { label: '扬声器', note: '2P · 朝前', anchor: new THREE.Vector3(0, 11.6, 3.9) },
  { label: '摄像头模组', note: 'FPC 24P', anchor: new THREE.Vector3(0, 21.2, 2.4) },
], 'main', null);

/* ---------- 交互：点选插座 / 点选线 ---------- */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tip = $('tip');

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const targets = [];
  pinout.group.traverse((o) => { if (o.isMesh && /^(connBody|pin:)/.test(o.name)) targets.push(o); });
  const hit = ray.intersectObjects(targets, false)[0];
  if (hit) {
    const name = hit.object.name;
    return { type: 'conn', id: name.split(':')[1] };
  }
  const w = [];
  duck.dof.wires.traverse((o) => { if (o.isMesh && /^(wire|ribbon):/.test(o.name)) w.push(o); });
  const wh = ray.intersectObjects(w, false)[0];
  if (wh) return { type: 'wire', ud: wh.object.userData };
  return null;
}

let hoverTimer = 0;
canvas.addEventListener('pointermove', (ev) => {
  const now = performance.now();
  if (now - hoverTimer < 70) return;
  hoverTimer = now;
  const p = pick(ev);
  if (!p) { tip.style.display = 'none'; return; }
  if (p.type === 'conn') {
    const c = connGroupById.get(p.id);
    tip.innerHTML = `<b>${c.id}</b> ${c.label}<i>${c.typeName} · ${c.n}P · ${c.edge} 面</i>`;
  } else {
    const ud = p.ud;
    if (ud.ribbon) {
      tip.innerHTML = `<b>${ud.nets.length} 芯排线</b> 摄像头 FPC<i>${ud.seg[0]} ⇄ ${ud.seg[1]}</i>`;
    } else {
      tip.innerHTML = `<b>${ud.label}</b>${ud.bus}<i>${ud.seg ? ud.seg.join(' → ') : ud.chain.join(' → ')}</i>`;
    }
  }
  const r = canvas.getBoundingClientRect();
  tip.style.display = 'block';
  tip.style.left = Math.min(ev.clientX - r.left + 14, r.width - 250) + 'px';
  tip.style.top = Math.max(12, ev.clientY - r.top - 46) + 'px';
});

canvas.addEventListener('click', (ev) => {
  const p = pick(ev);
  if (!p) { selectConn(null); return; }
  if (p.type === 'conn') selectConn(p.id);
});

function selectConn(id) {
  selConn = id;
  const c = id ? connGroupById.get(id) : null;
  if (c) {
    buildPinLabels(c);
    placeInset();
    // 插座所在的器件一起高亮，方便定位
    selectDev(c.dev === 'servo'
      ? 'JS' + (duck.dof.servoJoints.findIndex((sj, i) => 'JS' + (i + 1) === id) + 1)
      : c.dev, true);
  } else {
    buildPinLabels(null);
  }
  renderPinTable();
  $('insetFrame').style.display = id ? 'block' : 'none';
}

function selectDev(id, quiet) {
  selDev = id;
  const row = devList.find((d) => d.id === id);
  if (row) {
    const b = new THREE.Box3();
    row.meshes.forEach((m) => b.expandByObject(m));
    selBox.box.copy(b);
    selBox.visible = true;
    const c = b.getCenter(new THREE.Vector3());
    studio.orbit.want.set(c.x, c.y, c.z);
    studio.view(studio.orbit.wt, studio.orbit.wp, Math.max(16, b.getSize(new THREE.Vector3()).length() * 2.2), [c.x, c.y, c.z]);
  } else {
    selBox.visible = false;
  }
  if (!quiet) selectConn(null);
  [...$('devList').children].forEach((el) => el.classList.toggle('on', el.dataset.id === id));
}

/* ---------- 面板：器件清单 / 引脚表 / 网表 ---------- */
function renderDevList() {
  const wrap = $('devList');
  wrap.innerHTML = '';
  devList.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'row-item';
    el.dataset.id = d.id;
    el.dataset.cat = d.cat;
    el.innerHTML = `<b>${d.label}</b><i>${d.spec || ''}</i>`;
    el.onclick = () => { selectDev(d.id); selectConn(null); };
    wrap.appendChild(el);
  });
}

function renderPinTable() {
  const wrap = $('pinTable');
  wrap.innerHTML = '';
  if (!selConn) {
    wrap.innerHTML = '<div class="empty">在 3D 里点一个插座，这里出引脚表</div>';
    $('pinHead').textContent = '引脚表';
    return;
  }
  const c = connGroupById.get(selConn);
  const pins = pinout.pins.filter((p) => p.conn === selConn);
  $('pinHead').innerHTML = `${c.id} · ${c.label} <s>${c.typeName} · ${c.n}P · ${c.edge}</s>`;
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>脚</th><th>网名</th><th>接去哪</th><th>线径</th></tr></thead>';
  const tb = document.createElement('tbody');
  pins.forEach((p) => {
    const net = pinout.nets.get(p.net);
    const others = (net ? net.pins : []).filter((q) => q !== p);
    const awg = p.net.startsWith('#') ? '板内' : (net && net.bus === 'power' ? '22 AWG' : '28 AWG');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="n">${p.index}</td>
      <td class="${p.net.startsWith('#') ? 'dim' : ''}">${p.net.replace(/^#/, '')}</td>
      <td>${others.length ? others.map((q) => q.conn + '.' + q.index).join(', ') : '—'}</td>
      <td class="dim">${awg}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.appendChild(t);
}

function renderNetTable() {
  const wrap = $('netTable');
  const rows = netTable(pinout);
  const q = ($('netFilter').value || '').toLowerCase();
  const list = rows.filter((r) => !q || (r.net + r.from + r.to + r.bus).toLowerCase().includes(q));
  wrap.innerHTML = `<div class="nt-head"><span>网名</span><span>总线</span><span>起</span><span>止</span><span>芯</span></div>` +
    list.map((r) => `<div class="nt-row" data-net="${r.raw}">
      <span class="nm">${r.net}${r.domain ? '<s>:' + r.domain + '</s>' : ''}</span>
      <span class="bus b-${r.bus}">${r.bus}</span>
      <span>${r.from}</span><span>${r.to}</span><span>${r.pins}</span>
    </div>`).join('');
  wrap.querySelectorAll('.nt-row').forEach((el) => {
    el.onclick = () => {
      const net = pinout.nets.get(el.dataset.net);
      if (!net || !net.pins.length) return;
      const p = net.pins[0];
      selectConn(p.conn);
    };
  });
  $('netCount').textContent = list.length + ' 条';
  $('devCount').textContent = devList.length + ' 件';
}

/* ---------- 分组过滤 ---------- */
const CATS = ['全部', '计算', '电源', '驱动', '传感', '音频', '视觉', '关节'];
function applyFilter(cat) {
  state.filter = cat;
  const keepDev = (d) => cat === '全部' || d.cat === cat;
  devList.forEach((d) => {
    const show = keepDev(d);
    d.meshes.forEach((m) => { m.visible = show; });
  });
  // 插座跟着器件走
  pinout.connectors.forEach((c) => {
    const d = devList.find((x) => x.id === (c.dev === 'servo' ? 'JS' + (duck.dof.servoJoints.findIndex((sj, i) => 'JS' + (i + 1) === c.id) + 1) : c.dev));
    c.group.visible = !d || keepDev(d);
  });
  // 线：两端都还在才画
  duck.dof.wires.traverse((o) => {
    if (!o.isMesh || !/^(wire|ribbon|pulse)/.test(o.name)) return;
    const seg = (o.userData && (o.userData.seg || o.userData.chain)) || [];
    const devs = seg.map((k) => {
      const cc = connGroupById.get(k.split('.')[0]);
      if (!cc) return null;
      return cc.dev === 'servo'
        ? 'JS' + (duck.dof.servoJoints.findIndex((sj, i) => 'JS' + (i + 1) === cc.id) + 1)
        : cc.dev;
    });
    const ok = devs.every((id) => {
      if (!id) return true;
      const d = devList.find((x) => x.id === id);
      return !d || keepDev(d);
    });
    o.visible = ok && state.harness;
  });
  [...$('cats').children].forEach((b) => b.classList.toggle('on', b.dataset.cat === cat));
}

/* ---------- 控件 ---------- */
const btnMulti = $('btnMulti'), btnGhost = $('btnGhost'), btnHarness = $('btnHarness');
const btnPins = $('btnPins'), btnMarks = $('btnMarks'), btnSpin = $('btnSpin');

function sync() {
  btnMulti.classList.toggle('on', state.multi);
  btnGhost.classList.toggle('on', state.ghost);
  btnHarness.classList.toggle('on', state.harness);
  btnPins.classList.toggle('on', state.pinLabels);
  btnMarks.classList.toggle('on', state.marks);
  btnSpin.classList.toggle('on', state.spin);
  $('vpLabels').style.display = state.multi ? 'block' : 'none';
  setGhost(state.ghost);
  applyFilter(state.filter);
}
btnMulti.onclick = () => { state.multi = !state.multi; sync(); studio.resize(); };
btnGhost.onclick = () => { state.ghost = !state.ghost; sync(); };
btnHarness.onclick = () => { state.harness = !state.harness; sync(); };
btnPins.onclick = () => { state.pinLabels = !state.pinLabels; sync(); };
btnMarks.onclick = () => { state.marks = !state.marks; sync(); };
btnSpin.onclick = () => { state.spin = !state.spin; sync(); };

[['三分之四', 0.72, 1.29, 58], ['正面', 0, 1.42, 56], ['侧面', Math.PI / 2, 1.42, 56],
 ['背面', Math.PI, 1.36, 58], ['俯视', 0.5, 0.18, 62], ['仰视', 0.55, 1.52, 52]]
  .forEach(([label, t, p, d]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      state.multi = false; sync();
      studio.orbit.want.set(0, 11.6, 0);
      studio.view(t, p, d, [0, 11.6, 0]);
    };
    $('views').appendChild(b);
  });

CATS.forEach((cat, i) => {
  const b = document.createElement('button');
  b.textContent = cat;
  b.dataset.cat = i === 0 ? 'all' : cat;
  if (i === 0) b.classList.add('on');
  b.onclick = () => applyFilter(i === 0 ? 'all' : cat);
  $('cats').appendChild(b);
});

$('netFilter').oninput = renderNetTable;
$('tDev').onclick = () => setTable('dev');
$('tNet').onclick = () => setTable('net');
function setTable(k) {
  state.table = k;
  $('tDev').classList.toggle('on', k === 'dev');
  $('tNet').classList.toggle('on', k === 'net');
  $('paneDev').style.display = k === 'dev' ? 'flex' : 'none';
  $('paneNet').style.display = k === 'net' ? 'flex' : 'none';
}

/* BOM 小表：器件 / 数量 / 引脚数 */
function renderBom() {
  const rows = bomRows(pinout);
  const tb = $('bomBody');
  tb.innerHTML = rows.map((r) => `<tr>
    <td>${r.label}</td><td class="n">${r.qty}</td>
    <td class="n">${r.pins}</td><td class="dim">${r.conns || '—'}</td>
  </tr>`).join('');
}

/* ---------- 四视图标签 ---------- */
['正视图', '侧视图', '俯视图', '轴测'].forEach((name, i) => {
  const el = document.createElement('div');
  el.className = 'vp';
  el.textContent = name;
  el.style.left = (i % 2) * 50 + '%';
  el.style.top = Math.floor(i / 2) * 50 + '%';
  $('vpLabels').appendChild(el);
  const fr = document.createElement('div');
  fr.className = 'frame';
  fr.style.left = (i % 2) * 50 + '%';
  fr.style.top = Math.floor(i / 2) * 50 + '%';
  $('vpLabels').appendChild(fr);
});

/* ---------- 渲染 ---------- */
studio.hooks.before.push((dt) => {
  if (state.spin) studio.orbit.wt += dt * 0.3;
  // 内部件不动，只让电流脉冲沿线上走 —— 静止的管线读不出方向
  if (state.harness && state.pinLabels) {
    duck.dof.pulses.forEach((p, i) => {
      p.mesh.visible = true;
      p.t = (p.t + dt * (0.26 + i * 0.01)) % 1;
      p.curve.getPoint(p.t, p.mesh.position);
    });
  } else {
    duck.dof.pulses.forEach((p) => { p.mesh.visible = false; });
  }
});

drawFrame = (R, s, c) => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (state.multi) quad.draw(s, w, h);
  else R.render(s, c);
};

studio.hooks.after.push(() => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const R = studio.renderer;
  if (state.multi) marks.hideAll();
  else marks.update('main', duck.root, state.marks);
  // 放大镜
  if (selConn && !state.multi) {
    const x = INSET.x, y = INSET.bottom;
    R.setScissorTest(true);
    R.setViewport(x, y, INSET.w, INSET.h);
    R.setScissor(x, y, INSET.w, INSET.h);
    R.setClearColor(0x0b0e12, 0.96);
    R.clear(true, true, false);
    R.render(scene, insetCam);
    R.setScissorTest(false);
    R.setViewport(0, 0, w, h);
    R.setClearColor(0x000000, 0);
    updatePinLabels();
    $('insetFrame').style.display = 'block';
    $('insetFrame').style.left = x + 'px';
    $('insetFrame').style.bottom = INSET.bottom + 'px';
    $('insetFrame').style.width = INSET.w + 'px';
    $('insetFrame').style.height = INSET.h + 'px';
    $('insetTitle').textContent = selConn ? connGroupById.get(selConn).id + ' 引脚近摄' : '';
  } else {
    pinLabelLayer.style.display = 'none';
    $('insetFrame').style.display = 'none';
  }
});

/* ---------- 启动 ---------- */
renderDevList();
renderBom();
renderNetTable();
renderPinTable();
setTable('dev');
sync();
studio.start();

$('stat').textContent =
  `${pinout.stats.connectors} 个插座 · ${pinout.stats.pins} 个引脚 · ${pinout.stats.wired} 条网 · ` +
  `${harness.wireCount} 段线 + ${harness.ribbonCount} 条排线 · ${pinout.stats.servos} 个舵机`;
window.__MD_OK = true;
$('boot').classList.add('hide');
