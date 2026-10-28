# 08 · 四个完整案例

**[中文](08-examples.zh.md)** | [English](08-examples.md)

四个示例都在 `examples/` 下，**全套文件可跑**（`.ino` + `diagram.json` + `wokwi.toml` + `sim-viewer.html`）。

| 示例 | 覆盖能力 | 难度 |
|---|---|---|
| `traffic-light` | 纯 GPIO、状态机、串口可观测 | ★ |
| `remote-switch` | WiFi + HTTP 服务器 + PWM 呼吸 + 串口命令 | ★★★ |
| `servo-ring` | Mega 85 脚 + 32 路舵机 + 98 条连线 + 四段动画 | ★★★★★ |
| `duck-robot` | 4 类外设协同（LED/舵机/蜂鸣器/超声波）、零库 LEDC、scenario 注入 | ★★★ |

前两个案例在下面逐段拆；后两个篇幅原因单独成文，见
[`examples/servo-ring/README.md`](../examples/servo-ring/README.md)（要点：双排针拐点要按板边算、
板边零件的引脚引线要单列计数、双列丝印没地方写字、AVR 出 `.hex` 不是 `.bin`）与
[`examples/duck-robot/README.md`](../examples/duck-robot/README.md)（要点：手绘图不算电路、
引脚名编错会静默丢线、元件要引脚朝向板、没有 scenario 的"跑通了"证明不了分支）。

---

## 案例一：ESP32 三色红绿灯

### 需求原文

> wokwi: 用 ESP32 做一个红绿灯，绿灯 4 秒、黄灯 1 秒、红灯 4 秒

### 选型（写进查看器 `CFG.selection`）

| 需求点 | 选型 | 理由 |
|---|---|---|
| 跑状态机、串口可观 | ESP32 DevKit C | GPIO 够；自带串口；`board-esp32-devkit-c-v4` |
| 三色指示 | `wokwi-led` ×3 | Wokwi 只有单色 LED，用 3 个不同 color 组合 |
| 限流 | 330Ω ×3 | LED 直连 3.3V 会过流 |
| 无头可验证 | 串口打印状态 | 每次切换打 `[TRAFFIC]`，日志即证据 |

### 接线（`diagram.json` 摘要）

```
GPIO25 → rr(330Ω) → red:A    ; red:C    → GND.1
GPIO26 → ry(330Ω) → yellow:A ; yellow:C → GND.2
GPIO27 → rg(330Ω) → green:A  ; green:C  → GND.3
TX/RX  → $serialMonitor
```

### 代码要点（`traffic-light.ino`）

```cpp
#define R_PIN 25
#define Y_PIN 26
#define G_PIN 27

void setLights(bool r, bool y, bool g) {
  digitalWrite(R_PIN, r ? HIGH : LOW);
  digitalWrite(Y_PIN, y ? HIGH : LOW);
  digitalWrite(G_PIN, g ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(R_PIN, OUTPUT); pinMode(Y_PIN, OUTPUT); pinMode(G_PIN, OUTPUT);
  // 上电自检：三灯各亮 300ms —— 无头仿真也能判断"跑起来了"
  setLights(1,0,0); delay(300);
  setLights(0,1,0); delay(300);
  setLights(0,0,1); delay(300);
  setLights(0,0,0);
  Serial.println("[BOOT] self-test done");
}

void loop() {
  setLights(0,0,1); Serial.println("[TRAFFIC] GREEN  ON  (4s)"); delay(4000);
  setLights(0,1,0); Serial.println("[TRAFFIC] YELLOW ON  (1s)"); delay(1000);
  setLights(1,0,0); Serial.println("[TRAFFIC] RED    ON  (4s)"); delay(4000);
}
```

**设计意图**：`delay()` 是阻塞的，但这里每一段都很短，不需要状态机；可观测性靠每段一行日志 + 上电自检。

### 真实运行结果（`sim-*/serial.log`）

```
=========================================
  ESP32 Traffic Light  (demo, no libs)
  cycle: GREEN 4s -> YELLOW 1s -> RED 4s
=========================================
[BOOT] self-test done
[TRAFFIC] GREEN  ON  (4s)
[TRAFFIC] YELLOW ON  (1s)
[TRAFFIC] RED    ON  (4s)
[TRAFFIC] GREEN  ON  (4s)
```

### 自己跑一遍

```bash
cd examples/traffic-light
powershell -File ../../scripts/compile.ps1 -Project .
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 14000 -Expect "TRAFFIC"
```

编译体积：**285,664 字节**（21% 程序 / 6% RAM）。

---

## 案例二：WiFi 网页远程开关 + 呼吸灯

### 需求原文

> wokwi: 用 ESP32 做一个能通过网页远程控制的开关，顺便有个呼吸灯效果

### 选型

| 需求点 | 选型 | 理由 |
|---|---|---|
| 网页远程控制 | ESP32 DevKit C | 自带 WiFi，可跑 `WebServer` |
| 显示开/关/呼吸 | `wokwi-led`（红，GPIO2） | GPIO2 支持 LEDC 硬件 PWM，可做亮度渐变 |
| 限流 | 330Ω | 同上 |
| 无头可验证 | 串口 + 常亮 3 秒 | 自检呼吸 2 次、常亮 3 秒、每 2 秒打 duty |
| 交互 | HTTP `/on` `/off` `/breathe` `/status` | 虚拟 WiFi 分配 `10.13.37.2` |

### 关键代码结构

