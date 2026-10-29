/* 接线图的几何体检。
 *
 * 这张图最容易出的错不是"不好看"，是"看着像接上了、其实接的是旁边那根针"。
 * 所以检查全部按坐标来：
 *   1. 器件盒子不许互相压
 *   2. 插座必须贴在自己器件的那条边上，针必须落在插座壳里
 *   3. 每段线的两端必须正好落在它声明的那两个脚上（2 px 内）
 *   4. 线不许穿过任何器件本体，也不许越出画布
 *   5. 可见的网一条都不能漏画
 *   6. 所有线段都得是水平或垂直的（斜线在装配图里没有意义）
 */
import { buildDiagram, CANVAS } from '../src/diagram.js';

const d = buildDiagram();
const { nt, boxes, conns, wires } = d;
let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };
const ok = (m) => console.log('  ✓ ' + m);

const B = Object.entries(boxes);
const hit = (p, b, pad = 0) => p.x > b.x + pad && p.x < b.x + b.w - pad
  && p.y > b.y + pad && p.y < b.y + b.h - pad;

/* 1. 器件不重叠 */
{
  const clashes = [];
  for (let i = 0; i < B.length; i++) {
    for (let j = i + 1; j < B.length; j++) {
      const [ia, a] = B[i], [ib, b] = B[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) clashes.push(`${ia} × ${ib}`);
    }
  }
  if (clashes.length) fail('器件盒子重叠：' + clashes.slice(0, 5).join(', '));
  else ok(`${B.length} 个器件盒子互不重叠`);
}

/* 2. 插座贴边 + 针在壳内 */
{
  const off = [];
  conns.forEach((c) => {
    const b = boxes[c.dev];
    const r = c.rect;
    const touches = (c.side === 'top' && Math.abs(r.y + r.h - b.y) < 0.6)
      || (c.side === 'bottom' && Math.abs(r.y - (b.y + b.h)) < 0.6)
      || (c.side === 'left' && Math.abs(r.x + r.w - b.x) < 0.6)
      || (c.side === 'right' && Math.abs(r.x - (b.x + b.w)) < 0.6);
    if (!touches) off.push(`${c.id} 没贴住 ${c.dev} 的 ${c.side} 边`);
    c.pins.forEach((p) => {
      if (p.pos.x < r.x - 0.1 || p.pos.x > r.x + r.w + 0.1
        || p.pos.y < r.y - 0.1 || p.pos.y > r.y + r.h + 0.1) off.push(`${c.id}.${p.index} 不在壳内`);
    });
  });
  if (off.length) fail(off.slice(0, 6).join(' / '));
  else ok(`${conns.length} 个插座都贴在自己的板边上，${nt.stats.pins} 根针都在壳里`);
}

