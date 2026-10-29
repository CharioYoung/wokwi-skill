/* ==================================================================== *
 * 网表 —— 纯数据，不碰 three 也不碰 DOM
 *
 * 输入是 hardware.js 的连接器表（含 15 个按关节生成的舵机口），输出是
 * "每个插座有哪些脚、每个脚上是什么网、每条网连了哪几个脚"。
 *
 * 为什么单独一层：3D 线束要知道脚在空间里的位置，2D 接线图要知道脚在
 * 图纸上的位置，校验脚本两边都要看。三者共享的就是这一层，位置各算各的。
 * ==================================================================== */

import { DEVICES, SERVO_DEVICE, CONN_TYPES, connectorDefs, netBus, splitNet } from './hardware.js';
import { SERVO_JOINTS } from './joints.js';

export function buildNetlist(joints = SERVO_JOINTS) {
  const defs = connectorDefs(joints);

  const connectors = defs.map((d) => {
    const ct = CONN_TYPES[d.type] || CONN_TYPES.PH20;
    const pins = d.pins.map((net, k) => ({ conn: d.id, dev: d.dev, index: k + 1, net }));
    return {
      id: d.id, dev: d.dev, label: d.label, type: d.type, typeName: ct.name,
      joint: d.joint || null, npins: pins.length, pins,
    };
  });

  const pins = connectors.flatMap((c) => c.pins);

  const nets = new Map();
  pins.forEach((p) => {
    const rec = nets.get(p.net) || { net: p.net, bus: netBus(p.net), pins: [], hidden: false };
    rec.pins.push(p);
    nets.set(p.net, rec);
  });
  nets.forEach((rec) => {
    const sp = splitNet(rec.net);
    rec.label = sp.label;
    rec.domain = sp.domain;
    // 板内铜皮（#开头）与单点网不进接线图：画出来只会是一根断头线
    rec.hidden = rec.net.startsWith('#') || rec.pins.length < 2;
  });

  const devices = DEVICES.map((d) => ({ ...d, kind: 'device' }));
  const servos = joints.map((s, i) => ({
    ...SERVO_DEVICE,
    id: 'JS' + (i + 1), joint: s.id, jointName: s.joint, group: s.group,
    label: `${i + 1} ${s.joint}${s.side}`, kind: 'servo',
  }));

  return {
    connectors,
    pins,
    nets,
    devices,
    servos,
    byConn: new Map(connectors.map((c) => [c.id, c])),
    stats: {
      connectors: connectors.length,
      pins: pins.length,
      nets: nets.size,
      wired: [...nets.values()].filter((r) => !r.hidden).length,
      servos: joints.length,
      devices: devices.length,
    },
  };
}

/* 网表行：一条网一行，起止取链的两端（多脚网只列首末，脚数另给） */
export function netRows(nt) {
  const rows = [];
  nt.nets.forEach((rec) => {
    if (rec.hidden) return;
    const ends = rec.pins;
    const at = (p) => p.conn + '.' + p.index;
    rows.push({
      raw: rec.net, net: rec.label, domain: rec.domain, bus: rec.bus,
      from: at(ends[0]), to: at(ends[ends.length - 1]), pins: ends.length,
    });
  });
  return rows.sort((a, b) => (a.bus === b.bus ? a.net.localeCompare(b.net) : a.bus.localeCompare(b.bus)));
}

/* BOM：器件的型号、数量、引脚数、挂在哪些插座上 */
export function bomRows(nt) {
  const connOf = new Map();
  nt.connectors.forEach((c) => {
    const k = c.dev;
    if (!connOf.has(k)) connOf.set(k, []);
    connOf.get(k).push(c.id);
  });
  const rows = nt.devices.map((d) => ({
    label: d.label, qty: d.qty, pins: nt.pins.filter((p) => p.dev === d.id).length,
    conns: (connOf.get(d.id) || []).join(' '),
  }));
  const servoPins = nt.pins.filter((p) => p.dev === 'servo').length;
  rows.push({
    label: SERVO_DEVICE.label, qty: 15, pins: servoPins,
    conns: nt.connectors.filter((c) => c.dev === 'servo').map((c) => c.id).join(' '),
  });
  return rows;
}
