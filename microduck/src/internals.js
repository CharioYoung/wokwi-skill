/* ==================================================================== *
 * 接线图页面 —— 挂载 SVG、平移缩放、按总线/插座/网高亮
 *
 * 这里没有 three，也没有外壳。器件图是平面图：板子摊开，针脚朝外，
 * 线的端点是具体某一根针。要查"J5 第 3 脚是不是 SCL"，点一下插座，
 * 右侧出引脚表，图上那几根线亮起来，其余压暗。
 * ==================================================================== */

import { buildDiagram, CANVAS } from './diagram.js';
import { netRows, bomRows } from './netlist.js';
import { BUS_TYPES } from './bus.js';

const $ = (id) => document.getElementById(id);

window.addEventListener('error', (e) => {
  const boot = $('boot');
  if (!boot) return;
  boot.classList.remove('hide');
  boot.innerHTML = '<div class="fail">渲染出错：<br><code>' +
    String(e.message || e).replace(/</g, '&lt;') + '</code></div>';
});

const diagram = buildDiagram();
const { nt, conns, wires } = diagram;
$('stage').innerHTML = diagram.svg;
const svg = document.querySelector('#board');

/* ---------- 视图：平移 / 缩放 ---------- */
const view = { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };
const MIN_W = 260;
const MAX_W = CANVAS.w * 1.5;

function applyView() {
  svg.setAttribute('viewBox', `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`);
}

function toSvg(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  const scale = Math.min(r.width / view.w, r.height / view.h);
  const offX = (r.width - view.w * scale) / 2;
  const offY = (r.height - view.h * scale) / 2;
  return {
    x: view.x + (clientX - r.left - offX) / scale,
    y: view.y + (clientY - r.top - offY) / scale,
  };
}

function zoomAt(factor, cx, cy) {
  const p = toSvg(cx, cy);
  const nw = Math.max(MIN_W, Math.min(MAX_W, view.w * factor));
  const k = nw / view.w;
  view.x = p.x - (p.x - view.x) * k;
  view.y = p.y - (p.y - view.y) * k;
  view.w = nw;
  view.h = CANVAS.h * (nw / CANVAS.w);
  applyView();
}

function fitView() {
  view.x = 0; view.y = 0; view.w = CANVAS.w; view.h = CANVAS.h;
  applyView();
}

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.deltaY > 0 ? 1.12 : 0.89, e.clientX, e.clientY);
}, { passive: false });

let drag = null;
svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = svg.getBoundingClientRect();
  const scale = Math.min(r.width / view.w, r.height / view.h);
  const dx = (e.clientX - drag.x) / scale;
  const dy = (e.clientY - drag.y) / scale;
  if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
  view.x = drag.vx - dx;
  view.y = drag.vy - dy;
  applyView();
});
svg.addEventListener('pointerup', (e) => {
  const moved = drag && drag.moved;
  drag = null;
  try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* 指针已释放 */ }
  if (moved) return;
  handleClick(e);
});
svg.addEventListener('dblclick', fitView);

/* ---------- 选中状态 ---------- */
const state = { conn: null, net: null, bus: null, nums: false };

const wireEls = [...svg.querySelectorAll('.wire')];
const pinEls = [...svg.querySelectorAll('.pin')];
const connEls = [...svg.querySelectorAll('.conn')];
const devEls = [...svg.querySelectorAll('.dev')];
const numLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
numLayer.setAttribute('class', 'pinnums');
svg.appendChild(numLayer);

function clearHighlight() {
  wireEls.forEach((w) => { w.classList.remove('hl', 'dim'); });
  pinEls.forEach((p) => { p.classList.remove('hl'); });
  connEls.forEach((c) => { c.classList.remove('hl', 'dim'); });
  devEls.forEach((d) => { d.classList.remove('hl', 'dim'); });
  numLayer.textContent = '';
}

