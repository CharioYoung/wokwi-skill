/* 把接线图渲成 PNG —— 这台机器上浏览器拿不到无头截图，
 * 所以用 resvg 直接吃导出的 SVG。图上有什么，这里就能看到什么。
 *
 *   node tools/shot-diagram.mjs [输出] [--scale 2] [--crop x,y,w,h]
 *
 * resvg 改根 viewBox 会崩（几何模块 unwrap 到空值），所以裁剪不走 SVG，
 * 而是整张渲完再裁像素 —— 顺便省掉一次矢量重算。
 */
import fs from 'fs';
import zlib from 'zlib';
import { Resvg } from '../../node_modules/@resvg/resvg-js/index.js';
import { buildDiagram, CANVAS } from '../src/diagram.js';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || '.dev/diagram.png';
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith('--' + k + '='));
  return eq ? eq.split('=')[1] : null;
};

const scale = Number(argOf('scale') || 1);
const crop = argOf('crop') ? argOf('crop').split(',').map(Number) : null;

const d = buildDiagram();
const W = Math.round(CANVAS.w * scale);
const img = new Resvg(d.svg, { fitTo: { mode: 'width', value: W } }).render();
const { width, height, pixels } = img;

/* ---- PNG 编码：RGBA，逐行 filter 0 ---- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let buf = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.length);
let ow = width, oh = height;

if (crop) {
  const [x, y, w, h] = crop.map((v) => Math.round(v * scale));
  const cw = Math.min(w, width - x), ch = Math.min(h, height - y);
  const dst = Buffer.alloc(cw * ch * 4);
  for (let r = 0; r < ch; r++) {
    buf.copy(dst, r * cw * 4, ((y + r) * width + x) * 4, ((y + r) * width + x + cw) * 4);
  }
  buf = dst; ow = cw; oh = ch;
}

fs.writeFileSync(out, encodePng(ow, oh, buf));
console.log('%s  %d×%d · %d 段线', out, ow, oh, d.wires.length);
