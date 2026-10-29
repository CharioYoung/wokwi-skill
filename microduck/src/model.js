/* ==================================================================== *
 * Microduck — 双足鸭形机器人，参数化 three.js 模型
 *
 * 单位是厘米（1 unit = 1 cm），Y 轴向上，鸭嘴朝 +Z。
 * 整机 高 25 / 宽 14 / 深约 19（含鸭嘴与尾羽）。
 *
 * 为什么是"参数化"而不是导入 GLB：这份模型的用途是给外观评审看，
 * 每一处比例都要能改一行数字就重跑，而不是回建模软件里拖。
 * 所以先有一段 PROPORTION，所有关键尺寸都从那里取。
 *
 * 自由度合计 15：
 *   腿 ×2  = 髋偏航 / 髋俯仰 / 膝 / 踝俯仰 / 踝侧倾   → 10
 *   颈     = 俯仰 / 偏航                              →  2
 *   头     = 俯仰                                     →  1
 *   喙     = 上颚 / 下颚                               →  2
 *                                                    = 15
 * ==================================================================== */

import { SERVO_JOINTS } from './joints.js';

const DEG = Math.PI / 180;

/* 整机比例。改这里就能整体调体型，别去散着改下面每个零件。 */
export const PROPORTION = {
  totalH: 25,
  bodyBottom: 4.0, bodyTop: 14.6, bodyR: 6.42, bodyDepthK: 1.10,
  hipY: 5.45, thigh: 2.30, shin: 2.10, ankleY: 0.95,
  headCY: 21.1, headR: 3.95,
  footScale: 1.28,
};

/* ---------- 几何小工具 ---------- */

/* 旋转体：给一串 [y, r] 关键点，用 Catmull-Rom 采样成光滑侧面再绕 Y 旋成体。
 * 鸭子身上没有一条直线，靠一堆球拼会看到接缝，旋转体是最省事的光滑解。 */
function lathe(THREE, profile, opts) {
  const o = opts || {};
  const pts = profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0002), y));
  const curve = new THREE.SplineCurve(pts);
  const sampled = curve.getPoints(o.samples || 56).map(
    (v) => new THREE.Vector2(Math.max(v.x, 0.0002), v.y)
  );
  const geo = new THREE.LatheGeometry(sampled, o.segs || 56);
  if (o.sx || o.sz) geo.scale(o.sx || 1, 1, o.sz || 1);
  geo.computeVertexNormals();
  return geo;
}

/* 放样：一串椭圆截面沿 +Z 串起来，用于鸭嘴、翅膀、尾巴这类"一头粗一头细"的东西。
 * 每个截面 { z, cx, cy, rx, ry, roll }，首尾自动封口。 */
function loft(THREE, sections, radial) {
  const R = radial || 28;
  const pos = [];
  const idx = [];
  sections.forEach((s) => {
    const cx = s.cx || 0, cy = s.cy || 0, roll = s.roll || 0;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2;
      const x = Math.cos(a) * s.rx;
      const y = Math.sin(a) * s.ry;
      pos.push(cx + x * cr - y * sr, cy + x * sr + y * cr, s.z);
    }
  });
  for (let i = 0; i < sections.length - 1; i++) {
    const a = i * R, b = (i + 1) * R;
    for (let j = 0; j < R; j++) {
      const j2 = (j + 1) % R;
      idx.push(a + j, b + j, b + j2);
      idx.push(a + j, b + j2, a + j2);
    }
  }
  const first = sections[0], last = sections[sections.length - 1];
  const c0 = pos.length / 3;
  pos.push(first.cx || 0, first.cy || 0, first.z);
  for (let j = 0; j < R; j++) idx.push(c0, (j + 1) % R, j);
  const c1 = pos.length / 3;
  pos.push(last.cx || 0, last.cy || 0, last.z);
  const base = (sections.length - 1) * R;
  for (let j = 0; j < R; j++) idx.push(c1, base + j, base + ((j + 1) % R));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* 圆角盒：extrude + bevel 就是最省事的倒角机。宽高是外廓尺寸，
 * 厚度 d 里要扣掉两端的 bevelThickness，否则成品会比标称厚两个 r。 */
