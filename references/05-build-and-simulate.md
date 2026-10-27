# 05 · 编译与仿真：把固件真的跑起来

**中文** | [English](05-build-and-simulate.en.md)

这篇讲两件事：**怎么把 `.ino` 变成固件**，**怎么在 Wokwi 里跑它并把证据取回来**。

---

## 1. 为什么必须本地编译

`wokwi-cli` 的设计是"**你给固件，我负责跑**"：

| 项目类型 | wokwi-cli 会不会帮你编译 |
|---|---|
| ESP-IDF | ✅ 自动（有 `CMakeLists.txt` 就推断） |
| Raspberry Pi Pico SDK | ✅ 自动 |
| **ESP32 Arduino（`.ino`）** | ❌ **不会**，必须提供 `.bin` |

所以 ESP32 Arduino 项目的正确姿势是：

```
sketch.ino  --arduino-cli-->  build/sketch.ino.bin  --wokwi-cli-->  仿真
```

跳过第一步，你会看到 `Firmware file not found` 或仿真启动后串口毫无输出。

---

## 2. arduino-cli 编译

### 基本命令

```bash
arduino-cli compile \
  --fqbn esp32:esp32:esp32 \
  --build-path /tmp/wokwi-build \
  --output-dir <项目目录>/build \
  <项目目录>
```

| 参数 | 作用 | 注意 |
|---|---|---|
| `--fqbn` | 板卡全名 | ESP32 DevKit C 用 `esp32:esp32:esp32` |
| `--build-path` | 中间产物目录 | **必须纯 ASCII**，否则 `ld.exe` 失败 |
| `--output-dir` | 最终 `.bin` 输出目录 | 一般设成 `<项目>/build`，和 `wokwi.toml` 对应 |
| `--config-dir` | Arduino 数据目录（核心所在） | 默认核心装在中文路径时，用 ASCII 目录 |
| `--warnings` | 警告级别 | 调试时可加 `all` |

### FQBN 对照

| 板子 | FQBN |
|---|---|
| ESP32 DevKit C | `esp32:esp32:esp32` |
| ESP32-S3 | `esp32:esp32:esp32s3` |
| ESP32-C3 | `esp32:esp32:esp32c3` |
| Arduino Uno | `arduino:avr:uno` |
| Pico | `rp2040:rp2040:rpipico` |

### 成功判据

```
Sketch uses 285664 bytes (21%) of program storage space.
Global variables use 22084 bytes (6%) of dynamic memory.
```
且 `<build>/<name>.ino.bin` 存在、体积 > 0。

体积参考：ESP32 空项目约 250–300KB；带 WiFi + WebServer 约 900KB–1MB。

### 需要第三方库时

```bash
arduino-cli lib install "DHT sensor library"
arduino-cli lib install "Adafruit SSD1306"
arduino-cli lib install "Adafruit GFX Library"
```

同时把库名写进项目的 `libraries.txt`（每行一个），这样在 wokwi.com 网页端新建同名文件就能自动装库。

---

## 3. wokwi.toml

```toml
[wokwi]
version = 1
firmware = 'build/sketch.ino.bin'
```

- 路径**相对 `wokwi.toml` 所在目录**；
- 用单引号，斜杠用 `/`；
- ESP32 Arduino 项目**必须**写；
- 文件名要和编译产物一致（`traffic-light.ino` → `traffic-light.ino.bin`）。

---

## 4. wokwi-cli 跑仿真

```bash
wokwi-cli --timeout 16000 \
          --serial-log-file sim/serial.log \
          --expect-text "IP:" \
          <项目目录>
```

### 参数速查

| 参数 | 作用 | 坑 |
|---|---|---|
| `--timeout <ms>` | 仿真超时，**单位是仿真毫秒** | 不是墙钟！本机慢 1.5–5 倍，16000 仿真毫秒可能要等 25–80 秒 |
| `--serial-log-file <path>` | 把串口输出落盘 | **必用**，这是唯一可靠的证据 |
| `--expect-text <s>` | 日志出现该文本即成功 | 可多次指定 |
| `--fail-text <s>` | 出现即失败 | 用于检测 `Guru Meditation`、panic |
| `--screenshot-part <id>` | 截某个元件 | **只对有 framebuffer 的元件有效**（OLED/LCD） |
| `--screenshot-time <ms>` | 在仿真第几毫秒截图 | 仿真时间，不是墙钟 |
| `--screenshot-file <path>` | 截图保存路径 | 不设 part 时常常 0 字节 |
| `--interactive` | 交互模式，可键盘输入串口 | 需要真 TTY，管道喂命令不生效 |
| `--elapsed-time` | 打印仿真实际耗时 | 调试节奏用 |

### 退出码

| 码 | 含义 | 是否正常 |
|---|---|---|
| 0 | 正常结束 | ✅ |
| 42 | 达到 `--timeout` 被终止 | ✅ **持续运行的程序都这样，只要日志有目标行就算通过** |
| 1 | 编译/启动/断言失败 | ❌ 看日志 |

