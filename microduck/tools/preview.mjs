/* Node 端预览：把 three 的几何体在世界空间里光栅化，出一张多视角接触表。
 * 用途只有两个 —— 确认模型尺寸对得上规格，以及在改动比例后立刻看到结果。 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import * as THREE from '../vendor/three/three.module.js';
import { buildMicroduck, POSES, applyPose } from '../src/model.js';

/* ---- PNG 写入 ---- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    chunks.push(len, td, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr); chunk('IDAT', idat); chunk('IEND', Buffer.alloc(0));
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks,
  ]));
}

/* ---- 收集世界空间三角面 ---- */
function collect(root, shellMats) {
  root.updateMatrixWorld(true);
  const tris = [];
  const v = new THREE.Vector3();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    // 隐藏分支里的东西不画
    let p = obj;
    while (p) { if (p.visible === false) return; p = p.parent; }
    const g = obj.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const idx = g.index ? g.index.array : null;
    const m = obj.material;
    const base = m.color ? m.color.clone() : new THREE.Color('#cccccc');
    const emis = m.emissive ? m.emissive.clone().multiplyScalar(m.emissiveIntensity || 1) : new THREE.Color(0, 0, 0);
    // 镜面/粗糙度拿来做高光强度
    const rough = m.roughness == null ? 0.7 : m.roughness;
    const metal = m.metalness == null ? 0 : m.metalness;
    const nm = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);
    const count = idx ? idx.length : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx[i] : i, ib = idx ? idx[i + 1] : i + 1, ic = idx ? idx[i + 2] : i + 2;
      const P = [ia, ib, ic].map((k) => new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(obj.matrixWorld));
      const N = [ia, ib, ic].map((k) => {
        const n = nrm ? new THREE.Vector3().fromBufferAttribute(nrm, k) : new THREE.Vector3(0, 1, 0);
        return n.applyMatrix3(nm).normalize();
      });
      tris.push({ P, N, color: base, emis, rough, metal, isShell: shellMats ? shellMats.indexOf(m) >= 0 : false });
    }
  });
  return tris;
}

/* ---- 光栅化 ---- */
const LIGHTS = [
  { dir: new THREE.Vector3(-0.45, 0.85, 0.55).normalize(), col: new THREE.Color(1.0, 0.97, 0.92), i: 2.15 },
  { dir: new THREE.Vector3(0.75, 0.35, 0.45).normalize(), col: new THREE.Color(0.55, 0.66, 0.85), i: 0.95 },
  { dir: new THREE.Vector3(0.1, 0.25, -0.95).normalize(), col: new THREE.Color(0.95, 0.82, 0.7), i: 0.8 },
];
const AMB = new THREE.Color(0.30, 0.32, 0.38);

function shade(n, viewDir, color, emis, rough, metal) {
  let r = 0, g = 0, b = 0;
  const ndv = Math.max(0.0, -n.dot(viewDir));
  const fres = Math.pow(1 - ndv, 3);
  for (const L of LIGHTS) {
    const ndl = Math.max(0, n.dot(L.dir));
    // 半兰伯特，暗部不至于死黑
    const diff = ndl * 0.85 + 0.15 * Math.max(0, n.dot(L.dir) * 0.5 + 0.5);
    const spec = Math.pow(Math.max(0, n.dot(L.dir.clone().add(viewDir).normalize())), 8 + 90 * (1 - rough));
    const k = diff * L.i;
    r += L.col.r * (color.r * k + spec * (0.35 + metal));
    g += L.col.g * (color.g * k + spec * (0.35 + metal));
    b += L.col.b * (color.b * k + spec * (0.35 + metal));
  }
  r += color.r * AMB.r * 2.2 + emis.r;
  g += color.g * AMB.g * 2.2 + emis.g;
  b += color.b * AMB.b * 2.2 + emis.b;
  const rim = fres * 0.35;
  r += rim; g += rim; b += rim * 1.1;
  return [r, g, b];
}

