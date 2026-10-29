/* 打印件校验：每件都要能上 220×220 的床、料量要合理、容纳表不能有负间隙。
 * 外观图里的"能不能打""装不装得下"两句话，都由这里给出数字。 */
import * as THREE from '../vendor/three/three.module.js';
import { buildMicroduck, POSES, applyPose } from '../src/model.js';
import { measureParts, BED } from '../src/print.js';
import { measureFit, WALL } from '../src/fit.js';

const duck = buildMicroduck(THREE, {});
applyPose(duck.dof, POSES.stand, 1);
duck.dof.internals.visible = true;
duck.root.updateMatrixWorld(true);

const pr = measureParts(THREE, duck);
let fail = 0;
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

console.log('分件 %d 件 / 材料 %s / 主体估料 %d g（含选配 %d g）/ 超床 %d 件 / 需支撑 %d 件',
  pr.summary.count, pr.summary.materials.join(' + '),
  Math.round(pr.summary.gramsCore), Math.round(pr.summary.grams),
  pr.summary.oversize, pr.summary.needSupport);
console.log('热床 %d×%d×%d cm', BED.x, BED.y, BED.z);

const rows = pr.parts.slice().sort((a, b) => (b.size ? b.size[1] : 0) - (a.size ? a.size[1] : 0));
console.log('\n最高的 8 件：');
rows.slice(0, 8).forEach((r) => {
  if (!r.size) { console.log('  !! %s %s', r.label, r.error); return; }
  console.log('  %s %s  高%s mm  悬垂%s%%  %s',
    r.label.padEnd(9), (Math.round(r.size[0]) + '×' + Math.round(r.size[2])).padEnd(10),
    r.size[1].toFixed(0).padStart(4), (r.overhang * 100).toFixed(0).padStart(3),
    r.support);
});

pr.parts.forEach((r) => {
  if (r.error) bad(`${r.label}: ${r.error}`);
  else if (!r.fits) bad(`${r.label} ${Math.round(r.size[0])}×${Math.round(r.size[2])}×${Math.round(r.size[1])} mm 超出热床`);
});
if (pr.summary.grams < 100 || pr.summary.grams > 900) {
  bad(`估料 ${Math.round(pr.summary.grams)} g 不在 100~900 g 的合理区间（整机 ≈800 g）`);
}

/* 容纳：内部件到内壁的间隙 */
const fit = measureFit(THREE, duck);
const walled = fit.filter((r) => r.mm < 0);
console.log('\n容纳检查（壁厚 %s mm）：%d 件，负间隙 %d 件', (WALL * 10).toFixed(1), fit.length, walled.length);
fit.slice(0, 10).forEach((r) => {
  console.log('  %s %s %s mm  %s',
    (r.ok ? 'ok  ' : '干涉'), r.name.padEnd(15), r.mm.toFixed(1).padStart(6), r.frame);
});
walled.forEach((r) => bad(`${r.name} 到内壁 ${r.mm.toFixed(1)} mm`));

console.log('\n%s', fail ? `失败 ${fail} 项` : '全部通过');
process.exit(fail ? 1 : 0);
