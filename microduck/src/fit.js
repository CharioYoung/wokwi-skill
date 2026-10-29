/* ==================================================================== *
 * 容纳计算：器件到内壁还剩多少
 *
 * 外观图和器件图分开之后，"外壳能不能装下这些器件"就没人负责了 ——
 * 外观图看不出腔体，器件图没有壳。所以把这件事做成一份数据：
 * 每件到内壁的最小间隙，单位毫米，装不下就是负的。
 *
 * 这里是唯一一份壁厚 / 剖面数据，页面和校验脚本都从这儿取，
 * 免得页面写 2.4 mm、检查脚本写 2.0 mm，最后谁也不知道哪个是真的。
 * ==================================================================== */

export const WALL = 0.24;            // 2.4 mm，FDM 0.4 喷嘴 × 6 圈
export const DZ = 1.10;              // 机身前后拉长系数（与 model.js 的 bodyDepthK 一致）

/* 躯干旋转体剖面：[y, 半径]，与 model.js 的 lathe 入参逐点一致 */
export const BODY_PROFILE = [
  [4.00, 0.0002], [4.35, 3.70], [5.15, 5.50], [6.20, 6.20], [7.60, 6.40],
  [9.30, 6.42], [11.00, 6.28], [12.30, 5.85], [13.50, 5.00], [14.30, 3.60], [14.60, 0.0002],
];

/* 头壳剖面（head 局部 y）：[y, 半径]，再乘 1.08 得到 z 向半径 */
export const HEAD_PROFILE = [
  [-3.72, 0.0002], [-3.32, 2.95], [-2.60, 3.62], [-1.50, 3.90], [-0.20, 3.96],
  [1.10, 3.86], [2.20, 3.50], [3.00, 2.90], [3.60, 1.75], [3.92, 0.0002],
];
export const HEAD_SZ = 1.08;

/* 腿套筒：大腿从髋 y5.45 到膝 y3.15，小腿从 3.15 到 1.05 */
export const LIMB_PROFILE = [
  [1.05, 1.26], [1.60, 1.22], [3.15, 1.18], [3.60, 1.56], [5.45, 1.60],
];

function interp(profile, y) {
  if (y < profile[0][0] || y > profile[profile.length - 1][0]) return 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [y0, r0] = profile[i], [y1, r1] = profile[i + 1];
    if (y >= y0 && y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  }
  return 0;
}

export const bodyOuterR = (y) => interp(BODY_PROFILE, y);
export const bodyInnerR = (y) => Math.max(0, bodyOuterR(y) - WALL);
export const headInnerR = (yLocal) => Math.max(0, interp(HEAD_PROFILE, yLocal) - WALL);
export const limbInnerR = (y) => Math.max(0, interp(LIMB_PROFILE, y) - WALL);

/* 椭圆半径比：q ≤ 1 在腔内，q > 1 已经戳出内壁 */
function ellipseRatio(x, z, a, b) {
  if (a <= 1e-6 || b <= 1e-6) return 99;
  return Math.hypot(x / a, z / b);
}

/* 间隙（cm）：q 到 1 的距离按最短半轴折算，比直接给"比例"好读 */
function clearanceOf(q, a, b) {
  return (1 - q) * Math.min(a, b);
}

/* 器件在哪一层壳里 —— 靠场景树判断，不靠人肉写表 */
export function frameOf(duck, obj) {
  const has = (node) => {
    let p = obj;
    while (p) { if (p === node) return true; p = p.parent; }
    return false;
  };
  for (const k of ['headL', 'head']) {
    const n = duck.dof[k];
    if (n && has(n)) return 'head';
  }
  if (duck.dof.neckPivot && has(duck.dof.neckPivot)) return 'neck';
  for (const k of ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) {
    const n = duck.dof[k];
    if (n && has(n)) return 'leg';
  }
  if (duck.dof.torso && has(duck.dof.torso)) return 'body';
  return 'external';
}

/* 器件到内壁的最小间隙。返回 cm（负数是干涉），并给出最坏的那个角点。 */
export function clearanceOfBox(THREE, box, frame, duck) {
  const corners = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push([x, y, z]);
    }
  }
  const headC = frame === 'head'
    ? duck.dof.head.getWorldPosition(new THREE.Vector3())
    : null;

  let worst = Infinity, at = null;
  for (const [x, y, z] of corners) {
    let c;
    if (frame === 'head') {
      const ly = y - headC.y;
      const a = headInnerR(ly);
      const q = ellipseRatio(x - headC.x, z - headC.z, a, a * HEAD_SZ);
      c = clearanceOf(q, a, a * HEAD_SZ);
    } else if (frame === 'neck') {
      const a = 2.35 - WALL;
      const q = Math.hypot(x, z) / a;
      c = clearanceOf(q, a, a);
    } else if (frame === 'leg') {
      const a = limbInnerR(y);
      const q = Math.hypot(Math.abs(x) - 3.5, z - 0.12) / a;
      c = clearanceOf(q, a, a);
    } else {
      const a = bodyInnerR(y);
      const q = ellipseRatio(x, z, a, a * DZ);
      c = clearanceOf(q, a, a * DZ);
    }
    if (c < worst) { worst = c; at = [x, y, z]; }
  }
  return { cm: worst, at };
}

/* 整机容纳表：器件 → 层 → 间隙 mm → 结论 */
export function measureFit(THREE, duck) {
  const rows = [];
  duck.root.updateMatrixWorld(true);
  duck.dof.internals.traverse((o) => {
    if (!o.isMesh) return;
    if (/^(pin|conn|pulse|wire)/.test(o.name)) return;
    if (/^connBody|^pin1/.test(o.name)) return;
    const frame = frameOf(duck, o);
    if (frame === 'external') return;
    const box = new THREE.Box3().setFromObject(o);
    const r = clearanceOfBox(THREE, box, frame, duck);
    rows.push({
      name: o.name || '(无名件)', frame,
      mm: r.cm * 10,
      ok: r.cm > 0,
    });
  });
  rows.sort((a, b) => a.mm - b.mm);
  return rows;
}
