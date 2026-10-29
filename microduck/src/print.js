/* ==================================================================== *
 * 打印分件表
 *
 * 外观图要能指导打印，光有一张好看的效果图没用 —— 得说清楚：
 *   这一件叫什么、什么材料、几层高、要不要支撑、摆成什么姿态、
 *   在 220×220 的热床上占多大、大概多少克。
 *
 * 除了材料和层高是人定的，其余全是量出来的：面积、体积、包围盒、
 * 悬垂面积占比都在这里算，所以改一处模型尺寸，表里的克数会自己变。
 * ==================================================================== */

import { WALL } from './fit.js';

export const BED = { x: 22.0, y: 22.0, z: 25.0 };   // Bambu A1 / P1S，单位 cm

/* mat: 材料；layer: 层高 mm；split: 需要从同一件几何里按高度切开 */
export const PARTS = [
  { id: 'bodyLower', hollow: true, label: '下身壳', mesh: 'body', band: [0, 7.55], mat: 'PETG', layer: 0.2,
    note: '分模面在 y=7.55，与装饰沟槽齐平；底面朝下，腿孔处需要树状支撑' },
  { id: 'bodyUpper', hollow: true, label: '上身壳', mesh: 'body', band: [7.55, 99], mat: 'PETG', layer: 0.2,
    note: '倒扣打印（开口朝上），颈孔与颈柱一体，免支撑' },
  { id: 'head', hollow: true, label: '头壳', mesh: 'headShell', mat: 'PETG', layer: 0.16,
    note: '喙根开口朝上；眼窝是通孔，内壁留 0.15 倒角方便装镜筒' },
  { id: 'neck', hollow: true, label: '颈圈', mesh: 'neckShell', mat: 'PETG', layer: 0.16,
    note: '竖放，与颈舵机同轴；下端 2 mm 台阶卡进上身壳' },
  { id: 'beakUpper', hollow: true, label: '上喙', mesh: 'beakUpperShell', mat: 'PETG', layer: 0.16,
    note: '侧躺打印，喙尖朝上；内腔走一根 2 mm 拉簧' },
  { id: 'beakLower', hollow: true, label: '下喙', mesh: 'beakLowerShell', mat: 'PETG', layer: 0.16,
    note: '侧躺打印，与上喙同一姿态，方便对齐铰链孔' },
  { id: 'beakPadU', label: '上喙软垫', mesh: 'beakUpperPad', mat: 'TPU 95A', layer: 0.2,
    note: 'TPU 直接打，抓取面；用 0.4 喷嘴、20 mm/s' },
  { id: 'beakPadL', label: '下喙软垫', mesh: 'beakLowerPad', mat: 'TPU 95A', layer: 0.2,
    note: 'TPU，与上垫同款，粘接或卡扣' },
  { id: 'wingL', hollow: true, label: '左翅', mesh: 'wingL', mat: 'PETG', layer: 0.16, note: '平躺打印，翅面朝下' },
  { id: 'wingR', hollow: true, label: '右翅', mesh: 'wingR', mat: 'PETG', layer: 0.16, note: '平躺打印，与左翅镜像' },
  { id: 'tail', hollow: true, label: '尾羽', mesh: 'tailShell', mat: 'PETG', layer: 0.16, note: '根面朝下，尾尖朝上斜放' },
  { id: 'thighL', hollow: true, label: '左大腿壳', mesh: 'thighL', mat: 'PETG', layer: 0.16, note: '竖放，髋端朝下' },
  { id: 'thighR', hollow: true, label: '右大腿壳', mesh: 'thighR', mat: 'PETG', layer: 0.16, note: '竖放，髋端朝下' },
  { id: 'shinL', hollow: true, label: '左小腿壳', mesh: 'shinL', mat: 'PETG', layer: 0.16, note: '竖放，膝端朝上' },
  { id: 'shinR', hollow: true, label: '右小腿壳', mesh: 'shinR', mat: 'PETG', layer: 0.16, note: '竖放，膝端朝上' },
  { id: 'footL', hollow: true, label: '左脚掌', mesh: 'footShellL', mat: 'PETG', layer: 0.2, note: '蹼面朝下平放，趾间悬空处少量支撑' },
  { id: 'footR', hollow: true, label: '右脚掌', mesh: 'footShellR', mat: 'PETG', layer: 0.2, note: '与左脚同姿态' },
  { id: 'soleL', label: '左蹼底', mesh: 'soleL', mat: 'TPU 85A', layer: 0.24, note: 'TPU 耐磨底，1.2 倍线宽挤出' },
  { id: 'soleR', label: '右蹼底', mesh: 'soleR', mat: 'TPU 85A', layer: 0.24, note: 'TPU，与左脚镜像' },
  { id: 'bootL', hollow: true, label: '左踝罩', mesh: 'bootL', mat: 'PETG', layer: 0.16, note: '罩住踝部两只舵机，开口朝上' },
  { id: 'bootR', hollow: true, label: '右踝罩', mesh: 'bootR', mat: 'PETG', layer: 0.16, note: '与左罩镜像' },
  { id: 'bezelL', thin: true, label: '左镜筒', mesh: 'eyeBezelL', mat: 'PETG', layer: 0.12, note: '竖放，锥口朝上；内壁 0.1 层高更细腻' },
  { id: 'bezelR', thin: true, label: '右镜筒', mesh: 'eyeBezelR', mat: 'PETG', layer: 0.12, note: '与左镜筒同姿态' },
  { id: 'panel', thin: true, label: '胸前面板', mesh: 'nfcPad', mat: 'PETG', layer: 0.16, note: '贴面件，背面双面胶；NFC 天线位于其后 3 mm' },
  { id: 'deck', optional: true, hollow: true, label: '轮滑底板（选配）', mesh: 'deck', mat: 'PETG', layer: 0.24,
    note: '底面朝下，轮轴孔桥接；不打印则整机为纯双足' },
];

