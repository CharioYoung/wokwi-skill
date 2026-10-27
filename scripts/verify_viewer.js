#!/usr/bin/env node
/**
 * verify_viewer.js - Prove that a sim-viewer.html is "honest".
 *
 * Checks, in order:
 *   1. CONSISTENCY  the code / circuit embedded in the page is byte-identical
 *                   to the real .ino / diagram.json in the project
 *   2. SYNTAX       every non-`text/plain` <script> block parses (node --check)
 *   3. COMPILE      (optional, --compile) the extracted .ino still builds
 *
 * Why step 1 must read textContent, not raw HTML:
 *   A previous version regex-extracted `const INO = `...`` from the raw file.
 *   The raw file literally contains a backslash + n, so the compile passed -
 *   a FALSE POSITIVE - while the browser turned `\n` into a real newline and
 *   the code users copied was broken. Always mimic what the browser sees.
 *
 * Usage:
 *   node verify_viewer.js <projectDir>
 *   node verify_viewer.js <projectDir> --compile
 *   node verify_viewer.js <projectDir> --compile --build-dir C:/wokwi-toolchain/chk
 *
 * Exit code: 0 = all good, 1 = something failed.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('-')) {
  console.log('usage: node verify_viewer.js <projectDir> [--compile] [--build-dir <ascii-dir>]');
  process.exit(2);
}
const projectDir = path.resolve(args[0]);
const doCompile = args.includes('--compile');
const bdIdx = args.indexOf('--build-dir');
const buildDirArg = bdIdx >= 0 ? args[bdIdx + 1] : '';

// ---------------------------------------------------------------- helpers
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');

/** Mimic document.getElementById(id).textContent for a text/plain script block. */
function rawSrcOf(html, id) {
  const open = `<script type="text/plain" id="${id}">`;
  const i = html.indexOf(open);
  if (i < 0) return null;
  const j = html.indexOf('</script>', i);
  if (j < 0) return null;
  const txt = html.slice(i + open.length, j);
  // Browsers do NOT strip the first newline for <script>; our template adds one.
  return txt.replace(/^\r?\n/, '').replace(/\s+$/, '') + '\n';
}

function fail(msg) {
  console.log('  [FAIL] ' + msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('  [PASS] ' + msg);
}
function warn(msg) {
  console.log('  [WARN] ' + msg);
}

// ---------------------------------------------------------------- locate files
const viewerPath = path.join(projectDir, 'sim-viewer.html');
if (!fs.existsSync(viewerPath)) {
  console.log(`[FAIL] sim-viewer.html not found in ${projectDir}`);
  process.exit(1);
}

let inoPath = null;
let diaPath = path.join(projectDir, 'diagram.json');

const inos = fs.readdirSync(projectDir).filter((f) => f.endsWith('.ino') && !f.endsWith('.bak'));
const inosReal = inos.filter((f) => !fs.statSync(path.join(projectDir, f)).isDirectory());
if (inosReal.length === 1) {
  inoPath = path.join(projectDir, inosReal[0]);
} else if (inosReal.length > 1) {
  // prefer one whose basename matches the folder name
  const base = path.basename(projectDir);
  const guess = inosReal.find((f) => f.replace(/\.ino$/, '') === base) || inosReal[0];
  inoPath = path.join(projectDir, guess);
  warn(`multiple .ino found, verifying against ${guess}`);
}

const html = fs.readFileSync(viewerPath, 'utf8');

console.log('');
console.log('=== verify_viewer ===');
console.log('  project : ' + projectDir);
console.log('  viewer  : ' + viewerPath);
console.log('');

// ---------------------------------------------------------------- 1. consistency
console.log('--- 1. consistency (browser textContent vs real file) ---');

const inoOut = rawSrcOf(html, 'inoSrc');
const diaOut = rawSrcOf(html, 'diaSrc');

let consistencyOk = true;

if (inoOut === null) {
  fail('missing <script type="text/plain" id="inoSrc"> block');
  consistencyOk = false;
} else if (!inoPath) {
  warn('no .ino file in project, skipped INO comparison');
} else {
  const real = norm(fs.readFileSync(inoPath, 'utf8'));
  if (norm(inoOut) === real) {
    pass(`INO identical to ${path.basename(inoPath)} (${real.length} chars)`);
  } else {
    consistencyOk = false;
    fail(`INO differs from ${path.basename(inoPath)}`);
    const a = norm(inoOut).split('\n');
    const b = real.split('\n');
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k] !== b[k]) {
        console.log(`         first diff at line ${k + 1}:`);
        console.log(`           page: ${JSON.stringify(a[k])}`);
        console.log(`           file: ${JSON.stringify(b[k])}`);
        break;
      }
    }
  }
}