function highlight() {
  clearHighlight();
  const { conn, net, bus } = state;

  if (net) {
    wireEls.forEach((w) => {
      const on = w.dataset.net === net;
      w.classList.toggle('hl', on);
      w.classList.toggle('dim', !on);
    });
    connEls.forEach((c) => { c.classList.toggle('dim', !(c.dataset.conn === netConn(net))); });
    devEls.forEach((d) => { d.classList.add('dim'); });
    const cid = netConn(net);
    if (cid) devEls.forEach((d) => { if (d.dataset.dev === connDev(cid)) d.classList.remove('dim'); });
    return;
  }

  if (conn) {
    const c = diagram.conns.find((x) => x.id === conn);
    const nets = new Set(c.pins.map((p) => p.net));
    wireEls.forEach((w) => {
      const on = nets.has(w.dataset.net);
      w.classList.toggle('hl', on);
      w.classList.toggle('dim', !on);
    });
    pinEls.forEach((p) => { p.classList.toggle('hl', p.dataset.conn === conn); });
    connEls.forEach((x) => { x.classList.toggle('hl', x.dataset.conn === conn); });
    devEls.forEach((d) => { d.classList.toggle('dim', d.dataset.dev !== c.dev); });
    if (state.nums) drawPinNumbers(c);
    return;
  }

  if (bus) {
    wireEls.forEach((w) => {
      const on = w.dataset.bus === bus;
      w.classList.toggle('hl', on);
      w.classList.toggle('dim', !on);
    });
  }
}

const connDev = (id) => (nt.byConn.get(id) || {}).dev;
const netConn = (net) => {
  const w = wires.find((x) => x.net === net);
  return w ? w.from.split('.')[0] : null;
};

/* 选中插座的引脚号：标在针的外侧，跟着缩放一起缩放，所以用 SVG 文本 */
function drawPinNumbers(c) {
  numLayer.textContent = '';
  const dx = c.normal.x * 11, dy = c.normal.y * 11;
  c.pins.forEach((p) => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(p.pos.x + dx));
    t.setAttribute('y', String(p.pos.y + dy + 2.6));
    t.setAttribute('text-anchor', c.normal.x < 0 ? 'end' : c.normal.x > 0 ? 'start' : 'middle');
    t.setAttribute('font-size', '7');
    t.setAttribute('fill', '#d9f4ff');
    t.setAttribute('stroke', '#07110f');
    t.setAttribute('stroke-width', '2.2');
    t.setAttribute('paint-order', 'stroke');
    t.setAttribute('font-family', 'ui-monospace, Menlo, monospace');
    t.textContent = String(p.index);
    numLayer.appendChild(t);
  });
}

/* ---------- 点击 / 悬停 ---------- */
const tip = $('tip');

function closest(el, sel) {
  return el && el.closest ? el.closest(sel) : null;
}

function handleClick(e) {
  const pin = closest(e.target, '.pin');
  if (pin) {
    state.net = pin.dataset.net;
    state.conn = pin.dataset.conn;
    selectConn(pin.dataset.conn, true);
    return;
  }
  const conn = closest(e.target, '.conn');
  if (conn) {
    state.net = null;
    selectConn(conn.dataset.conn);
    return;
  }
  state.conn = null; state.net = null;
  setPanelIdle();
  highlight();
}

let hoverT = 0;
svg.addEventListener('pointermove', (e) => {
  if (drag) return;
  const now = performance.now();
  if (now - hoverT < 60) return;
  hoverT = now;
  const w = closest(e.target, '.wire');
  const c = closest(e.target, '.conn');
  let html = '';
  if (w) {
    html = `<b>${w.dataset.tip.split(' · ')[0]}</b><i>${w.dataset.from} → ${w.dataset.to}</i>`;
  } else if (c) {
    const conn = nt.byConn.get(c.dataset.conn);
    html = `<b>${conn.id}</b> ${conn.label}<i>${conn.typeName} · ${conn.npins}P</i>`;
  }
  if (!html) { tip.style.display = 'none'; return; }
  const r = svg.getBoundingClientRect();
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 240) + 'px';
  tip.style.top = Math.max(10, e.clientY - r.top - 42) + 'px';
});
svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; });

