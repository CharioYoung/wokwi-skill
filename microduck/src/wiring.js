/* ==================================================================== *
 * 电气连接拓扑 —— 总线泳道图
 *
 * 3D 视图里的线束只回答"线怎么走"，回答不了"接到哪个口、走什么总线"。
 * 这张图补的是后者：一行一路总线，左进右出，中间是主控。
 *
 * 为什么是泳道而不是蛛网：之前试过把器件摆成一圈、从主控放射连线，
 * 十一条线在主控边缘挤成一束，绕行、压字，反而看不清谁连谁。
 * 泳道把"连接关系"压成每行独立的一条，行与行不可能交叉 ——
 * 这是电路框图本来的画法，不是妥协。
 *
 * 颜色与 3D 线束一一对应：在 3D 里看到一根青线，这里就知道是哪一路。
 * ==================================================================== */

export const BUS_TYPES = {
  power: { name: '电源', color: '#ff6b3d' },
  bus: { name: '舵机总线 UART', color: '#4fd8ff' },
  cam: { name: '视频 MIPI CSI-2', color: '#c48bff' },
  i2c: { name: 'I2C 传感', color: '#6ef2a6' },
  aud: { name: '音频 I2S', color: '#ffd24a' },
  gpio: { name: 'GPIO', color: '#9aa1ac' },
  rf: { name: '无线', color: '#7fd4ff' },
};

/* 画布 900×620。三块：左器件区、中间主控带、右器件区。 */
export const GEO = {
  w: 900, h: 620,
  mcu: { x: 392, y: 40, w: 116, h: 540 },
  left: { x: 44, w: 140, h: 40 },
  left2: { x: 206, w: 144, h: 40 },
  right: { x: 612, w: 146, h: 40 },
  right2: { x: 746, w: 142, h: 40 },
};

/* lane：一行一路。left 从左边接进主控，right 从主控接出去。 */
export const LANES = [
  { y: 92, bus: 'rf', tag: 'SDIO / UART',
    right: { id: 'radio', label: 'Wi-Fi / BT', sub: '板载模组' } },

  { y: 142, bus: 'cam', tag: 'MIPI CSI-2',
    left: { id: 'cam', label: '摄像头', sub: '单目 · 左眼' } },

  { y: 192, bus: 'i2c', tag: 'I2C · 0x52',
    left: { id: 'lidar', label: 'LiDAR', sub: '额前扫描窗' } },

  { y: 242, bus: 'i2c', tag: 'I2C · 0x68',
    left: { id: 'imu', label: 'IMU ×2', sub: '主控旁 + 近地' } },

  { y: 292, bus: 'i2c', tag: 'I2C · 0x24',
    left: { id: 'nfc', label: 'NFC ×2', sub: '胸前面板' } },

  { y: 342, bus: 'aud', tag: 'I2S IN',
    left: { id: 'mic', label: '麦克风 ×2', sub: '双侧拾音孔' } },

  { y: 392, bus: 'bus', tag: 'UART2 · 1 Mbps',
    right: { id: 'joint', label: '舵机总线板', sub: '15 路 · 腿10 颈2 头1 喙2' } },

  { y: 442, bus: 'aud', tag: 'I2S OUT',
    right: { id: 'spk', label: '扬声器', sub: '胸腔朝前' } },

  { y: 492, bus: 'gpio', tag: 'GPIO',
    right: { id: 'led', label: '状态灯', sub: '胸前三颗' } },

  // 电源单独一行，因为它在左边有两个串联的器件
  { y: 542, bus: 'power', tag: null,
    left: { id: 'bat', label: 'NP-F550', sub: '2600 mAh · 可拆' },
    left2: { id: 'pwr', label: '电源分配板', sub: '7.2V → 5V / 3.3V / 6V' } },
];

/* 主控带上的引脚刻度：每条总线在带子上的着陆点，视觉上表明"这不是一根线，
 * 是一个端口"。位置跟着 lane 的 y 走。 */
export function pins() {
  return LANES.map((l) => ({ y: l.y, bus: l.bus }));
}

/* ---------- 渲染 ---------- */

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function box(g, x, y, w, h, cls) {
  return g.appendChild(el('rect', {
    x, y, width: w, height: h, rx: 10, ry: 10, class: cls || 'node-box',
  }));
}

function labelPair(g, cx, cy, label, sub) {
  const t1 = el('text', { x: cx, y: cy - 3, 'text-anchor': 'middle', class: 'node-label' });
  t1.textContent = label;
  g.appendChild(t1);
  const t2 = el('text', { x: cx, y: cy + 12, 'text-anchor': 'middle', class: 'node-sub' });
  t2.textContent = sub;
  g.appendChild(t2);
}

