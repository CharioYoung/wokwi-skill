/* ==================================================================== *
 * Microduck 引脚级网表
 *
 * 为什么要在模型里做"引脚"：只说"主控接舵机板"，评审时看不出这根线到底
 * 接哪个口、几号脚、走什么电平。所以这里把每个器件的连接器、每个脚的
 * 网名都写成数据，几何体按数据生成 —— 线束端点落在具体的脚上，不是落
 * 在器件中心。
 *
 * 三段数据：
 *   DEVICES     器件清单（BOM），连接器挂在器件上，位置由器件包围盒推出来，
 *               所以器件挪了位置，插头和线跟着走，不用改两处。
 *   CONNECTORS  连接器：边、偏移、型号、引脚网名。
 *   NETS        网表由引脚反推：同一个网名出现在几个脚上，就是几点的链。
 *
 * 网名的两种写法：
 *   "I2C_SCL"     普通网，同名即同网
 *   "#VSERVO"     板内铜皮 / 器件内部连接，只进表、不画线
 *   "GND:power"   带域的地。地不分域的话，一颗 GND 会把电池、舵机、
 *                 摄像头的地全连成一条横穿机身的线，既不真实也没法看。
 * ==================================================================== */

/* 连接器与网名的数据在 hardware.js —— 3D 线束、2D 接线图、校验脚本
 * 读的都是那一份。这里只负责把它们摆到 3D 器件表面上、连出实体线。 */
import { CONN_TYPES, DEVICES, SERVO_DEVICE, CONNECTORS, netBus, splitNet, connectorDefs } from './hardware.js';

export { CONN_TYPES, DEVICES, SERVO_DEVICE, CONNECTORS, netBus, splitNet };

/* ---------- 从器件包围盒推连接器位姿 ---------- */

const AXIS = {
  '+x': { n: [1, 0, 0], t: [0, 0, 1] },
  '-x': { n: [-1, 0, 0], t: [0, 0, 1] },
  '+y': { n: [0, 1, 0], t: [1, 0, 0] },
  '-y': { n: [0, -1, 0], t: [1, 0, 0] },
  '+z': { n: [0, 0, 1], t: [1, 0, 0] },
  '-z': { n: [0, 0, -1], t: [1, 0, 0] },
};

/* 面心：包围盒在该轴上的极值面，另两轴取中心 */
function faceCenter(box, edge) {
  const ctr = [
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2,
  ];
  const p = ctr.slice();
  const sgn = edge[0], ax = edge[1];
  const i = 'xyz'.indexOf(ax);
  p[i] = (sgn === '+' ? box.max : box.min)[ax];
  return p;
}

/* 把 [切向, 法向, 第三轴] 组成右手系。三轴顺序决定 BoxGeometry 的局部轴，
 * 这样所有连接器都能用同一套局部坐标生成，不用为每个面写一遍旋转。 */
function basisFor(edge) {
  const { n, t } = AXIS[edge];
  const nx = [n[0], n[1], n[2]];
  const tx = [t[0], t[1], t[2]];
  const uz = [
    tx[1] * nx[2] - tx[2] * nx[1],
    tx[2] * nx[0] - tx[0] * nx[2],
    tx[0] * nx[1] - tx[1] * nx[0],
  ];
  return { tx, nx, uz };
}

/* ---------- 建连接器 + 引脚 ---------- */

