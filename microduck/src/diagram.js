/* ==================================================================== *
 * 接线图 —— 器件摆开画，线走栅格
 *
 * 这一页不套外壳，也不共用外观图的镜头。它就是一张装配台的照片：
 * 板子平铺在桌面上，插座朝外，线从这根针拉到那根针。
 *
 * 三件事决定了这张图可不可信：
 *   1. 器件外形按实物画（parts2d.js），插座数量与脚数来自 hardware.js
 *   2. 线的端点就是引脚坐标，不是"器件中心连器件中心"
 *   3. 走线在 8 px 栅格上做 A*：压到板子是硬代价，拐弯和贴线是软代价，
 *      所以线会自己找到器件之间的缝，不需要人手工画通道
 *
 * 不按物理比例 —— 按比例画的话 84 mm 的主控板只有 30 px 宽，24 脚的 FPC
 * 根本画不出针距。可读性优先，真实尺寸交给外观图的容纳表。
 * ==================================================================== */

import { buildNetlist } from './netlist.js';
import { BUS_TYPES } from './bus.js';
import { svgDefs, partArt, connArt } from './parts2d.js';

export const CANVAS = { w: 1480, h: 980 };

/* 插座厚度（px）。真实 JST 是 5~6 mm，这里画厚一点，针才看得见。 */
const CT = 14;

/* 针距：同一排针之间留多少。FPC 密一些，电池触点疏一些。 */
const PITCH = {
  XH254: 12, PH20: 10, GH125: 9, ZH15: 6.5, FPC05: 5.2, BTN: 15, IPEX: 12,
};

/* 器件在图纸上的位置。不是机身里的坐标 —— 这是装配台，按走线顺不顺排。 */
const BOX = {
  battery: { x: 40, y: 58, w: 178, h: 112 },
  powerBoard: { x: 40, y: 262, w: 226, h: 152 },
  servoBoard: { x: 40, y: 512, w: 272, h: 306 },
  mb: { x: 470, y: 250, w: 360, h: 240 },
  cam: { x: 936, y: 62, w: 152, h: 134 },
  lidar: { x: 1132, y: 62, w: 134, h: 114 },
  speaker: { x: 1300, y: 54, w: 142, h: 142 },
  imuA: { x: 922, y: 248, w: 110, h: 86 },
  imuB: { x: 922, y: 372, w: 110, h: 86 },
  nfcL: { x: 922, y: 496, w: 126, h: 88 },
  nfcR: { x: 1074, y: 496, w: 126, h: 88 },
  micL: { x: 1228, y: 300, w: 90, h: 66 },
  micR: { x: 1228, y: 402, w: 90, h: 66 },
};

/* 每块板的插座排在哪条边、以什么顺序。顺序决定针的次序，
 * 也决定线从哪一段边出来 —— 把 24 脚的 FPC 放到远离摄像头的一侧，
 * 线就要横穿整块主控板。 */
const SIDES = {
  mb: {
    top: ['J9', 'J4', 'J3'],
    bottom: ['J2', 'J8'],
    left: ['J1'],
    right: ['J5', 'J6', 'J7'],
  },
  powerBoard: { top: ['P1', 'P4'], right: ['P2'], bottom: ['P3'] },
  servoBoard: {
    top: ['S0', 'S1'],
    right: ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'],
    bottom: ['S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16'],
  },
  battery: { bottom: ['B1'] },
  cam: { left: ['C1'] },
  lidar: { bottom: ['C2'] },
  speaker: { left: ['K1'] },
  imuA: { left: ['I1'] },
  imuB: { left: ['I2'] },
  nfcL: { left: ['N1'] },
  nfcR: { left: ['N2'] },
  micL: { left: ['M1'] },
  micR: { left: ['M2'] },
};

const DEV_KIND = {
  mb: 'mb', powerBoard: 'powerBoard', servoBoard: 'servoBoard', battery: 'battery',
  speaker: 'speaker', cam: 'cam', lidar: 'lidar',
  imuA: 'imu', imuB: 'imu', nfcL: 'nfc', nfcR: 'nfc', micL: 'mic', micR: 'mic',
};