/* ---------- 右侧面板 ---------- */
const connById = new Map(conns.map((c) => [c.id, c]));

function setPanelIdle() {
  $('pinHead').textContent = '引脚表';
  $('pinBody').innerHTML = '<div class="empty">在图上点一个插座或一根线。<br />' +
    '插座看全部引脚，线看它两端接到哪。</div>';
  $('netInfo').style.display = 'none';
}

function selectConn(id, keepNet) {
  state.conn = id;
  const c = connById.get(id);
  if (!c) { setPanelIdle(); return; }
  if (!keepNet) state.net = null;
  highlight();

  $('pinHead').innerHTML = `${c.id} · ${c.label} <s>${c.typeName} · ${c.npins}P · ${c.dev}</s>`;
  const tb = c.pins.map((p) => {
    const rec = nt.nets.get(p.net);
    const others = (rec ? rec.pins : []).filter((q) => !(q.conn === p.conn && q.index === p.index));
    const hidden = p.net.startsWith('#');
    const rowCls = state.net === p.net ? ' class="on"' : '';
    return `<tr${rowCls} data-pin-net="${p.net}">
      <td class="n">${p.index}</td>
      <td class="${hidden ? 'dim' : ''}">${p.net.replace(/^#/, '')}${p.net.includes(':') ? '<s>:' + p.net.split(':')[1] + '</s>' : ''}</td>
      <td>${hidden ? '<span class="dim">板内铜皮</span>'
        : (others.length ? others.map((q) => q.conn + '.' + q.index).join(', ') : '<span class="dim">单点网</span>')}</td>
    </tr>`;
  }).join('');
  $('pinBody').innerHTML = `<table><thead><tr><th>脚</th><th>网名</th><th>接去哪</th></tr></thead>
    <tbody>${tb}</tbody></table>`;
  $('pinBody').querySelectorAll('tr[data-pin-net]').forEach((tr) => {
    tr.onclick = () => {
      state.net = tr.dataset.pinNet;
      highlight();
      renderPinTableSelection();
      renderNetInfo();
    };
  });
  renderNetInfo();
}

function renderPinTableSelection() {
  $('pinBody').querySelectorAll('tr[data-pin-net]').forEach((tr) => {
    tr.classList.toggle('on', tr.dataset.pinNet === state.net);
  });
}

function renderNetInfo() {
  const box = $('netInfo');
  if (!state.net) { box.style.display = 'none'; return; }
  const rec = nt.nets.get(state.net);
  if (!rec) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const ends = rec.pins.map((p) => `<span class="chip" data-goto="${p.conn}">${p.conn}.${p.index}</span>`).join('');
  box.innerHTML = `<b>${rec.label}${rec.domain ? '<s>:' + rec.domain + '</s>' : ''}</b>
    <i>${(BUS_TYPES[rec.bus] || {}).name || rec.bus} · ${rec.pins.length} 个脚</i>
    <div>${ends}</div>`;
  box.querySelectorAll('.chip').forEach((ch) => {
    ch.onclick = () => selectConn(ch.dataset.goto, true);
  });
}