function roundedBox(THREE, w, h, d, r, seg) {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const s = new THREE.Shape();
  const x = w / 2 - rr, y = h / 2 - rr;
  s.moveTo(-x, -h / 2);
  s.lineTo(x, -h / 2);
  s.absarc(x, -y, rr, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, y);
  s.absarc(x, y, rr, 0, Math.PI / 2, false);
  s.lineTo(-x, h / 2);
  s.absarc(-x, y, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -y);
  s.absarc(-x, -y, rr, Math.PI, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, d - 2 * rr),
    bevelEnabled: true,
    bevelSize: rr * 0.95,
    bevelThickness: rr * 0.95,
    bevelSegments: seg || 4,
    curveSegments: 10,
    steps: 1,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/* 鸭蹼：三段蹼叶 + 蹼膜，是"这是一只鸭"最容易被认出来的一个形。
 * 轮廓画在 XY 平面上，+Y 是脚尖方向。 */
function webbedFootShape(THREE, scale) {
  const k = scale || 1;
  const s = new THREE.Shape();
  const p = (x, y) => [x * k, y * k];
  let q = p(0, -1.55); s.moveTo(q[0], q[1]);
  q = p(1.45, -1.5); s.quadraticCurveTo(q[0], q[1], 1.5 * k, -0.1 * k);
  q = p(1.95, 2.45); s.lineTo(q[0], q[1]);
  s.quadraticCurveTo(2.15 * k, 2.75 * k, 1.75 * k, 2.8 * k);
  s.quadraticCurveTo(1.5 * k, 2.15 * k, 0.95 * k, 1.35 * k);
  s.quadraticCurveTo(0.42 * k, 3.5 * k, 0, 3.55 * k);
  s.quadraticCurveTo(-0.42 * k, 3.5 * k, -0.95 * k, 1.35 * k);
  s.quadraticCurveTo(-1.5 * k, 2.15 * k, -1.75 * k, 2.8 * k);
  s.quadraticCurveTo(-2.15 * k, 2.75 * k, -1.95 * k, 2.45 * k);
  q = p(-1.5, -0.1); s.lineTo(q[0], q[1]);
  s.quadraticCurveTo(-1.45 * k, -1.5 * k, 0, -1.55 * k);
  return s;
}

function footGeometry(THREE, scale, thickness, bevel) {
  const geo = new THREE.ExtrudeGeometry(webbedFootShape(THREE, scale), {
    depth: Math.max(0.02, thickness - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 14,
    steps: 1,
  });
  // 从 XY 平面躺到地面。rotateX(-90°) 把形状的 +Y 送到 -Z，而机头在 +Z，
  // 于是脚尖朝着屁股 —— 必须先转正再落下，否则整只鸭子在往后走。
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);   // 底面严格落在 y=0
  geo.computeVertexNormals();
  return geo;
}

/* ---------- 配色 ---------- */

export const COLORWAYS = {
  cream: { name: '奶油白', shell: '#f3eee2', shell2: '#e6ddca', accent: '#f5912c', led: '#6fdcff' },
  graphite: { name: '石墨灰', shell: '#4b5057', shell2: '#3b3f45', accent: '#f5912c', led: '#6fdcff' },
  lavender: { name: '薰衣草紫', shell: '#b8a6e2', shell2: '#a291cf', accent: '#ffcf5c', led: '#a9ecff' },
  sky: { name: '天空蓝', shell: '#8ec7ea', shell2: '#79b3d7', accent: '#ff8a5c', led: '#c9f4ff' },
};

function makeMaterials(THREE) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    // 哑光 3D 打印外壳：粗糙度高、镜面反射弱，才会像塑料而不是陶瓷
    shell: std({ color: '#f3eee2', roughness: 0.84, metalness: 0.02 }),
    shell2: std({ color: '#e6ddca', roughness: 0.88, metalness: 0.02 }),
    accent: std({ color: '#f5912c', roughness: 0.68, metalness: 0.03 }),
    // TPU 软垫：更暗更糙，几乎不反光
    tpu: std({ color: '#2b2e34', roughness: 0.96, metalness: 0.0 }),
    joint: std({ color: '#35383e', roughness: 0.6, metalness: 0.15 }),
    metal: std({ color: '#b9bfc7', roughness: 0.3, metalness: 0.92 }),
    dark: std({ color: '#14161a', roughness: 0.42, metalness: 0.1 }),
    // 镜头：一颗大半球玻璃，配一圈自发光虹膜，90 年代电子宠物的"眼神"
    glass: new THREE.MeshPhysicalMaterial({
      color: '#070a10', roughness: 0.05, metalness: 0.25,
      clearcoat: 1, clearcoatRoughness: 0.04,
    }),
    iris: std({ color: '#0a2a33', emissive: '#59d8ff', emissiveIntensity: 1.6, roughness: 0.35 }),
    led: std({ color: '#0a1a20', emissive: '#7fe3ff', emissiveIntensity: 1.8, roughness: 0.4 }),

    /* 内部件：只在"透视 / 剖切"下出现，所以不怕深色，越深越能跟壳分开 */
    pcb: std({ color: '#1d4034', roughness: 0.72, metalness: 0.08 }),
    pcb2: std({ color: '#243a52', roughness: 0.72, metalness: 0.08 }),
    chip: std({ color: '#0d1014', roughness: 0.44, metalness: 0.28 }),
    copper: std({ color: '#b87333', roughness: 0.34, metalness: 0.85 }),

    /* 线束：自发光，才在一堆深色器件里看得清走向 */
    wirePwr: new THREE.MeshBasicMaterial({ color: '#ff6b3d' }),
    wireBus: new THREE.MeshBasicMaterial({ color: '#4fd8ff' }),
    wireCam: new THREE.MeshBasicMaterial({ color: '#c48bff' }),
    wireI2c: new THREE.MeshBasicMaterial({ color: '#6ef2a6' }),
    wireAud: new THREE.MeshBasicMaterial({ color: '#ffd24a' }),
  };
}

/* ---------- 主体 ---------- */