/* 15 个舵机在右下角排成 5×3，插头一律朝左，线从舵机板过来。 */
const SERVO_GRID = { x0: 430, y0: 600, dx: 200, dy: 100, w: 92, h: 56, cols: 5 };

const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- 布局：插座贴边 ---------- */

function layoutConnectors(nt, boxes, sides) {
  const out = [];
  const pick = (ids) => ids.map((id) => nt.byConn.get(id)).filter(Boolean);

  Object.entries(sides).forEach(([dev, sideMap]) => {
    const b = boxes[dev];
    if (!b) return;
    Object.entries(sideMap).forEach(([side, ids]) => {
      const list = pick(ids);
      const horiz = side === 'top' || side === 'bottom';
      const span = horiz ? b.w : b.h;
      const sizes = list.map((c) => c.npins * PITCH[c.type] + 9);
      const gap = Math.max(6, (span - 24 - sizes.reduce((s, v) => s + v, 0)) / Math.max(1, list.length));
      let cur = (horiz ? b.x : b.y) + 12;
      list.forEach((c, i) => {
        const len = sizes[i];
        const pitch = PITCH[c.type];
        let rect;
        if (horiz) {
          const cx = cur + len / 2;
          rect = { x: cx - len / 2, w: len, h: CT, y: side === 'top' ? b.y - CT : b.y + b.h };
        } else {
          const cy = cur + len / 2;
          rect = { y: cy - len / 2, h: len, w: CT, x: side === 'left' ? b.x - CT : b.x + b.w };
        }
        const pins = c.pins.map((p, k) => {
          const t = k + 0.5;
          const pos = horiz
            ? { x: rect.x + 4.5 + pitch * t, y: rect.y + CT / 2 }
            : { x: rect.x + CT / 2, y: rect.y + 4.5 + pitch * t };
          return { ...p, pos };
        });
        out.push({
          ...c, dev, side, rect, pins,
          normal: side === 'top' ? { x: 0, y: -1 } : side === 'bottom' ? { x: 0, y: 1 }
            : side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 },
        });
        cur += len + gap;
      });
    });
  });
  return out;
}

/* ---------- 栅格 ---------- */

const CELL = 8;

function makeGrid(boxes) {
  const cols = Math.ceil(CANVAS.w / CELL);
  const rows = Math.ceil(CANVAS.h / CELL);
  const blocked = new Uint8Array(cols * rows);
  const used = new Uint16Array(cols * rows);
  Object.values(boxes).forEach((b) => {
    // 往里收 5 px：线可以贴着板边走，但不能从板子身上过去
    const c0 = Math.floor((b.x + 5) / CELL), c1 = Math.ceil((b.x + b.w - 5) / CELL);
    const r0 = Math.floor((b.y + 5) / CELL), r1 = Math.ceil((b.y + b.h - 5) / CELL);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) blocked[r * cols + c] = 1;
    }
  });
  // 最外一圈不让走：贴着画布边的线在打印或截图时会被裁掉
  for (let c = 0; c < cols; c++) { blocked[c] = 1; blocked[(rows - 1) * cols + c] = 1; }
  for (let r = 0; r < rows; r++) { blocked[r * cols] = 1; blocked[r * cols + cols - 1] = 1; }
  return { cols, rows, blocked, used };
}

/* 二叉堆：A* 的开集。用数组排序也能跑，但 70 条线一跑就是几秒 */
function heapPush(h, node) {
  h.push(node);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].f <= h[i].f) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l].f < h[m].f) m = l;
      if (r < h.length && h[r].f < h[m].f) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

/* 离 p 最近的可走格 */
function snap(grid, p) {
  const { cols, rows, blocked } = grid;
  const c0 = Math.round(p.x / CELL), r0 = Math.round(p.y / CELL);
  for (let rad = 0; rad <= 8; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        if (!blocked[r * cols + c]) return { c, r };
      }
    }
  }
  return { c: Math.max(0, Math.min(cols - 1, c0)), r: Math.max(0, Math.min(rows - 1, r0)) };
}

