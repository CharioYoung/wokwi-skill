#!/usr/bin/env node
/**
 * sync_pcbview.js - keep the inlined circuit renderer identical everywhere.
 *
 * Why this exists:
 *   Every sim-viewer.html must stay a single self-contained file (it has to
 *   work from file:// and from a plain static host). So scripts/pcbview.js is
 *   inlined into each page instead of being <script src=>'d. Three copies of
 *   the same code WILL drift - someone fixes a routing bug in one page and
 *   the other page keeps drawing the old, wrong picture.
 *
 *   This tool owns the copy: it writes the canonical block into every target,
 *   and with --check it fails when any page disagrees with scripts/pcbview.js.
 *   CI runs --check, so drift cannot be merged.
 *
 * Usage:
 *   node sync_pcbview.js            # rewrite the blocks
 *   node sync_pcbview.js --check    # verify only, exit 1 on drift
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'pcbview.js');
const BEGIN = '/* === PCB-VIEW BEGIN: generated from scripts/pcbview.js - edit that file, not this block === */';
const END = '/* === PCB-VIEW END === */';

/* Every viewer, discovered rather than listed: a new example must not be able
   to ship with a stale renderer just because someone forgot to add it here. */
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
  console.error('[FAIL] pcbview.js contains a literal </script> and cannot be inlined');
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
      console.log(`[FAIL] ${rel} block differs from scripts/pcbview.js`);
      failed++;
      continue;
    }
    html = html.slice(0, i) + inner + html.slice(j + END.length);
  } else if (i >= 0 || j >= 0) {
    console.log(`[FAIL] ${rel} has only one of the two markers - fix it by hand`);
    failed++;
    continue;
  } else {
    /* first run: inject a new block right after the diagram.json data block */
    const dataAt = html.indexOf('id="diaSrc"');
    if (dataAt < 0) {
      console.log(`[FAIL] ${rel} has no diaSrc block to anchor the injection`);
      failed++;
      continue;
    }
    const close = html.indexOf('</script>', dataAt);
    if (close < 0) {
      console.log(`[FAIL] ${rel} malformed diaSrc block`);
      failed++;
      continue;
    }
    const at = close + '</script>'.length;
    const block = '\n<script>\n' + inner + '\n</script>';
    if (check) {
      console.log(`[FAIL] ${rel} has no PCB-VIEW block yet (run: node scripts/sync_pcbview.js)`);
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
    console.log(`RESULT: FAILED - ${failed} file(s) out of sync with scripts/pcbview.js`);
    console.log('        Run: node scripts/sync_pcbview.js');
    process.exit(1);
  }
  console.log('RESULT: OK - every viewer carries the same renderer');
} else {
  console.log(changed ? `updated ${changed} file(s)` : 'already in sync');
}