export function buildMicroduck(THREE, opts) {
  const o = opts || {};
  const P = PROPORTION;
  const M = makeMaterials(THREE);
  const root = new THREE.Group();
  root.name = 'Microduck';

  const add = (parent, geo, mat, pos, rot, name) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (name) m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* 躯干。最鼓的一圈压在 y≈9.3，比几何中心更低 —— 这是"站姿低矮、
   * 重心偏下"在模型上唯一能看见的地方。 */
  const bodyPivot = new THREE.Group();      // 整机起伏 / 前后倾 / 横滚
  bodyPivot.name = 'bodyPivot';
  root.add(bodyPivot);

  const torso = new THREE.Group();
  torso.name = 'torso';
  bodyPivot.add(torso);

  const bodyGeo = lathe(THREE, [
    [P.bodyBottom, 0.0002], [P.bodyBottom + 0.35, 3.7], [P.bodyBottom + 1.15, 5.5],
    [P.bodyBottom + 2.2, 6.2], [7.6, 6.4], [9.3, P.bodyR], [11.0, 6.28],
    [12.3, 5.85], [13.5, 5.0], [14.3, 3.6], [P.bodyTop, 0.0002],
  ], { sz: P.bodyDepthK, segs: 64 });
  add(torso, bodyGeo, M.shell, [0, 0, 0], null, 'body');

  /* 身子就是一整块，不再套一层"护板"。旋转体套旋转体必然在上下缘各留一圈台阶，
   * 那一圈台阶在人眼里就是腰带 —— 先看到腰带，才看到鸭子。 */

  // 分模线：一圈浅沟，说明这是上下分件打印的
  add(torso, new THREE.TorusGeometry(6.34, 0.1, 8, 96), M.shell2, [0, 7.55, 0], [Math.PI / 2, 0, 0], 'seam')
    .scale.set(1.008, P.bodyDepthK, 1);

  /* ---- 颈 ---- */
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 14.0, 0.35);
  neckPivot.name = 'neck';
  torso.add(neckPivot);

  add(neckPivot, lathe(THREE, [
    [-1.1, 0.0002], [-0.8, 2.7], [-0.1, 2.52], [1.0, 2.38], [2.2, 2.3], [3.0, 2.22], [3.45, 1.6], [3.6, 0.0002],
  ], { segs: 40, sz: 1.04 }), M.shell, [0, 0, 0.25], null, 'neckShell');

  // 颈部关节环：露出一圈机械结构，是"机器人"而不是"玩具鸭"的信号
  add(neckPivot, new THREE.TorusGeometry(2.34, 0.26, 10, 32), M.joint, [0, 1.15, 0.25], [Math.PI / 2, 0, 0], 'neckRing');

  /* ---- 头 ---- */
  const head = new THREE.Group();
  head.position.set(0, P.headCY - 14.0, 1.35);
  head.name = 'head';
  neckPivot.add(head);

  add(head, lathe(THREE, [
    [-3.72, 0.0002], [-3.32, 2.95], [-2.6, 3.62], [-1.5, 3.9], [-0.2, 3.96],
    [1.1, 3.86], [2.2, 3.5], [3.0, 2.9], [3.6, 1.75], [3.92, 0.0002],
  ], { sx: 1.0, sz: 1.08, segs: 56 }), M.shell, [0, 0, 0], null, 'headShell');

  // 后脑勺散热鳍，顺便挡住壳体的收口
  for (let i = 0; i < 3; i++) {
    add(head, roundedBox(THREE, 3.2 - i * 0.55, 0.3, 0.5, 0.14), M.shell2,
      [0, 0.6 + i * 0.62, -3.15 + i * 0.16], [0.42, 0, 0], 'gill' + i);
  }

  /* 两只眼。规格里的"单目摄像头"说的是视觉方案只有一颗摄像头，
   * 不是脸上只长一只眼 —— 鸭子的脸天生是左右对称的，少一只眼立刻变怪物。
   * 所以左眼是真摄像头（后面有一颗 CM4 模组），右眼是红外补光 + 对称装饰镜，
   * 两颗做成同款镜筒，正面看过去才不歪。
   *
   * 位置放在头壳的斜前侧（鸭子眼睛本来就偏在两侧），镜筒沿表面法线伸出。
   * 镜座做成外小内大的锥形，内端埋进壳里，凸面上才不会有缝。 */
  function buildEye(side) {
    const g = new THREE.Group();
    g.position.set(side * 1.95, 1.15, 2.55);
    g.rotation.y = side * 0.55;
    g.name = side < 0 ? 'eyeL' : 'eyeR';
    head.add(g);

    add(g, new THREE.CylinderGeometry(1.55, 1.95, 1.9, 40), M.shell2,
      [0, 0, -0.2], [Math.PI / 2, 0, 0], 'eyeBezel' + (side < 0 ? 'L' : 'R'));
    add(g, new THREE.TorusGeometry(1.56, 0.11, 10, 44), M.metal,
      [0, 0, 0.72], null, 'eyeRingMetal' + (side < 0 ? 'L' : 'R'));

    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), M.glass);
    glass.rotation.x = Math.PI / 2;
    glass.position.set(0, 0, 0.64);
    glass.scale.set(1, 1, 0.66);
    glass.name = 'eyeGlass' + (side < 0 ? 'L' : 'R');
    glass.castShadow = false;
    g.add(glass);

    add(g, new THREE.TorusGeometry(0.98, 0.2, 12, 36), M.iris, [0, 0, 0.95], null, 'iris' + (side < 0 ? 'L' : 'R'));
    add(g, new THREE.CircleGeometry(0.5, 26), M.dark, [0, 0, 1.0], null, 'pupil' + (side < 0 ? 'L' : 'R'));
    add(g, new THREE.CircleGeometry(0.21, 16), M.led, [0.4, 0.44, 1.03], null, 'catchlight' + (side < 0 ? 'L' : 'R'));
    return g;
  }
  const eyeL = buildEye(-1);
  const eyeR = buildEye(1);
  // 旧代码里 dof.eye 是单只，这里留着指向左眼，眨眼时两只一起动
  const eye = eyeL;

  // 眉骨：两道浅弧，压在眼睛上方。没有它，两只眼就是两个圆洞
  [-1, 1].forEach((s) => {
    add(head, roundedBox(THREE, 2.5, 0.36, 0.6, 0.16, 3), M.shell2,
      [s * 1.85, 2.42, 2.62], [0.34, s * 0.5, s * 0.22], 'brow' + s);
  });


  // LiDAR 视窗：额头一道横缝，深色玻璃
  add(head, roundedBox(THREE, 3.1, 0.64, 0.4, 0.2, 3), M.dark, [0, 3.45, 1.15], [0.5, 0, 0], 'lidar');
  add(head, roundedBox(THREE, 3.3, 0.2, 0.28, 0.09, 2), M.accent, [0, 3.19, 1.1], [0.5, 0, 0], 'lidarTrim');

  // 麦克风孔 ×2
  [-1, 1].forEach((s, i) => {
    add(head, new THREE.CylinderGeometry(0.24, 0.24, 0.28, 16), M.dark, [s * 2.5, -1.15, 2.55], [Math.PI / 2, 0, 0], 'mic' + i);
  });

  /* ---- 铰接式鸭嘴夹爪 ---- */
  const beakUpper = new THREE.Group();
  beakUpper.position.set(0, -1.34, 2.3);
  beakUpper.rotation.x = 0.1;
  beakUpper.name = 'beakUpper';
  head.add(beakUpper);
  add(beakUpper, loft(THREE, [
    { z: 0.0, cy: 0.06, rx: 3.02, ry: 0.84 },
    { z: 1.6, cy: 0.0, rx: 3.3, ry: 0.9 },
    { z: 3.4, cy: -0.18, rx: 3.2, ry: 0.8 },
    { z: 5.0, cy: -0.46, rx: 2.7, ry: 0.62 },
    { z: 6.0, cy: -0.72, rx: 1.8, ry: 0.4 },
    { z: 6.4, cy: -0.88, rx: 0.62, ry: 0.14 },
  ], 32), M.accent, [0, 0, 0], null, 'beakUpperShell');
  add(beakUpper, loft(THREE, [
    { z: 0.15, cy: -0.5, rx: 2.25, ry: 0.15 },
    { z: 2.0, cy: -0.58, rx: 2.3, ry: 0.15 },
    { z: 3.8, cy: -0.78, rx: 1.95, ry: 0.13 },
    { z: 4.9, cy: -0.94, rx: 1.0, ry: 0.09 },
  ], 20), M.tpu, [0, 0, 0], null, 'beakUpperPad');
  add(beakUpper, new THREE.CylinderGeometry(0.42, 0.42, 4.4, 20), M.metal, [0, 0, -0.14], [0, 0, Math.PI / 2], 'beakHingeUpper');

  const beakLower = new THREE.Group();
  beakLower.position.set(0, -2.22, 2.26);
  beakLower.rotation.x = 0.1;
  beakLower.name = 'beakLower';
  head.add(beakLower);
  add(beakLower, loft(THREE, [
    { z: 0.0, cy: 0.0, rx: 2.6, ry: 0.52 },
    { z: 1.5, cy: -0.02, rx: 2.85, ry: 0.57 },
    { z: 3.1, cy: -0.2, rx: 2.75, ry: 0.49 },
    { z: 4.4, cy: -0.44, rx: 2.3, ry: 0.35 },
    { z: 5.15, cy: -0.64, rx: 1.2, ry: 0.16 },
  ], 30), M.shell2, [0, 0, 0], null, 'beakLowerShell');
  add(beakLower, loft(THREE, [
    { z: 0.15, cy: 0.38, rx: 1.95, ry: 0.12 },
    { z: 2.2, cy: 0.3, rx: 2.0, ry: 0.12 },
    { z: 3.6, cy: 0.1, rx: 1.5, ry: 0.09 },
  ], 18), M.tpu, [0, 0, 0], null, 'beakLowerPad');
  add(beakLower, new THREE.CylinderGeometry(0.34, 0.34, 3.5, 18), M.metal, [0, 0, -0.24], [0, 0, Math.PI / 2], 'beakHingeLower');

  /* ---- 翅膀：贴着侧腹的折叠翅，肩高尾尖，往外鼓出一圈才读得出是翅膀 ---- */
  const wingGeo = (side) => loft(THREE, [
    { z: -4.6, cx: side * 4.55, cy: 9.2, rx: 0.35, ry: 0.8 },
    { z: -3.0, cx: side * 5.36, cy: 9.5, rx: 1.0, ry: 2.1 },
    { z: -1.0, cx: side * 5.74, cy: 9.9, rx: 1.26, ry: 2.9 },
    { z: 1.2, cx: side * 5.78, cy: 10.1, rx: 1.22, ry: 3.1 },
    { z: 3.1, cx: side * 5.6, cy: 10.3, rx: 1.08, ry: 2.6 },
    { z: 4.4, cx: side * 5.3, cy: 10.4, rx: 0.6, ry: 1.35 },
    { z: 4.95, cx: side * 5.15, cy: 10.5, rx: 0.16, ry: 0.42 },
  ], 26);

  const wingL = add(torso, wingGeo(-1), M.shell2, [0, 0, 0], null, 'wingL');
  const wingR = add(torso, wingGeo(1), M.shell2, [0, 0, 0], null, 'wingR');
  // 翅根一圈配色环：翅膀是独立分件，也是 90 年代玩具最爱描的那道边
  [-1, 1].forEach((s) => {
    const ring = add(torso, new THREE.TorusGeometry(1.62, 0.13, 8, 40), M.accent,
      [s * 5.62, 10.35, 0.35], [0, Math.PI / 2, 0], 'wingRim' + s);
    ring.scale.set(1, 1, 1.42);
  });

  /* ---- 尾羽 ---- */
  const tail = new THREE.Group();
  tail.position.set(0, 11.4, -5.7);
  tail.name = 'tail';
  torso.add(tail);
  add(tail, loft(THREE, [
    { z: 0.5, cy: 0, rx: 3.1, ry: 1.75 },
    { z: -1.2, cy: 0.55, rx: 3.55, ry: 1.6 },
    { z: -2.7, cy: 1.3, rx: 3.2, ry: 1.18 },
    { z: -3.9, cy: 2.1, rx: 2.55, ry: 0.72 },
    { z: -4.6, cy: 2.6, rx: 1.75, ry: 0.38 },
    { z: -4.95, cy: 2.85, rx: 0.95, ry: 0.18 },
  ], 28), M.shell, [0, 0, 0], null, 'tailShell');

  /* ---- 胸口：扬声器格栅 / NFC / 状态灯 ---- */
  for (let i = 0; i < 4; i++) {
    add(torso, roundedBox(THREE, 4.4 - i * 0.2, 0.26, 0.32, 0.1, 2), M.dark,
      [0, 12.35 - i * 0.5, 5.86 + i * 0.02], [0.2 + i * 0.04, 0, 0], 'speaker' + i);
  }
  add(torso, roundedBox(THREE, 4.0, 2.3, 0.3, 0.14, 3), M.accent, [0, 8.95, 6.3], [0.16, 0, 0], 'nfcPad');
  add(torso, new THREE.TorusGeometry(0.7, 0.09, 8, 24), M.dark, [0, 8.95, 6.44], [0.16, 0, 0], 'nfcRing');
  [-1, 0, 1].forEach((s, i) => {
    add(torso, new THREE.SphereGeometry(0.19, 12, 8), M.led, [s * 1.15, 13.55, 5.5], null, 'status' + i);
  });

  /* ---- 电池：NP-F550，从背后插进去，只露一条缝 ---- */
  const battery = new THREE.Group();
  battery.position.set(0, 10.5, -6.55);
  battery.name = 'battery';
  torso.add(battery);
  add(battery, roundedBox(THREE, 6.9, 3.9, 0.55, 0.12, 2), M.dark, [0, 0, 0.05], [0.06, 0, 0], 'batterySlot');
  add(battery, roundedBox(THREE, 6.5, 3.5, 1.7, 0.2, 3), M.shell2, [0, 0, -0.28], [0.06, 0, 0], 'batteryPack');
  add(battery, roundedBox(THREE, 4.6, 0.42, 0.22, 0.09, 2), M.metal, [0, 0.95, -1.16], [0.06, 0, 0], 'batteryContact');
  add(battery, roundedBox(THREE, 1.6, 0.3, 0.24, 0.1, 2), M.accent, [0, -1.5, -1.16], [0.06, 0, 0], 'batteryLatch');

  /* ==================================================================== *
   * 内部：器件布局与布线
   *
   * 这一层默认隐藏。上一版把电子部分整个丢了，只剩一张外观图 ——
   * 但外观图只能证明"看起来像鸭子"，证明不了"里面装得下 15 个舵机和
   * 一块 RK3566"。所以按实际装配关系摆一遍：主控在中腔、电池在后腔、
   * 电源与舵机总线在下腔、传感件贴着各自的窗口、线束按总线类型分色。
   * ==================================================================== */
  const internals = new THREE.Group();
  internals.name = 'internals';
  internals.visible = false;
  torso.add(internals);

  const put = (parent, geo, mat, pos, rot, name) => add(parent, geo, mat, pos, rot, name);

  /* ---- 主控：RK3566 核心板 + SoC + eMMC + 无线模组 ---- */
  put(internals, roundedBox(THREE, 8.4, 0.42, 5.6, 0.12, 2), M.pcb, [0, 10.6, -1.4], null, 'mb');
  put(internals, roundedBox(THREE, 3.0, 0.46, 3.0, 0.08, 2), M.chip, [-1.5, 10.95, -1.7], null, 'soc');
  put(internals, new THREE.BoxGeometry(2.0, 0.26, 1.5), M.chip, [2.1, 10.88, -0.9], null, 'emmc');
  put(internals, new THREE.BoxGeometry(1.9, 0.22, 1.4), M.chip, [2.1, 10.86, -2.7], null, 'wifiModule');
  // 天线：贴在腔体后壁上的一小片，不是一块板
  put(internals, new THREE.BoxGeometry(3.6, 0.12, 0.5), M.copper, [0, 11.6, -3.9], [0.24, 0, 0], 'antenna');
  // 散热片压在 SoC 上
  for (let i = 0; i < 5; i++) {
    put(internals, new THREE.BoxGeometry(3.2, 0.52, 0.16), M.metal,
      [-1.5, 11.28, -3.0 + i * 0.62], null, 'heatsink' + i);
  }

  /* ---- 电源：分配板 + 保险 + DC-DC ---- */
  put(internals, roundedBox(THREE, 5.4, 0.34, 3.4, 0.1, 2), M.pcb2, [0, 7.7, -2.6], null, 'powerBoard');
  put(internals, new THREE.BoxGeometry(1.4, 0.5, 1.0), M.chip, [-1.6, 8.05, -3.1], null, 'dcdc');
  put(internals, new THREE.BoxGeometry(0.9, 0.36, 0.5), M.chip, [1.5, 8.0, -2.2], null, 'fuse');

  /* ---- 舵机总线板：15 个关节都挂在这一块上，50 Hz 一帧广播 ---- */
  put(internals, roundedBox(THREE, 4.6, 0.34, 2.8, 0.1, 2), M.pcb2, [0, 6.4, 0.6], null, 'servoBoard');
  put(internals, new THREE.BoxGeometry(1.2, 0.4, 0.9), M.chip, [-1.2, 6.7, 0.4], null, 'servoMcu');
  // 六个腿部接口，两侧各三个
  [-1, 1].forEach((s) => {
    for (let i = 0; i < 3; i++) {
      put(internals, new THREE.BoxGeometry(0.5, 0.3, 0.6), M.copper,
        [s * 1.7, 6.68, -0.3 + i * 1.0], null, 'servoPort' + s + i);
    }
  });

  /* ---- 双 IMU：一颗在主板旁，一颗压在最底下（近地面，测的是机体真实加速度） ---- */
  put(internals, new THREE.BoxGeometry(1.0, 0.3, 1.0), M.chip, [3.1, 10.9, -3.1], null, 'imuA');
  put(internals, new THREE.BoxGeometry(1.0, 0.3, 1.0), M.chip, [0, 5.15, -2.6], null, 'imuB');

  /* ---- 音频：一颗朝前的扬声器 + 两颗拾音麦 ---- */
  put(internals, new THREE.CylinderGeometry(1.72, 1.72, 0.7, 26), M.chip, [0, 11.55, 3.55], [Math.PI / 2, 0, 0], 'speakerUnit');
  put(internals, new THREE.TorusGeometry(1.4, 0.13, 8, 30), M.copper, [0, 11.55, 3.95], null, 'speakerRing');
  [-1, 1].forEach((s) => {
    put(internals, new THREE.CylinderGeometry(0.32, 0.32, 0.42, 14), M.chip,
      [s * 2.2, 13.0, 3.9], [Math.PI / 2, 0, 0], 'micUnit' + s);
  });

  /* ---- 双 NFC：胸前面板后面并排两颗，刷卡区就是那块橙色面板 ---- */
  [-1, 1].forEach((s) => {
    put(internals, roundedBox(THREE, 2.6, 0.3, 1.8, 0.08, 2), M.pcb2,
      [s * 1.55, 9.1, 4.6], [0.16, 0, 0], 'nfcReader' + s);
    put(internals, new THREE.TorusGeometry(0.85, 0.1, 8, 26), M.copper,
      [s * 1.55, 9.16, 4.62], [0.16 + Math.PI / 2, 0, 0], 'nfcCoil' + s);
  });

  /* ---- 内骨架：颈不是悬在外壳上的。
   * 剖开看的时候，头和躯干之间必须有一根真实的立柱，
   * 否则内部图会读成"头掉下来了"。 ---- */
  put(internals, new THREE.CylinderGeometry(0.86, 0.98, 2.6, 20), M.joint, [0, 12.35, 0.15], null, 'spineBase');
  put(internals, new THREE.CylinderGeometry(0.52, 0.64, 1.5, 18), M.joint, [0, 13.6, 0.28], null, 'spineTop');
  put(neckPivot, new THREE.CylinderGeometry(0.44, 0.44, 3.0, 16), M.joint, [0, 1.9, 0.2], null, 'neckPost');

  /* ---- 头内：摄像头模组、LiDAR 模组、头/喙舵机 ---- */
  put(head, roundedBox(THREE, 2.6, 1.2, 0.8, 0.06, 2), M.pcb2, [0, 1.15, 1.35], null, 'camModule');
  put(head, new THREE.CylinderGeometry(0.85, 0.85, 0.9, 20), M.chip, [0, 1.15, 1.95], [Math.PI / 2, 0, 0], 'camLens');
  put(head, roundedBox(THREE, 1.9, 1.5, 1.7, 0.1, 2), M.chip, [0, 2.95, 0.55], null, 'lidarModule');
  put(head, new THREE.CylinderGeometry(0.55, 0.55, 0.5, 18), M.copper, [0, 2.95, 1.45], [Math.PI / 2, 0, 0], 'lidarDrum');
  put(head, new THREE.CylinderGeometry(0.62, 0.62, 1.7, 18), M.joint, [0, -1.9, 0.4], [0, 0, Math.PI / 2], 'headServo');
  put(neckPivot, new THREE.CylinderGeometry(0.72, 0.72, 2.0, 18), M.joint, [0, 1.6, 0.2], [0, 0, Math.PI / 2], 'neckServoY');
  put(neckPivot, new THREE.CylinderGeometry(0.66, 0.66, 1.8, 18), M.joint, [0, 1.0, -0.5], null, 'neckServoP');
  put(beakUpper, new THREE.CylinderGeometry(0.3, 0.3, 0.6, 14), M.joint, [0, 0.2, -0.5], [0, 0, Math.PI / 2], 'beakServoU');
  put(beakLower, new THREE.CylinderGeometry(0.28, 0.28, 0.55, 14), M.joint, [0, -0.2, -0.55], [0, 0, Math.PI / 2], 'beakServoL');

  /* ---- 线束：按总线类型分色，走最短路径但不穿器件 ---- */
  const wires = new THREE.Group();
  wires.name = 'wires';
  internals.add(wires);

  const cableCurves = [];
  function cable(name, pts, mat, r) {
    const curve = new THREE.CatmullRomCurve3(
      pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.4);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(24, pts.length * 10), r || 0.085, 6, false), mat);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    wires.add(mesh);
    cableCurves.push({ name, curve, mat });
    return mesh;
  }

  // 电源：电池 → 电源分配板 → 主控
  cable('wPowerBat', [[0, 10.4, -5.4], [0.6, 9.4, -4.6], [0.4, 8.3, -3.6], [0, 7.85, -3.4]], M.wirePwr, 0.13);
  cable('wPowerMb', [[0, 7.9, -2.9], [0.2, 8.8, -2.4], [0.6, 9.9, -2.0], [1.4, 10.45, -1.6]], M.wirePwr, 0.13);
  cable('wPowerServo', [[1.6, 7.75, -2.4], [1.9, 7.1, -1.2], [1.6, 6.75, 0.2]], M.wirePwr, 0.11);

  // 舵机总线：主控 → 舵机板 → 两侧髋关节，一条菊花链
  cable('wBusMb', [[3.6, 10.5, -1.2], [3.9, 9.4, -0.6], [3.4, 8.0, 0.1], [2.0, 6.85, 0.5]], M.wireBus, 0.1);
  cable('wBusL', [[-1.9, 6.6, 0.4], [-2.6, 6.2, 0.2], [-3.2, 5.8, 0.15], [-3.6, 5.55, 0.12]], M.wireBus, 0.1);
  cable('wBusR', [[1.9, 6.6, 0.4], [2.6, 6.2, 0.2], [3.2, 5.8, 0.15], [3.6, 5.55, 0.12]], M.wireBus, 0.1);
  // 往颈部的一路，从舵机板绕上去
  cable('wBusNeck', [[0.4, 6.7, 1.0], [0.2, 9.0, 1.6], [0, 12.0, 1.4], [0, 13.6, 0.8]], M.wireBus, 0.09);

  // 视频：主控 → 颈部 → 头部摄像头（只在颈根截止，颈内走线）
  cable('wCam', [[0, 10.6, 1.0], [0, 11.8, 1.5], [0, 13.2, 1.2], [0, 14.2, 0.6]], M.wireCam, 0.09);

  // I2C：两颗 IMU 与两颗 NFC 并到一条总线上
  cable('wI2cImuA', [[3.0, 10.8, -3.0], [2.6, 10.7, -2.4], [2.0, 10.62, -1.8]], M.wireI2c, 0.07);
  cable('wI2cImuB', [[0.4, 5.3, -2.6], [0.6, 6.6, -2.4], [0.8, 7.8, -2.3]], M.wireI2c, 0.07);
  cable('wI2cNfcL', [[-1.4, 9.3, 4.5], [-1.9, 9.8, 3.4], [-1.6, 10.3, 2.2], [-0.8, 10.55, 0.4]], M.wireI2c, 0.07);
  cable('wI2cNfcR', [[1.6, 9.3, 4.5], [2.1, 9.8, 3.4], [1.8, 10.3, 2.2], [1.2, 10.55, 0.4]], M.wireI2c, 0.07);

  // 音频：主控 → 扬声器 / 拾音麦
  cable('wAudSpk', [[0, 10.8, 1.2], [0, 11.2, 2.1], [0, 11.5, 3.0]], M.wireAud, 0.08);
  cable('wAudMic', [[-0.6, 10.9, 1.1], [-1.4, 12.0, 2.4], [-2.1, 12.8, 3.6]], M.wireAud, 0.06);

  /* 线束上跑的脉冲：不是装饰，是用来读出"信号往哪个方向走"。
   * 一个点沿曲线匀速走完，比一条静止的管子信息量大。 */
  const pulses = cableCurves.map(({ curve, mat }, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat);
    s.name = 'pulse' + i;
    s.castShadow = false;
    s.visible = false;
    curve.getPoint(0, s.position);     // 先落在起点，否则包围盒堆在原点
    wires.add(s);
    return { mesh: s, curve, t: Math.random() };
  });

  /* ---- 腿（每条 5 个自由度） ---- */
  const legs = {};
  [-1, 1].forEach((side) => {
    const key = side < 0 ? 'L' : 'R';
    const hip = new THREE.Group();
    hip.position.set(side * 3.5, P.hipY, 0.12);
    hip.name = 'hip' + key;
    torso.add(hip);

    add(hip, new THREE.CylinderGeometry(1.5, 1.5, 1.7, 26), M.shell2, [side * 0.1, 0, 0], [0, 0, Math.PI / 2], 'hipServo' + key);
    add(hip, new THREE.TorusGeometry(1.02, 0.15, 8, 24), M.joint, [side * 0.92, 0, 0], [0, Math.PI / 2, 0], 'hipRing' + key);
    /* 髋偏航舵机：竖着立在髋轴上方，藏在腹腔下缘。
     * 规格写的 15 自由度是 每腿 5 个（髋偏航/髋俯仰/膝/踝俯仰/踝侧倾），
     * 之前模型只做了髋俯仰和膝两个 —— 数一数就知道对不上，内部图里也没法数出 15 个。 */
    add(hip, new THREE.CylinderGeometry(0.86, 0.86, 1.5, 22), M.joint, [0, 0.98, 0], null, 'hipYawServo' + key);

    add(hip, lathe(THREE, [
      [-P.thigh, 0.0002], [-P.thigh + 0.25, 1.1], [-1.1, 1.52], [-0.3, 1.6], [0.35, 1.35], [0.5, 0.0002],
    ], { segs: 26 }), M.shell, [0, 0, 0], null, 'thigh' + key);

    const knee = new THREE.Group();
    knee.position.set(0, -P.thigh, 0);
    knee.name = 'knee' + key;
    hip.add(knee);
    add(knee, new THREE.CylinderGeometry(0.98, 0.98, 1.35, 22), M.joint, [0, 0, 0], [0, 0, Math.PI / 2], 'kneeServo' + key);

    add(knee, lathe(THREE, [
      [-P.shin, 0.0002], [-P.shin + 0.22, 0.9], [-1.05, 1.18], [-0.25, 1.26], [0.3, 1.05], [0.45, 0.0002],
    ], { segs: 24 }), M.shell, [0, 0, 0], null, 'shin' + key);

    const ankle = new THREE.Group();
    ankle.position.set(0, -P.shin, 0);
    ankle.name = 'ankle' + key;
    knee.add(ankle);
    add(ankle, new THREE.SphereGeometry(0.8, 18, 14), M.joint, [0, 0, 0], null, 'ankleBall' + key);
    /* 踝部两只小舵机：俯仰一个（横轴、在球后），侧倾一个（竖轴、压在脚背里）。
     * 9g 级的尺寸才塞得进 2.7 cm 宽的脚，所以半径都取 0.35~0.4。 */
    add(ankle, new THREE.CylinderGeometry(0.4, 0.4, 0.85, 18), M.joint, [0, 0.02, -0.52], [0, 0, Math.PI / 2], 'anklePitchServo' + key);
    add(ankle, new THREE.CylinderGeometry(0.34, 0.34, 0.6, 16), M.joint, [0, 0.34, 0.06], null, 'ankleRollServo' + key);

    /* 脚：外壳 + TPU 鞋底。蹼是这只鸭最容易被认出来的形。 */
    const foot = new THREE.Group();
    foot.position.set(0, -P.ankleY, 0.15);
    foot.rotation.y = side * 8 * DEG;
    foot.name = 'foot' + key;
    ankle.add(foot);
    add(foot, footGeometry(THREE, P.footScale, 0.95, 0.17), M.shell, [0, 0.28, 0.35], null, 'footShell' + key);
    add(foot, footGeometry(THREE, P.footScale * 1.03, 0.5, 0.12), M.tpu, [0, -0.02, 0.35], null, 'sole' + key);
    add(ankle, lathe(THREE, [
      [-0.6, 0.0002], [-0.5, 1.15], [0.25, 1.22], [0.75, 1.0], [0.9, 0.0002],
    ], { segs: 22 }), M.shell2, [0, -0.45, 0.02], null, 'boot' + key);

    legs[key] = { hip, knee, ankle, foot };
  });

  /* ---- 可拆卸轮滑底座 ---- */
  const skateboard = new THREE.Group();
  skateboard.name = 'skateboard';
  skateboard.visible = false;
  root.add(skateboard);
  add(skateboard, roundedBox(THREE, 13.6, 0.9, 17.0, 0.42, 3), M.shell2, [0, 0.62, 0.4], null, 'deck');
  add(skateboard, roundedBox(THREE, 11.6, 0.22, 15.0, 0.1, 2), M.tpu, [0, 1.08, 0.4], null, 'gripTape');
  [[-4.6, 5.6], [4.6, 5.6], [-4.6, -4.8], [4.6, -4.8]].forEach(([x, z], i) => {
    add(skateboard, new THREE.CylinderGeometry(1.02, 1.02, 0.8, 22), M.tpu, [x, 0.12, z], [0, 0, Math.PI / 2], 'wheel' + i);
    add(skateboard, new THREE.CylinderGeometry(0.4, 0.4, 0.9, 14), M.metal, [x, 0.12, z], [0, 0, Math.PI / 2], 'axle' + i);
  });

  /* ---- 标注锚点 ----
   * 两组：外观模式指外壳上的功能窗口，内部模式指腔体里真实的器件。
   * 内部锚点是世界坐标（root 空间），外观锚点用 root 空间同一套投影。 */
  const hotspots = [
    { id: 'camera', label: '摄像头（左眼）', note: '单目视觉，4.2 mm 广角', anchor: new THREE.Vector3(-2.1, 22.35, 4.9) },
    { id: 'eyeR', label: '右眼', note: '红外补光 + 对称装饰镜', anchor: new THREE.Vector3(2.1, 22.35, 4.9) },
    { id: 'lidar', label: 'LiDAR', note: '额前扫描窗，避障与 SLAM', anchor: new THREE.Vector3(0, 24.5, 2.9) },
    { id: 'beak', label: '鸭嘴夹爪', note: '上下颚铰接，TPU 软垫抓取', anchor: new THREE.Vector3(0, 19.4, 8.6) },
    { id: 'speaker', label: '扬声器 / 麦克风', note: '胸前格栅 + 双侧拾音孔', anchor: new THREE.Vector3(0, 11.9, 6.5) },
    { id: 'nfc', label: '双 NFC 读卡器', note: '胸前面板，刷卡片触发行为', anchor: new THREE.Vector3(0, 9.0, 6.7) },
    { id: 'battery', label: 'NP-F550 电池', note: '2600 mAh 可拆卸，约 1 小时', anchor: new THREE.Vector3(0, 10.5, -7.9) },
  ];

  // 内部锚点：位置取自上面实际摆的器件，不是估的
  const internalHotspots = [
    { id: 'mb', label: 'RK3566 主控板', note: '50 Hz 策略循环 · Wi-Fi/BT', anchor: new THREE.Vector3(0, 11.4, -1.4) },
    { id: 'soc', label: 'SoC + 散热片', note: '四核 A55，跑 PPO 策略', anchor: new THREE.Vector3(-1.5, 11.4, -1.7) },
    { id: 'power', label: '电源分配板', note: 'DC-DC · 保险 · 电量计', anchor: new THREE.Vector3(0, 8.0, -2.6) },
    { id: 'servobus', label: '舵机总线板', note: '15 路关节 · 一帧广播', anchor: new THREE.Vector3(0, 6.6, 0.6) },
    { id: 'imuA', label: 'IMU ×2', note: '主控旁一颗，近地一颗', anchor: new THREE.Vector3(3.1, 11.05, -3.1) },
    { id: 'nfcIn', label: 'NFC 读卡器 ×2', note: '贴胸面板内侧', anchor: new THREE.Vector3(1.6, 9.5, 4.6) },
    { id: 'spkIn', label: '扬声器单元', note: '胸前腔，朝前发声', anchor: new THREE.Vector3(0, 11.6, 3.4) },
    { id: 'camIn', label: '摄像头模组', note: '左眼镜筒后方的 CMOS 板', anchor: new THREE.Vector3(0, 22.25, 3.1) },
    { id: 'lidarIn', label: 'LiDAR 模组', note: '额头内，转鼓朝前', anchor: new THREE.Vector3(0, 24.05, 2.3) },
  ];

  /* 15 个舵机由 joints.js 定义：模型只管把它们摆到位置上，
   * 名字不在第二处重复，引脚表与接线图读的是同一张表。 */
  const servoJoints = SERVO_JOINTS;

  const dof = {
    bodyPivot, torso, neckPivot, head, beakUpper, beakLower,
    wingL, wingR, tail,
    hipL: legs.L.hip, kneeL: legs.L.knee, ankleL: legs.L.ankle, footL: legs.L.foot,
    hipR: legs.R.hip, kneeR: legs.R.knee, ankleR: legs.R.ankle, footR: legs.R.foot,
    skateboard, battery,
    eyeL, eyeR, eyes: [eyeL, eyeR],
    eye,                       // 旧名，指向左眼
    internals, wires, pulses,
    servoJoints,
  };

  function setColorway(key) {
    const c = COLORWAYS[key] || COLORWAYS.cream;
    M.shell.color.set(c.shell);
    M.shell2.color.set(c.shell2);
    M.accent.color.set(c.accent);
    M.iris.emissive.set(c.led);
    M.led.emissive.set(c.led);
  }
  setColorway(o.colorway || 'cream');

  return { root, dof, materials: M, hotspots, internalHotspots, setColorway, proportion: P };
}

