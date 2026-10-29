/* 两个页面的静态体检。
 *
 * 没有可用的浏览器（本机的 Edge 无头模式直接退，拿不到 WebGL），
 * 所以退一步：把"页面会不会在运行时炸"里最常见的三类错静态挡掉 ——
 *   1. 代码里 getElementById 的 id 在 HTML 里不存在（拼错/漏写）
 *   2. import 的符号在目标模块里没有导出
 *   3. 用了库里不存在的 THREE.X
 * 这三类占了 WebGL 页面白屏原因的大头，而且都能不跑就查出来。
 */
import fs from 'fs';
import * as THREE from '../vendor/three/three.module.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const pages = [
  { html: '../internals.html', js: '../src/internals.js' },
  { html: '../shell.html', js: '../src/shell.js' },
  { html: '../review.html', js: '../src/app.js' },
];

let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };

/* HTML 里定义的 id */
function idsOf(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

/* JS 里引用到的 id：$('x') / getElementById('x') */
function refsOf(js) {
  const out = new Set();
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) out.add(m[1]);
  for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) out.add(m[1]);
  return out;
}

/* 模块导出 */
async function exportsOf(spec) {
  const mod = await import(spec);
  return new Set(Object.keys(mod));
}

for (const p of pages) {
  const html = read(p.html);
  const js = read(p.js);
  console.log('\n%s', p.html.replace('../', ''));
  const ids = idsOf(html);
  const refs = refsOf(js);
  const missing = [...refs].filter((id) => !ids.has(id));
  if (missing.length) fail('HTML 里没有这些 id：' + missing.join(', '));
  else console.log('  %d 个 id 引用全部命中', refs.size);

  /* import 符号 */
  for (const m of js.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w.-]+)'/g)) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const spec = '../src/' + m[2];
    let ex;
    try { ex = await exportsOf(spec); } catch (e) { fail(`导入 ${spec} 失败：${e.message}`); continue; }
    const miss = names.filter((n) => !ex.has(n));
    if (miss.length) fail(`${m[2]} 没有导出：${miss.join(', ')}`);
  }

  /* THREE.X */
  const used = [...new Set([...js.matchAll(/THREE\.([A-Za-z0-9_]+)/g)].map((x) => x[1]))];
  const missApi = used.filter((n) => THREE[n] === undefined);
  if (missApi.length) fail('three 里没有：' + missApi.join(', '));
  else if (!used.length) console.log('  不依赖 three');
  else console.log('  %d 个 THREE API 都存在', used.length);
}

/* 两个页面都要能链到对方和一个入口 */
const idx = read('../index.html');
['internals.html', 'shell.html', 'review.html'].forEach((f) => {
  if (!idx.includes(f)) fail('入口页没有链到 ' + f);
});

console.log('\n%s', bad ? `问题 ${bad} 处` : '页面静态检查通过');
process.exit(bad ? 1 : 0);