export function buildPinout(THREE, duck) {
  const internals = duck.dof.internals;
  duck.root.updateMatrixWorld(true);

  const boxes = new Map();
  const boxOf = (meshName) => {
    if (boxes.has(meshName)) return boxes.get(meshName);
    const o = duck.root.getObjectByName(meshName);
    if (!o) throw new Error('pinout: 找不到器件网格 ' + meshName);
    const b = new THREE.Box3().setFromObject(o);
    boxes.set(meshName, b);
    return b;
  };

  /* 手写的 + 按关节生成的（15 个舵机 + 16 口总线板） */
  const joints = duck.dof.servoJoints || [];
  const all = connectorDefs(joints);

  const group = new THREE.Group();
  group.name = 'pinout';
  internals.add(group);

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.72, metalness: 0.04 });
  const pinMat = new THREE.MeshStandardMaterial({
    color: '#d8b25e', roughness: 0.32, metalness: 0.86,
    emissive: '#3a2a08', emissiveIntensity: 0.5,
  });
  const markMat = new THREE.MeshBasicMaterial({ color: '#ff8a3c' });
  pinMat.name = 'pinMetal';

  const connectors = [];
  const pins = [];

  all.forEach((def) => {
    const ct = CONN_TYPES[def.type] || CONN_TYPES.PH20;
    const box = boxOf(devMesh(def));
    const fc = faceCenter(box, def.edge);
    const { tx, nx, uz } = basisFor(def.edge);
    const n = def.pins.length;
    const len = Math.max(n * ct.pitch, ct.pitch || 0.18) * 1.32 + 0.10;
    const lift = def.lift == null ? 0.02 : def.lift;

    const g = new THREE.Group();
    g.name = 'conn:' + def.id;
    const base = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(tx[0], tx[1], tx[2]),
      new THREE.Vector3(nx[0], nx[1], nx[2]),
      new THREE.Vector3(uz[0], uz[1], uz[2]),
    );
    g.quaternion.setFromRotationMatrix(base);
    g.position.set(
      fc[0] + nx[0] * (lift + ct.h / 2) + tx[0] * (def.along || 0),
      fc[1] + nx[1] * (lift + ct.h / 2) + tx[1] * (def.along || 0),
      fc[2] + nx[2] * (lift + ct.h / 2) + tx[2] * (def.along || 0),
    );
    group.add(g);

    // 壳体
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, ct.h, ct.w), bodyMat.clone());
    body.material.color.set(ct.body);
    body.name = 'connBody:' + def.id;
    body.castShadow = false;
    g.add(body);

    // 每根针：露出来的一小段金属，位置就是这根线的落点
    const pw = Math.max(ct.pitch * 0.52, 0.05);
    def.pins.forEach((raw, i) => {
      const x = (i - (n - 1) / 2) * ct.pitch;
      const pin = new THREE.Mesh(new THREE.BoxGeometry(pw, ct.h * 0.55, pw * 1.9), pinMat);
      pin.position.set(x, ct.h * 0.42, 0);
      pin.name = `pin:${def.id}:${i + 1}`;
      pin.castShadow = false;
      g.add(pin);

      pins.push({
        conn: def.id, dev: def.dev, index: i + 1, net: raw,
        local: new THREE.Vector3(x, ct.h * 0.42, 0),
        obj: pin,
      });
    });

    // 1 脚标记：一个橙色小方块，装配时对方向用
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(pw * 0.85, ct.h * 0.12, ct.w * 0.42), markMat);
    m1.position.set(-len / 2 + ct.pitch * 0.55, ct.h / 2 + 0.01, 0);
    m1.name = 'pin1:' + def.id;
    g.add(m1);

    connectors.push({
      id: def.id, dev: def.dev, label: def.label, type: def.type,
      typeName: ct.name, edge: def.edge, n, group: g,
    });
  });

  group.updateMatrixWorld(true);

  /* 脚的最终位置（internals 局部空间）。线束也建在 internals 下，
   * 同一个空间里算距离，才不会出现"表上连着、图上差两毫米"。 */
  const inv = new THREE.Matrix4().copy(internals.matrixWorld).invert();
  pins.forEach((p) => {
    const w = p.obj.getWorldPosition(new THREE.Vector3());
    p.pos = w.applyMatrix4(inv);
  });
  connectors.forEach((c) => {
    const body = c.group.getObjectByName('connBody:' + c.id);
    c.bodyBox = new THREE.Box3().setFromObject(body);
    // internals 局部空间里的盒子，走线避障直接用
    c.bodyBoxLocal = c.bodyBox.clone().applyMatrix4(inv);
  });

  /* 网表：同网名的脚连成一条链 */
  const nets = new Map();
  pins.forEach((p) => {
    const rec = nets.get(p.net) || { net: p.net, bus: netBus(p.net), pins: [], hidden: false };
    rec.pins.push(p);
    nets.set(p.net, rec);
  });
  nets.forEach((rec) => {
    const sp = splitNet(rec.net);
    rec.label = sp.label;
    rec.domain = sp.domain;
    rec.hidden = rec.net.startsWith('#') || rec.pins.length < 2;
  });

  return {
    group, connectors, pins, nets,
    devBox: (mesh) => boxOf(mesh),
    /* 器件包围盒清单：校验脚本用它在 3D 里验"线有没有从器件身上穿过去" */
    deviceBoxes: [...new Set(all.map((d) => devMesh(d)))].map((mesh) => ({
      dev: mesh, box: boxOf(mesh),
    })),
    stats: {
      connectors: connectors.length,
      pins: pins.length,
      nets: nets.size,
      wired: [...nets.values()].filter((r) => !r.hidden).length,
      servos: joints.length,
    },
  };
}

/* 舵机是动态生成的器件，没有固定 mesh 名，连接器定义里直接带上 mesh */
function devMesh(def) {
  if (def.mesh) return def.mesh;
  const d = DEVICES.find((x) => x.id === def.dev);
  if (!d) throw new Error('pinout: 未知器件 ' + def.dev);
  return d.mesh;
}