export function renderWiring(svgRoot) {
  while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);

  const gWires = el('g', { class: 'wires' });
  const gNodes = el('g', { class: 'nodes' });
  svgRoot.appendChild(gWires);
  svgRoot.appendChild(gNodes);

  const G = GEO;

  /* 主控带：一条竖带，所有总线都落在它身上。
   * 它不是一个"节点"，是这张图的脊柱 —— 每条泳道都接到同一根柱子上。 */
  const mcuG = el('g', { class: 'mcu-band' });
  gNodes.appendChild(mcuG);
  mcuG.appendChild(el('rect', {
    x: G.mcu.x, y: G.mcu.y, width: G.mcu.w, height: G.mcu.h,
    rx: 18, ry: 18, class: 'band-box',
  }));
  const mc = G.mcu.x + G.mcu.w / 2;
  const mt = el('text', { x: mc, y: G.mcu.y + 30, 'text-anchor': 'middle', class: 'band-title' });
  mt.textContent = 'RK3566';
  mcuG.appendChild(mt);
  const ms = el('text', { x: mc, y: G.mcu.y + 46, 'text-anchor': 'middle', class: 'band-sub' });
  ms.textContent = '四核 A55 · 50 Hz';
  mcuG.appendChild(ms);

  // 引脚刻度
  pins().forEach((p) => {
    [G.mcu.x - 3, G.mcu.x + G.mcu.w + 1].forEach((x) => {
      mcuG.appendChild(el('rect', {
        x, y: p.y - 1.6, width: 2, height: 3.2, rx: 1,
        fill: BUS_TYPES[p.bus].color, opacity: 0.9,
      }));
    });
  });

  const rowEls = [];
  const nodeEls = [];

  LANES.forEach((lane) => {
    const color = BUS_TYPES[lane.bus].color;
    const row = el('g', { class: 'lane', 'data-bus': lane.bus });
    gWires.appendChild(row);

    // 行底纹：隔行淡一点，帮助横向阅读，不做网格线
    row.appendChild(el('rect', {
      x: 16, y: lane.y - 24, width: G.w - 32, height: 48, rx: 9,
      class: 'lane-bg',
    }));

    const wire = (x1, x2) => {
      // 直线段 + 两端小圆头；泳道内不做曲线，曲线是交叉的来源
      row.appendChild(el('line', {
        x1, y1: lane.y, x2, y2: lane.y,
        stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.9,
      }));
      const dot = el('circle', { r: 3, fill: color });
      row.appendChild(dot);
      const anim = el('animateMotion', {
        dur: `${2.6 + (lane.y % 5) * 0.3}s`, repeatCount: 'indefinite',
        path: `M ${x1} ${lane.y} L ${x2} ${lane.y}`,
      });
      dot.appendChild(anim);
    };

    const tagAt = (x1, x2) => {
      if (!lane.tag) return;
      const t = el('text', {
        x: (x1 + x2) / 2, y: lane.y - 7, 'text-anchor': 'middle',
        class: 'edge-label', fill: color,
      });
      t.textContent = lane.tag;
      row.appendChild(t);
    };

    if (lane.left) {
      const b = G.left;
      const g = el('g', { class: 'node' });
      box(g, b.x, lane.y - b.h / 2, b.w, b.h);
      labelPair(g, b.x + b.w / 2, lane.y, lane.left.label, lane.left.sub);
      gNodes.appendChild(g);
      nodeEls.push({ id: lane.left.id, g });

      if (lane.left2) {
        const b2 = G.left2;
        const g2 = el('g', { class: 'node' });
        box(g2, b2.x, lane.y - b2.h / 2, b2.w, b2.h);
        labelPair(g2, b2.x + b2.w / 2, lane.y, lane.left2.label, lane.left2.sub);
        gNodes.appendChild(g2);
        nodeEls.push({ id: lane.left2.id, g: g2 });
        wire(b.x + b.w + 2, b2.x - 2);
        wire(b2.x + b2.w + 2, G.mcu.x - 4);
        if (lane.tag) tagAt(G.mcu.x - 4 - 78, G.mcu.x - 4);
      } else {
        wire(b.x + b.w + 2, G.mcu.x - 4);
        tagAt(b.x + b.w + 2, G.mcu.x - 4);
      }
    }

    if (lane.right) {
      const b = G.right;
      const g = el('g', { class: 'node' });
      box(g, b.x, lane.y - b.h / 2, b.w, b.h);
      labelPair(g, b.x + b.w / 2, lane.y, lane.right.label, lane.right.sub);
      gNodes.appendChild(g);
      nodeEls.push({ id: lane.right.id, g });
      wire(G.mcu.x + G.mcu.w + 4, b.x - 2);
      tagAt(G.mcu.x + G.mcu.w + 4, b.x - 2);
    }

    rowEls.push({ lane, row });
  });

  /* 高亮：泳道图里"谁连谁"本来就一目了然，所以高亮只做一件事 ——
   * 把鼠标所在那一行之外的全部压暗，读单一路径时不受其他行干扰。 */
  let focusBus = null;
  function applyFocus(bus) {
    focusBus = bus;
    rowEls.forEach(({ lane, row }) => {
      row.classList.toggle('dim', bus != null && lane.bus !== bus);
    });
    nodeEls.forEach(({ g }) => g.classList.remove('dim'));
  }
  rowEls.forEach(({ lane, row }) => {
    row.addEventListener('mouseenter', () => applyFocus(lane.bus));
    row.addEventListener('mouseleave', () => applyFocus(null));
  });
  mcuG.addEventListener('mouseenter', () => applyFocus(null));
  svgRoot.addEventListener('mouseleave', () => applyFocus(null));

  return { nodes: nodeEls.length + 1, edges: rowEls.length, lanes: LANES.length };
}

export function busLegend() {
  return Object.entries(BUS_TYPES).map(([k, v]) => ({ key: k, ...v }));
}
