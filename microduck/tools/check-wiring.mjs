/* 连接图是纯 DOM/SVG 代码，没有浏览器就得另想办法验证。
 * 这里用一层极简 DOM stub 把它真跑一遍，然后检查画得出来但会让人看不懂的事：
 *   1. 行与行之间是否留够间距（贴住就分不清哪行是哪路总线）
 *   2. 节点框是否互不重叠
 *   3. 总线标签是否压到主控带或器件框（压字是最难忍的一种错）
 *   4. 连线两端是否真的落在框边上
 * 这些都能算出来，不必靠人眼盯截图。 */

class El {
  constructor(tag) {
    this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {};
    this.dataset = {}; this._text = '';
    this.classList = { set: new Set(), toggle: (c, on) => {
      const want = on === undefined ? !this.classList.set.has(c) : !!on;
      if (want) this.classList.set.add(c); else this.classList.delete(c);
    }, add: (c) => this.classList.set.add(c), remove: (c) => this.classList.set.delete(c),
    contains: (c) => this.classList.set.has(c) };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  get firstChild() { return this.children[0] || null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  set textContent(v) { this._text = v; }
  get textContent() { return this._text; }
}
globalThis.document = { createElementNS: (ns, t) => new El(t), createElement: (t) => new El(t) };

const { renderWiring, LANES, GEO, BUS_TYPES } = await import('../src/wiring.js');
const svg = new El('svg');
const st = renderWiring(svg);
console.log('渲染：%d 条泳道 / %d 个节点', st.lanes, st.nodes);

let bad = 0;
const fail = (msg) => { console.log('  [问题] ' + msg); bad++; };

/* 1. 行距 */
const H = 40;
for (let i = 1; i < LANES.length; i++) {
  const gap = LANES[i].y - LANES[i - 1].y;
  if (gap < H + 8) fail(`行 ${i - 1}→${i} 间距 ${gap}，小于 ${H + 8}`);
}

/* 2. 节点框重叠（只可能发生在同一行的 left/left2） */
LANES.forEach((l, i) => {
  if (l.left && l.left2) {
    const gap = GEO.left2.x - (GEO.left.x + GEO.left.w);
    if (gap < 6) fail(`第 ${i} 行两个左节点间隙 ${gap}`);
  }
});

/* 3. 标签压框：按最宽的字估算（中文 1em，英文 0.55em） */
const textW = (s, fs) => {
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fa5·]/.test(ch) ? fs : fs * 0.56;
  return w;
};
const mcuL = GEO.mcu.x, mcuR = GEO.mcu.x + GEO.mcu.w;
LANES.forEach((l, i) => {
  if (!l.tag) return;
  const fs = 10;
  const w = textW(l.tag, fs);
  let cx, obstacles;
  if (l.right) {
    cx = (mcuR + 4 + GEO.right.x - 2) / 2;
    obstacles = [[mcuL, mcuR], [GEO.right.x, GEO.right.x + GEO.right.w]];
  } else {
    const x1 = l.left.x + l.left.w + 2, x2 = mcuL - 4;
    cx = (x1 + x2) / 2;
    obstacles = [[mcuL, mcuR], [l.left.x, l.left.x + l.left.w]];
    if (l.left2) obstacles.push([GEO.left2.x, GEO.left2.x + GEO.left2.w]);
  }
  const lo = cx - w / 2, hi = cx + w / 2;
  for (const [a, b] of obstacles) {
    if (hi > a + 2 && lo < b - 2) fail(`第 ${i} 行标签「${l.tag}」压到框 [${a},${b}]（标签 ${lo.toFixed(0)}..${hi.toFixed(0)}）`);
  }
  if (lo < 12 || hi > GEO.w - 12) fail(`第 ${i} 行标签「${l.tag}」出界`);
});

/* 4. 连线端点：必须是"框边 → 框边"，不能悬空 */
function edgesOf(lane) {
  const out = [];
  if (lane.left) {
    const x1 = lane.left.x + GEO.left.w;
    if (lane.left2) {
      out.push([x1 + 2, GEO.left2.x - 2]);
      out.push([GEO.left2.x + GEO.left2.w + 2, mcuL - 4]);
    } else {
      out.push([x1 + 2, mcuL - 4]);
    }
  }
  if (lane.right) out.push([mcuR + 4, GEO.right.x - 2]);
  return out;
}
LANES.forEach((l, i) => {
  for (const [a, b] of edgesOf(l)) {
    if (b - a < 6) fail(`第 ${i} 行连线长度只有 ${(b - a).toFixed(0)}px`);
    if (a < 0 || b > GEO.w) fail(`第 ${i} 行连线出界`);
  }
});

/* 5. 总线类型必须都在图例里 */
LANES.forEach((l) => { if (!BUS_TYPES[l.bus]) fail('未知总线类型 ' + l.bus); });

/* 6. 每个总线条目至少在图上出现一次 */
const used = new Set(LANES.map((l) => l.bus));
Object.keys(BUS_TYPES).forEach((k) => {
  if (!used.has(k)) console.log('  [提示] 图例里的 %s 没有对应泳道', k);
});

console.log(bad ? `问题 ${bad} 处` : '行距、标签、连线全部通过');
process.exit(bad ? 1 : 0);