/* ---------- 走线 ---------- */

/* 两点之间的默认弯：在中点把路径推向机身内壁。
 * 线束在真实机器里就是贴着壳走的，中间留出板卡的净空；
 * 直接连直线会从主控板中间穿过去。 */
function defaultVia(THREE, a, b, innerR) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const r = Math.hypot(mid.x, mid.z);
  if (mid.y > 13.6) {
    // 颈以上：收进颈柱，别在头壳里横着拉
    mid.x *= 0.35; mid.z = mid.z * 0.35 + 0.35;
  } else if (r > 0.3) {
    // 外推量按线长给：短线不需要绕一大圈，长线才贴壁走
    const len = a.distanceTo(b);
    const push = Math.min(0.95, len * 0.14);
    const cap = innerR ? innerR(mid.y) - 0.55 : r + push;
    const want = Math.min(r + push, Math.max(r * 0.6, cap));
    const k = want / r;
    mid.x *= k; mid.z *= k;
  }
  return mid;
}

/* 链序：一条网挂在好几件器件上时，接线顺序不能按"表里的书写顺序"，
 * 否则线会从机身一头拉到另一头再折回来。这里用最近邻 + 2-opt
 * 解一个小的开路 TSP —— 六个点以内，暴力都不慢。 */
function orderChain(THREE, pins) {
  const n = pins.length;
  if (n <= 2) return pins.slice();
  const d = (i, j) => pins[i].pos.distanceTo(pins[j].pos);
  // 从离"重心"最远的那个脚出发（通常是主控，链子最好从它开始铺）
  const c = new THREE.Vector3();
  pins.forEach((p) => c.add(p.pos));
  c.multiplyScalar(1 / n);
  let start = 0, far = -1;
  pins.forEach((p, i) => { const k = p.pos.distanceTo(c); if (k > far) { far = k; start = i; } });

  const used = new Array(n).fill(false);
  const order = [start];
  used[start] = true;
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const k = d(last, j);
      if (k < bd) { bd = k; best = j; }
    }
    used[best] = true;
    order.push(best);
  }
  // 2-opt：反转一段若缩短总长就保留
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a1 = d(order[i - 1], order[i]);
        const a2 = j + 1 < n ? d(order[j], order[j + 1]) : 0;
        const b1 = d(order[i - 1], order[j]);
        const b2 = j + 1 < n ? d(order[i], order[j + 1]) : 0;
        if (b1 + b2 < a1 + a2 - 1e-6) {
          const seg = order.slice(i, j + 1).reverse();
          order.splice(i, seg.length, ...seg);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return order.map((i) => pins[i]);
}

/* 避障：候选控制点里挑第一个"采样全程都不进器件"的。
 * 一个中点不够用 —— 从主控到近地 IMU 的那条线，中点正好落在电源板上。 */
function routeVia(THREE, a, b, innerR, obstacles) {
  const base = defaultVia(THREE, a, b, innerR);
  if (!obstacles || !obstacles.length) return base;

  const cands = [base];
  // 更贴壁
  for (const push of [0.6, 1.5]) {
    const v = base.clone();
    const r = Math.hypot(v.x, v.z);
    if (r > 0.2) { const k = (r + push) / r; v.x *= k; v.z *= k; }
    cands.push(v);
  }
  // 上下绕
  for (const dy of [0.9, -0.9, 1.8, -1.8]) cands.push(base.clone().setY(base.y + dy));
  // 侧向绕
  for (const dx of [1.2, -1.2]) cands.push(base.clone().setX(base.x + dx));
  for (const dz of [1.2, -1.2]) cands.push(base.clone().setZ(base.z + dz));
  // 主板前后沿：从 y6 爬到 y14 的那几根，只能贴着板子边缘走
  for (const zs of [1, -1]) {
    const v = base.clone();
    if (Math.abs(v.z) < 1.95) v.z = zs * 1.95;
    cands.push(v);
  }
  // 绕侧：主控板几乎占满腔体截面，竖着走的线只剩左右两条缝
  const sideR = (innerR ? innerR(base.y) : 6) - 0.55;
  for (const sx of [1, -1]) cands.push(base.clone().setX(sx * sideR));
  for (const sz of [1, -1]) cands.push(base.clone().setZ(sz * sideR));

  const curvePts = (v) => {
    const c = new THREE.QuadraticBezierCurve3(a, v, b);
    const out = [];
    // 采样密度要比管子本身更密，否则"判定通过"的曲线一细分又蹭上去
    for (let i = 1; i <= 30; i++) out.push(c.getPoint(i / 31));
    return out;
  };

  let best = base, bestHit = Infinity;
  for (const v of cands) {
    const pts = curvePts(v);
    let hit = 0;
    for (const p of pts) {
      for (const box of obstacles) if (box.containsPoint(p)) hit++;
    }
    if (hit === 0) return v;
    if (hit < bestHit) { bestHit = hit; best = v; }
  }
  return best;
}

