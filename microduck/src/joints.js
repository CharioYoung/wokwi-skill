/* 15 个自由度 —— 全工程唯一的定义处。
 *
 * 3D 模型按 servo 找网格，连接器表按 id 生成 SIG_ 网名，接线图按 joint
 * 排舵机位；三处数字对不上时，评审看到的"15 自由度"就是一句宣传语。
 *
 * servo : model.js 里那根舵机的网格名
 * group : 腿 / 颈 / 头 / 喙，接线图按组分列
 */
export const SERVO_JOINTS = [];

['L', 'R'].forEach((k) => {
  SERVO_JOINTS.push(
    { id: 'hipYaw' + k, servo: 'hipYawServo' + k, joint: '髋偏航', group: '腿', side: k },
    { id: 'hipPitch' + k, servo: 'hipServo' + k, joint: '髋俯仰', group: '腿', side: k },
    { id: 'knee' + k, servo: 'kneeServo' + k, joint: '膝', group: '腿', side: k },
    { id: 'anklePitch' + k, servo: 'anklePitchServo' + k, joint: '踝俯仰', group: '腿', side: k },
    { id: 'ankleRoll' + k, servo: 'ankleRollServo' + k, joint: '踝侧倾', group: '腿', side: k },
  );
});

SERVO_JOINTS.push(
  { id: 'neckYaw', servo: 'neckServoY', joint: '颈偏航', group: '颈', side: '' },
  { id: 'neckPitch', servo: 'neckServoP', joint: '颈俯仰', group: '颈', side: '' },
  { id: 'headPitch', servo: 'headServo', joint: '头俯仰', group: '头', side: '' },
  { id: 'beakUpper', servo: 'beakServoU', joint: '上颚', group: '喙', side: '' },
  { id: 'beakLower', servo: 'beakServoL', joint: '下颚', group: '喙', side: '' },
);