/* ---------- 姿态 ---------- */

/* 一个姿态就是一组关节角（弧度）加整体升降。站立时膝盖微屈不锁死，
 * 蹲下时髋膝同时收、重心再往下 2 cm，是"跌倒后能自己爬起来"的前提。 */
export const POSES = {
  stand: {
    bodyY: 0, bodyPitch: 0,
    hipL: { x: 0.05, z: 0.04 }, kneeL: { x: -0.12 }, ankleL: { x: 0.07, z: -0.04 },
    hipR: { x: 0.05, z: -0.04 }, kneeR: { x: -0.12 }, ankleR: { x: 0.07, z: 0.04 },
    neck: { x: 0.05, y: 0 }, headPitch: -0.04, beak: 0.03,
  },
  crouch: {
    bodyY: -0.82, bodyPitch: 0.11,
    hipL: { x: 0.92, z: 0.1 }, kneeL: { x: -1.72 }, ankleL: { x: 0.82, z: -0.09 },
    hipR: { x: 0.92, z: -0.1 }, kneeR: { x: -1.72 }, ankleR: { x: 0.82, z: 0.09 },
    neck: { x: -0.16, y: 0 }, headPitch: 0.2, beak: 0.05,
  },
  grip: {
    bodyY: 0.37, bodyPitch: 0.18,
    hipL: { x: 0.4, z: 0.09 }, kneeL: { x: -0.78 }, ankleL: { x: 0.34, z: -0.07 },
    hipR: { x: 0.4, z: -0.09 }, kneeR: { x: -0.78 }, ankleR: { x: 0.34, z: 0.07 },
    neck: { x: 0.42, y: 0 }, headPitch: -0.3, beak: 0.62,
  },
  kick: {
    bodyY: 0.76, bodyPitch: -0.14,
    hipL: { x: 0.34, z: 0.08 }, kneeL: { x: -0.62 }, ankleL: { x: -0.16, z: -0.05 },
    hipR: { x: -0.42, z: -0.08 }, kneeR: { x: -0.62 }, ankleR: { x: -0.12, z: 0.05 },
    neck: { x: -0.1, y: 0.12 }, headPitch: 0.12, beak: 0.08,
  },
  // 侧躺：跌倒后的第一帧。爬起是"躺 → 蹲 → 站"三段，
  // 这一段是整个 15 自由度里唯一需要大关节角的地方。
  lying: {
    bodyY: 5.52, bodyPitch: 0.04, bodyRoll: 1.32,
    hipL: { x: 1.15, z: 0.5 }, kneeL: { x: -0.75 }, ankleL: { x: 0.5, z: 0.2 },
    hipR: { x: 0.95, z: 0.35 }, kneeR: { x: -0.6 }, ankleR: { x: 0.45, z: 0.15 },
    neck: { x: -0.35, y: 0.25 }, headPitch: 0.25, beak: 0.1,
  },
  skate: {
    bodyY: -0.18, bodyPitch: 0.03,
    hipL: { x: 0.26, z: 0.14 }, kneeL: { x: -0.58 }, ankleL: { x: 0.3, z: -0.12 },
    hipR: { x: 0.26, z: -0.14 }, kneeR: { x: -0.58 }, ankleR: { x: 0.3, z: 0.12 },
    neck: { x: 0.02, y: 0 }, headPitch: -0.02, beak: 0.03,
  },
};

