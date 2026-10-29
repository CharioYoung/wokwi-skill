/* ==================================================================== *
 * 硬件清单与连接器定义 —— 两张图纸唯一的电气事实来源
 *
 * 这里只有金属和塑料：哪块板、什么插座、几号脚、脚上是什么网。
 * 没有 three，没有 DOM，没有坐标 —— 所以 3D 线束、2D 接线图和校验脚本
 * 可以读同一份数据，不会出现"图上标 J5.3、表里写 J5.4"。
 *
 * 网名的两种写法：
 *   "I2C_SCL"     普通网，同名即同网
 *   "#VSERVO"     板内铜皮 / 器件内部连接，只进表、不画线
 *   "GND:power"   带域的地。地不分域的话，一颗 GND 会把电池、舵机、
 *                 摄像头的地全连成一条横穿机身的线，既不真实也没法看。
 * ==================================================================== */

/* ---------- 连接器型号 ---------- */
/* pitch 单位是厘米（3D 模型里 1 unit = 1 cm），2D 图不按这个比例画。 */
export const CONN_TYPES = {
  XH254: { name: 'XH2.54', pitch: 0.254, h: 0.62, w: 0.52, body: '#e9e3d5', pins: '#d8b25e' },
  PH20: { name: 'PH2.0', pitch: 0.200, h: 0.46, w: 0.44, body: '#efe9dc', pins: '#d8b25e' },
  GH125: { name: 'GH1.25', pitch: 0.125, h: 0.34, w: 0.32, body: '#f2eee4', pins: '#d8b25e' },
  ZH15: { name: 'ZH1.5', pitch: 0.150, h: 0.38, w: 0.34, body: '#f2eee4', pins: '#d8b25e' },
  FPC05: { name: 'FPC 0.5-24P', pitch: 0.050, h: 0.16, w: 0.30, body: '#c9a24d', pins: '#e8c877' },
  BTN: { name: '电池触点', pitch: 0.900, h: 0.12, w: 0.60, body: '#b87333', pins: '#ffd28a' },
  IPEX: { name: 'IPEX MHF4', pitch: 0.000, h: 0.16, w: 0.28, body: '#c9ced6', pins: '#e9eef6' },
};

/* ---------- 器件清单 ----------
 * mesh 是 model.js 里那件网格的名字，3D 连接器与容纳检查都靠它定位。
 * size 是实物外形（厘米，宽 × 高 × 深），2D 图用它定"看起来多大"，
 * 不做像素级等比 —— 接线图要能读，不是渲染图。
 */