/* A*：4 邻域，代价 = 步长 + 已占用惩罚 + 拐弯惩罚。
 * 拐弯惩罚给得比占用高：宁可绕远一点，也别在板子缝里扭成一团。 */
function astar(grid, s, t, opts = {}) {
  const { cols, rows, blocked, used } = grid;
  const N = cols * rows;
  const g = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const dirAt = new Int8Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = s.r * cols + s.c, goal = t.r * cols + t.c;
  g[start] = 0;
  const open = [];
  heapPush(open, { i: start, f: Math.abs(t.c - s.c) + Math.abs(t.r - s.r) });
  const DC = [1, -1, 0, 0], DR = [0, 0, 1, -1];
  const turnCost = opts.turn == null ? 7 : opts.turn;
  const useCost = opts.use == null ? 1.15 : opts.use;

  while (open.length) {
    const cur = heapPop(open).i;
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % cols, cr = (cur - cc) / cols;
    for (let d = 0; d < 4; d++) {
      const nc = cc + DC[d], nr = cr + DR[d];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (blocked[ni] || closed[ni]) continue;
      const turn = dirAt[cur] >= 0 && dirAt[cur] !== d ? turnCost : 0;
      const ng = g[cur] + 1 + turn + used[ni] * useCost;
      if (ng < g[ni]) {
        g[ni] = ng;
        prev[ni] = cur;
        dirAt[ni] = d;
        heapPush(open, { i: ni, f: ng + Math.abs(t.c - nc) + Math.abs(t.r - nr) });
      }
    }
  }
  if (!isFinite(g[goal])) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = prev[i]) {
    cells.push({ c: i % cols, r: Math.floor(i / cols) });
    if (i === start) break;
  }
  cells.reverse();
  // 占用计数：后面的线会主动让开，形成并排线束
  cells.forEach(({ c, r }) => { used[r * cols + c] += 1; });
  return cells;
}

function simplify(pts) {
  const out = [];
  pts.forEach((p) => {
    const q = { x: r1(p.x), y: r1(p.y) };
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - q.x) < 0.6 && Math.abs(last.y - q.y) < 0.6) return;
    out.push(q);
  });
  for (let i = 1; i < out.length - 1;) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const sameX = Math.abs(a.x - b.x) < 0.6 && Math.abs(b.x - c.x) < 0.6;
    const sameY = Math.abs(a.y - b.y) < 0.6 && Math.abs(b.y - c.y) < 0.6;
    if (sameX || sameY) out.splice(i, 1);
    else i++;
  }
  return out;
}

/* 把一条正交折线整体平移 off（左法线方向）。段与段之间会出现小台阶，
 * 正是排线拐弯的样子。 */
export function offsetPath(pts, off) {
  if (!off) return pts;
  const out = [];
  let prevEnd = null;
  let prevVert = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const nx = -dy, ny = dx;
    const vert = Math.abs(a.x - b.x) < 0.4;
    const s0 = { x: a.x + nx * off, y: a.y + ny * off };
    const e = { x: b.x + nx * off, y: b.y + ny * off };
    if (!prevEnd) {
      out.push(s0);
    } else if (Math.abs(prevEnd.x - s0.x) > 0.4 || Math.abs(prevEnd.y - s0.y) > 0.4) {
      /* 拐角斜接：取两条偏移线的交点。这里不能直接连 prevEnd → s0，
       * 那样会往回拐一段，和相邻的芯叠在一起，24 根就糊成一片网点。 */
      // 交点要用"上一段的方向"来取：上一段是竖的，交点就在 prevEnd.x 上
      out.push(prevVert ? { x: prevEnd.x, y: s0.y } : { x: s0.x, y: prevEnd.y });
      out.push(e);
      prevEnd = e;
      prevVert = vert;
      continue;
    }
    out.push(e);
    prevEnd = e;
    prevVert = vert;
  }
  return simplify(out);
}

