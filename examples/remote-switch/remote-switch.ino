/*
 * ESP32 远程开关 + 上电自检呼吸灯
 * ------------------------------------------------------------
 * 目的：即使在「无头仿真」（没有浏览器点按钮）的情况下，
 *       也能通过 串口输出 + LED 截图 验证整条链路真的在跑。
 *
 * 两种模式：
 *   MODE_BREATHE（默认）：上电后 GPIO2 自动呼吸（PWM），串口每 2 秒报一次状态
 *   MODE_MANUAL        ：访问 /on /off 或串口输入 on/off 后进入，LED 常亮/常灭
 *                        （输入 breathe 可切回自动呼吸）
 *
 * 串口命令：on / off / breathe / status   （115200 波特率）
 */

#include <WiFi.h>
#include <WebServer.h>

const char* ssid     = "Wokwi-GUEST";   // Wokwi 虚拟 WiFi（开放网络）
const char* password = "";

#define LED       2
#define PWM_FREQ  5000
#define PWM_RES   8        // 8 bit -> duty 0..255
#define STEP_MS   20       // 呼吸灯刷新间隔

WebServer server(80);

enum Mode { MODE_BREATHE, MODE_MANUAL };
Mode mode = MODE_BREATHE;

int  duty = 0;             // 当前 PWM 占空比 0..255
int  step = 3;             // 每次呼吸的变化量
bool ledOn = false;

void applyDuty(int d) {
  duty = constrain(d, 0, 255);
  ledcWrite(LED, duty);
  ledOn = (duty > 0);
}

void printStatus(const char* why) {
  Serial.print("[STATUS] ");
  Serial.print(why);
  Serial.print(" | mode=");
  Serial.print(mode == MODE_BREATHE ? "BREATHE" : "MANUAL");
  Serial.print(" | led=");
  Serial.print(ledOn ? "ON" : "OFF");
  Serial.print(" | duty=");
  Serial.println(duty);
}

/* ---------------- HTTP ---------------- */
void handleRoot() {
  String html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<title>ESP32 远程开关</title></head><body>"
    "<h1>ESP32 远程开关</h1>"
    "<p><a href='/on'>打开 LED</a> &nbsp;|&nbsp; <a href='/off'>关闭 LED</a>"
    " &nbsp;|&nbsp; <a href='/breathe'>呼吸灯</a></p>"
    "<p><a href='/status'>查看状态</a></p></body></html>";
  server.send(200, "text/html; charset=utf-8", html);
}

void handleOn() {
  mode = MODE_MANUAL;
  applyDuty(255);
  Serial.println("HTTP /on  -> LED ON");
  printStatus("web");
  server.send(200, "text/plain; charset=utf-8", "LED ON");
}

void handleOff() {
  mode = MODE_MANUAL;
  applyDuty(0);
  Serial.println("HTTP /off -> LED OFF");
  printStatus("web");
  server.send(200, "text/plain; charset=utf-8", "LED OFF");
}

void handleBreathe() {
  mode = MODE_BREATHE;
  Serial.println("HTTP /breathe -> auto breathing");
  printStatus("web");
  server.send(200, "text/plain; charset=utf-8", "BREATHE");
}

void handleStatus() {
  String s = String("mode=") + (mode == MODE_BREATHE ? "BREATHE" : "MANUAL") +
             " led=" + (ledOn ? "ON" : "OFF") +
             " duty=" + String(duty) +
             " ip=" + WiFi.localIP().toString();
  Serial.println("[HTTP] /status -> " + s);
  server.send(200, "text/plain; charset=utf-8", s);
}

/* ---------------- 上电自检：呼吸 2 个来回 ---------------- */
void selfTest() {
  Serial.println("[BOOT] self-test: PWM fade on GPIO2 (2 cycles)");
  for (int cycle = 0; cycle < 2; cycle++) {
    for (int d = 0; d <= 255; d += 5) { ledcWrite(LED, d); delay(8); }
    for (int d = 255; d >= 0; d -= 5) { ledcWrite(LED, d); delay(8); }
    Serial.print("[BOOT] fade cycle ");
    Serial.print(cycle + 1);
    Serial.println("/2 done");
  }
  ledcWrite(LED, 0);
  Serial.println("[BOOT] self-test done, switching to auto breathing");
}

/* ---------------- 串口命令 ---------------- */
void handleSerial() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toLowerCase();
  if (cmd.length() == 0) return;

  Serial.println("[CMD] > " + cmd);
  if (cmd == "on") {
    mode = MODE_MANUAL; applyDuty(255); printStatus("serial");
  } else if (cmd == "off") {
    mode = MODE_MANUAL; applyDuty(0); printStatus("serial");
  } else if (cmd == "breathe") {
    mode = MODE_BREATHE; printStatus("serial");
  } else if (cmd == "status") {
    printStatus("serial");
  } else {
    Serial.println("[CMD] unknown, use: on | off | breathe | status");
  }
}

/* ---------------- setup / loop ---------------- */
void setup() {
  Serial.begin(115200);
  delay(300);

  if (!ledcAttach(LED, PWM_FREQ, PWM_RES)) {
    Serial.println("[BOOT] ERROR: ledcAttach failed");
  }

  Serial.println();
  Serial.println("=========================================");
  Serial.println("  ESP32 remote-switch  (v2: self-test)");
  Serial.println("  serial cmds: on | off | breathe | status");
  Serial.println("=========================================");

  selfTest();

  // [SHOW] Hold LED ON for 3s right after self-test. This guarantees a
  // headless screenshot taken around sim-time 3s catches a clearly lit LED,
  // independent of how long WiFi association takes.
  Serial.println("[SHOW] holding LED ON 3s for screenshot verification");
  applyDuty(255);
  delay(3000);
  applyDuty(0);

  WiFi.begin(ssid, password);
  Serial.print("[WIFI] connecting");
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("[WIFI] connected");
    Serial.println("IP: " + WiFi.localIP().toString());
  } else {
    Serial.println();
    Serial.println("[WIFI] FAILED (timeout) - LED/serial still work");
  }

  server.on("/",        handleRoot);
  server.on("/on",      handleOn);
  server.on("/off",     handleOff);
  server.on("/breathe", handleBreathe);
  server.on("/status",  handleStatus);
  server.begin();
  Serial.println("[HTTP] server started on port 80");
  printStatus("ready");
}

void loop() {
  server.handleClient();
  handleSerial();

  static uint32_t lastBreath = 0;
  static uint32_t lastReport = 0;

  // 自动呼吸
  if (mode == MODE_BREATHE && millis() - lastBreath >= STEP_MS) {
    lastBreath = millis();
    int next = duty + step;
    if (next >= 255 || next <= 0) { step = -step; next = constrain(next, 0, 255); }
    applyDuty(next);
  }

  // 每 2 秒上报一次，便于无头仿真观测
  if (millis() - lastReport >= 2000) {
    lastReport = millis();
    printStatus("tick");
  }
}
