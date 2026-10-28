#!/usr/bin/env node
/**
 * check_enclosure.js - prove the printable shell actually fits the parts.
 *
 * Why this exists:
 *   enclosure.js can build a shell for any numbers you give it, and the
 *   picture always looks like a box. What the picture cannot show you is
 *   whether the shell is 2 mm too narrow for the board, whether the USB hole
 *   lines up with the socket, whether a face failed to triangulate, or whether
 *   a wall is thinner than one nozzle pass. Each of those is a failed print
 *   and a wasted afternoon, so they are checked here and turned into an exit
 *   code.
 *
 * What it reports, per project:
 *   parts    every part in diagram.json has a position, and no two overlap
 *   shells   base + lid + bosses, each a closed manifold with positive volume
 *   volume   mm^3 of the assembled shell, and the bounding box in mm
 *   ports    how many connectors have a hole they can actually reach / total
 *            (a port facing solid plastic is decoration, not a hole)
 *   bed      the footprint must fit the printer bed
 *
 * Usage:
 *   node check_enclosure.js                  # every project under examples/
 *   node check_enclosure.js examples/duck-robot
 *   node check_enclosure.js --parts          # also list every part's assumed size
 *
 * Exit code: 0 = clean, 1 = a shell is open, a part has no room, two parts
 *            share space, a port faces a wall, or a wall is too thin.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadEnclosure() {
  const ctx = { console, JSON, Math, String, Number, Object, Array, parseFloat, parseInt, isFinite, isNaN };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'enclosure.js'), 'utf8'), ctx, { filename: 'enclosure.js' });
  if (!ctx.Enclosure) throw new Error('enclosure.js did not define Enclosure');
  return ctx.Enclosure;
}

const argv = process.argv.slice(2);
const showParts = argv.includes('--parts');

function findProjects() {
  const given = argv.filter((a) => !a.startsWith('-'));
  if (given.length) return given.map((d) => path.resolve(d));
  const ex = path.join(ROOT, 'examples');
  if (!fs.existsSync(ex)) return [];
  return fs
    .readdirSync(ex)
    .map((d) => path.join(ex, d))
    .filter((d) => fs.existsSync(path.join(d, 'diagram.json')));
}

const projects = findProjects();
if (!projects.length) {
  console.log('[FAIL] no project with a diagram.json found');
  process.exit(1);
}

const Enclosure = loadEnclosure();
let bad = 0;
let checked = 0;

console.log('');
console.log('=== check_enclosure ===');

for (const dir of projects) {
  const label = path.relative(ROOT, dir) || dir;
  const encPath = path.join(dir, 'enclosure.json');
  const diaPath = path.join(dir, 'diagram.json');

  if (!fs.existsSync(encPath)) {
    /* A project without a body is not wrong - it is a circuit that nobody has
       put in a box yet. Say so out loud; a silent skip reads like a pass. */
    console.log(`  [SKIP] ${label}: no enclosure.json (circuit only, no printed body)`);
    continue;
  }

  let enc, dia;
  try {
    enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  } catch (e) {
    console.log(`  [FAIL] ${label}: enclosure.json is not valid JSON (${e.message})`);
    bad++;
    continue;
  }
  try {
    dia = JSON.parse(fs.readFileSync(diaPath, 'utf8'));
  } catch (e) {
    console.log(`  [FAIL] ${label}: diagram.json is not valid JSON (${e.message})`);
    bad++;
    continue;
  }

  let m;
  try {
    m = Enclosure.model(enc, dia);
  } catch (e) {
    console.log(`  [FAIL] ${label}: model threw (${e.message})`);
    bad++;
    continue;
  }

  checked++;
  const s = m.stats;
  const ports = m.gaps;
  const cut = ports.filter((g) => g.cut && !g.blocked).length;
  const blocked = ports.filter((g) => g.blocked).length;
  const ok = m.problems.length === 0;

  console.log(
    `  ${ok ? '[OK]  ' : '[FAIL]'} ${label}:` +
      ` parts=${m.parts.length}` +
      ` shells=${s.shells}` +
      ` tris=${s.tris}` +
      ` closed=${s.closed ? 'yes' : 'NO'}` +
      ` volume=${Math.round(s.volume)}mm3` +
      ` bbox=${s.bbox.map((n) => Math.round(n)).join('×')}mm` +
      ` ports=${cut}/${ports.length}` +
      (blocked ? ` ${blocked} unreachable` : '') +
      ` wall=${m.enc.base.wall}mm` +
      (s.lid ? ` lid=${m.enc.lid.thick}+${m.enc.lid.lip}mm` : ' lid=off')
  );

  for (const p of m.problems) console.log(`         [${p.k}] ${p.msg}`);
  for (const w of m.warns) console.log(`         [warn] ${w}`);

  if (showParts) {
    for (const p of m.parts) {
      const b = p.box;
      console.log(
        `         ${p.id.padEnd(8)} ${String(p.type).padEnd(26)}` +
          ` ${p.size.map((n) => n.toFixed(1)).join('×').padEnd(16)}` +
          ` at [${p.at.map((n) => n.toFixed(1)).join(', ')}]` +
          ` rot ${JSON.stringify(p.rot)}` +
          ` box [${b.x0.toFixed(1)},${b.y0.toFixed(1)},${b.z0.toFixed(1)}]..` +
          `[${b.x1.toFixed(1)},${b.y1.toFixed(1)},${b.z1.toFixed(1)}]` +
          (p.known ? '' : '  ASSUMED')
      );
    }
  }

  if (!ok) bad++;
}

console.log('');
if (bad) {
  console.log(`RESULT: FAILED - ${bad} project(s). An open shell, a part with no room, or a`);
  console.log('        port facing solid plastic is a print that fails on the bed, not a');
  console.log('        cosmetic bug: fix enclosure.json and run this again.');
  process.exit(1);
}
console.log(`RESULT: OK - ${checked} enclosure(s) close, fit, and print`);
console.log('');