function trunkPath(grid, p1, na, p2, nb, boxes) {
  const pts = [p1];
  const vertA = na.x === 0, vertB = nb.x === 0;
  if (vertA && vertB) {
    const ymid = (p1.y + p2.y) / 2;
    pts.push({ x: p1.x, y: ymid }, { x: p2.x, y: ymid });
  } else if (!vertA && !vertB) {
    const xmid = (p1.x + p2.x) / 2;
    pts.push({ x: xmid, y: p1.y }, { x: xmid, y: p2.y });
  } else if (vertA) {
    pts.push({ x: p1.x, y: p2.y });
  } else {
    pts.push({ x: p2.x, y: p1.y });
  }
  pts.push(p2);
  const clean = simplify(pts);
  const hits = (segs) => segs.some((seg) => Object.values(boxes).some((b) => {
    const r = { x0: b.x + 4, y0: b.y + 4, x1: b.x + b.w - 4, y1: b.y + b.h - 4 };
    if (seg.y != null) return seg.y > r.y0 && seg.y < r.y1
      && Math.min(seg.x1, r.x1) > Math.max(seg.x0, r.x0);
    return seg.x > r.x0 && seg.x < r.x1 && Math.min(seg.y1, r.y1) > Math.max(seg.y0, r.y0);
  }));
  const segs = [];
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i], b = clean[i + 1];
    segs.push(Math.abs(a.y - b.y) < 0.5
      ? { y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) }
      : { x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
  }
  if (!hits(segs)) return clean;
  return connect(grid, p1, p2, { use: 1.6 });
}

function connect(grid, A, B, opts) {
  const s = snap(grid, A), t = snap(grid, B);
  const cells = astar(grid, s, t, opts);
  if (!cells) return [A, B];
  const mid = cells.map(({ c, r }) => ({ x: c * CELL, y: r * CELL }));
  const first = mid[0], last = mid[mid.length - 1];
  /* 端点不在栅格上，直接连过去会得到一条斜线；斜段既不像真实走线，
   * 也没法按法线平移（排线会在拐角拧成麻花）。所以两端各补一个 L 形接头。 */
  return simplify([
    A, { x: first.x, y: A.y }, first,
    ...mid.slice(1),
    last, { x: last.x, y: B.y }, B,
  ]);
}

/* ---------- 组装 ---------- */

