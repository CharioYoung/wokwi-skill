/* ==================================================================== *
 * 外观图：为打印服务，并且对器件负责
 *
 * 这一页只做壳。器件图在 internals.html，两边不共享视角也不共享面板 ——
 * 上次把两张图塞进一个页面，结果外观不敢剖、剖了看不出外观。
 *
 * 这里回答三个问题：
 *   1. 长什么样（可转，四视图，尺寸标注按实测包围盒）
 *   2. 怎么打（分件表：材料、层高、朝向、支撑、克数、热床占用，全是量出来的）
 *   3. 装不装得下（腔体视图 + 每件到内壁的间隙，负的就是装不下）
 * ==================================================================== */

import * as THREE from 'three';
import { buildMicroduck, POSES, applyPose } from './model.js';
import { PARTS, measureParts, BED } from './print.js';
import { measureFit, WALL, BODY_PROFILE, HEAD_PROFILE, DZ } from './fit.js';
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

let drawFrame = null;
const studio = createStudio(THREE, {
  canvas, fov: 32, dist: 66, target: [0, 12.4, 0], shadows: true,
  render: (R, s, c) => (drawFrame ? drawFrame(R, s, c) : R.render(s, c)),
});
const { scene, camera, renderer } = studio;

const duck = buildMicroduck(THREE, { colorway: 'cream' });
applyPose(duck.dof, POSES.stand, 1);
scene.add(duck.root);
duck.dof.internals.visible = false;
duck.dof.wires.visible = false;
duck.root.updateMatrixWorld(true);

const SHELL_MATS = [duck.materials.shell, duck.materials.shell2, duck.materials.accent, duck.materials.tpu];

/* ---------- 整机尺寸（实测） ---------- */
const box = new THREE.Box3();
duck.root.traverse((o) => {
  if (!o.isMesh) return;
  let p = o;
  while (p) { if (p.visible === false) return; p = p.parent; }
  if (o.name === 'deck' || /^(wheel|axle|gripTape)/.test(o.name)) return;   // 选配件不算整机
  box.expandByObject(o);
});
const size = box.getSize(new THREE.Vector3());
const mm = (v) => (v * 10).toFixed(0);

/* ---------- 腔体：内壁线框 ----------
 * 打印件是空心的，但模型里的壳是一张实心旋转体。与其把壳体真的挖空
 * （布尔运算在浏览器里代价太大），不如单独画一层"内壁"线框：
 * 它和壁厚是同一个数据源，器件到内壁的间隙也按它算。 */
const cavityMat = new THREE.LineBasicMaterial({
  color: '#4fd8ff', transparent: true, opacity: 0.34,
});
function cavityLines(profile, sx, sz, yShift) {
  const g = new THREE.Group();
  // 只取有半径的段，两端收口处补到 0
  const pts = [];
  for (let y = profile[0][0]; y <= profile[profile.length - 1][0] + 1e-6; y += 0.35) {
    let r = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const [y0, r0] = profile[i], [y1, r1] = profile[i + 1];
      if (y >= y0 && y <= y1) { r = r0 + (r1 - r0) * (y - y0) / (y1 - y0); break; }
    }
    pts.push([y, Math.max(r - WALL, 0.002)]);
  }
  // 横环
  [0.12, 0.3, 0.5, 0.7, 0.88].forEach((k) => {
    const [y, r] = pts[Math.min(pts.length - 1, Math.round(k * (pts.length - 1)))];
    const ring = [];
    for (let a = 0; a <= 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(t) * r * sx, y + yShift, Math.sin(t) * r * sz));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), cavityMat));
  });
  // 竖棱
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    const line = pts.map(([y, r]) => new THREE.Vector3(Math.cos(t) * r * sx, y + yShift, Math.sin(t) * r * sz));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), cavityMat));
  }
  return g;
}
const cavityBody = cavityLines(BODY_PROFILE, 1, DZ, 0);
cavityBody.name = 'cavityBody';
duck.dof.torso.add(cavityBody);
const cavityHead = cavityLines(HEAD_PROFILE, 1, 1.08, 0);
cavityHead.name = 'cavityHead';
duck.dof.head.add(cavityHead);
cavityBody.visible = false;
cavityHead.visible = false;

/* ---------- 打印件 → 网格 ---------- */
const partMeshes = new Map();
PARTS.forEach((p) => {
  const o = duck.root.getObjectByName(p.mesh);
  if (o) partMeshes.set(p.id, o);
});

/* ---------- 分件高亮 ----------
 * 选一件时：其余压暗；如果这件是"按高度切开的一半壳"，
 * 再用剖切面把另一半真的切掉 —— 否则件 1 和件 2 长得一模一样。 */