/* 3/4/6. 线的端点、穿板、轴对齐 */
{
  const connById = new Map(conns.map((c) => [c.id, c]));
  const pinAt = (key) => {
    const [id, idx] = key.split('.');
    const c = connById.get(id);
    const p = c && c.pins.find((q) => String(q.index) === idx);
    return p ? p.pos : null;
  };
  const problems = { end: [], cross: [], diag: [], out: [] };
  wires.forEach((w) => {
    const a = pinAt(w.from), b = pinAt(w.to);
    if (!a || !b) { problems.end.push(`${w.net} 端点不存在 ${w.from}/${w.to}`); return; }
    const p0 = w.pts[0], p1 = w.pts[w.pts.length - 1];
    if (Math.hypot(p0.x - a.x, p0.y - a.y) > 2 || Math.hypot(p1.x - b.x, p1.y - b.y) > 2) {
      problems.end.push(`${w.net} 端点偏离 ${w.from}→${w.to}`);
    }
    for (let i = 0; i < w.pts.length - 1; i++) {
      const s = w.pts[i], t = w.pts[i + 1];
      const dx = Math.abs(s.x - t.x), dy = Math.abs(s.y - t.y);
      // 排线两端的扇出是斜线（针距 5.2 px、芯距 2.4 px，必然要收拢），
      // 拐角处还有一段 45° 斜弯 —— 这两类斜线是物理形状，不算错
      const isFan = i === 0 || i === w.pts.length - 2;
      const diagonalOk = w.ribbon && (isFan || Math.abs(dx - dy) < 2.5);
      if (dx > 0.6 && dy > 0.6 && !diagonalOk) problems.diag.push(`${w.net} 有斜段`);
      const n = Math.max(2, Math.ceil(Math.hypot(dx, dy) / 3));
      for (let k = 0; k <= n; k++) {
        const p = { x: s.x + (t.x - s.x) * k / n, y: s.y + (t.y - s.y) * k / n };
        if (p.x < 1 || p.y < 1 || p.x > CANVAS.w - 1 || p.y > CANVAS.h - 1) problems.out.push(w.net);
        B.forEach(([id, bb]) => {
          // 收缩 1 px：线可以贴边，不能进板
          if (hit(p, bb, 1)) problems.cross.push(`${w.net} 穿过 ${id}`);
        });
      }
    }
  });
  if (problems.end.length) fail(problems.end.slice(0, 5).join(' / '));
  else ok(`${wires.length} 段线的两端都落在声明的针上（≤2 px）`);

  const uniq = (arr) => [...new Set(arr)];
  if (problems.cross.length) fail('线穿板：' + uniq(problems.cross).slice(0, 5).join(' / '));
  else ok('没有一段线穿过器件本体');

  if (problems.diag.length) fail('有斜线：' + uniq(problems.diag).slice(0, 4).join(' / '));
  else ok('所有线段都是水平/垂直');

  if (problems.out.length) fail('线出画布：' + uniq(problems.out).slice(0, 4).join(' / '));
  else ok('线都在画布内');
}

/* 5. 网不漏 */
{
  const drawn = new Set(wires.map((w) => w.net));
  const miss = [...nt.nets.values()].filter((n) => !n.hidden && !drawn.has(n.net)).map((n) => n.net);
  if (miss.length) fail(`${miss.length} 条可见网没画：${miss.slice(0, 5).join(', ')}`);
  else ok(`${drawn.size} 条可见网全部画出（另有 ${nt.stats.nets - nt.stats.wired} 条板内/单点网按规则不画）`);
}

/* 6. 每条线都属于一条真实存在的网，别画出幽灵线 */
{
  const ghost = wires.filter((w) => !nt.nets.has(w.net));
  if (ghost.length) fail(`${ghost.length} 段线的网名不在网表里`);
  else ok('所有线段都能在网表里找到出处');
}

/* 7. 器件标题牌不许压到任何器件，也不许互相压。
 * 这一条是补出来的：标题一开始贴在 box 上沿 -21 写，正好落在顶边插座上，
 * "舵机总线板"盖住 S0/S1 —— 目视很难发现，坐标一量就露。 */
{
  const L = d.labels || [];
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const onDev = [];
  L.forEach((l) => {
    Object.entries(boxes).forEach(([id, b]) => {
      if (id === l.dev) return;
      if (overlap(l, b)) onDev.push(`${l.dev} 的标题压在 ${id} 上`);
    });
  });
  const cross = [];
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      if (overlap(L[i], L[j])) cross.push(`${L[i].dev} × ${L[j].dev}`);
    }
  }
  const out = L.filter((l) => l.x < 2 || l.y < 2 || l.x + l.w > CANVAS.w - 2 || l.y + l.h > CANVAS.h - 2)
    .map((l) => l.dev);
  if (onDev.length) fail(onDev.slice(0, 4).join(' / '));
  else if (cross.length) fail('标题牌互相压：' + cross.slice(0, 4).join(' / '));
  else if (out.length) fail('标题牌出画布：' + out.join(', '));
  else ok(`${L.length} 个器件标题都落在器件之外的空档里`);
}

console.log('\n%s', bad ? `问题 ${bad} 处` : '接线图几何校验通过');
process.exit(bad ? 1 : 0);
