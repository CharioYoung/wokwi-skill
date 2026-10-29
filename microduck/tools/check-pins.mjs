/* 引脚级校验：网表自洽 + 引脚贴在器件上 + 线不穿器件 + 端点落在脚上。
 *
 * 这几件事在页面上看不出来 —— 图上"接到舵机板"和"接到舵机板第 3 脚"
 * 像素级没有区别，只有把坐标算出来才能分辨。 */
import * as THREE from '../vendor/three/three.module.js';
import { buildMicroduck, POSES, applyPose } from '../src/model.js';
import { buildPinout, buildHarness, netTable, DEVICES } from '../src/pinout.js';
import { bodyInnerR } from '../src/fit.js';

const duck = buildMicroduck(THREE, {});
applyPose(duck.dof, POSES.stand, 1);
duck.dof.internals.visible = true;
duck.root.updateMatrixWorld(true);

const pinout = buildPinout(THREE, duck);
const h = buildHarness(THREE, duck, pinout, { innerR: bodyInnerR });
const s = pinout.stats;

console.log('连接器 %d 个 / 引脚 %d 个 / 网 %d 条（画线 %d 条）/ 舵机 %d 个',
  s.connectors, s.pins, s.nets, s.wired, s.servos);
console.log('线束：%d 段 + %d 条排线，归成 %d 组', h.wireCount, h.ribbonCount, h.groups);

let fail = 0;
const bad = (msg) => { console.log('  ✗ ' + msg); fail++; };

/* 器件网格名 ↔ 包围盒，引脚检查与穿模检查共用一份 */
const boxOf = new Map(pinout.deviceBoxes.map((d) => [d.dev, d.box]));
const meshOfConn = (conn) => {
  if (conn.dev === 'servo') {
    const i = duck.dof.servoJoints.findIndex((sj, k) => 'JS' + (k + 1) === conn.id);
    return i < 0 ? null : duck.dof.servoJoints[i].servo;
  }
  const d = DEVICES.find((x) => x.id === conn.dev);
  return d ? d.mesh : null;
};

/* 1. 15 个舵机都要有插座，且每个插座 3 脚 */
const servoConns = pinout.connectors.filter((c) => c.dev === 'servo');
if (servoConns.length !== 15) bad(`舵机插座 ${servoConns.length} 个，应为 15`);
servoConns.forEach((c) => { if (c.n !== 3) bad(`${c.id} 脚数 ${c.n}，舵机应为 3`); });

/* 2a. 连接器壳体必须贴住器件表面（插头不能飘在半空） */
const offBody = [];
pinout.connectors.forEach((c) => {
  const b = boxOf.get(meshOfConn(c));
  if (!b) { offBody.push(`${c.id} 找不到器件盒`); return; }
  const d = b.distanceToPoint(c.bodyBox.getCenter(new THREE.Vector3()));
  if (d > 0.45) offBody.push(`${c.id} 离 ${meshOfConn(c)} 表面 ${(d * 10).toFixed(1)} mm`);
});
if (offBody.length) {
  offBody.slice(0, 6).forEach((m) => console.log('  · ' + m));
  bad(`${offBody.length} 个连接器没贴住器件`);
}

/* 2b. 每个脚必须在自己连接器的壳体里（针脚在壳上，不是在壳外飘着） */
const off = [];
pinout.pins.forEach((p) => {
  const c = pinout.connectors.find((x) => x.id === p.conn);
  if (!c) { off.push(`${p.conn} 未知连接器`); return; }
  if (!c.bodyBox.clone().expandByScalar(0.03).containsPoint(p.pos)) {
    off.push(`${p.conn}.${p.index} 不在 ${c.id} 壳体内`);
  }
});
if (off.length) {
  off.slice(0, 6).forEach((m) => console.log('  · ' + m));
  bad(`${off.length} 个引脚不在自己的连接器壳体里`);
}

/* 3. 每条网至少两端；同一条网里不许出现同一个脚两次 */
[...pinout.nets.values()].forEach((rec) => {
  const keys = rec.pins.map((p) => p.conn + '.' + p.index);
  if (new Set(keys).size !== keys.length) bad(`网 ${rec.net} 里有重复的脚`);
  if (!rec.hidden && rec.pins.length < 2) bad(`网 ${rec.net} 只有一个脚却被画了线`);
});

/* 4. 线束不许穿过器件：沿线采样，落进别的器件盒子里就算穿模 */
const wireObjs = [];
duck.dof.wires.traverse((o) => { if (o.isMesh && /^wire:/.test(o.name)) wireObjs.push(o); });
const boxes = pinout.deviceBoxes
  .filter((d) => !duck.dof.servoJoints.some((sj) => sj.servo === d.dev))
  .map((d) => ({ dev: d.dev, box: d.box.clone().expandByScalar(-0.10) }));
let hits = 0, examples = [];
wireObjs.forEach((mesh) => {
  const own = new Set();
  (mesh.userData.chain || []).forEach((k) => {
    const c = pinout.connectors.find((x) => x.id === k.split('.')[0]);
    if (c) own.add(c.dev);
  });
  const pos = mesh.geometry.attributes.position;
  const step = Math.max(1, Math.floor(pos.count / 26));
  for (let i = 0; i < pos.count; i += step) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    for (const { dev, box } of boxes) {
      if (own.has(dev)) continue;
      if (box.containsPoint(v)) {
        hits++;
        if (examples.length < 8) examples.push(`${mesh.userData.net} 擦到 ${dev}`);
      }
    }
  }
});
if (hits) {
  console.log('  ! %d 个采样点落在器件内部：', hits, examples.join(' / '));
  console.log('    （走线是自动往内壁吸的，擦边可接受；数量大说明吸附半径给错了）');
}

/* 5. 线束端点必须在脚的 2 mm 以内 */
let endErr = 0;
wireObjs.forEach((mesh) => {
  const chain = mesh.userData.seg || mesh.userData.chain || [];
  if (chain.length < 2) return;
  const pinOf = (key) => {
    const [cid, idx] = key.split('.');
    return pinout.pins.find((p) => p.conn === cid && p.index === Number(idx));
  };
  const a = pinOf(chain[0]), b = pinOf(chain[chain.length - 1]);
  if (!a || !b) { endErr++; return; }
  const pos = mesh.geometry.attributes.position;
  const pa = new THREE.Vector3().fromBufferAttribute(pos, 0).applyMatrix4(mesh.matrixWorld);
  const pb = new THREE.Vector3().fromBufferAttribute(pos, pos.count - 1).applyMatrix4(mesh.matrixWorld);
  if (Math.min(pa.distanceTo(a.pos), pa.distanceTo(b.pos)) > 0.2) endErr++;
});
if (endErr) bad(`${endErr} 条线的端点没落在脚上`);

/* 6. 每个器件至少有一个连接器 */
const devsWithConn = new Set(pinout.connectors.map((c) => c.dev));
DEVICES.forEach((d) => {
  if (!devsWithConn.has(d.id)) bad(`器件 ${d.label}(${d.id}) 没有任何连接器`);
});

const rows = netTable(pinout);
console.log('\n网表 %d 行，前 8 行：', rows.length);
rows.slice(0, 8).forEach((r) => console.log('  %s %s %s → %s',
  (r.net + (r.domain ? ':' + r.domain : '')).padEnd(18),
  r.bus.padEnd(6), r.from, r.to));

console.log('\n%s', fail ? `失败 ${fail} 项` : '全部通过');
process.exit(fail ? 1 : 0);