const dimmed = new THREE.MeshStandardMaterial({
  color: '#2b3138', roughness: 0.92, metalness: 0.02, transparent: true, opacity: 0.28,
});
const origMats = new Map();
duck.root.traverse((o) => { if (o.isMesh) origMats.set(o, o.material); });

const bandPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), new THREE.Plane(new THREE.Vector3(0, 1, 0), 99)];
let selPart = null;

function applySel(id) {
  selPart = id;
  const part = PARTS.find((p) => p.id === id);
  duck.root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = origMats.get(o);
  });
  if (!part) {
    bandPlanes.forEach((pl) => { pl.constant = 99; });
    $('partInfo').textContent = '点一行查看该件的打印说明';
    return;
  }
  const keep = new Set();
  keep.add(partMeshes.get(part.id));
  duck.root.traverse((o) => {
    if (!o.isMesh) return;
    if (!keep.has(o)) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => SHELL_MATS.includes(m))) o.material = dimmed;
    }
  });
  // 按高度带切：上身壳留 y>7.55，下身壳留 y<7.55
  if (part.band) {
    bandPlanes[0].constant = part.band[1];   // -y + c = 0 → y = c
    bandPlanes[1].constant = -part.band[0];
  } else {
    bandPlanes[0].constant = 99;
    bandPlanes[1].constant = 99;
  }
  setTab('parts');
  $('partInfo').innerHTML = `<b>${part.label}</b><i>${part.mat} · 层高 ${part.layer} mm · ${part.note}</i>`;
  [...$('partList').children].forEach((el) => el.classList.toggle('on', el.dataset.id === id));
}

/* ---------- 模式 ---------- */
const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
const state = { mode: 'solid', multi: false, marks: true, spin: false, cavity: false, dims: true };

function applyMode(m) {
  state.mode = m;
  const cut = m === 'cut';
  const cavity = m === 'cavity';
  SHELL_MATS.forEach((mat) => {
    mat.transparent = cavity;
    mat.opacity = cavity ? 0.11 : 1;
    mat.depthWrite = !cavity;
    // 两个带平面始终挂在材质上，不切的时候把 constant 推到 99 之外就自动失效
    mat.clippingPlanes = cut ? [clipPlane, ...bandPlanes] : bandPlanes;
    mat.clipShadows = true;
    mat.needsUpdate = true;
  });
  cavityBody.visible = cavity;
  cavityHead.visible = cavity;
  duck.dof.internals.visible = cavity;
  duck.dof.internals.traverse((o) => {
    if (!o.isMesh) return;
    if (/^(pin|conn|pulse)/.test(o.name)) o.visible = false;   // 器件图才看引脚，这里只要体积
  });
  duck.dof.wires.visible = false;
  $('btnSolid').classList.toggle('on', m === 'solid');
  $('btnCut').classList.toggle('on', m === 'cut');
  $('btnCavity').classList.toggle('on', m === 'cavity');
  // 进腔体模式就顺手把右侧切到容纳表 —— 那一栏才是看这个模式的目的
  if (cavity) setTab('fit');
  else if (selPart == null) setTab('parts');
}

function updateClip() {
  if (state.mode !== 'cut') return;
  const n = new THREE.Vector3().copy(camera.position).sub(studio.orbit.target).setY(0);
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  n.normalize().negate();
  clipPlane.normal.copy(n);
  clipPlane.constant = -n.dot(studio.orbit.target);
}

/* ---------- 四视图 ---------- */
const ORTHO = 12;
const quad = createQuadViews(THREE, renderer, canvas, [
  { name: '正', pos: [0, 12.4, 190], fov: ORTHO },
  { name: '侧', pos: [190, 12.4, 0], fov: ORTHO },
  { name: '俯', pos: [0.01, 200, 0.6], fov: ORTHO },
  { name: '轴测', pos: [-74, 58, 96], fov: 16 },
], [0, 12.4, 0]);

/* ---------- 测量与表格 ---------- */
const pr = measureParts(THREE, duck);
const fit = measureFit(THREE, duck);
const tight = fit.slice(0, 8);

$('specH').textContent = mm(size.y);
$('specW').textContent = mm(size.x);
$('specD').textContent = mm(size.z);
$('specWall').textContent = (WALL * 10).toFixed(1);
$('specParts').textContent = pr.summary.count;
$('specGrams').textContent = Math.round(pr.summary.gramsCore);
$('specBed').textContent = `${BED.x * 10}×${BED.y * 10}`;

