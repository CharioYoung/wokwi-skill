/*
 * ESP32 三色红绿灯（教学演示 · 纯 GPIO，无第三方库）
 * ------------------------------------------------------------
 * 循环：绿灯 4s -> 黄灯 1s -> 红灯 4s，串口打印每次切换。
 * 目的：验证「自然语言需求 -> 选型 -> 代码 -> 编译 -> 仿真 -> 查看器」整条链路。
 *
 * 接线（共阴接法，每颗 LED 串 330Ω 到 GND）：
 *   红灯 -> GPIO25
 *   黄灯 -> GPIO26
 *   绿灯 -> GPIO27
 */

#define R_PIN 25
#define Y_PIN 26
#define G_PIN 27

void setLights(bool r, bool y, bool g) {
  digitalWrite(R_PIN, r ? HIGH : LOW);
  digitalWrite(Y_PIN, y ? HIGH : LOW);
  digitalWrite(G_PIN, g ? HIGH : LOW);
}

void announce(const char *which) {
  Serial.print("[TRAFFIC] ");
  Serial.println(which);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(R_PIN, OUTPUT);
  pinMode(Y_PIN, OUTPUT);
  pinMode(G_PIN, OUTPUT);

  Serial.println();
  Serial.println("=========================================");
  Serial.println("  ESP32 Traffic Light  (demo, no libs)");
  Serial.println("  cycle: GREEN 4s -> YELLOW 1s -> RED 4s");
  Serial.println("=========================================");

  // 上电自检：三灯各亮 300ms，便于观察与截图
  setLights(1, 0, 0); delay(300);
  setLights(0, 1, 0); delay(300);
  setLights(0, 0, 1); delay(300);
  setLights(0, 0, 0);
  Serial.println("[BOOT] self-test done");
}

void loop() {
  setLights(0, 0, 1);  announce("GREEN  ON  (4s)");   delay(4000);
  setLights(0, 1, 0);  announce("YELLOW ON  (1s)");   delay(1000);
  setLights(1, 0, 0);  announce("RED    ON  (4s)");   delay(4000);
}