export const DEVICES = [
  { id: 'mb', label: 'RK3566 主控板', mesh: 'mb', cat: '计算', qty: 1, wt: 14,
    size: [8.4, 0.42, 5.6], spec: '84×56 mm · 四核 A55 · 2/4 GB' },
  { id: 'powerBoard', label: '电源分配板', mesh: 'powerBoard', cat: '电源', qty: 1, wt: 9,
    size: [5.4, 0.34, 3.4], spec: '7.2 V → 5 V / 3.3 V / 6 V · 保险 · 电量计' },
  { id: 'servoBoard', label: '舵机总线板', mesh: 'servoBoard', cat: '驱动', qty: 1, wt: 7,
    size: [4.6, 0.34, 2.8], spec: '16 路 · UART 1 Mbps · 50 Hz 广播' },
  { id: 'imuA', label: 'IMU-A（主控旁）', mesh: 'imuA', cat: '传感', qty: 1, wt: 1,
    size: [1.0, 0.3, 1.0], spec: '6 轴 · I2C 0x68' },
  { id: 'imuB', label: 'IMU-B（近地）', mesh: 'imuB', cat: '传感', qty: 1, wt: 1,
    size: [1.0, 0.3, 1.0], spec: '6 轴 · I2C 0x69' },
  { id: 'nfcL', label: 'NFC 读卡器（左）', mesh: 'nfcReader-1', cat: '传感', qty: 1, wt: 2,
    size: [2.0, 0.25, 1.6], spec: '13.56 MHz · I2C' },
  { id: 'nfcR', label: 'NFC 读卡器（右）', mesh: 'nfcReader1', cat: '传感', qty: 1, wt: 2,
    size: [2.0, 0.25, 1.6], spec: '13.56 MHz · I2C' },
  { id: 'micL', label: 'MEMS 麦克风（左）', mesh: 'micUnit-1', cat: '音频', qty: 1, wt: 1,
    size: [0.8, 0.3, 0.6], spec: 'I2S · 63 dB SNR' },
  { id: 'micR', label: 'MEMS 麦克风（右）', mesh: 'micUnit1', cat: '音频', qty: 1, wt: 1,
    size: [0.8, 0.3, 0.6], spec: 'I2S · 63 dB SNR' },
  { id: 'speaker', label: '扬声器 8 Ω 2 W', mesh: 'speakerUnit', cat: '音频', qty: 1, wt: 11,
    size: [3.44, 0.7, 3.44], spec: 'Ø34 mm · 朝前' },
  { id: 'cam', label: '摄像头模组', mesh: 'camModule', cat: '视觉', qty: 1, wt: 3,
    size: [2.6, 1.2, 2.4], spec: '4.2 mm 广角 · FPC 24P' },
  { id: 'lidar', label: 'LiDAR 模组', mesh: 'lidarModule', cat: '视觉', qty: 1, wt: 5,
    size: [1.9, 1.5, 1.7], spec: 'dToF 转鼓 · UART' },
  { id: 'battery', label: 'NP-F550 电池', mesh: 'batteryPack', cat: '电源', qty: 1, wt: 78,
    size: [6.5, 3.5, 1.7], spec: '7.2 V 2600 mAh · 可拆' },
];

/* 舵机单列一行，qty 15，重量按 9 g 级算 */
export const SERVO_DEVICE = {
  id: 'servo', label: '关节舵机', cat: '驱动', qty: 15, wt: 9,
  size: [2.3, 2.2, 1.2], spec: '磁编码 · 串行总线 · 3P 插头',
};

/* ---------- 连接器 ----------
 * edge  : 贴在器件包围盒的哪个面上（3D 用）
 * along : 沿该面的切向偏移（±z 面切向是 x，±x 面切向是 z），单位 cm
 * lift  : 额外离开表面多少，默认 0
 * pins  : 网名数组，下标 +1 就是脚号
 */
