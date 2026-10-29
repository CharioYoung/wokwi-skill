/* 内部件必须装得进壳里。
 * 装配关系是手摆的，摆完必须量一遍 —— 器件戳出外壳，外观模式下就会露馅，
 * 而这种错误在渲染图里恰好被半透明外壳糊住，光看图看不出来。 */
import * as THREE from '../vendor/three/three.module.js';
import { buildMicroduck, POSES, applyPose } from '../src/model.js';

const d = buildMicroduck(THREE, {});
applyPose(d.dof, POSES.stand, 1);
d.dof.internals.visible = true;
d.root.updateMatrixWorld(true);

// 躯干旋转体的半径剖面（与 model.js 的 body profile 一致）
const P = d.proportion;
const prof = [
  [4.0, 0.0002], [4.35, 3.7], [5.15, 5.5], [6.2, 6.2], [7.6, 6.4], [9.3, 6.42],
  [11.0, 6.28], [12.3, 5.85], [13.5, 5.0], [14.3, 3.6], [14.6, 0.0002],
];
const DZ = P.bodyDepthK;
function bodyR(y) {
  if (y < prof[0][0] || y > prof[prof.length - 1][0]) return 0;
  for (let i = 0; i < prof.length - 1; i++) {
    const [y0, r0] = prof[i], [y1, r1] = prof[i + 1];
    if (y >= y0 && y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  }
  return 0;
}

const headBox = new THREE.Box3().setFromObject(d.root.getObjectByName('headShell'));
const WALL = 0.24;   // 2.4 mm 壁厚

let bad = 0, checked = 0;
const rows = [];
d.dof.internals.traverse((o) => {
  if (!o.isMesh) return;
  if (/^pulse/.test(o.name)) return;   // 脉冲球是动画元素，不参与装配检查
  const hasAncestor = (node) => { let p = o; while (p) { if (p === node) return true; p = p.parent; } return false; };
  const inHead = hasAncestor(d.dof.head);
  const inNeck = !inHead && hasAncestor(d.dof.neckPivot);
  const b = new THREE.Box3().setFromObject(o);
  if (inNeck) {
    // 颈是一段立着的圆柱：半径 2.35，y 世界 13.4 .. 17.6
    let worst = 0;
    for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
      const k = Math.hypot(x, z) / (2.35 - WALL);
      if (k > worst) worst = k;
    }
    if (b.min.y < 13.4 - 0.2 || b.max.y > 17.9) worst = Math.max(worst, 1.2);
    checked++;
    if (worst > 1) bad++;
    rows.push([o.name || '(neck part)', worst > 1 ? 'OUT' : 'ok', worst.toFixed(2)]);
    return;
  }
  if (inHead) {
    // 头部按椭球近似：x/3.95, y/3.95, z/(3.95*1.08)，中心在 head 原点
    const c = d.dof.head.getWorldPosition(new THREE.Vector3());
    let worst = 0, at = null;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const k = Math.hypot((x - c.x) / 3.95, (y - c.y) / 3.95, (z - c.z) / (3.95 * 1.08));
      if (k > worst) { worst = k; at = [x, y, z]; }
    }
    checked++;
    const ok = worst <= 1 - WALL / 3.95;
    if (!ok) bad++;
    rows.push([o.name || '(head part)', ok ? 'ok' : 'OUT', worst.toFixed(2)]);
    return;
  }
  // 躯干：8 个角点都要在椭圆内
  let worst = 0;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    const r = bodyR(y);
    const k = r < 1e-6 ? 99 : Math.hypot(x / Math.max(r - WALL, 0.01), z / Math.max((r - WALL) * DZ, 0.01));
    if (k > worst) worst = k;
  }
  checked++;
  const ok = worst <= 1.0;
  if (!ok) bad++;
  rows.push([o.name || '(part)', ok ? 'ok' : 'OUT', worst.toFixed(2)]);
});

rows.sort((a, b) => Number(b[2]) - Number(a[2]));
for (const r of rows.slice(0, 12)) console.log('  %s  %s  ratio=%s', r[1].padEnd(4), r[0].padEnd(16), r[2]);
console.log('检查 %d 个内部件，超出壳体 %d 个', checked, bad);
console.log('头顶世界 y = %s（规格 25.0）', headBox.max.y.toFixed(2));
process.exit(bad ? 1 : 0);