export function buildDiagram(opts = {}) {
  const nt = opts.nt || buildNetlist();
  const boxes = { ...BOX };
  const sides = {};
  Object.entries(SIDES).forEach(([k, v]) => { sides[k] = { ...v }; });

  nt.servos.forEach((s, i) => {
    const c = i % SERVO_GRID.cols, r = Math.floor(i / SERVO_GRID.cols);
    boxes[s.id] = {
      x: SERVO_GRID.x0 + c * SERVO_GRID.dx, y: SERVO_GRID.y0 + r * SERVO_GRID.dy,
      w: SERVO_GRID.w, h: SERVO_GRID.h,
    };
    sides[s.id] = { left: ['JS' + (i + 1)] };
  });

  const conns = layoutConnectors(nt, boxes, sides);
  const connById = new Map(conns.map((c) => [c.id, c]));
  const grid = makeGrid(boxes);

  const pinGeo = (p) => {
    const c = connById.get(p.conn);
    return { ...p, pos: c.pins.find((q) => q.index === p.index).pos, conn: c };
  };

  const visible = [...nt.nets.values()].filter((n) => !n.hidden);

  /* 把"同一对插座、芯数 ≥ 8"的网认成一条排线：24 根各自 A* 会散成
   * 一片扇形，真实 FPC 是一条扁带，只在两端扇出。 */
  const groups = new Map();
  visible.forEach((net) => {
    const ids = [...new Set(net.pins.map((p) => p.conn))];
    if (ids.length !== 2) return;
    const key = ids.slice().sort().join('|');
    const g = groups.get(key) || { ids, nets: [] };
    g.nets.push(net);
    groups.set(key, g);
  });
  const ribbons = [...groups.values()].filter((g) => g.nets.length >= 8);
  const ribbonNets = new Set(ribbons.flatMap((g) => g.nets.map((n) => n.net)));

  const wires = [];
  const netPaths = new Map();

  const pushWire = (net, pts, from, to, extra = {}) => {
    wires.push({
      net: net.net, label: net.label, domain: net.domain, bus: net.bus,
      pts: simplify(pts), from, to, ...extra,
    });
  };

  /* 1) 先铺排线：它最宽，占的通道最讲究 */
  ribbons.forEach((g) => {
    const [idA, idB] = g.ids;
    const ca = connById.get(idA), cb = connById.get(idB);
    // 排线要扇出 n 根：两端各留一段沿插座法线的直段，偏移才会顺，
    // 否则大偏移遇上短拐角，最外侧几根会拧成蝴蝶结
    const n = g.nets.length;
    const fan = 20 + n * 1.2;
    const straight = 120;
    const at = (c, d) => ({
      x: c.rect.x + c.rect.w / 2 + c.normal.x * d,
      y: c.rect.y + c.rect.h / 2 + c.normal.y * d,
    });
    const a1 = at(ca, fan), a2 = at(ca, fan + straight);
    const b1 = at(cb, fan), b2 = at(cb, fan + straight);
    const trunk = trunkPath(grid, a2, ca.normal, b2, cb.normal, boxes);
    const ribbonPts = simplify([a1, ...trunk, b1]);
    g.nets
      .slice()
      .sort((a, b) => a.pins[0].index - b.pins[0].index)
      .forEach((net, k) => {
        const off = (k - (n - 1) / 2) * 2.4;
        const pa = pinGeo(net.pins.find((p) => p.conn === idA));
        const pb = pinGeo(net.pins.find((p) => p.conn === idB));
        // 扇出用一段直线：FPC 从插座出来就是直接张开到带宽，中间再拐直角
        // 会让 24 根芯互相穿过，糊成一片网点
        const inner = offsetPath(ribbonPts, off);
        const pts = [pa.pos, ...inner, pb.pos];
        pushWire(net, pts, `${idA}.${pa.index}`, `${idB}.${pb.index}`, { ribbon: true });
        netPaths.set(net.net, { net, paths: [pts] });
      });
  });

  /* 2) 其余按总线优先级铺：电源和舵机总线先走，传感器线后绕 */
  const BUS_ORDER = { power: 0, bus: 1, cam: 2, i2c: 3, aud: 4, gpio: 5, rf: 6 };
  const rest = visible
    .filter((n) => !ribbonNets.has(n.net))
    .sort((a, b) => (BUS_ORDER[a.bus] - BUS_ORDER[b.bus]) || a.net.localeCompare(b.net));

  rest.forEach((net) => {
    const pins = net.pins.map(pinGeo);
    const todo = pins.slice();
    const order = [];
    const startIdx = Math.max(0, todo.findIndex((p) => p.dev === 'mb'));
    order.push(todo.splice(startIdx, 1)[0]);
    while (todo.length) {
      const last = order[order.length - 1];
      let bi = 0, bd = Infinity;
      todo.forEach((p, i) => {
        const d = Math.abs(p.pos.x - last.pos.x) + Math.abs(p.pos.y - last.pos.y);
        if (d < bd) { bd = d; bi = i; }
      });
      order.push(todo.splice(bi, 1)[0]);
    }

    const paths = [];
    for (let i = 0; i < order.length - 1; i++) {
      const A = order[i], B = order[i + 1];
      const stub = 14;
      const P = { x: A.pos.x + A.conn.normal.x * stub, y: A.pos.y + A.conn.normal.y * stub };
      const Q = { x: B.pos.x + B.conn.normal.x * stub, y: B.pos.y + B.conn.normal.y * stub };
      const mid = connect(grid, P, Q, {});
      const pts = simplify([A.pos, ...mid, B.pos]);
      paths.push(pts);
      pushWire(net, pts, `${A.conn.id}.${A.index}`, `${B.conn.id}.${B.index}`);
    }
    netPaths.set(net.net, { net, paths });
  });

  const { svg, labels } = renderSvg({ nt, boxes, conns, wires });
  return { nt, boxes, conns, wires, netPaths, svg, labels, grid };
}