/* ---------- 几何量算 ---------- */

function triIter(geo, matrix, cb) {
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : null;
  const count = idx ? idx.length : pos.count;
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 }, c = { x: 0, y: 0, z: 0 };
  const v = [a, b, c];
  for (let i = 0; i < count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const j = idx ? idx[i + k] : i + k;
      const p = v[k];
      p.x = pos.getX(j); p.y = pos.getY(j); p.z = pos.getZ(j);
      if (matrix) {
        const m = matrix.elements;
        const x = p.x, y = p.y, z = p.z;
        p.x = m[0] * x + m[4] * y + m[8] * z + m[12];
        p.y = m[1] * x + m[5] * y + m[9] * z + m[13];
        p.z = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
    }
    cb(a, b, c);
  }
}

/* 表面积（cm²）与包围盒（cm），可选按世界 y 取带 */
export function measureGeo(geo, matrix, band) {
  let area = 0, vol = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  triIter(geo, matrix, (a, b, c) => {
    const cy = (a.y + b.y + c.y) / 3;
    if (band && (cy < band[0] || cy > band[1])) return;
    // 面积
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) / 2;
    // 有向体积（闭合网格才准，敞口件只作参考）
    vol += (a.x * (b.y * c.z - b.z * c.y)
      - a.y * (b.x * c.z - b.z * c.x)
      + a.z * (b.x * c.y - b.y * c.x)) / 6;
    for (const p of [a, b, c]) {
      min[0] = Math.min(min[0], p.x); max[0] = Math.max(max[0], p.x);
      min[1] = Math.min(min[1], p.y); max[1] = Math.max(max[1], p.y);
      min[2] = Math.min(min[2], p.z); max[2] = Math.max(max[2], p.z);
    }
  });
  return {
    area, volume: Math.abs(vol),
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    min, max,
  };
}

/* 悬垂面积占比：法线朝下且比 45° 更平的面需要支撑。
 * 返回 0..1，是"这块面积里有多少悬在空气上"的直接度量。 */
export function overhangFraction(geo, matrix) {
  let total = 0, over = 0;
  triIter(geo, matrix, (a, b, c) => {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    const ar = len / 2;
    total += ar;
    if (ny / len < -0.707) over += ar;
  });
  return total > 0 ? over / total : 0;
}