export const CONNECTORS = [
  /* ---- 主控板：九个口，按"后-右-前-左"排一圈 ---- */
  { id: 'J1', dev: 'mb', label: '电池输入', type: 'XH254', edge: '-z', along: -2.6,
    pins: ['VBAT:power', 'GND:power'] },
  { id: 'J2', dev: 'mb', label: '舵机总线', type: 'GH125', edge: '+x', along: 0.4,
    pins: ['SERVO_TX', 'SERVO_RX', 'SERVO_EN', 'GND:bus'] },
  { id: 'J3', dev: 'mb', label: '摄像头 FPC', type: 'FPC05', edge: '+z', along: -1.6,
    pins: ['CAM_D0', 'CAM_D1', 'CAM_D2', 'CAM_D3', 'CAM_D4', 'CAM_D5', 'CAM_D6', 'CAM_D7',
      'CAM_CLK', 'CAM_VS', 'CAM_HS', 'CAM_MCLK', 'CAM_PWDN', 'CAM_RST', 'CAM_SCL', 'CAM_SDA',
      'CAM_3V3', 'CAM_1V8', 'CAM_2V8', 'CAM_AF', 'CAM_GND1:cam', 'CAM_GND2:cam',
      'CAM_GND3:cam', 'CAM_SHIELD:cam'] },
  { id: 'J4', dev: 'mb', label: 'LiDAR', type: 'GH125', edge: '+z', along: 2.6,
    pins: ['LIDAR_TX', 'LIDAR_RX', 'LIDAR_3V3', 'GND:i2c'] },
  { id: 'J5', dev: 'mb', label: 'I2C 扩展', type: 'PH20', edge: '-x', along: 1.2,
    pins: ['I2C_3V3', 'GND:i2c', 'I2C_SCL', 'I2C_SDA'] },
  { id: 'J6', dev: 'mb', label: 'I2S 音频', type: 'PH20', edge: '+x', along: -1.9,
    pins: ['I2S_BCLK', 'I2S_LRCK', 'I2S_DIN', 'I2S_DOUT', 'AUD_3V3', 'GND:aud'] },
  { id: 'J7', dev: 'mb', label: 'NFC 控制', type: 'PH20', edge: '-x', along: -0.6,
    pins: ['NFC_3V3', 'GND:i2c', 'NFC_IRQ', 'NFC_RST'] },
  { id: 'J8', dev: 'mb', label: '状态灯', type: 'PH20', edge: '-x', along: 2.0,
    pins: ['LED_5V', 'GND:gpio', 'LED_DIN', 'LED_CIN'] },
  { id: 'J9', dev: 'mb', label: 'Wi-Fi 天线', type: 'IPEX', edge: '-z', along: 2.8,
    pins: ['WIFI_ANT'] },

  /* ---- 电源分配板 ---- */
  { id: 'P1', dev: 'powerBoard', label: '电池进', type: 'XH254', edge: '-z', along: -1.6,
    pins: ['VBAT:power', 'GND:power'] },
  { id: 'P2', dev: 'powerBoard', label: '主控出', type: 'XH254', edge: '+z', along: -1.6,
    pins: ['VBAT_SW:power', 'GND:power'] },
  { id: 'P3', dev: 'powerBoard', label: '舵机 6 V', type: 'XH254', edge: '+x', along: 1.0,
    pins: ['VSERVO:power', 'GND:power'] },
  { id: 'P4', dev: 'powerBoard', label: '风扇 5 V', type: 'PH20', edge: '-x', along: 0.8,
    pins: ['FAN_5V', 'GND:power'] },

  /* ---- 舵机总线板 ---- */
  { id: 'S0', dev: 'servoBoard', label: '舵机电源', type: 'XH254', edge: '-x', along: -0.8,
    pins: ['VSERVO:power', 'GND:power'] },
  { id: 'S1', dev: 'servoBoard', label: 'UART 入', type: 'ZH15', edge: '+x', along: 0.6,
    pins: ['SERVO_TX', 'SERVO_RX', 'GND:bus'] },

  /* ---- 传感 / 音频 ---- */
  { id: 'I1', dev: 'imuA', label: 'IMU-A', type: 'GH125', edge: '-z', along: 0,
    pins: ['I2C_3V3', 'GND:i2c', 'I2C_SCL', 'I2C_SDA'] },
  { id: 'I2', dev: 'imuB', label: 'IMU-B', type: 'GH125', edge: '-z', along: 0,
    pins: ['I2C_3V3', 'GND:i2c', 'I2C_SCL', 'I2C_SDA'] },
  { id: 'N1', dev: 'nfcL', label: 'NFC 左', type: 'PH20', edge: '-z', along: 0,
    pins: ['NFC_3V3', 'GND:i2c', 'I2C_SCL', 'I2C_SDA', 'NFC_IRQ', 'NFC_RST'] },
  { id: 'N2', dev: 'nfcR', label: 'NFC 右', type: 'PH20', edge: '-z', along: 0,
    pins: ['NFC_3V3', 'GND:i2c', 'I2C_SCL', 'I2C_SDA', 'NFC_IRQ', 'NFC_RST'] },
  { id: 'K1', dev: 'speaker', label: '扬声器', type: 'PH20', edge: '-z', along: 1.2,
    pins: ['I2S_DOUT', 'GND:aud'] },
  { id: 'M1', dev: 'micL', label: '麦克风左', type: 'GH125', edge: '-z', along: 0,
    pins: ['I2S_BCLK', 'I2S_LRCK', 'I2S_DIN', 'GND:aud'] },
  { id: 'M2', dev: 'micR', label: '麦克风右', type: 'GH125', edge: '-z', along: 0,
    pins: ['I2S_BCLK', 'I2S_LRCK', 'I2S_DIN', 'GND:aud'] },

  /* ---- 头内 ---- */
  { id: 'C1', dev: 'cam', label: '摄像头 FPC', type: 'FPC05', edge: '-z', along: 0,
    pins: ['CAM_D0', 'CAM_D1', 'CAM_D2', 'CAM_D3', 'CAM_D4', 'CAM_D5', 'CAM_D6', 'CAM_D7',
      'CAM_CLK', 'CAM_VS', 'CAM_HS', 'CAM_MCLK', 'CAM_PWDN', 'CAM_RST', 'CAM_SCL', 'CAM_SDA',
      'CAM_3V3', 'CAM_1V8', 'CAM_2V8', 'CAM_AF', 'CAM_GND1:cam', 'CAM_GND2:cam',
      'CAM_GND3:cam', 'CAM_SHIELD:cam'] },
  { id: 'C2', dev: 'lidar', label: 'LiDAR', type: 'GH125', edge: '-z', along: 0,
    pins: ['LIDAR_TX', 'LIDAR_RX', 'LIDAR_3V3', 'GND:i2c'] },

  /* ---- 电池 ---- */
  { id: 'B1', dev: 'battery', label: '电池触点', type: 'BTN', edge: '+z', along: 0,
    pins: ['VBAT:power', 'GND:power'] },
];