function renderView(tris, W, H, cam, bg) {
  const depth = new Float32Array(W * H).fill(Infinity);
  const img = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    // 背景竖向渐变，配合地面阴影
    const t = i / W / H;
    img[i * 3] = bg[0] * (1 - t * 0.25);
    img[i * 3 + 1] = bg[1] * (1 - t * 0.25);
    img[i * 3 + 2] = bg[2] * (1 - t * 0.22);
  }
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const M = new THREE.Matrix4();
  const A = new THREE.Vector4(), B = new THREE.Vector4(), C = new THREE.Vector4();

  for (const tri of tris) {
    const ws = tri.P.slice();
    A.set(ws[0].x, ws[0].y, ws[0].z, 1).applyMatrix4(vp);
    B.set(ws[1].x, ws[1].y, ws[1].z, 1).applyMatrix4(vp);
    C.set(ws[2].x, ws[2].y, ws[2].z, 1).applyMatrix4(vp);
    if (A.w <= 0.01 || B.w <= 0.01 || C.w <= 0.01) continue;
    const ax = (A.x / A.w * 0.5 + 0.5) * W, ay = (1 - (A.y / A.w * 0.5 + 0.5)) * H;
    const bx = (B.x / B.w * 0.5 + 0.5) * W, by = (1 - (B.y / B.w * 0.5 + 0.5)) * H;
    const cx = (C.x / C.w * 0.5 + 0.5) * W, cy = (1 - (C.y / C.w * 0.5 + 0.5)) * H;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area >= -1e-6) continue; // 背面剔除（屏幕空间 y 向下，逆时针为负）
    const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxx = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const miny = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxy = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minx > maxx || miny > maxy) continue;
    const za = A.z / A.w, zb = B.z / B.w, zc = C.z / C.w;
    const inv = 1 / area;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        let w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
        let w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
        let w2 = 1 - w0 - w1;
        if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
        const z = w0 * za + w1 * zb + w2 * zc;
        const o = y * W + x;
        if (z >= depth[o]) continue;
        depth[o] = z;
        const n = new THREE.Vector3(
          w0 * tri.N[0].x + w1 * tri.N[1].x + w2 * tri.N[2].x,
          w0 * tri.N[0].y + w1 * tri.N[1].y + w2 * tri.N[2].y,
          w0 * tri.N[0].z + w1 * tri.N[1].z + w2 * tri.N[2].z
        ).normalize();
        const surf = new THREE.Vector3(
          w0 * ws[0].x + w1 * ws[1].x + w2 * ws[2].x,
          w0 * ws[0].y + w1 * ws[1].y + w2 * ws[2].y,
          w0 * ws[0].z + w1 * ws[1].z + w2 * ws[2].z
        );
        const vd = surf.clone().sub(camPos).normalize();
        const c = shade(n, vd, tri.color, tri.emis, tri.rough, tri.metal);
        img[o * 3] = c[0]; img[o * 3 + 1] = c[1]; img[o * 3 + 2] = c[2];
      }
    }
  }
  // 色调映射 + 编码
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) {
    let v = img[i];
    v = v / (1 + v * 0.72);              // 柔和的高光压缩
    v = Math.pow(Math.max(0, v), 1 / 2.2);
    out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

/* ---- 主流程 ---- */
const W = Number(process.env.PW || 460), H = W, COLS = 3, ROWS = 2;
const duck = buildMicroduck(THREE, { colorway: process.argv[2] || 'cream' });
const poseKey = process.argv[3] || 'stand';
const poseList = poseKey === 'poses'
  ? ['stand', 'crouch', 'grip', 'kick', 'skate', 'lying']
  : [poseKey];
if (POSES[poseKey]) applyPose(duck.dof, POSES[poseKey], 1);

// 先量尺寸再摆姿势：装饰性的歪头和转身会把 AABB 撑大，量出来的宽度就不是整机宽度了
const box = new THREE.Box3();
duck.root.updateMatrixWorld(true);
duck.root.traverse((o) => {
  if (!o.isMesh) return;
  let p = o; while (p) { if (p.visible === false) return; p = p.parent; }
  box.expandByObject(o);
});
const size = box.getSize(new THREE.Vector3());
console.log('尺寸  W×H×D = %s × %s × %s cm', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
console.log('包围盒 y: %s .. %s', box.min.y.toFixed(2), box.max.y.toFixed(2));

duck.dof.bodyPivot.rotation.z = 0.12;   // 一点点歪头，比正襟危坐好看
duck.dof.bodyPivot.rotation.y = 0.42;

/* internal 模式：把外壳整体藏掉，只留腔体里的器件与线束。
 * 这是唯一能在没有 GPU 的机器上验证"装不装得下"的办法。 */
const SHELL_MATS = [duck.materials.shell, duck.materials.shell2, duck.materials.accent, duck.materials.tpu];
// inner = 外壳全隐，只看器件；cut = 沿 x=0 剖开，近侧半壳切掉，器件完整
const internalView = poseKey === 'internal';
const cutView = poseKey === 'cut';
if (internalView || cutView) {
  duck.dof.internals.visible = true;
  duck.dof.wires.visible = true;
  duck.dof.pulses.forEach((p, i) => {
    p.mesh.visible = true;
    p.curve.getPoint((i * 0.37) % 1, p.mesh.position);
  });
  duck.dof.bodyPivot.rotation.z = 0;
  duck.dof.bodyPivot.rotation.y = 0;
}

let meshes = 0, tris = 0;
duck.root.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
console.log('网格 %d 个，三角面 %d', meshes, Math.round(tris));

let all = collect(duck.root, SHELL_MATS);
if (internalView) all = all.filter((t) => !t.isShell);
if (cutView) {
  // 质心在 +x 的外壳三角面丢掉 —— 与浏览器里那张随相机转的裁剪面同一个意思
  all = all.filter((t) => !t.isShell || (t.P[0].x + t.P[1].x + t.P[2].x) / 3 <= 0);
}
const detailView = internalView || cutView;
const target = new THREE.Vector3(0, detailView ? 12.0 : 12.4, detailView ? 0.2 : 0.4);
const views = detailView ? [
  { yaw: 30, pitch: 16, fov: 30, name: 'inner-hero' },
  { yaw: 0, pitch: 2, fov: 30, name: 'inner-front' },
  { yaw: 90, pitch: 2, fov: 30, name: 'inner-side' },
  { yaw: 200, pitch: 12, fov: 30, name: 'inner-back' },
  { yaw: 40, pitch: 58, fov: 30, name: 'inner-top' },
  { yaw: -30, pitch: -4, fov: 30, name: 'inner-low' },
] : [
  { yaw: 34, pitch: 12, fov: 30, name: 'hero' },
  { yaw: 0, pitch: 4, fov: 30, name: 'front' },
  { yaw: 90, pitch: 4, fov: 30, name: 'side' },
  { yaw: 208, pitch: 14, fov: 30, name: 'back' },
  { yaw: 42, pitch: 62, fov: 30, name: 'top' },
  { yaw: -18, pitch: -6, fov: 30, name: 'low' },
];
const sheet = Buffer.alloc(W * COLS * H * ROWS * 3);
const cam = new THREE.PerspectiveCamera(30, W / H, 1, 400);
const isPoseSheet = poseList.length > 1;
for (let vi = 0; vi < views.length; vi++) {
  if (isPoseSheet) {
    // 每个格子换一个姿态：先摆姿势再收集世界空间三角面
    applyPose(duck.dof, POSES[poseList[vi]], 1);
    duck.root.updateMatrixWorld(true);
    duck.root.traverse((o) => { if (o.isMesh) o.geometry.computeBoundingSphere(); });
    const b = new THREE.Box3();
    duck.root.traverse((o) => {
      if (!o.isMesh) return;
      let q = o; while (q) { if (q.visible === false) return; q = q.parent; }
      b.expandByObject(o);
    });
    // 与页面里那层逐帧贴地同一个道理：姿态角是手写的，组合起来（尤其
    // 俯仰叠上偏航）会让一侧沉下去，与其手调 bodyY，不如量完直接抵消。
    if (Math.abs(b.min.y) > 0.01) {
      duck.dof.bodyPivot.position.y -= b.min.y;
      duck.root.updateMatrixWorld(true);
      const b2 = new THREE.Box3();
      duck.root.traverse((o) => {
        if (!o.isMesh) return;
        let q = o; while (q) { if (q.visible === false) return; q = q.parent; }
        b2.expandByObject(o);
      });
      b.copy(b2);
    }
    console.log('  pose %s  y=%s..%s', poseList[vi], b.min.y.toFixed(2), b.max.y.toFixed(2));
    if (b.min.y < -0.02) console.log('    !! 仍穿地 %.2f', b.min.y);
  }
  const v = isPoseSheet
    ? { yaw: 26, pitch: 11, fov: 30, name: poseList[vi] }
    : views[vi];
  const dist = 74;
  const yr = v.yaw * Math.PI / 180, pr = v.pitch * Math.PI / 180;
  cam.fov = v.fov;
  cam.position.set(
    target.x + Math.sin(yr) * Math.cos(pr) * dist,
    target.y + Math.sin(pr) * dist,
    target.z + Math.cos(yr) * Math.cos(pr) * dist
  );
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  const tris = isPoseSheet ? collect(duck.root) : all;
  const img = renderView(tris, W, H, cam, [0.10, 0.11, 0.13]);
  const ox = (vi % COLS) * W, oy = Math.floor(vi / COLS) * H;
  for (let y = 0; y < H; y++) {
    img.copy(sheet, ((oy + y) * W * COLS + ox) * 3, y * W * 3, (y + 1) * W * 3);
  }
  console.log('  view', v.name);
}
const outFile = path.resolve(process.argv[4] || '.dev/microduck.png');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
writePNG(outFile, W * COLS, H * ROWS, sheet);
console.log('wrote', outFile);