const lerp = (a, b, t) => a + (b - a) * t;

/* 把姿态写进骨架。k=0..1 用于过渡，缺省直接到位。 */
export function applyPose(dof, pose, k) {
  const t = k == null ? 1 : k;
  dof.bodyPivot.position.y = lerp(dof.bodyPivot.position.y, pose.bodyY || 0, t);
  dof.bodyPivot.rotation.x = lerp(dof.bodyPivot.rotation.x, pose.bodyPitch || 0, t);
  dof.bodyPivot.rotation.z = lerp(dof.bodyPivot.rotation.z, pose.bodyRoll || 0, t);
  dof.neckPivot.rotation.x = lerp(dof.neckPivot.rotation.x, pose.neck.x || 0, t);
  dof.neckPivot.rotation.y = lerp(dof.neckPivot.rotation.y, pose.neck.y || 0, t);
  dof.head.rotation.x = lerp(dof.head.rotation.x, pose.headPitch || 0, t);
  const open = (pose.beak || 0) * 0.5;
  dof.beakUpper.rotation.x = lerp(dof.beakUpper.rotation.x, -open, t);
  dof.beakLower.rotation.x = lerp(dof.beakLower.rotation.x, open * 1.15, t);
  for (const s of ['L', 'R']) {
    const hip = pose['hip' + s], knee = pose['knee' + s], ankle = pose['ankle' + s];
    dof['hip' + s].rotation.x = lerp(dof['hip' + s].rotation.x, hip.x || 0, t);
    dof['hip' + s].rotation.z = lerp(dof['hip' + s].rotation.z, hip.z || 0, t);
    dof['knee' + s].rotation.x = lerp(dof['knee' + s].rotation.x, knee.x || 0, t);
    dof['ankle' + s].rotation.x = lerp(dof['ankle' + s].rotation.x, ankle.x || 0, t);
    dof['ankle' + s].rotation.z = lerp(dof['ankle' + s].rotation.z, ankle.z || 0, t);
  }
}

