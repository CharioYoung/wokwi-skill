#!/usr/bin/env node
/**
 * check_enclosure.js - prove the printable shell actually fits the parts.
 *
 * Why this exists:
 *   enclosure.js can generate a shell for any numbers you give it, and a
 *   render always looks plausible. What a picture cannot tell you is whether
 *   the shell is 2 mm too narrow for the board, whether the USB hole lines up
 *   with the socket, whether the isosurface came out watertight, or whether a
 *   wall is thinner than one nozzle pass. Each of those is a failed print, so
 *   they are checked here and turned into an exit code.
 *
 * What it reports, per project:
 *   parts    every part in diagram.json has a position, and no two overlap
 *   shells   base + head, each extracted from the field and checked watertight
 *   volume   mm^3 of the printed shells, and the bounding box in mm
 *   holes    every opening that the field actually punched through
 *   wall     the thinnest wall in the file, against the printer minimum
 *
 * Usage:
 *   node check_enclosure.js                    # every project under examples/
 *   node check_enclosure.js examples/duck-robot
 *   node check_enclosure.js --parts            # list every part's assumed size
 *   node check_enclosure.js --quick            # skip the mesh (field checks only)
 *
 * Exit code: 0 = clean, 1 = a shell leaks, a part has no room, two parts share
 *            space, a hole is blind, or a wall is too thin.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadEnclosure() {
  const ctx = {
    console, JSON, Math, String, Number, Object, Array, Boolean,
    parseFloat, parseInt, isFinite, isNaN,
    Float32Array, Uint8Array, Uint8ClampedArray, ArrayBuffer, DataView
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'enclosure.js'), 'utf8'), ctx, { filename: 'enclosure.js' });
  if (!ctx.Enclosure) throw new Error('enclosure.js did not define Enclosure');
  return ctx.Enclosure;
}

const argv = process.argv.slice(2);
const showParts = argv.includes('--parts');
const quick = argv.includes('--quick');

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
    /* A project without a body is not wrong - it is a circuit nobody has put
       in a box yet. Say so out loud; a silent skip reads like a pass. */
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
  const blind = m.problems.filter((p) => p.k === 'hole').length;

  let tris = 0, open = 0, volume = 0;
  if (!quick) {
    const bb = [-2, -2, -2, m.sdf.W + 2, m.sdf.D + 2, m.sdf.topZ + 2];
    const base = Enclosure.mesh(m.sdf.baseMap, bb, 1.4);
    tris += base.tris.length;
    open += Enclosure.openEdges(base);
    volume += Enclosure.volumeOf(base);
    if (m.sdf.hasHead) {
      const head = Enclosure.mesh(m.sdf.headMap, bb, 1.4);
      tris += head.tris.length;
      open += Enclosure.openEdges(head);
      volume += Enclosure.volumeOf(head);
    }
  }

  const ok = m.problems.length === 0 && open === 0;

  console.log(
    `  ${ok ? '[OK]  ' : '[FAIL]'} ${label}:` +
    ` parts=${m.parts.length}` +
    ` shells=${s.shells}` +
    (quick ? '' : ` tris=${tris} closed=${open === 0 ? 'yes' : 'NO(' + open + ')'} volume=${Math.round(volume)}mm3`) +
    ` bbox=${m.sdf.W}×${m.sdf.D}×${Math.round(m.sdf.topZ)}mm` +
    ` holes=${m.holes.length}` +
    (blind ? ` ${blind} blind` : '') +
    ` wall=${s.wall}mm` +
    (m.sdf.hasHead ? ` head=z${m.sdf.zDiv}` : ' head=off')
  );

  for (const p of m.problems) console.log(`         [${p.k}] ${p.msg}`);
  for (const w of m.warns) console.log(`         [warn] ${w.msg || w}`);

  if (showParts) {
    for (const p of m.parts) {
      const b = p.box;
      console.log(
        `         ${String(p.id).padEnd(8)} ${String(p.type).padEnd(26)}` +
        ` ${p.size.map((n) => n.toFixed(1)).join('×').padEnd(16)}` +
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
  console.log(`RESULT: FAILED - ${bad} project(s). A leaking shell, a part with no room, or a`);
  console.log('        blind hole is a print that fails on the bed, not a cosmetic bug:');
  console.log('        fix enclosure.json and run this again.');
  process.exit(1);
}
console.log(`RESULT: OK - ${checked} enclosure(s) close, fit, and print`);
console.log('');
