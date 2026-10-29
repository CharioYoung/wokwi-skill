/* 把连接图真的画出来看一眼。
 * 页面里的样式是 CSS 类，独立 SVG 没有外层 #wiringSvg，所以这里把同一套
 * 规则抄成内联 <style>，再用 resvg 光栅化 —— 布局对不对，眼睛比断言可靠。 */
import fs from 'fs';
import { Resvg } from '@resvg/resvg-js';

class El {
  constructor(tag) {
    this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {};
    this.dataset = {}; this._text = '';
    this.classList = { set: new Set(), toggle: (c, on) => {
      const want = on === undefined ? !this.classList.set.has(c) : !!on;
      if (want) this.classList.set.add(c); else this.classList.set.delete(c);
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

const { renderWiring, BUS_TYPES } = await import('../src/wiring.js');
const svg = new El('svg');
renderWiring(svg);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function ser(n) {
  const attrs = Object.entries(n.attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  if (n.tag === 'animateMotion') return `<${n.tag} ${attrs} />`;
  const cls = n.classList.set.size ? ` class="${[...n.classList.set].join(' ')}"` : '';
  const inner = n.children.map(ser).join('');
  if (n.tag === 'text') return `<text ${attrs}${cls}>${esc(n._text)}</text>`;
  return `<${n.tag} ${attrs}${cls}>${inner}</${n.tag}>`;
}
const body = svg.children.map(ser).join('');

const legend = Object.values(BUS_TYPES).map((b) =>
  `<span><i style="background:${b.color}"></i>${b.name}</span>`).join('');

const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="700" viewBox="0 0 900 620">
<style>
  .node-box { fill: #1a1e25; stroke: rgba(255,255,255,0.14); stroke-width: 1.1; }
  .band-box { fill: rgba(245,165,60,0.085); stroke: rgba(245,165,60,0.5); stroke-width: 1.4; }
  .band-title { fill: #ffd9a3; font-size: 13.5px; font-weight: 700; font-family: "Microsoft YaHei", sans-serif; }
  .band-sub { fill: #b08a5c; font-size: 9.5px; font-family: "Microsoft YaHei", sans-serif; }
  .lane-bg { fill: rgba(255,255,255,0.025); }
  .node-label { fill: #e8eaee; font-size: 12.5px; font-weight: 600; font-family: "Microsoft YaHei", sans-serif; }
  .node-sub { fill: #868d99; font-size: 9.5px; font-family: "Microsoft YaHei", sans-serif; }
  .edge-label { font-size: 10px; font-family: "Microsoft YaHei", sans-serif; }
</style>
<rect width="900" height="620" fill="#0d0f12"/>
${body}
${Object.values(BUS_TYPES).map((b, i) =>
  `<rect x="${40 + i * 122}" y="600" width="16" height="3" rx="1.5" fill="${b.color}"/>` +
  `<text x="${62 + i * 122}" y="605" font-size="9.5" fill="#8b929d" font-family="Microsoft YaHei">${esc(b.name)}</text>`
).join('')}
</svg>`;

fs.writeFileSync('.dev/wiring.svg', doc);
const png = new Resvg(doc, { fitTo: { mode: 'width', value: 1020 }, font: { loadSystemFonts: true } })
  .render().asPng();
fs.writeFileSync('.dev/wiring.png', png);
console.log('wrote .dev/wiring.png  %d KB', Math.round(png.length / 1024));