/* ---------- 总线分类：线束颜色跟着它走 ---------- */
const NET_BUS = [
  [/^(VBAT|VSERVO|FAN_|VBAT_SW|GND:power)/, 'power'],
  [/^(SERVO_|SIG_)/, 'bus'],
  [/^CAM_/, 'cam'],
  [/^(I2C_|LIDAR_)/, 'i2c'],
  [/^(I2S_|AUD_|MIC_)/, 'aud'],
  [/^(LED_|NFC_)/, 'gpio'],
  [/^WIFI_/, 'rf'],
];

export function netBus(net) {
  for (const [re, bus] of NET_BUS) if (re.test(net)) return bus;
  return 'gpio';
}

/* 网名拆成"显示名 + 域"：GND:power → { label:'GND', domain:'power' } */
export function splitNet(raw) {
  const i = raw.indexOf(':');
  return i < 0 ? { label: raw, domain: '' } : { label: raw.slice(0, i), domain: raw.slice(i + 1) };
}

/* 连接器全表：手写的 + 按关节生成的（15 个舵机 + 16 口总线板）。
 * 手写 30 个必然错一个脚号，所以舵机那批是生成的。 */
export function connectorDefs(joints) {
  const all = CONNECTORS.map((c) => ({ ...c }));
  joints.forEach((s, i) => {
    const net = 'SIG_' + s.id.toUpperCase();
    const front = i < 8;
    all.push({
      id: 'S' + (2 + i), dev: 'servoBoard', label: `${i + 1} ${s.joint}`, joint: s.id,
      type: 'ZH15', edge: front ? '+z' : '-z',
      along: front ? -1.6 + i * 0.5 : 1.6 - (i - 8) * 0.5,
      pins: ['#VSERVO', '#GND', net],
    });
    // 舵机的插座直接贴在自己的圆柱壳上，mesh 就是那根舵机
    all.push({
      id: 'JS' + (i + 1), dev: 'servo', mesh: s.servo, joint: s.id,
      label: `${i + 1} ${s.joint}`,
      type: 'ZH15', edge: '-z', along: 0,
      pins: ['#VSERVO', '#GND', net],
    });
  });
  return all;
}