/* 摆向：在六个轴对里挑一个"高度最小、底面最大"的姿态。
 * 这是打印摆件的通用取舍 —— 矮 = 稳、底面大 = 附着好、要支撑的少。 */
const ORIENTS = [
  { id: 'asis', label: '按模型姿态', m: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
  { id: 'back', label: '侧躺 90°', m: [1, 0, 0, 0, 0, -1, 0, 1, 0] },
  { id: 'face', label: '前倾 90°', m: [0, 0, 1, 0, 1, 0, -1, 0, 0] },
  { id: 'up', label: '倒扣', m: [-1, 0, 0, 0, -1, 0, 0, 0, 1] },
];

function mat3(THREE, arr) {
  const m = new THREE.Matrix4();
  m.set(arr[0], arr[1], arr[2], 0, arr[3], arr[4], arr[5], 0, arr[6], arr[7], arr[8], 0, 0, 0, 0, 1);
  return m;
}

/* ---------- 主测量 ---------- */

export function measureParts(THREE, duck) {
  duck.root.updateMatrixWorld(true);
  const out = [];

  for (const p of PARTS) {
    const obj = duck.root.getObjectByName(p.mesh);
    if (!obj) { out.push({ ...p, error: '缺网格 ' + p.mesh }); continue; }

    const world = obj.matrixWorld.clone();
    // 分件按世界 y 切带：局部矩阵先套上，再按世界 y 过滤
    const st = measureGeo(obj.geometry, world, p.band);
    if (!(st.area > 0)) { out.push({ ...p, error: '该高度带内没有面' }); continue; }

    /* 找最好的摆向 */
    let best = null;
    for (const o of ORIENTS) {
      const m = new THREE.Matrix4().multiplyMatrices(mat3(THREE, o.m), world);
      const s = measureGeo(obj.geometry, m, p.band);
      const oh = overhangFraction(obj.geometry, m);
      // 高越小越好，悬垂越少越好；底面（最薄那一维）要够大才贴得住
      const score = s.size[1] * 1.0 + oh * 12 - Math.min(s.size[0], s.size[2]) * 0.35;
      if (!best || score < best.score) best = { o, s, oh, score };
    }

    /* 壳件按"表面积 × 壁厚"估料，实心件按体积。
     * 这个区分不是为了好看：壳件的网格是一张实心旋转体（建模时没挖空），
     * 直接取体积会把 130 g 的机身壳算成 1.2 kg。 */
    /* 三种料量模型：
     *   shell  挖空打印，按表面积 × 2.4 mm 壁厚算
     *   thin   薄壁附件（镜筒、面板），按 1.2 mm 单壁算
     *   solid  实心件，按体积 × 95% 算 */
    const shellLike = !!p.hollow;
    const density = /TPU/.test(p.mat) ? 1.21 : 1.27;      // g/cm³
    const solid = shellLike ? st.area * WALL
      : p.thin ? st.area * 0.12
        : st.volume;
    const grams = solid * density * (p.thin ? 1.0 : shellLike ? 1.12 : 0.95);

    const size = best.s.size.map((v) => v * 10);          // mm
    const fits = size[0] <= BED.x * 10 && size[2] <= BED.y * 10 && size[1] <= BED.z * 10;

    out.push({
      ...p,
      size,
      volume: st.volume,
      area: st.area,
      grams,
      orient: best.o.label,
      overhang: best.oh,
      support: best.oh > 0.06 ? '树状支撑' : best.oh > 0.02 ? '局部支撑' : '免支撑',
      fits,
      bedUse: (size[0] / (BED.x * 10)) * (size[2] / (BED.y * 10)),
    });
  }

  const ok = out.filter((r) => !r.error);
  const core = ok.filter((r) => !r.optional);
  return {
    parts: out,
    summary: {
      count: ok.length,
      materials: [...new Set(ok.map((r) => r.mat))],
      grams: ok.reduce((s, r) => s + r.grams, 0),
      gramsCore: core.reduce((s, r) => s + r.grams, 0),
      optionalGrams: ok.filter((r) => r.optional).reduce((s, r) => s + r.grams, 0),
      oversize: ok.filter((r) => !r.fits).length,
      needSupport: ok.filter((r) => r.support !== '免支撑').length,
    },
  };
}