/* ---------- 出图 ---------- */

function busColor(bus) {
  return (BUS_TYPES[bus] || BUS_TYPES.gpio).color;
}

function renderWire(w) {
  const color = busColor(w.bus);
  const d = w.pts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join('');
  const tip = `${w.label}${w.domain ? ':' + w.domain : ''} · ${w.from} → ${w.to}`;
  return `<path class="wire${w.ribbon ? ' ribbon-core' : ''}" data-net="${w.net}" data-bus="${w.bus}" ` +
    `data-from="${w.from}" data-to="${w.to}" data-tip="${tip}" d="${d}" fill="none" stroke="${color}" ` +
    `stroke-width="${w.ribbon ? 1.5 : 1.8}" stroke-linejoin="round" stroke-linecap="round" opacity="0.88"/>`;
}

/* 估算字符串宽度：中文约等于字号，拉丁字母约 0.55 字号。
 * 标签底衬要按这个宽度画，否则长的 spec 会从底衬里探出去压到别的元素。 */
function textW(str, size) {
  let w = 0;
  for (const ch of String(str)) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.56;
  return w;
}

function renderDevice(dev, box, kind, topConn, gap, out) {
  const spec = dev.spec || '';
  let s = `<g class="dev" data-dev="${dev.id}">`;
  s += `<rect x="${box.x + 2}" y="${box.y + 3}" width="${box.w}" height="${box.h}" rx="6"
    fill="#05080b" opacity="0.55"/>`;
  s += `<g transform="translate(${box.x} ${box.y})">${partArt(kind, box.w, box.h, dev)}</g>`;
  /* 标题牌只包住文字，不铺满整条空档：
   * 横穿这条缝的线会从牌子下面过去 —— 一块贴着文字的牌读起来是"标签"，
   * 一块大黑方块读起来就是"线断了"。 */
  const nameW = textW(dev.label, 11.5);
  const specW = spec ? textW(spec, 8.8) : 0;
  /* 顶边有插座的板子，插座本体和脚号都画在 box 上沿以外（-CT 到 -CT-12），
   * 标题必须跳过这一段，否则"舵机总线板"正好压在 S0/S1 上。 */
  const drop = topConn ? CT + 26 : 13;
  /* 上面挤得只剩二三十像素时（IMU-B、NFC、右麦），两行会盖到上一个器件身上，
   * 就只留名字 —— 规格早在板子的丝印里写着。 */
  const two = spec && box.h >= 100 && gap >= drop + 31 + 4;
  const labelW = Math.max(nameW, two ? specW : 0) + 10;
  const plateH = two ? 31 : 19;
  const lx = Math.min(box.x, CANVAS.w - labelW - 14) - 3;
  const ly = box.y - drop - plateH;
  if (out) out.push({ dev: dev.id, x: lx, y: ly, w: labelW, h: plateH, two });
  s += `<rect x="${lx}" y="${ly}" width="${labelW}" height="${plateH}" rx="3"
    fill="#0c1117" opacity="0.94" stroke="#1f2833" stroke-width="0.8"/>`;
  s += `<text class="dev-name" x="${lx + 5}" y="${ly + 14}" font-size="11.5" fill="#dbe4ee"
    font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-weight="600">${dev.label}</text>`;
  if (two) {
    s += `<text class="dev-spec" x="${lx + 5}" y="${ly + 26}" font-size="8.8" fill="#828d99"
      font-family="ui-monospace, Menlo, monospace">${spec}</text>`;
  }
  s += '</g>';
  return s;
}