> 很多人看到 exit 42 就以为失败，其实是"我把你按超时掐断了"的正常退出。

### 时间感：仿真比真实时间慢

本机实测：仿真里跑 16000ms，真实等待约 80 秒。所以：

- 想看到"上电 + 自检 + 连 WiFi + 一次状态输出"，`--timeout` 至少给 12000–16000；
- 想验证 30 秒才发生的事，`--timeout` 给 150000，实际要等 12 分钟——**不建议**，改用缩短周期的测试模式。

---

## 5. 通过 MCP 跑（agent 自动模式）

配置见 `02-environment.md`。常见工具：

- `start_simulation` —— 启动
- `get_serial_output` —— 取串口
- `stop_simulation` —— 停止

**已知坑**：MCP 进程常驻，一次被中断的 `start_simulation` 会留一个挂起请求堵住队列，表现为"永远没返回"。处理：

1. 重启客户端（最干净）；
2. 或改用 CLI 直连：`scripts/simulate.ps1`。

**判断是不是网络问题**：先 `curl -I https://wokwi.com` 看 HTTP 是否 200。之前有人怀疑"连不上 Wokwi"，实际是仿真慢 + 队列堵塞。

---

## 6. 观测手段分级（从最稳到最不稳）

| 级别 | 手段 | 能证明什么 | 可靠性 |
|---|---|---|---|
| ★★★ | **串口日志** | 程序执行到哪、变量值、IP、状态 | 永远可用 |
| ★★★ | 日志断言（`--expect-text`） | 关键路径真的走到了 | 永远可用 |
| ★★ | **OLED/LCD 截图** | 屏幕上真实显示的内容 | 仅带 framebuffer 的元件 |
| ★★ | 逻辑分析仪（`wokwi-logic-analyzer`） | 引脚时序、PWM 波形、I2C 帧 | 需要额外接线 |
| ★ | LED 截图 | 只有 16×16 缩略图，几乎无用 | ❌ 别指望 |
| ✗ | 浏览器自动化抓 wokwi.com 画面 | 受网络策略限制，常常直接失败 | ❌ 不要依赖 |

**结论：把"可观测性"写进固件设计**，而不是指望事后截图。

### 固件里该打印什么

```cpp
void setup() {
  Serial.begin(115200);
  Serial.println("[BOOT] start");        // 证明程序真的启动了
  ...
  Serial.println("[BOOT] self-test done");
  Serial.printf("[WIFI] ip=%s\n", WiFi.localIP().toString().c_str());
}
void loop() {
  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    Serial.printf("[STATUS] tick | mode=%s | duty=%d\n", mode, duty);  // 证明主循环在转
  }
}
```

末尾带 `\n`，否则日志会粘成一行。

---

## 7. 标准验证循环

```bash
# 1. 编译
powershell -File scripts/compile.ps1 -Project <dir>
# 2. 仿真 + 断言
powershell -File scripts/simulate.ps1 -Project <dir> -Timeout 16000 -Expect "IP:","server started"
# 3. 人工看日志
tail -40 <dir>/sim-*/serial.log
```

三次不过就别再盲试，按下面排查。

---

## 8. 失败排查树

```
仿真没有输出
├─ build/*.bin 不存在 ────────→ 编译没成功，看编译日志
├─ bin 存在但串口全空
│   ├─ wokwi.toml 的 firmware 路径写错 ─→ 核对文件名
│   ├─ diagram.json 没接 $serialMonitor → 补两根线
│   └─ 代码里没有 Serial.begin() ──────→ 加上 115200
├─ 串口只有乱码
│   └─ 波特率与监视器不一致 ──────────→ 统一 115200
├─ 跑到一半停住
│   ├─ 卡在 WiFi.begin() ─────────────→ 加超时重试，或先跳过联网
│   └─ 死循环里没有 yield() ───────────→ 加 yield()/delay(1)
└─ 报 Guru Meditation / panic
    ├─ 访问了空指针 / 数组越界
    ├─ 用了 GPIO 6–11
    └─ 看日志第一行 backtrace，对照 07-troubleshooting.md
```

---

## 9. 一键脚本说明

| 脚本 | 作用 | 关键行为 |
|---|---|---|
| `scripts/compile.ps1` | 编译 | 默认 ASCII 数据/构建目录；输出体积 |
| `scripts/simulate.ps1` | 仿真 | 自动读 token；exit 42 视为正常；断言 `-Expect` |
| `scripts/check-env.ps1` | 自检 | 检查工具链、token 格式、核心、Node |

所有 `.ps1` 均为**纯 ASCII**：Windows PowerShell 5.1 会把无 BOM 的 UTF-8 当 GBK 读，含中文会直接解析失败（`意外的标记 }`）。改脚本时请保持 ASCII。
