#!/usr/bin/env node
/**
 * sync_enclosure.js - keep the inlined enclosure builder identical everywhere.
 *
 * Same contract as sync_pcbview.js: a sim-viewer.html has to stay a single
 * file that works from file://, so scripts/enclosure.js is copied into every
 * page instead of being loaded with <script src>. Copies drift; this tool owns
 * them.
 *
 * The difference is what the copy does. pcbview draws the schematic netlist
 * again for people who cannot run Wokwi; enclosure.js builds the printed body
 * from enclosure.json and *checks it* - parts fit, ports reach the outside,
 * every shell closes. A stale copy would happily print an enclosure the file
 * no longer describes, so CI runs --check on this too.
 *
 * Usage:
 *   node sync_enclosure.js            # rewrite the blocks
 *   node sync_enclosure.js --check    # verify only, exit 1 on drift
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'enclosure.js');
const BEGIN = '/* === ENC-VIEW BEGIN: generated from scripts/enclosure.js - edit that file, not this block === */';
const END = '/* === ENC-VIEW END === */';

const TARGETS = (() => {
  const out = ['assets/viewer-template.html'];
  const ex = path.join(ROOT, 'examples');
  if (fs.existsSync(ex)) {
    for (const d of fs.readdirSync(ex)) {
      const f = path.join(ex, d, 'sim-viewer.html');
      if (fs.existsSync(f)) out.push('examples/' + d + '/sim-viewer.html');
    }
  }
  return out;
})();

const check = process.argv.includes('--check');
const body = fs.readFileSync(SRC, 'utf8').replace(/\s+$/, '');
if (body.includes('</script>')) {
  console.error('[FAIL] enclosure.js contains a literal </script> and cannot be inlined');
  process.exit(1);
}
const inner = BEGIN + '\n' + body + '\n' + END;

let failed = 0;
let changed = 0;

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.log(`[SKIP] ${rel} (not present)`);
    continue;
  }
  let html = fs.readFileSync(file, 'utf8');
  const i = html.indexOf(BEGIN);
  const j = html.indexOf(END);

  if (i >= 0 && j > i) {
    const current = html.slice(i, j + END.length);
    if (current === inner) {
      console.log(`[OK]   ${rel}`);
      continue;
    }
    if (check) {
      console.log(`[FAIL] ${rel} block differs from scripts/enclosure.js`);
      failed++;
      continue;
    }
    html = html.slice(0, i) + inner + html.slice(j + END.length);
  } else if (i >= 0 || j >= 0) {
    console.log(`[FAIL] ${rel} has only one of the two markers - fix it by hand`);
    failed++;
    continue;
  } else {
    /* First run: drop the block straight after the diagram data block, i.e.
     * BEFORE the page's own script.
     *
     * It has to come before. The page ends with a bare `boot()` call, so a
     * block placed after the page script would not exist yet when boot() runs
     * drawEnc(), the guard reads Enclosure as undefined, and the card hides
     * itself - a page that looks like it has no enclosure at all, with no
     * error to explain why. */
    const anchor = html.indexOf('id="diaSrc"');
    if (anchor < 0) {
      console.log(`[FAIL] ${rel} has no diaSrc block to anchor the injection`);
      failed++;
      continue;
    }
    const close = html.indexOf('</script>', anchor);
    if (close < 0) {
      console.log(`[FAIL] ${rel} malformed anchor block`);
      failed++;
      continue;
    }
    const at = close + '</script>'.length;
    const block = '\n<script>\n' + inner + '\n</script>';
    if (check) {
      console.log(`[FAIL] ${rel} has no ENC-VIEW block yet (run: node scripts/sync_enclosure.js)`);
      failed++;
      continue;
    }
    html = html.slice(0, at) + block + html.slice(at);
  }

  if (!check) {
    fs.writeFileSync(file, html, 'utf8');
    console.log(`[WROTE] ${rel}`);
    changed++;
  }
}

console.log('');
if (check) {
  if (failed) {
    console.log(`RESULT: FAILED - ${failed} file(s) out of sync with scripts/enclosure.js`);
    console.log('        Run: node scripts/sync_enclosure.js');
    process.exit(1);
  }
  console.log('RESULT: OK - every viewer carries the same enclosure builder');
} else {
  console.log(changed ? `updated ${changed} file(s)` : 'already in sync');
}
