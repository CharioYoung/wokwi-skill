/* 总线分类与配色 —— 3D 线束、2D 接线图、图例共用一份。
 * 颜色不是为了好看：同一路总线在图例、图上的线、引脚表里必须是同一个色，
 * 否则读者要在两种色系之间做翻译。 */
export const BUS_TYPES = {
  power: { name: '电源', color: '#ff6b3d' },
  bus: { name: '舵机总线 UART', color: '#4fd8ff' },
  cam: { name: '视频 MIPI CSI-2', color: '#c48bff' },
  i2c: { name: 'I2C 传感', color: '#6ef2a6' },
  aud: { name: '音频 I2S', color: '#ffd24a' },
  gpio: { name: 'GPIO / 控制', color: '#9aa1ac' },
  rf: { name: '无线', color: '#7fd4ff' },
};