/* ---------- 底部网表 ---------- */
function renderNetTable() {
  const q = ($('netFilter').value || '').trim().toLowerCase();
  const rows = netRows(nt).filter((r) => !q
    || (r.net + r.domain + r.from + r.to + r.bus).toLowerCase().includes(q));
  $('netTable').innerHTML = `<div class="nt-head"><span>网名</span><span>总线</span><span>起</span><span>止</span><span>芯</span></div>`
    + rows.map((r) => `<div class="nt-row" data-net="${r.raw}">
      <span class="nm">${r.net}${r.domain ? '<s>:' + r.domain + '</s>' : ''}</span>
      <span class="bus" style="color:${(BUS_TYPES[r.bus] || {}).color || '#9aa1ac'}">${r.bus}</span>
      <span>${r.from}</span><span>${r.to}</span><span>${r.pins}</span>
    </div>`).join('');
  $('netTable').querySelectorAll('.nt-row').forEach((el) => {
    el.onclick = () => {
      state.net = el.dataset.net;
      state.conn = null;
      highlight();
      setPanelIdle();
      renderNetInfo();
    };
  });
  $('netCount').textContent = rows.length + ' 条';
}

/* ---------- BOM ---------- */
function renderBom() {
  const rows = bomRows(nt);
  $('bomBody').innerHTML = rows.map((r) => `<tr>
    <td>${r.label}</td><td class="n">${r.qty}</td><td class="n">${r.pins}</td>
    <td class="dim">${r.conns || '—'}</td></tr>`).join('');
}

/* ---------- 图例与总线过滤 ---------- */
function renderLegend() {
  const seen = new Map();
  wires.forEach((w) => {
    const rec = seen.get(w.bus) || { bus: w.bus, nets: 0, cores: 0 };
    rec.nets += 1;
    rec.cores += 1;
    seen.set(w.bus, rec);
  });
  const order = ['power', 'bus', 'cam', 'i2c', 'aud', 'gpio'];
  $('legend').innerHTML = order.filter((k) => seen.has(k)).map((k) => {
    const t = BUS_TYPES[k];
    return `<button class="lg" data-bus="${k}">
      <i style="background:${t.color}"></i><b>${t.name}</b><s>${seen.get(k).nets} 段</s>
    </button>`;
  }).join('');
  $('legend').querySelectorAll('.lg').forEach((b) => {
    b.onclick = () => {
      const bus = b.dataset.bus;
      state.bus = state.bus === bus ? null : bus;
      state.conn = null; state.net = null;
      $('legend').querySelectorAll('.lg').forEach((x) => x.classList.toggle('on', x.dataset.bus === state.bus));
      highlight();
    };
  });
}

/* ---------- 控件 ---------- */
$('btnFit').onclick = () => { fitView(); };
$('btnZoomIn').onclick = () => zoomAt(0.8, innerWidth / 2, innerHeight / 2);
$('btnZoomOut').onclick = () => zoomAt(1.25, innerWidth / 2, innerHeight / 2);
$('btnNums').onclick = () => {
  state.nums = !state.nums;
  $('btnNums').classList.toggle('on', state.nums);
  if (state.nums && state.conn) drawPinNumbers(connById.get(state.conn));
  else numLayer.textContent = '';
};
$('btnDim').onclick = () => {
  svg.classList.toggle('no-dim');
  $('btnDim').classList.toggle('on', !svg.classList.contains('no-dim'));
};
$('netFilter').oninput = renderNetTable;
$('tDev').onclick = () => setTab('dev');
$('tBom').onclick = () => setTab('bom');
function setTab(k) {
  $('tDev').classList.toggle('on', k === 'dev');
  $('tBom').classList.toggle('on', k === 'bom');
  $('paneDev').style.display = k === 'dev' ? 'flex' : 'none';
  $('paneBom').style.display = k === 'bom' ? 'flex' : 'none';
}

/* ---------- 启动 ---------- */
renderLegend();
renderBom();
renderNetTable();
setPanelIdle();
setTab('dev');
applyView();

const ribbons = wires.filter((w) => w.ribbon).length;
$('stat').textContent = `${nt.stats.connectors} 个插座 · ${nt.stats.pins} 个引脚 · ${nt.stats.wired} 条网 · `
  + `${wires.length - ribbons} 段线 + ${ribbons} 芯排线 · ${nt.stats.servos} 个舵机`;

window.__MD_OK = true;
$('boot').classList.add('hide');