/* 扁排线（FPC）：沿曲线铺一条带宽度的带子。
 * 24 根圆管并起来像一根粗电缆，而真实摄像头排线是扁的，
 * 所以芯数 ≥ 8 的组按扁带画。 */
function flatRibbon(THREE, curve, width, thick, mat) {
  const SEG = 64, pos = [], idx = [], nrm = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t).normalize();
    let right = new THREE.Vector3().crossVectors(tan, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const nUp = new THREE.Vector3().crossVectors(right, tan).normalize();
    [-0.5, 0.5].forEach((s) => {
      [-0.5, 0.5].forEach((q) => {
        const v = p.clone().addScaledVector(right, s * width).addScaledVector(nUp, q * thick);
        pos.push(v.x, v.y, v.z);
        nrm.push(nUp.x, nUp.y, nUp.z);
      });
    });
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 4, b = (i + 1) * 4;
    // 四个面都封上，否则扁带从侧面看是空心
    idx.push(a, b, b + 1, a, b + 1, a + 1);
    idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
    idx.push(a, a + 2, b + 2, a, b + 2, b);
    idx.push(a + 1, b + 1, b + 3, a + 1, b + 3, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, mat);
}

export function buildHarness(THREE, duck, pinout, opts) {
  const innerR = (opts && opts.innerR) || null;
  const wires = duck.dof.wires;
  while (wires.children.length) wires.remove(wires.children[0]);
  const pulses = [];
  duck.dof.pulses.length = 0;

  const COLORS = {
    power: '#ff6b3d', bus: '#4fd8ff', cam: '#c48bff',
    i2c: '#6ef2a6', aud: '#ffd24a', gpio: '#9aa1ac', rf: '#7fd4ff',
  };

  const devOfConn = new Map(pinout.connectors.map((c) => [c.id, c.dev]));
  const connDev = (pin) => devOfConn.get(pin.conn) || '';

  /* 避障盒子：器件包围盒收 1 mm，舵机不参与（线本来就贴着舵机走） */
  const obstacles = pinout.deviceBoxes
    .filter((d) => !duck.dof.servoJoints.some((sj) => sj.servo === d.dev))
    .map((d) => ({ dev: d.dev, box: d.box.clone().applyMatrix4(
      new THREE.Matrix4().copy(duck.dof.internals.matrixWorld).invert()).expandByScalar(-0.14) }));

  /* 先把每条网的链序排好，再按"起点终点序列"分组 —— 分组键要建立在
   * 排好的链上，否则同一对口的 24 根排线会被拆成好几组。 */
  const routed = [];
  [...pinout.nets.values()].forEach((rec) => {
    if (rec.hidden) return;
    const chain = orderChain(THREE, rec.pins);
    const sig = chain.map((p) => p.conn).join('>');
    const rev = chain.map((p) => p.conn).reverse().join('>');
    routed.push({ rec, chain, key: sig < rev ? sig : rev, forward: sig <= rev });
  });

  const groups = new Map();
  routed.forEach((r) => {
    const arr = groups.get(r.key) || [];
    arr.push(r);
    groups.set(r.key, arr);
  });

  let wireCount = 0, ribbonCount = 0;
  const stats = [];

  groups.forEach((items, key) => {
    const isRibbon = items.length >= 8;

    items.forEach((item, gi) => {
      const { rec, chain } = item;
      // 组内统一方向，多芯线才不会一半正走一半倒走
      const seq = item.forward ? chain : chain.slice().reverse();
      const col = COLORS[rec.bus] || '#9aa1ac';
      const mat = new THREE.MeshBasicMaterial({ color: col });
      const r = isRibbon ? 0.035 : (rec.bus === 'power' ? 0.075 : 0.055);
      // 组内偏移：同一束里的第 gi 根往旁边挪一点，看起来才是排线
      const off = isRibbon ? 0 : (gi - (items.length - 1) / 2) * 0.13;

      for (let i = 0; i < seq.length - 1; i++) {
        const a = seq[i].pos, b = seq[i + 1].pos;
        const own = new Set([connDev(seq[i]), connDev(seq[i + 1])]);
        const obs = obstacles.filter((o) => !own.has(o.dev)).map((o) => o.box);
        const via = (rec.via && rec.via[i]) || routeVia(THREE, a, b, innerR, obs);
        const curve = new THREE.QuadraticBezierCurve3(a.clone(), via, b.clone());
        const geo = new THREE.TubeGeometry(curve, 28, r, 6, false);
        const mesh = new THREE.Mesh(geo, mat);
        if (off) {
          const t0 = curve.getTangent(0.5).normalize();
          const side = new THREE.Vector3().crossVectors(t0, new THREE.Vector3(0, 1, 0)).normalize();
          mesh.position.addScaledVector(side, off);
        }
        mesh.name = 'wire:' + rec.net;
        mesh.userData = {
          net: rec.net, bus: rec.bus, label: rec.label,
          chain: seq.map((p) => `${p.conn}.${p.index}`),
          seg: [`${seq[i].conn}.${seq[i].index}`, `${seq[i + 1].conn}.${seq[i + 1].index}`],
        };
        mesh.castShadow = false;
        wires.add(mesh);
        wireCount++;

        if (!isRibbon && rec.bus !== 'power') {
          const sp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat);
          sp.visible = false;
          sp.castShadow = false;
          sp.name = 'pulse';
          sp.userData = { seg: mesh.userData.seg, pulse: true };
          curve.getPoint(0, sp.position);
          wires.add(sp);
          pulses.push({ mesh: sp, curve, t: Math.random() });
        }
      }
    });

    /* 扁排线（FPC）：24 根圆管并起来像一根粗电缆，真实排线是扁的，
     * 所以芯数 ≥ 8 的组改画一条带子，宽度按芯数给。 */
    if (isRibbon) {
      const { rec, chain } = items[0];
      const seq = items[0].forward ? chain : chain.slice().reverse();
      const a = seq[0].pos, b = seq[seq.length - 1].pos;
      const own = new Set([connDev(seq[0]), connDev(seq[seq.length - 1])]);
      const obs = obstacles.filter((o) => !own.has(o.dev)).map((o) => o.box);
      const via = routeVia(THREE, a, b, innerR, obs);
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), via, b.clone());
      const width = Math.min(1.5, items.length * 0.052);
      const mat = new THREE.MeshStandardMaterial({
        color: '#b8860b', roughness: 0.42, metalness: 0.1,
        transparent: true, opacity: 0.92, side: THREE.DoubleSide,
      });
      const rib = flatRibbon(THREE, curve, width, 0.035, mat);
      rib.name = 'ribbon:' + key;
      rib.userData = {
        ribbon: key, nets: items.map((it) => it.rec.net),
        seg: [`${seq[0].conn}.${seq[0].index}`, `${seq[seq.length - 1].conn}.${seq[seq.length - 1].index}`],
      };
      rib.castShadow = false;
      wires.add(rib);
      ribbonCount++;
    }

    stats.push({ key, n: items.length, ribbon: isRibbon });
  });

  duck.dof.pulses.push(...pulses);
  return { wireCount, ribbonCount, groups: stats.length };
}

