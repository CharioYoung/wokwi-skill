#!/usr/bin/env node
/**
 * sync_embed.js - copy the real sketch/diagram into a sim-viewer.html.
 *
 * Why this exists:
 *   The viewer has to carry the byte-identical .ino and diagram.json so that
 *   "copy this file" cannot hand out code that differs from what was compiled.
 *   verify_viewer.js proves that, but it cannot *fix* it - and hand-pasting
 *   into a <script type="text/plain"> block is exactly how a trimmed "demo"
 *   version once got in. This is the write half: the real files are the source
 *   of truth, the page is generated from them.
 *
 * Usage:
 *   node sync_embed.js <projectDir>            # rewrite ino/dia blocks
 *   node sync_embed.js <projectDir> --check    # verify only
 *
 * Exit code: 0 = ok / rewritten, 1 = drift in --check mode or a missing file.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('-'));
if (!dirArg) {
  console.log('usage: node sync_embed.js <projectDir> [--check]');
  process.exit(2);
}
const dir = path.resolve(dirArg);
const check = args.includes('--check');
const viewer = path.join(dir, 'sim-viewer.html');
if (!fs.existsSync(viewer)) {
  console.log(`[FAIL] no sim-viewer.html in ${dir}`);
  process.exit(1);
}

const inos = fs.readdirSync(dir).filter((f) => f.endsWith('.ino') && fs.statSync(path.join(dir, f)).isFile());
const base = path.basename(dir);
const inoName = inos.find((f) => f.replace(/\.ino$/, '') === base) || inos[0];
const diaPath = path.join(dir, 'diagram.json');

let html = fs.readFileSync(viewer, 'utf8');
let failed = false;

function put(id, text) {
  const open = `<script type="text/plain" id="${id}">`;
  const i = html.indexOf(open);
  if (i < 0) {
    console.log(`[FAIL] block ${id} not found`);
    failed = true;
    return;
  }
  const j = html.indexOf('</script>', i);
  const cur = html.slice(i + open.length, j);
  const want = '\n' + text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
  if (cur === want) {
    console.log(`[OK]   ${id} already matches`);
    return;
  }
  if (check) {
    console.log(`[FAIL] ${id} differs from the real file`);
    failed = true;
    return;
  }
  html = html.slice(0, i + open.length) + want + html.slice(j);
  console.log(`[WROTE] ${id}`);
}

if (inoName) put('inoSrc', fs.readFileSync(path.join(dir, inoName), 'utf8'));
else console.log('[SKIP] no .ino file');

if (fs.existsSync(diaPath)) {
  const txt = fs.readFileSync(diaPath, 'utf8');
  try { JSON.parse(txt); } catch (e) {
    console.log(`[FAIL] diagram.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  put('diaSrc', txt);
} else {
  console.log('[SKIP] no diagram.json');
}

/* enclosure.json is optional, but the page block must not lie about it.
 *
 * A page copied from the template carries the template's sample shell, and an
 * enclosure the file does not describe is worse than no enclosure: it looks
 * printable. So: no enclosure.json -> blank the block (the card hides itself);
 * enclosure.json -> the block is its bytes. */
const encPath = path.join(dir, 'enclosure.json');
const hasEncBlock = html.indexOf('<script type="text/plain" id="encSrc">') >= 0;
if (fs.existsSync(encPath)) {
  const txt = fs.readFileSync(encPath, 'utf8');
  try { JSON.parse(txt); } catch (e) {
    console.log(`[FAIL] enclosure.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  if (hasEncBlock) put('encSrc', txt);
  else console.log('[SKIP] page has no encSrc block - run: node scripts/sync_enclosure.js');
} else if (hasEncBlock) {
  put('encSrc', '');
} else {
  console.log('[SKIP] no enclosure.json');
}

if (failed) process.exit(1);
if (!check) fs.writeFileSync(viewer, html, 'utf8');
console.log(check ? 'RESULT: OK - page embeds the real files' : 'RESULT: OK');