function renderParts() {
  const wrap = $('partList');
  wrap.innerHTML = '';
  pr.parts.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'part';
    el.dataset.id = r.id;
    const sizeTxt = r.size
      ? `${Math.round(r.size[0])}×${Math.round(r.size[2])}×${Math.round(r.size[1])}`
      : '—';
    el.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span>
      <span class="nm">${r.label}<i>${r.mat} · ${r.layer} mm</i></span>
      <span class="sz">${sizeTxt}<i>mm</i></span>
      <span class="gr">${r.grams ? r.grams.toFixed(0) : '—'}<i>g</i></span>`;
    el.onclick = () => applySel(r.id);
    wrap.appendChild(el);
  });
}

function renderFit() {
  const wrap = $('fitList');
  wrap.innerHTML = '';
  tight.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'fit';
    el.innerHTML = `<span class="nm">${r.name}</span>
      <span class="fr">${r.frame}</span>
      <span class="mm ${r.mm < 3 ? 'warn' : ''}">${r.mm.toFixed(1)} mm</span>`;
    el.onclick = () => {
      const o = duck.root.getObjectByName(r.name);
      const b = new THREE.Box3().setFromObject(o);
      const c = b.getCenter(new THREE.Vector3());
      studio.view(studio.orbit.wt, studio.orbit.wp, 34, [c.x, c.y, c.z]);
      if (state.mode !== 'cavity') applyMode('cavity');
    };
    wrap.appendChild(el);
  });
  const neg = fit.filter((r) => r.mm < 0).length;
  $('fitSum').textContent = `${fit.length} 件已核 / 负间隙 ${neg} 件`;
}

/* ---------- 尺寸标注 ---------- */
const marks = createMarks(THREE, canvas, camera, $('marks'));
marks.add([
  { label: `高 ${mm(size.y)} mm`, note: '含头顶到蹼底', anchor: new THREE.Vector3(box.max.x * 0.1, box.max.y, (box.max.z + box.min.z) / 2) },
  { label: `宽 ${mm(size.x)} mm`, note: '翅尖到翅尖', anchor: new THREE.Vector3(box.max.x, 10.4, 0.4) },
  { label: `深 ${mm(size.z)} mm`, note: '喙尖到尾羽', anchor: new THREE.Vector3(0.2, 9.6, box.max.z) },
  { label: `分模 y=${mm(7.55)} mm`, note: '上下身壳在这里分件', anchor: new THREE.Vector3(-6.2, 7.55, 0) },
  { label: `壁厚 ${(WALL * 10).toFixed(1)} mm`, note: '6 圈 0.4 喷嘴', anchor: new THREE.Vector3(0, 4.6, 6.2) },
], 'main', null);

/* ---------- 控件 ---------- */
function setTab(k) {
  $('tParts').classList.toggle('on', k === 'parts');
  $('tFit').classList.toggle('on', k === 'fit');
  $('paneParts').style.display = k === 'parts' ? 'flex' : 'none';
  $('paneFit').style.display = k === 'fit' ? 'flex' : 'none';
}
$('tParts').onclick = () => setTab('parts');
$('tFit').onclick = () => setTab('fit');

$('btnSolid').onclick = () => applyMode('solid');
$('btnCut').onclick = () => applyMode('cut');
$('btnCavity').onclick = () => applyMode('cavity');

$('btnMulti').onclick = () => {
  state.multi = !state.multi;
  $('btnMulti').classList.toggle('on', state.multi);
  $('vpLabels').style.display = state.multi ? 'block' : 'none';
  studio.resize();
};
$('btnMarks').onclick = () => {
  state.marks = !state.marks;
  $('btnMarks').classList.toggle('on', state.marks);
};
$('btnSpin').onclick = () => {
  state.spin = !state.spin;
  $('btnSpin').classList.toggle('on', state.spin);
};

[['三分之四', 0.72, 1.29, 66], ['正面', 0, 1.42, 62], ['侧面', Math.PI / 2, 1.42, 62],
 ['背面', Math.PI, 1.36, 64], ['俯视', 0.5, 0.18, 70], ['底部', 0.55, 1.52, 58]]
  .forEach(([label, t, p, d]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      state.multi = false;
      $('btnMulti').classList.remove('on');
      $('vpLabels').style.display = 'none';
      studio.view(t, p, d, [0, 12.4, 0]);
    };
    $('views').appendChild(b);
  });

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
drawFrame = (R, s, c) => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (state.multi) quad.draw(s, w, h);
  else R.render(s, c);
};

studio.hooks.before.push((dt) => {
  if (state.spin) studio.orbit.wt += dt * 0.3;
  updateClip();
});
studio.hooks.after.push(() => {
  if (state.multi) marks.hideAll();
  else marks.update('main', duck.root, state.marks && state.dims);
});

/* ---------- 启动 ---------- */
renderParts();
renderFit();
applyMode('solid');
applySel(null);
studio.start();

window.__MD_OK = true;
$('boot').classList.add('hide');