/* ---------- 给页面用的表 ---------- */

/* 网表行：网名、总线、起点脚、终点脚、芯数 */
export function netTable(pinout) {
  const rows = [];
  [...pinout.nets.values()].forEach((rec) => {
    if (rec.hidden) return;
    const ends = rec.pins.map((p) => `${p.conn}.${p.index}`);
    rows.push({
      raw: rec.net, net: rec.label, domain: rec.domain, bus: rec.bus, pins: rec.pins.length,
      from: ends[0], to: ends.length > 2 ? ends.slice(1).join(' / ') : ends[1] || '—',
      chain: ends.join(' → '),
    });
  });
  rows.sort((a, b) => (a.bus + a.net).localeCompare(b.bus + b.net));
  return rows;
}

export function bomRows(pinout) {
  const rows = DEVICES.map((d) => ({ ...d }));
  const s = SERVO_DEVICE;
  rows.push({
    id: s.id, label: s.label, cat: s.cat, qty: s.qty, wt: s.wt, spec: s.spec,
    mesh: '（15 个关节，见引脚表 JS1..JS15）', solder: 'ZH1.5 3P',
  });
  const pinByDev = new Map();
  pinout.connectors.forEach((c) => {
    pinByDev.set(c.dev, (pinByDev.get(c.dev) || 0) + c.n);
  });
  rows.forEach((r) => {
    r.pins = r.id === 'servo' ? 45 : (pinByDev.get(r.id) || 0);
    r.conns = pinout.connectors.filter((c) => c.dev === r.id).map((c) => c.id).join(' ');
  });
  return rows;
}