```cpp
#define LED 2
#define PWM_FREQ 5000
#define PWM_RES 8          // 8 位 → duty 0..255

WebServer server(80);
enum Mode { MODE_BREATHE, MODE_MANUAL };
Mode mode = MODE_BREATHE;
int duty = 0, step = 3;

void applyDuty(int d) { duty = constrain(d, 0, 255); ledcWrite(LED, duty); }

void handleOn()      { mode = MODE_MANUAL; applyDuty(255); server.send(200,"text/plain","LED ON"); }
void handleOff()     { mode = MODE_MANUAL; applyDuty(0);   server.send(200,"text/plain","LED OFF"); }
void handleBreathe() { mode = MODE_BREATHE;                 server.send(200,"text/plain","BREATHE"); }

void setup() {
  Serial.begin(115200);
  ledcAttach(LED, PWM_FREQ, PWM_RES);   // ESP32 core 3.x 新 API
  selfTest();                            // 呼吸 2 个来回
  applyDuty(255); delay(3000);           // 常亮 3 秒：给截图/人眼一个确定窗口
  WiFi.begin("Wokwi-GUEST");
  server.on("/on", handleOn);
  server.on("/off", handleOff);
  server.on("/breathe", handleBreathe);
  server.on("/status", handleStatus);
  server.begin();
  Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.println("[HTTP] server started on port 80");
}

void loop() {
  server.handleClient();
  if (mode == MODE_BREATHE) {
    int n = duty + step;
    if (n >= 255 || n <= 0) { step = -step; n = constrain(n, 0, 255); }
    applyDuty(n);
    delay(20);
  }
}
```

### 真实运行结果

```
[BOOT] self-test: PWM fade on GPIO2 (2 cycles)
[BOOT] fade cycle 1/2 done
[BOOT] fade cycle 2/2 done
[BOOT] self-test done, switching to auto breathing
[SHOW] holding LED ON 3s for screenshot verification
[WIFI] connecting....
[WIFI] connected
IP: 10.13.37.2
[HTTP] server started on port 80
[STATUS] ready | mode=BREATHE | led=OFF | duty=0
[STATUS] tick | mode=BREATHE | led=ON | duty=3
[STATUS] tick | mode=BREATHE | led=ON | duty=207
[STATUS] tick | mode=BREATHE | led=ON | duty=93
```

`duty` 在 3 / 207 / 93 / 117 之间跳动 = **PWM 真的在变**。这是"呼吸灯在工作"的硬证据。

**注意**：`--timeout` 至少给 16000（约 80 秒真实等待），否则 WiFi 还没连上就被掐断——这是本项目踩过的坑。

### 三个易错点

1. **`ledcAttach` vs `ledcSetup`**：ESP32 core 3.x 用 `ledcAttach(pin, freq, res)`；2.x 是 `ledcSetup(ch, freq, res) + ledcAttachPin(pin, ch)`。版本不匹配会编译失败。
2. **`--interactive` 需要真 TTY**：用管道喂 `on` 命令不生效，别指望脚本化串口交互。要验证 HTTP 逻辑，看 `--serial-log-file` 里的 `[HTTP]` 行就够。
3. **`10.13.37.2` 只在虚拟网内可达**：你本机浏览器打不开它，只有 Wokwi 仿真内的浏览器能访问。

### 自己跑一遍

```bash
cd examples/remote-switch
powershell -File ../../scripts/compile.ps1 -Project .
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 16000 -Expect "IP:","server started"
```

编译体积：**947,568 字节**（72% 程序 / 14% RAM）。

---

## 从示例到新需求：只改三处

假设要做一个"按键控制舵机云台"：

| 步骤 | 改什么 | 参考 |
|---|---|---|
| 1. 选型 | 把 LED 换成 `wokwi-servo`，加 `wokwi-pushbutton`；查 03 的映射表 | `03-hardware-selection.zh.md` |
| 2. 电路 | 改 `diagram.json`：`GPIO13 → servo:PWM`、`GPIO4 → 按键 → GND` | `04-diagram-schema.zh.md` |
| 3. 代码 | 沿用"自检 + 循环 + 每 2 秒打印"骨架，换业务逻辑 | 上面两个案例的骨架 |
| 4. 查看器 | 改 `CFG.actors` 为舵机（画角度指示器）、`sequence` 改成角度序列、`rawLog` 换真实日志 | `06-viewer.zh.md` |

**骨架不变**：`Serial.begin` → 初始化外设 → 自检 → 主循环 → 周期打印。这个结构适用于 90% 的仿真项目。

---

## 还可以做什么（已验证可行）

| 需求 | 关键元件 | 要点 |
|---|---|---|
| 温湿度显示 | `wokwi-dht22` + `wokwi-ssd1306` | 需要 `DHT sensor library` + `Adafruit SSD1306`；OLED 可**真截图** |
| 光敏自动夜灯 | `wokwi-photoresistor-sensor` + LED | ADC 读数阈值判断，日志打原始值 |
| 舵机云台 | `wokwi-servo` + 按键 | PWM 50Hz，脉宽 500–2500us |
| 超声波测距 | `wokwi-hc-sr04` + OLED | `pulseIn` 测回波宽度 |
| 红外遥控空调 | `wokwi-ir-receiver` + `wokwi-ir-remote` | 打印收到的码值验证协议 |
| 按键计数 + 数码管 | `wokwi-7segment` | 消抖很重要（20ms） |

---

## 不适合仿真验证的（如实告知用户）

| 需求 | 原因 | 替代 |
|---|---|---|
| 真实语音识别 | Wokwi 无麦克风/识别模型 | 串口输入指令代替 |
| 访问真实互联网 API | 虚拟网隔离 | 用 HTTP 服务器方向验证（板子当服务端） |
| 毫秒级严格时序 | 仿真非实时（慢 1.5–5 倍） | 换真机验证，仿真只验逻辑 |
| 特定型号专用芯片 | 无模型 | 等效替代 + 给真机接线 |
| 大电流/强电 | 仿真不体现功率 | 只验控制信号逻辑 |
