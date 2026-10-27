#!/usr/bin/env node
/**
 * domrun.js - Run a sim-viewer.html in a fake DOM and report runtime health.
 *
 * Why this exists:
 *   `node --check` only proves the syntax is valid. It cannot catch
 *   "CFG is not defined" - a page that parses fine and dies on the first line
 *   of boot(). That exact regression shipped once and produced a blank page.
 *   This harness actually executes the page's script against a stub DOM and
 *   reports how much content each element received and how many errors fired.
 *
 * Usage:
 *   node domrun.js <path/to/sim-viewer.html>
 *
 * Pass criteria:
 *   errors = 0  AND  the elements that should hold content are non-empty.
 *
 * Exit code: 0 = no runtime errors, 1 = errors were thrown.
 */

const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
if (!file) {
  console.log('usage: node domrun.js <path/to/sim-viewer.html>');
  process.exit(2);
}

const html = fs.readFileSync(file, 'utf8');

// ---- collect executable script blocks (skip text/plain data blocks) ----
const re = /<script(?![^>]*type="text\/plain")[^>]*>([\s\S]*?)<\/script>/g;
let code = '';
let m;
while ((m = re.exec(html)) !== null) code += m[1] + '\n';

// ---- text/plain blocks hold the page's data; feed them real content ----
function rawSrcOf(id) {
  const open = `<script type="text/plain" id="${id}">`;
  const i = html.indexOf(open);
  if (i < 0) return '';
  const j = html.indexOf('</script>', i);
  return html.slice(i + open.length, j);
}

// ---- minimal DOM stub ----
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    _html: '',
    _text: '',
    _styleWrites: 0,
    classList: {
      add() { el._styleWrites++; },
      remove() { el._styleWrites++; },
      toggle() { el._styleWrites++; },
      contains() { return false; },
    },
    dataset: {},
    scrollTop: 0,
    scrollHeight: 0,
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 300, height: 200, top: 0, left: 0 }; },
    focus() {},
  };
  // Count style writes so "styled but empty" elements (#led, #glow, #fill) are
  // not reported as suspicious empties.
  el.style = new Proxy({}, {
    set(t, k, v) { el._styleWrites++; t[k] = v; return true; },
    get(t, k) { return t[k]; },
  });
  Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); } });
  Object.defineProperty(el, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); } });
  return el;
}

const cache = {};
const touched = [];
const document = {
  getElementById(id) {
    if (!cache[id]) {
      const el = makeEl('div');
      if (id === 'inoSrc' || id === 'diaSrc') el._text = rawSrcOf(id);
      cache[id] = el;
      touched.push(id);
    }
    return cache[id];
  },
  createElement(t) { return makeEl(t); },
  querySelector() { return makeEl('div'); },
  querySelectorAll() { return []; },
  addEventListener() {},
  body: makeEl('body'),
};

const errors = [];
const sandbox = {
  document,
  navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
  window: { open() {}, addEventListener() {}, matchMedia() { return { matches: false }; } },
  console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  Date, Math, JSON, String, Number, Boolean, Array, Object, Promise, RegExp,
  parseInt, parseFloat, isNaN,
  performance: { now: () => Date.now() },
};
sandbox.globalThis = sandbox;

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 5000 });
} catch (e) {
  errors.push('RUN ERROR: ' + e.message);
  (e.stack || '').split('\n').slice(1, 5).forEach((l) => errors.push('  ' + l.trim()));
}

setTimeout(() => {
  console.log('');
  console.log('=== domrun ===');
  console.log('  file   : ' + file);
  console.log('  scripts: ' + code.split('\n').length + ' lines');
  console.log('');
  console.log('--- elements the page wrote to ---');

  const interesting = touched.filter((id) => id !== 'inoSrc' && id !== 'diaSrc');
  if (interesting.length === 0) {
    console.log('  (none) - the script never touched the DOM?');
  }
  for (const id of interesting) {
    const el = cache[id];
    const htmlLen = el._html.length;
    const textLen = el._text.length;
    const kids = el.children.length;
    const styled = el._styleWrites;
    const empty = htmlLen + textLen + kids === 0 && styled === 0;
    const flag = empty ? '  <-- empty (nothing written)' : '';
    console.log(
      `  #${id.padEnd(16)} children=${String(kids).padEnd(3)} html=${String(htmlLen).padEnd(6)} text=${String(textLen).padEnd(6)} style=${String(styled).padEnd(3)}${flag}`
    );
  }

  console.log('');
  console.log('--- errors ---');
  if (errors.length === 0) {
    console.log('  0');
  } else {
    errors.slice(0, 8).forEach((e) => console.log('  ! ' + e));
    if (errors.length > 8) console.log(`  ... and ${errors.length - 8} more`);
  }

  console.log('');
  if (errors.length === 0) {
    console.log('RESULT: OK (0 runtime errors)');
    console.log('        Reminder: a page can pass this and still show wrong data -');
    console.log('        also run verify_viewer.js to confirm the embedded code is honest.');
  } else {
    console.log('RESULT: FAILED - the page throws at runtime. Do NOT deliver it.');
    console.log('        Common causes: a deleted `const CFG`, a missing element id,');
    console.log('        or boot() running before its dependencies are defined.');
  }
  console.log('');
  process.exit(errors.length ? 1 : 0);
}, 300);