if (diaOut === null) {
  fail('missing <script type="text/plain" id="diaSrc"> block');
  consistencyOk = false;
} else if (!fs.existsSync(diaPath)) {
  warn('no diagram.json in project, skipped DIA comparison');
} else {
  const real = norm(fs.readFileSync(diaPath, 'utf8'));
  if (norm(diaOut) === real) {
    pass(`DIA identical to diagram.json (${real.length} chars)`);
  } else {
    consistencyOk = false;
    fail('DIA differs from diagram.json');
  }
  try {
    JSON.parse(diaOut);
    pass('DIA is valid JSON');
  } catch (e) {
    consistencyOk = false;
    fail('DIA is not valid JSON: ' + e.message);
  }
}

// guard against the classic regression: code inside a JS template literal
if (/const\s+INO\s*=\s*`/.test(html) || /const\s+DIA\s*=\s*`/.test(html)) {
  consistencyOk = false;
  fail('found `const INO = ` ... - code must NOT live inside a JS template literal (\\n becomes a real newline)');
}

// ---------------------------------------------------------------- 2. syntax
console.log('');
console.log('--- 2. script syntax ---');

const blocks = [];
const re = /<script(?![^>]*type="text\/plain")[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) blocks.push(m[1]);

if (blocks.length === 0) {
  warn('no executable <script> block found');
} else {
  const tmp = path.join(os.tmpdir(), 'wokwi-viewer-check');
  fs.mkdirSync(tmp, { recursive: true });
  let syntaxOk = true;
  blocks.forEach((code, idx) => {
    const f = path.join(tmp, `block${idx + 1}.js`);
    fs.writeFileSync(f, code, 'utf8');
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status === 0) {
      pass(`script block ${idx + 1} parses (${code.split('\n').length} lines)`);
    } else {
      syntaxOk = false;
      fail(`script block ${idx + 1} syntax error:\n${(r.stderr || '').trim()}`);
    }
  });
  if (!syntaxOk) process.exitCode = 1;
}

// ---------------------------------------------------------------- 3. compile
if (doCompile) {
  console.log('');
  console.log('--- 3. compile (the exact text users would copy) ---');

  if (!inoOut) {
    fail('cannot compile: ino block missing');
  } else {
    const buildDir = buildDirArg || process.env.VERIFY_BUILD_DIR || path.join(os.tmpdir(), 'wokwi-verify-build');
    const nonAscii = /[^\x00-\x7F]/.test(buildDir);
    if (nonAscii) {
      fail(`build dir has non-ASCII characters: ${buildDir}`);
      console.log('         ld.exe cannot handle it; pass --build-dir with an ASCII path');
    } else {
      const cli =
        process.env.ARDUINO_CLI ||
        (spawnSync('arduino-cli', ['version'], { encoding: 'utf8' }).status === 0 ? 'arduino-cli' : null) ||
        (fs.existsSync('C:/wokwi/bin/arduino-cli.exe') ? 'C:/wokwi/bin/arduino-cli.exe' : null);

      if (!cli) {
        warn('arduino-cli not found, skipped compile');
      } else {
        const dataDir = process.env.ARDUINO_DATA_DIR || 'C:/wokwi-toolchain/data';
        const work = path.join(os.tmpdir(), 'wokwi-verify-src');
        fs.rmSync(work, { recursive: true, force: true });
        fs.mkdirSync(work, { recursive: true });
        const name = path.basename(inoPath).replace(/\.ino$/, '');
        const sketchPath = path.join(work, name + '.ino');
        fs.writeFileSync(sketchPath, inoOut, 'utf8');
        if (diaOut) fs.writeFileSync(path.join(work, 'diagram.json'), diaOut, 'utf8');

        console.log(`  compiling ${sketchPath}`);
        console.log(`  build dir ${buildDir}`);
        fs.rmSync(buildDir, { recursive: true, force: true });
        const r = spawnSync(
          cli,
          ['--config-dir', dataDir, 'compile', '--fqbn', process.env.ARDUINO_FQBN || 'esp32:esp32:esp32', '--build-path', buildDir, work],
          { encoding: 'utf8' }
        );
        const out = (r.stdout || '') + (r.stderr || '');
        const used = /Sketch uses (\d+) bytes/.exec(out);
        const binPath = path.join(buildDir, name + '.ino.bin');
        const binOk = fs.existsSync(binPath) && fs.statSync(binPath).size > 0;
        if (r.status === 0 && binOk) {
          pass(`compiles cleanly (${fs.statSync(binPath).size} bytes${used ? `, sketch ${used[1]} B` : ''})`);
        } else {
          fail('compile failed');
          console.log(out.split('\n').slice(-15).join('\n'));
        }
      }
    }
  }
}

// ---------------------------------------------------------------- summary
console.log('');
if (process.exitCode === 1) {
  console.log('RESULT: FAILED - fix the items above before delivering the viewer.');
  console.log('        Reminder: pages must embed the COMPILED source, never a trimmed "demo" version.');
} else {
  console.log('RESULT: OK');
  console.log('        Next: node domrun.js <projectDir>/sim-viewer.html   (runtime check)');
}
console.log('');
