/* ==================================================================== *
 * 器件"实物"图形 —— 俯视角，照着真板子的样子画
 *
 * 为什么不用方块加文字：那种图能看拓扑，看不出"这块板上有几个插座、
 * 插座在哪条边上、针距多密"。接线图要能对着实物装，就得把板子画成
 * 板子：深绿阻焊、金色焊盘、金属屏蔽罩、丝印、安装孔、JST 壳体。
 *
 * 画法跟 Wokwi 一致：不按物理比例，按可读性定尺寸；但板上的相对位置、
 * 元件数量、插座脚数是真的 —— 由 hardware.js 的连接器表决定。
 *
 * 每个 partArt() 只画器件本体，(0,0) 是左上角，尺寸由调用方给。
 * ==================================================================== */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 渐变与共用图案：一次定义，整张图引用 */
export function svgDefs() {
  return `
<defs>
  <linearGradient id="pcbG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#12513c"/><stop offset="0.55" stop-color="#0d3f2e"/>
    <stop offset="1" stop-color="#0a3325"/>
  </linearGradient>
  <linearGradient id="pcbG2" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#14503f"/><stop offset="0.6" stop-color="#0e3b2d"/>
    <stop offset="1" stop-color="#0b2f24"/>
  </linearGradient>
  <linearGradient id="metalG" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0" stop-color="#d6dbe0"/><stop offset="0.45" stop-color="#a8b0b8"/>
    <stop offset="1" stop-color="#7d858d"/>
  </linearGradient>
  <linearGradient id="canG" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#c9d0d7"/><stop offset="0.5" stop-color="#98a1aa"/>
    <stop offset="1" stop-color="#6f777f"/>
  </linearGradient>
  <linearGradient id="chipG" x1="0" y1="0" x2="0.2" y2="1">
    <stop offset="0" stop-color="#2b3037"/><stop offset="1" stop-color="#15181c"/>
  </linearGradient>
  <linearGradient id="goldG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f0d492"/><stop offset="0.5" stop-color="#d3ab5c"/>
    <stop offset="1" stop-color="#a9823c"/>
  </linearGradient>
  <linearGradient id="cellG" x1="0" y1="0" x2="0.1" y2="1">
    <stop offset="0" stop-color="#2c3038"/><stop offset="0.6" stop-color="#1a1d22"/>
    <stop offset="1" stop-color="#101318"/>
  </linearGradient>
  <linearGradient id="lensG" x1="0.2" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="#3e4a56"/><stop offset="0.5" stop-color="#161b21"/>
    <stop offset="0.78" stop-color="#2b3f52"/><stop offset="1" stop-color="#0b0e12"/>
  </linearGradient>
  <radialGradient id="coneG" cx="0.5" cy="0.45" r="0.55">
    <stop offset="0" stop-color="#3a3f46"/><stop offset="0.7" stop-color="#1d2126"/>
    <stop offset="1" stop-color="#111417"/>
  </radialGradient>
</defs>`;
}

/* ---------- 基础零件 ---------- */

const rect = (x, y, w, h, rx, fill, extra = '') =>
  `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" fill="${fill}" ${extra}/>`;

const line = (x1, y1, x2, y2, stroke, w = 0.8, extra = '') =>
  `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;

const txt = (x, y, s, size, fill, extra = '') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${fill}" ` +
  `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" ${extra}>${esc(s)}</text>`;

