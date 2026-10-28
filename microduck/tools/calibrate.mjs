/* 逐姿态量最低点，把 bodyY 修正成"脚正好踩在地面上"。
 * 人眼对穿地极其敏感，而人的姿态参数是猜的 —— 与其手调，不如量出来。 */
import * as THREE from '../vendor/three/three.module.js';
import { buildMicroduck, POSES, applyPose } from '../src/model.js';

for (const [name, pose] of Object.entries(POSES)) {
  const d = buildMicroduck(THREE, {});
  applyPose(d.dof, pose, 1);
  d.root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  d.root.traverse((o) => {
    if (!o.isMesh) return;
    let q = o; while (q) { if (q.visible === false) return; q = q.parent; }
    b.expandByObject(o);
  });
  const want = (pose.bodyY || 0) - b.min.y;
  console.log('%s  bodyY %s -> %s   (顶 %s)',
    name.padEnd(8), String(pose.bodyY || 0).padStart(7), want.toFixed(2), b.max.y.toFixed(2));
}
