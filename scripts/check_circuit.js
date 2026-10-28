#!/usr/bin/env node
/**
 * check_circuit.js - prove the rendered circuit is physically sane.
 *
 * Why this exists:
 *   pcbview.js draws wires around the PCB, not across it. That guarantee is
 *   geometric, so "it looks fine in the screenshot" is not a test - one bad
 *   lane or one part placed inside the board footprint turns a wire into a
 *   line that runs over the PCB, and at a glance it still looks plausible.
 *   This checks the geometry directly.
 *
 * What it reports, per diagram:
 *   wires      connections that resolved to real pins and got routed
 *   dangling   connections whose endpoints are not known pins (skipped, not drawn)
 *   crossings  segments that overlap the board footprint (must be 0)
 *   leads      segments that overlap the board but end on a pin. The pin lead
 *              itself is allowed to sit on the PCB: a header is inset from the
 *              board edge, and a part parked on the edge (the 32-servo ring
 *              does that at every corner) puts its pin inside the footprint.
 *              Reported so the number is visible, never counted as a failure.
 *   pins       hover hotspots / total header pins (must match - an unhoverable
 *              pin gives no name, and the user is left guessing what it is)
 *   tips       hotspots with an empty <title> (must be 0)
 *
 * What it cannot see: a drawing cropped by its own viewBox. The frame and the
 * viewBox are derived from the same numbers, so a check here would only agree
 * with itself. That bug class is real - a rotated servo sticks out of its
 * unrotated footprint, and the ring lost 15 units off its bottom horns - but
 * it has to be caught by looking at the rendered page, not at these numbers.
 *
 * Usage:
 *   node check_circuit.js                 # every diagram.json under examples/
 *   node check_circuit.js <dir> [<dir>]   # specific project directories
 *
 * Exit code: 0 = clean, 1 = a wire crosses the board, a pin has no tooltip,
 *            or no diagram was found.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadPcbView() {
  const ctx = { console, JSON, Math, String, Number, Object, Array, parseFloat, isFinite };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'pcbview.js'), 'utf8'), ctx, { filename: 'pcbview.js' });
  if (!ctx.PcbView) throw new Error('pcbview.js did not define PcbView');
  return ctx.PcbView;
}

function findDiagrams() {
  const given = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (given.length) return given.map((d) => path.join(d, 'diagram.json'));
  const ex = path.join(ROOT, 'examples');
  if (!fs.existsSync(ex)) return [];
  return fs
    .readdirSync(ex)
    .map((d) => path.join(ex, d, 'diagram.json'))
    .filter((f) => fs.existsSync(f));
}

const files = findDiagrams();
if (!files.length) {
  console.log('[FAIL] no diagram.json found');
  process.exit(1);
}

const PcbView = loadPcbView();
let bad = 0;

console.log('');
console.log('=== check_circuit ===');
for (const f of files) {
  const label = path.relative(ROOT, f) || f;
  let dia;
  try {
    dia = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.log(`  [FAIL] ${label}: not valid JSON (${e.message})`);
    bad++;
    continue;
  }

  let v;
  try {
    v = PcbView.render(dia);
  } catch (e) {
    console.log(`  [FAIL] ${label}: render threw (${e.message})`);
    bad++;
    continue;
  }

  const conns = dia.connections || [];
  /* connections to $serialMonitor / $led are virtual: nothing to draw, and
     that is not a problem. Only a *real* part with an unknown pin is. */
  const virtual = conns.filter((c) => String(c[0]).charAt(0) === '$' || String(c[1]).charAt(0) === '$').length;
  const unknown = conns.length - virtual - v.wires;

  /* Every pin must be answerable on hover. Silkscreen is printed for all of
     them, but the pointer target is what actually answers "what is this pin?",
     and it is easy to lose that while editing the renderer. */
  const hotspots = v.svg.match(/class="pcb-pin"/g) || [];
  const emptyTips = (v.svg.match(/<title>\s*<\/title>/g) || []).length;
  const pinOk = hotspots.length === v.pins.total && emptyTips === 0;

  const ok = v.audit.crossings === 0 && unknown === 0 && pinOk;
  console.log(
    `  ${ok ? '[OK]  ' : '[FAIL]'} ${label}: parts=${v.parts} wires=${v.wires}/${conns.length - virtual}` +
      (virtual ? ` +${virtual} virtual` : '') +
      (unknown ? ` ${unknown} UNRESOLVED` : '') +
      ` crossings=${v.audit.crossings}` +
      ` leads=${v.audit.excused || 0}` +
      ` pins=${hotspots.length}/${v.pins.total} (${v.pins.used} wired)` +
      (pinOk ? '' : ' PIN-HINT-MISSING')
  );
  if (!ok) {
    for (const o of v.audit.offenders) {
      console.log(`         ${o.wire}  ${JSON.stringify(o.from)} -> ${JSON.stringify(o.to)}`);
    }
    bad++;
  }
}

console.log('');
if (bad) {
  console.log(`RESULT: FAILED - ${bad} problem(s). A wire drawn over the PCB is a routing bug,`);
  console.log('        not a cosmetic one: fix the router or move the part in diagram.json.');
  process.exit(1);
}
console.log('RESULT: OK - no wire crosses the board, every pin names itself on hover');
console.log('');