/* 安装孔：外圈铜环 + 内圈钻孔，四个角 */
function holes(w, h, inset = 9, r = 4.4) {
  const pts = [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]];
  return pts.map(([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#0a2a20" stroke="#c9a45c" stroke-width="1.1" opacity="0.9"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="#05080a"/>`).join('');
}

/* 阻焊上的走线：几条 45° 折线，不指向任何具体网络，只交代"这是块 PCB" */
function traces(w, h, seed = 1) {
  let s = '';
  const rows = Math.max(3, Math.round(h / 34));
  for (let i = 0; i < rows; i++) {
    const y = 12 + i * ((h - 24) / Math.max(1, rows - 1));
    const x1 = 8 + ((i * 37 + seed * 13) % 40);
    const x2 = w - 8 - ((i * 53 + seed * 7) % 50);
    const k = 8 + (i % 3) * 6;
    s += `<path d="M${x1} ${y}H${(x1 + x2) / 2 - k}l${k} ${k * 0.6}H${x2}" fill="none"
      stroke="#1c6b50" stroke-width="0.9" opacity="0.45"/>`;
  }
  return s;
}

/* 丝印框 + 板名。
 * 板名默认写左下角，但左下角正好是底边插座的脚号位（S10/S11…），
 * 所以插座排满底边的板子要指定别处，否则两串字叠在一起。 */
function silk(w, h, name, o = {}) {
  const x = o.x == null ? 8 : o.x;
  const y = o.y == null ? h - 7 : o.y;
  return rect(3, 3, w - 6, h - 6, 3, 'none', 'stroke="#cfe3d8" stroke-width="0.7" opacity="0.42"') +
    txt(x, y, name, 6.2, '#cfe3d8', 'opacity="0.5" letter-spacing="0.4"');
}

/* 贴片芯片：深色本体 + 一侧 1 脚圆点 + 顶部高光 */
function chip(x, y, w, h, label, dark = true) {
  const fill = dark ? 'url(#chipG)' : '#3b424a';
  return rect(x, y, w, h, 1.6, fill, 'stroke="#0a0c0f" stroke-width="0.8"') +
    rect(x + 1.2, y + 1.2, w - 2.4, Math.max(1, h * 0.16), 0.8, '#ffffff', 'opacity="0.07"') +
    `<circle cx="${x + 4}" cy="${y + h - 4}" r="1.5" fill="#6b7480" opacity="0.85"/>` +
    (label ? txt(x + w / 2, y + h / 2 + 2.2, label, Math.min(6.4, w / (label.length * 0.62)), '#98a2ad',
      'text-anchor="middle" opacity="0.92"') : '');
}

/* ---------- 各器件 ---------- */

const ART = {
  /* 84 × 56 主控板：RK3566 核心 + LPDDR + eMMC + Wi-Fi 模组 */
  mb(w, h) {
    let s = rect(0, 0, w, h, 6, 'url(#pcbG2)', 'stroke="#08241a" stroke-width="1.4"');
    s += traces(w, h, 2);
    s += holes(w, h, 12, 5);
    s += silk(w, h, 'MICRODUCK-MB  REV.B', { x: 26, y: 17 });
    // SoC：金属盖 + 丝印
    const sx = w * 0.30, sy = h * 0.30, sw = Math.min(78, w * 0.24), sh = sw * 0.92;
    s += rect(sx - 2, sy - 2, sw + 4, sh + 4, 2, '#0a0c0f', 'opacity="0.5"');
    s += rect(sx, sy, sw, sh, 2, 'url(#canG)', 'stroke="#5d666f" stroke-width="1"');
    s += txt(sx + sw / 2, sy + sh * 0.42, 'RK3566', 8.5, '#31383f', 'text-anchor="middle" font-weight="700"');
    s += txt(sx + sw / 2, sy + sh * 0.62, 'BGA · 4×A55', 5.4, '#4b535b', 'text-anchor="middle"');
    // 屏蔽罩四角螺钉
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([i, j]) => {
      s += `<circle cx="${sx + 6 + i * (sw - 12)}" cy="${sy + 6 + j * (sh - 12)}" r="2.4"
        fill="#c9d0d7" stroke="#6d767e" stroke-width="0.7"/>`;
    });
    // LPDDR ×2
    s += chip(sx + sw + 14, sy - 2, 34, 14, 'LPDDR4');
    s += chip(sx + sw + 14, sy + 16, 34, 14, 'LPDDR4');
    // eMMC
    s += chip(sx + sw + 14, sy + sh - 22, 26, 16, 'eMMC');
    // Wi-Fi 模组：金属罩 + 天线座
    const wx = w * 0.63, wy = h * 0.14, ww = Math.min(96, w * 0.29), wh = Math.min(52, h * 0.24);
    s += rect(wx, wy, ww, wh, 2, 'url(#metalG)', 'stroke="#5c646c" stroke-width="1"');
    s += txt(wx + 6, wy + 13, 'AIC8800', 6.8, '#3a424a', 'font-weight="700"');
    s += txt(wx + 6, wy + 23, 'Wi-Fi 6 + BT5.2', 5.2, '#4a525a');
    s += `<circle cx="${wx + ww - 16}" cy="${wy + wh / 2}" r="6.5" fill="#c9ced6" stroke="#7d858d" stroke-width="1"/>`;
    s += `<circle cx="${wx + ww - 16}" cy="${wy + wh / 2}" r="2.2" fill="#2a3037"/>`;
    // USB-C / 调试口
    s += rect(w - 46, h - 24, 24, 11, 2.4, 'url(#metalG)', 'stroke="#6d767e" stroke-width="0.8"');
    s += txt(w - 34, h - 6, 'USB-C', 5, '#cfe3d8', 'text-anchor="middle" opacity="0.6"');
    // 去耦电容一排
    for (let i = 0; i < 7; i++) {
      s += rect(sx + 6 + i * 12, sy + sh + 10, 6, 5, 1, '#8b6f3f');
    }
    return s;
  },

  powerBoard(w, h) {
    let s = rect(0, 0, w, h, 5, 'url(#pcbG)', 'stroke="#08241a" stroke-width="1.2"');
    s += traces(w, h, 5);
    s += holes(w, h, 10, 4);
    s += silk(w, h, 'PWR-DIST  7.2V→5/3.3/6V', { x: 26, y: 17 });
    // 两个 DC-DC 电感
    s += rect(w * 0.12, h * 0.20, 40, 34, 3, '#4a4f57', 'stroke="#20242a" stroke-width="1"');
    s += txt(w * 0.12 + 20, h * 0.20 + 20, '4R7', 7, '#c3c9d0', 'text-anchor="middle"');
    s += rect(w * 0.12 + 46, h * 0.20, 34, 30, 3, '#4a4f57', 'stroke="#20242a" stroke-width="1"');
    s += txt(w * 0.12 + 63, h * 0.20 + 18, '2R2', 7, '#c3c9d0', 'text-anchor="middle"');
    // 电解电容
    [[0.66, 0.26], [0.78, 0.26], [0.66, 0.56]].forEach(([fx, fy]) => {
      s += `<circle cx="${w * fx}" cy="${h * fy}" r="12" fill="#2d3a45" stroke="#8f9aa5" stroke-width="1.2"/>`;
      s += `<circle cx="${w * fx}" cy="${h * fy}" r="7" fill="#1d262e"/>`;
      s += `<path d="M${w * fx - 10} ${h * fy}h-4" stroke="#9aa5af" stroke-width="1.4"/>`;
    });
    // 保险 + 电量计
    s += rect(w * 0.14, h * 0.62, 26, 13, 1.5, '#c8a24a', 'stroke="#8a6c2b"');
    s += txt(w * 0.14 + 13, h * 0.62 + 9, 'FUSE', 4.6, '#3a2f14', 'text-anchor="middle"');
    s += chip(w * 0.30, h * 0.62, 30, 16, 'BQ27');
    s += txt(w * 0.30 + 15, h * 0.62 + 26, '电量计', 4.8, '#cfe3d8', 'text-anchor="middle" opacity="0.55"');
    return s;
  },

  /* 46 × 28 舵机总线板：16 个 3P 口挤在右边和下边，板芯全空着不像真板子。
   * 按真实的总线板排：MCU + Flash + 电平转换 → 降压 → 总线取电 → 16 路指示。 */
  servoBoard(w, h) {
    const X = (v) => (v / 272) * w, Y = (v) => (v / 306) * h;
    let s = rect(0, 0, w, h, 5, 'url(#pcbG)', 'stroke="#08241a" stroke-width="1.2"');
    s += traces(w, h, 8);
    // 板名挪到左上：左下被 S10 的脚号占了
    s += silk(w, h, 'SERVO-BUS  16×3P  50Hz', { x: 26, y: 17 });
    s += holes(w, h, 9, 4);

    // ① 主控区
    s += chip(X(22), Y(28), X(58), Y(42), 'RP2040');
    s += chip(X(86), Y(28), X(34), Y(15), 'W25Q16');
    s += chip(X(86), Y(48), X(42), Y(17), '74HC245');
    s += rect(X(140), Y(28), X(22), Y(12), 1.5, '#b9c1c9', 'stroke="#6d767e" stroke-width="0.8"');
    s += txt(X(151), Y(37), '12M', 4.4, '#3a424a', 'text-anchor="middle"');

    // ② 6 V → 5 V 降压（电感 + 同步整流 + 滤波）
    s += rect(X(22), Y(84), X(30), Y(24), 3, '#4a4f57', 'stroke="#20242a" stroke-width="1"');
    s += txt(X(37), Y(99), '4R7', 6.4, '#c3c9d0', 'text-anchor="middle"');
    s += chip(X(58), Y(88), X(28), Y(18), 'MP1584');
    s += `<circle cx="${X(112)}" cy="${Y(97)}" r="${X(11)}" fill="#2d3a45" stroke="#8f9aa5" stroke-width="1.1"/>`;
    s += `<circle cx="${X(112)}" cy="${Y(97)}" r="${X(6)}" fill="#1d262e"/>`;
    s += `<circle cx="${X(140)}" cy="${Y(98)}" r="${X(8.4)}" fill="#2d3a45" stroke="#8f9aa5" stroke-width="1"/>`;
    s += `<circle cx="${X(140)}" cy="${Y(98)}" r="${X(4.4)}" fill="#1d262e"/>`;
    // 总线取电端子
    s += rect(X(168), Y(84), X(42), Y(24), 2, '#3f8f5f', 'stroke="#1d4a30" stroke-width="1"');
    s += rect(X(172), Y(88), X(34), Y(16), 1, '#d8c9a0', 'opacity="0.72"');
    [0, 1].forEach((i) => {
      s += `<circle cx="${X(180 + i * 20)}" cy="${Y(96)}" r="${X(5.4)}" fill="none" stroke="#1d4a30" stroke-width="1.2"/>`;
      s += line(X(180 + i * 20 - 3), Y(96), X(180 + i * 20 + 3), Y(96), '#1d4a30', 1);
    });
    s += txt(X(189), Y(119), 'VSERVO IN', 4.4, '#cfe3d8', 'text-anchor="middle" opacity="0.6"');

    // ③ 16 路状态灯：两列八行，正好对上 16 个口
    for (let i = 0; i < 16; i++) {
      const cx = X(196 + (i % 2) * 15), cy = Y(140 + Math.floor(i / 2) * 17);
      s += `<circle cx="${cx}" cy="${cy}" r="${X(2.6)}" fill="#4fd8ff" opacity="0.55"/>`;
    }
    s += txt(X(190), Y(132), 'CH1-16', 4.2, '#cfe3d8', 'opacity="0.5"');

    // ④ 大电容 + 电源指示
    s += `<circle cx="${X(46)}" cy="${Y(196)}" r="${X(15)}" fill="#2d3a45" stroke="#8f9aa5" stroke-width="1.2"/>`;
    s += `<circle cx="${X(46)}" cy="${Y(196)}" r="${X(8)}" fill="#1d262e"/>`;
    s += `<path d="M${X(38)} ${Y(196)}h${-4}" stroke="#9aa5af" stroke-width="1.4"/>`;
    s += txt(X(46), Y(220), '470uF', 4.2, '#cfe3d8', 'text-anchor="middle" opacity="0.5"');
    // 三颗状态灯压到左下角
    for (let i = 0; i < 3; i++) {
      s += `<circle cx="${X(26 + i * 11)}" cy="${Y(252)}" r="${X(3)}"
        fill="${['#ff5a3c', '#ffd24a', '#4fd8ff'][i]}" opacity="0.9"/>`;
    }
    s += txt(X(22), Y(268), 'PWR · BUS · ERR', 4.4, '#cfe3d8', 'opacity="0.55"');
    s += txt(X(100), Y(268), 'UART 1Mbps · 50Hz 广播', 4.4, '#cfe3d8', 'opacity="0.45"');
    return s;
  },

  servo(w, h) {
    // 黑色塑料壳 + 两侧安装耳 + 输出轴 + 白色舵盘
    let s = rect(6, 4, w - 12, h - 8, 4, '#22262c', 'stroke="#0d1014" stroke-width="1.2"');
    s += rect(2, h * 0.30, 8, h * 0.40, 2, '#22262c', 'stroke="#0d1014" stroke-width="1"');
    s += rect(w - 10, h * 0.30, 8, h * 0.40, 2, '#22262c', 'stroke="#0d1014" stroke-width="1"');
    s += rect(8, 6, w - 16, 8, 2, '#333941', 'opacity="0.75"');
    s += `<circle cx="${w * 0.64}" cy="${h * 0.52}" r="${h * 0.20}" fill="#d9d4c8" stroke="#8e897d" stroke-width="1"/>`;
    s += `<circle cx="${w * 0.64}" cy="${h * 0.52}" r="3" fill="#6f6a5f"/>`;
    s += `<path d="M${w * 0.64 - 15} ${h * 0.52}h30M${w * 0.64} ${h * 0.52 - 10}v20"
      stroke="#8e897d" stroke-width="2.4" opacity="0.9"/>`;
    s += txt(12, h - 9, 'SERVO', 5, '#9aa3ad', 'opacity="0.8"');
    return s;
  },

  battery(w, h) {
    let s = rect(0, 0, w, h, 8, 'url(#cellG)', 'stroke="#05070a" stroke-width="1.6"');
    s += rect(4, 4, w - 8, h - 8, 6, 'none', 'stroke="#4a5058" stroke-width="0.9" opacity="0.7"');
    // 标签面
    s += rect(12, 14, w - 24, h * 0.42, 3, '#e8e4d8', 'opacity="0.92"');
    s += txt(20, 30, 'NP-F550', 9, '#24282e', 'font-weight="700"');
    s += txt(20, 42, '7.2V  2600mAh  18.7Wh', 5.4, '#3c424a');
    s += txt(20, 51, 'Li-ion 2S1P · 可拆', 5, '#5b626b');
    // 电量指示
    for (let i = 0; i < 4; i++) {
      s += rect(18 + i * 10, h - 26, 7, 5, 1, i < 3 ? '#5ad07a' : '#2a5c3a');
    }
    // 底边留给 B1 的脚号，'POWER' 丝印往上让一格
    s += txt(18, h - 33, 'POWER', 4.6, '#8b929d', 'opacity="0.8"');
    return s;
  },

  speaker(w, h) {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;
    let s = '';
    // 盆架（金属）+ 折环 + 纸盆 + 防尘帽 + 螺钉
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#23272d" stroke="#0c0f12" stroke-width="1.4"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.88}" fill="#2c3138" stroke="#8f99a3" stroke-width="1.2"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.70}" fill="none" stroke="#11151a" stroke-width="2.2" opacity="0.9"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.60}" fill="url(#coneG)" stroke="#0d1014" stroke-width="1"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.22}" fill="#3b4148" stroke="#11151a" stroke-width="1"/>`;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      s += `<circle cx="${cx + Math.cos(a) * r * 0.94}" cy="${cy + Math.sin(a) * r * 0.94}" r="2.6"
        fill="#b9c1c9" stroke="#6d767e" stroke-width="0.7"/>`;
    }
    s += txt(cx, cy + r * 0.42, '8Ω 2W', 6, '#c9d2db', 'text-anchor="middle" opacity="0.72"');
    return s;
  },

  cam(w, h) {
    // 小板 + 镜头座 + FPC 金手指
    let s = rect(6, 6, w - 12, h - 12, 4, 'url(#pcbG)', 'stroke="#08241a" stroke-width="1.2"');
    s += traces(w - 12, h - 12, 3);
    const cx = w / 2, cy = h * 0.46, r = Math.min(w, h) * 0.27;
    s += `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="#14181d" stroke="#3a4149" stroke-width="1.4"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#lensG)" stroke="#5b6672" stroke-width="1.2"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="none" stroke="#6f8ea8" stroke-width="0.9" opacity="0.55"/>`;
    s += `<circle cx="${cx - r * 0.28}" cy="${cy - r * 0.28}" r="${r * 0.18}" fill="#ffffff" opacity="0.18"/>`;
    s += txt(cx, h - 12, '4.2mm  F2.0', 5, '#cfe3d8', 'text-anchor="middle" opacity="0.6"');
    return s;
  },

  lidar(w, h) {
    let s = rect(4, 4, w - 8, h - 8, 4, 'url(#pcbG2)', 'stroke="#08241a" stroke-width="1.2"');
    const cx = w / 2, cy = h * 0.44;
    s += `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.30}" fill="#1a1f25" stroke="#6d7681" stroke-width="1.4"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.22}" fill="#0c1015" stroke="#40474f" stroke-width="0.9"/>`;
    s += rect(cx - 9, cy - 4, 18, 8, 2, '#7fd4ff', 'opacity="0.55"');
    s += txt(cx, h - 10, 'dToF  940nm', 5, '#cfe3d8', 'text-anchor="middle" opacity="0.6"');
    return s;
  },

  imu(w, h, dev) {
    let s = rect(0, 0, w, h, 3, 'url(#pcbG)', 'stroke="#08241a" stroke-width="1"');
    s += chip(w * 0.22, h * 0.18, w * 0.42, h * 0.40, '', true);
    s += `<circle cx="${w * 0.26}" cy="${h * 0.30}" r="1.3" fill="#6b7480"/>`;
    // 地址从器件表里取：两颗 IMU 一颗 0x68 一颗 0x69，写死会有一颗对不上
    const addr = ((dev && dev.spec) || '').match(/0x[0-9A-Fa-f]{2}/);
    s += txt(w * 0.22, h * 0.80, addr ? addr[0] : '0x68', 5.4, '#cfe3d8', 'opacity="0.65"');
    s += holes(w, h, 5, 2.2);
    return s;
  },

  nfc(w, h) {
    let s = rect(0, 0, w, h, 3, 'url(#pcbG2)', 'stroke="#08241a" stroke-width="1"');
    // 天线线圈：三圈方框
    for (let i = 0; i < 3; i++) {
      s += rect(5 + i * 4, 5 + i * 4, w - 10 - i * 8, h - 10 - i * 8, 3, 'none',
        'stroke="#c9a45c" stroke-width="1.1" opacity="0.55"');
    }
    s += chip(w * 0.28, h * 0.30, 22, 16, 'NFC');
    s += txt(w * 0.30, h * 0.82, '13.56 MHz', 4.8, '#cfe3d8', 'opacity="0.6"');
    return s;
  },

  mic(w, h) {
    let s = rect(0, 0, w, h, 2.5, 'url(#pcbG)', 'stroke="#08241a" stroke-width="1"');
    s += chip(6, h * 0.20, w - 12, h * 0.44, 'MEMS');
    s += `<circle cx="${w / 2}" cy="${h * 0.42}" r="2.4" fill="#05080a"/>`;
    s += txt(6, h - 4, 'I2S', 4.6, '#cfe3d8', 'opacity="0.6"');
    return s;
  },
};

/* 取某类器件的画法；未知类型退回一块素板，不静默画成空白 */
export function partArt(kind, w, h, dev) {
  const fn = ART[kind] || ART.mb;
  const body = fn(w, h, dev);
  return `<g class="part-art">${body}</g>`;
}

/* 插座：JST 壳体 + 每股一粒金针。
 * 针画成短竖条压在壳上，线的落点就是针尖 —— 图上的"接到第几脚"不是标注
 * 上去的，是画在那儿的。 */
export function connArt({ x, y, w, h, n, side, type }) {
  const bodyFill = type === 'FPC05' ? '#b98f45' : type === 'BTN' ? '#8a5a2e'
    : type === 'IPEX' ? '#c9ced6' : '#e9e3d5';
  const pinFill = type === 'FPC05' ? '#f0d492' : 'url(#goldG)';
  let s = '';
  if (side === 'left' || side === 'right') {
    s += rect(x, y, w, h, 2, bodyFill, 'stroke="#6f6857" stroke-width="0.9"');
    // 每根针：横向短条，沿 h 平均分布
    for (let i = 0; i < n; i++) {
      const py = y + (h / n) * (i + 0.5);
      s += rect(x + 1.2, py - 1.5, w - 2.4, 3, 0.8, pinFill);
    }
    // 1 脚标记
    s += rect(x + 1, y + 1.5, 3.2, 3.2, 0.6, '#ff8a3c', 'opacity="0.95"');
  } else {
    s += rect(x, y, w, h, 2, bodyFill, 'stroke="#6f6857" stroke-width="0.9"');
    for (let i = 0; i < n; i++) {
      const px = x + (w / n) * (i + 0.5);
      s += rect(px - 1.5, y + 1.2, 3, h - 2.4, 0.8, pinFill);
    }
    s += rect(x + 1.5, y + 1, 3.2, 3.2, 0.6, '#ff8a3c', 'opacity="0.95"');
  }
  return s;
}
