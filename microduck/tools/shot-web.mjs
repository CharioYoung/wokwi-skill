/* 无头浏览器验收：真的把页面跑一遍，抓控制台错误 + 截图。
 * 光看图不够 —— 关键证据是"没有任何 console error / pageerror"。 */
import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'http://localhost:8099/';
const OUT = process.argv[3] || '.dev/web';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--user-data-dir=' + process.cwd() + '/.edge-profile',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[404] ${r.url()} ${r.failure()?.errorText || ''}`));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
let ok = true;
try {
  await page.waitForFunction('window.__MD_OK === true', { timeout: 25000 });
} catch (e) {
  ok = false;
  logs.push('[fatal] window.__MD_OK 一直没有置位 —— 模块没跑起来');
}
await new Promise((r) => setTimeout(r, 2000));

await page.screenshot({ path: `${OUT}-hero.png` });

// 四视图
if (ok) {
  await page.click('#btnMulti');
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${OUT}-multi.png` });
  await page.click('#btnMulti');
  await new Promise((r) => setTimeout(r, 400));
  // 换配色 + 蹲下，确认交互链路
  await page.evaluate(() => {
    document.querySelectorAll('#swatches .sw')[3].click();
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('#poses button')].find((b) => b.textContent === '蹲下').click();
  });
  await new Promise((r) => setTimeout(r, 1600));
  await page.screenshot({ path: `${OUT}-sky-crouch.png` });
}

// 画面是不是全黑：采样 canvas 的像素亮度
const stats = await page.evaluate(() => {
  const c = document.getElementById('gl');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  if (!g) return { err: 'no webgl context' };
  const w = g.drawingBufferWidth, h = g.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
  let lit = 0, sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] + px[i + 1] + px[i + 2];
    sum += v;
    if (v > 90) lit++;
  }
  return { w, h, litRatio: +(lit / (w * h)).toFixed(4), avg: +(sum / (w * h) / 3).toFixed(1) };
});

console.log('canvas:', JSON.stringify(stats));
console.log(logs.length ? logs.slice(0, 12).join('\n') : '没有 console 错误');
console.log(ok ? 'RESULT: OK' : 'RESULT: FAILED');
await browser.close();
process.exit(ok && !logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[fatal]')) ? 0 : 1);