function renderConnector(c, netBusOf) {
  const body = connArt({ x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h, n: c.npins, side: c.side, type: c.type });
  let lx, ly, anchor;
  /* 顶边的脚号写在板外：顶边这条带子还要放器件标题，两样叠在板里没法看。
   * 底边写在板内（板底下面就是主干线束，写上会被线压），
   * 所以底边板的丝印名统一挪到左上角，别跟脚号抢位置。 */
  if (c.side === 'top') { lx = c.rect.x + 1; ly = c.rect.y - 5; anchor = 'start'; }
  else if (c.side === 'bottom') { lx = c.rect.x + 1; ly = c.rect.y - 5; anchor = 'start'; }
  else if (c.side === 'left') { lx = c.rect.x + CT + 5; ly = c.rect.y + 9; anchor = 'start'; }
  else { lx = c.rect.x - 5; ly = c.rect.y + 9; anchor = 'end'; }

  const pins = c.pins.map((p) => {
    const b = p.net.startsWith('#') ? null : netBusOf(p.net);
    return `<circle class="pin" data-conn="${c.id}" data-pin="${p.index}" data-net="${p.net}"
      cx="${r1(p.pos.x)}" cy="${r1(p.pos.y)}" r="2.1" fill="${b ? busColor(b) : '#8d949c'}"
      stroke="#0a0e12" stroke-width="0.6"/>`;
  }).join('');

  return `<g class="conn" data-conn="${c.id}" data-dev="${c.dev}">
    ${body}
    <text class="conn-id" x="${r1(lx)}" y="${r1(ly)}" text-anchor="${anchor}" font-size="7.6"
      fill="#b9c8bf" stroke="#0a1512" stroke-width="2.4" paint-order="stroke"
      font-family="ui-monospace, Menlo, monospace">${c.id}</text>
    ${pins}
  </g>`;
}

/* 左侧电池/电源板与主控板之间有一块空地，正好放图例。
 * 放在图里而不是只放在页面侧栏：这张 SVG 会被单独导出成 PNG 交出去，
 * 离了页面就没有侧栏了，颜色得自己解释自己。 */
function renderLegend(nt) {
  const x = 292, y = 70, w = 200, h = 106;
  const order = ['power', 'bus', 'cam', 'i2c', 'aud', 'gpio', 'rf'];
  const vis = [...nt.nets.values()].filter((n) => !n.hidden).length;
  let s = `<g class="legend">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#0c1117" opacity="0.92"
      stroke="#1f2833" stroke-width="0.8"/>
    <text x="${x + 10}" y="${y + 18}" font-size="10.5" fill="#dbe4ee" font-weight="600"
      font-family="-apple-system, 'PingFang SC', sans-serif">总线配色</text>
    <text x="${x + 10}" y="${y + 31}" font-size="8.4" fill="#77828e"
      font-family="ui-monospace, Menlo, monospace">55 插座 · 216 针 · ${vis} 网</text>
    <path d="M${x + 10} ${y + 38}H${x + w - 10}" stroke="#1f2833" stroke-width="0.8"/>`;
  order.forEach((k, i) => {
    const b = BUS_TYPES[k];
    const cx = x + 12 + (i % 2) * 86;
    const cy = y + 52 + Math.floor(i / 2) * 14;
    s += `<rect x="${cx}" y="${cy - 5}" width="8" height="4" rx="1" fill="${b.color}" opacity="0.95"/>` +
      `<text x="${cx + 13}" y="${cy}" font-size="8.4" fill="#9aa7b4"
        font-family="-apple-system, 'PingFang SC', sans-serif">${b.name}</text>`;
  });
  return s + '</g>';
}