/* 摇摆步态：一个周期里左右腿反相，躯干横滚 + 偏航，是鸭子走路的样子。 */
export function waddleFrame(dof, phase) {
  const s = Math.sin(phase), c = Math.cos(phase);
  dof.bodyPivot.position.y = -0.28 + Math.abs(s) * 0.3;
  dof.bodyPivot.rotation.z = s * 0.11;
  dof.bodyPivot.rotation.y = s * 0.07;
  dof.bodyPivot.rotation.x = 0.05;
  dof.neckPivot.rotation.x = 0.02 - Math.abs(s) * 0.05;
  dof.neckPivot.rotation.y = -s * 0.1;
  dof.head.rotation.x = -0.04;
  dof.head.rotation.z = -s * 0.07;
  dof.hipL.rotation.x = 0.5 + s * 0.55;
  dof.hipR.rotation.x = 0.5 - s * 0.55;
  dof.kneeL.rotation.x = -0.55 - Math.max(0, s) * 0.5;
  dof.kneeR.rotation.x = -0.55 - Math.max(0, -s) * 0.5;
  dof.ankleL.rotation.x = 0.35 - s * 0.25;
  dof.ankleR.rotation.x = 0.35 + s * 0.25;
  dof.wingL.rotation.z = -Math.abs(c) * 0.1;
  dof.wingR.rotation.z = Math.abs(c) * 0.1;
  dof.beakUpper.rotation.x = -0.02;
  dof.beakLower.rotation.x = 0.02;
}
