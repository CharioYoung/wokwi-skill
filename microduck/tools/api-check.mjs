/* 用到的 three API 是否真的存在。headless 环境里拿不到 WebGL 上下文，
 * 但"名字写错"这类错误占运行时错误的绝大多数，静态对一遍就能挡掉。 */
import fs from 'fs';
import * as THREE from '../vendor/three/three.module.js';

const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
  + fs.readFileSync(new URL('../src/model.js', import.meta.url), 'utf8');

const used = [...new Set([...src.matchAll(/THREE\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();
const missing = used.filter((n) => THREE[n] === undefined);
console.log('引用 THREE.X 共 %d 个：%s', used.length, used.join(' '));
console.log(missing.length ? '缺失: ' + missing.join(', ') : '缺失: 无');

// WebGLRenderer 的方法是构造函数里挂到实例上的，原型上没有 —— 只能在源码里找
const core = fs.readFileSync(new URL('../vendor/three/three.module.js', import.meta.url), 'utf8');
// 两种写法都要认：类方法 setSize(...) 与构造器里挂的 this.setScissor = function
const needs = ['setSize', 'setPixelRatio', 'setViewport', 'setScissor', 'setScissorTest', 'render'];
const has = (k) => new RegExp('this\\.' + k + '\\s*=\\s*function').test(core)
  || new RegExp('\\b' + k + '\\s*\\(\\s*(width|boolean|x|scene)').test(core);
const badProto = needs.filter((k) => !has(k));
console.log('WebGLRenderer 方法:', badProto.length ? '缺 ' + badProto.join(',') : '齐全');

const p = new THREE.MeshStandardMaterial();
console.log('材质属性 wireframe/roughness/emissive:', 'wireframe' in p, 'roughness' in p, 'emissive' in p);
const scene = new THREE.Scene();
console.log('scene.environmentIntensity:', 'environmentIntensity' in scene, '=', scene.environmentIntensity);
console.log('PMREMGenerator.fromEquirectangular:', typeof THREE.PMREMGenerator.prototype.fromEquirectangular);
process.exit(missing.length || badProto.length ? 1 : 0);