function renderSvg({ nt, boxes, conns, wires }) {
  const { w, h } = CANVAS;
  const netBusOf = (net) => (nt.nets.get(net) || { bus: 'gpio' }).bus;
  const wiresSvg = wires.map(renderWire).join('');
  const devById = new Map(nt.devices.map((d) => [d.id, d]));
  const servos = new Map(nt.servos.map((s) => [s.id, s]));
  // 哪些器件顶边挂了插座 —— 标题要给插座和脚号让出这条带子
  const topDevs = new Set(conns.filter((c) => c.side === 'top').map((c) => c.dev));
  const botDevs = new Set(conns.filter((c) => c.side === 'bottom').map((c) => c.dev));
  /* 标题要占 box 上方的那条空档，先量一下这条空档有多高：
   * 只看"横向有重叠、且整个在它上面"的器件；上面那件的底边要是挂了插座，
   * 插座本体还要再占 CT 高度，得一起扣掉。 */
  const gapAbove = (box, id) => {
    let top = 0;
    Object.entries(boxes).forEach(([bid, b]) => {
      if (bid === id) return;
      if (b.y + b.h > box.y - 2) return;
      if (b.x >= box.x + box.w || b.x + b.w <= box.x) return;
      const bottom = b.y + b.h + (botDevs.has(bid) ? CT : 0);
      if (bottom > top) top = bottom;
    });
    return box.y - top;
  };

  const labels = [];
  let devSvg = '';
  Object.entries(boxes).forEach(([id, box]) => {
    const dev = devById.get(id);
    if (dev) {
      devSvg += renderDevice(dev, box, DEV_KIND[id] || 'mb', topDevs.has(id), gapAbove(box, id), labels);
    } else if (servos.has(id)) {
      const s = servos.get(id);
      devSvg += `<g class="dev" data-dev="${id}">` +
        `<rect x="${box.x + 1}" y="${box.y + 2}" width="${box.w}" height="${box.h}" rx="4" fill="#05080b" opacity="0.5"/>` +
        `<g transform="translate(${box.x} ${box.y})">${partArt('servo', box.w, box.h, s)}</g>` +
        `<rect x="${box.x + 1}" y="${box.y + box.h - 13}" width="${s.label.length * 7.6 + 4}" height="11" rx="2"
          fill="#0b0f14" opacity="0.7"/>` +
        `<text x="${box.x + 3}" y="${box.y + box.h - 4}" font-size="7.4" fill="#9aa3ad"
          font-family="-apple-system, 'PingFang SC', sans-serif">${s.label}</text></g>`;
    }
  });

  const connSvg = conns.map((c) => renderConnector(c, netBusOf)).join('');

  // 没有连线的插座标 NC，别让人以为是漏画
  const wiredConn = new Set(wires.flatMap((x) => [x.from.split('.')[0], x.to.split('.')[0]]));
  const ncSvg = conns.filter((c) => !wiredConn.has(c.id)).map((c) => {
    const cx = c.rect.x + c.rect.w / 2, cy = c.rect.y + c.rect.h / 2;
    const dx = c.side === 'left' ? -12 : c.side === 'right' ? 12 : 16;
    const dy = c.side === 'top' ? -6 : c.side === 'bottom' ? 26 : 2;
    return `<text x="${r1(cx + dx)}" y="${r1(cy + dy)}" font-size="7" fill="#c9a45c"
      text-anchor="middle" font-family="ui-monospace, Menlo, monospace">NC</text>`;
  }).join('');

  const notes = `
    <g class="notes" font-family="ui-monospace, Menlo, monospace">
      <text x="24" y="${h - 34}" font-size="10" fill="#5d6772">示意图不按比例 · 真实尺寸与壁厚见外观图</text>
      <text x="24" y="${h - 18}" font-size="10" fill="#5d6772">舵机 3P 中的 VSERVO / GND 是总线板铜皮（# 网），图上只画 SIG</text>
      <text x="${w - 24}" y="${h - 18}" font-size="10" fill="#5d6772" text-anchor="end">
        MICRODUCK · 器件接线图 · SHEET 2/2</text>
    </g>`;

  return { labels, svg: `<svg id="board" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"
    width="${w}" height="${h}" font-family="-apple-system, BlinkMacSystemFont, sans-serif">
    ${svgDefs()}
    <defs>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M32 0H0V32" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="#0b0f14"/>
    <rect width="${w}" height="${h}" fill="url(#grid)"/>
    <g class="wires">${wiresSvg}</g>
    <g class="devices">${devSvg}</g>
    <g class="connectors">${connSvg}</g>
    ${ncSvg}
    ${renderLegend(nt)}
    ${notes}
  </svg>` };
}
