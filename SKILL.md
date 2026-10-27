---
name: wokwi-builder
description: 用自然语言在 Wokwi 在线仿真器里搭建、编译并运行 ESP32 / Arduino / 树莓派 Pico 电路，支持从零基础起步。当用户说 "wokwi: ..."、"用 wokwi 模拟..."、"生成一个 wokwi 项目/电路"、"在 wokwi 里跑一下..."，或提到 ESP32/LED 呼吸灯/按键/传感器/舵机/OLED/温湿度/远程开关等硬件仿真需求时使用。负责需求→选型→diagram.json+sketch.ino→本地编译→Wokwi 无头仿真→回收串口日志→生成可交互结果查看器，全链路闭环。 / Build, compile and run ESP32 / Arduino / Raspberry Pi Pico circuits in the Wokwi online simulator from natural language. Use when the user says "wokwi: ...", "simulate with wokwi", "generate a wokwi project/circuit", or mentions ESP32, breathing LED, button, sensor, servo, OLED, temperature/humidity or a web remote switch. Owns the full loop: requirement → part selection → diagram.json + sketch.ino → local build → headless Wokwi simulation → serial log capture → interactive result viewer.
license: MIT
metadata:
  version: "1.0.0"
  compatibility: "需要 wokwi-cli（含 `wokwi-cli mcp`）与 WOKWI_CLI_TOKEN；本地编译需要 arduino-cli + esp32 核心。Node 18+ 用于校验脚本。"
  tags: "wokwi, esp32, arduino, simulation, hardware, iot"
---

# Wokwi Builder

**中文** | [English](SKILL.en.md)

把一句自然语言需求变成**真的在 Wokwi 里跑起来**的电路工程，并把运行结果以可交互页面交付。

适用对象包括**完全不懂硬件的人**：用户不需要知道 GPIO、电阻、PWM，你负责全部翻译。

> 下文所有 `scripts/`、`references/`、`assets/` 路径都**相对于本 skill 目录**（安装后位于 `~/.workbuddy/skills/wokwi-builder/` 或 `~/.claude/skills/wokwi-builder/`）。执行时请拼成绝对路径。

---

## 0. 先自检环境（每个新会话/新机器只做一次）

不要凭记忆假设工具存在，先跑：

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
# macOS / Linux
bash scripts/check-env.sh
```

- 任何一项 `FAIL` → 按 `references/02-environment.md` 逐步安装，**装完再动手**。
- 全都 `PASS` 才开始接需求。
- 若本机没有任何工具，也**可以先只产出文件**（`sketch.ino` + `diagram.json`），让用户去 wokwi.com 网页粘贴运行——这是零依赖降级路径。

---

## 1. 需求解析与选型

拿到需求先做三件事，然后**直接给合理默认值往下走**，不要连环追问：

1. **拆功能**：输入（传感器/按钮/网络）、处理（逻辑/状态机）、输出（LED/屏幕/舵机/继电器）。
2. **选板**：`references/03-hardware-selection.md` 的决策树。默认 **ESP32 DevKit C**（`board-esp32-devkit-c-v4`）。
3. **对表**：确认每个器件在 Wokwi 里**有模型**（`references/04-diagram-schema.md` 的元件表）。没有模型就走降级策略（等效替代 / 信号注入 / 标为"仿真外"），并**如实告知用户**。

选型结论必须能写成"需求点 → 选型 → 理由"三列，最后放进查看器（`CFG.selection`），让用户看得见你为什么这么选。

---

## 2. 产出工程文件

在 `<workspace>/wokwi-projects/<项目名>/` 下生成：

| 文件 | 作用 | 要点 |
|---|---|---|
| `sketch.ino` | Arduino C++ 固件 | ESP32 逻辑电平 3.3V；GPIO 编号不是物理脚序 |
| `diagram.json` | 电路拓扑 | **写之前必读** `references/04-diagram-schema.md`；LED 必须串 220–330Ω |
| `wokwi.toml` | 告诉 wokwi-cli 固件在哪 | `firmware = 'build/sketch.ino.bin'` |
| `libraries.txt` | 第三方库（可选） | 每行一个，如 `Adafruit SSD1306` |
| `sim-viewer.html` | 结果查看器（第 5 步生成） | 由 `assets/viewer-template.html` 改造 |

**固件里必须自带可观测性**——这是无头仿真的唯一"眼睛"：

- `Serial.begin(115200)` + 关键节点 `println`（启动、自检、IP、状态、周期上报）。
- 上电自检（LED 呼吸 2 次 / 三灯轮流亮），让"有没有跑起来"肉眼/日志都能判定。
- 网络类项目：打印 `WiFi.localIP()`，并做超时重试。
- 状态类项目：每 1–2 秒打印一行状态（`[STATUS] tick | mode=BREATHE | duty=207`）。

---

## 3. 本地编译（ESP32 Arduino 必须走这步）

**硬事实：wokwi-cli 不会帮你编译 ESP32 Arduino 代码，必须自己给固件。**（ESP-IDF / Pico SDK 可自动推断，Arduino 不行。）

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/compile.ps1 -Project <项目目录>
# macOS / Linux
bash scripts/compile.sh <项目目录>
```

- 成功判据：`build/<name>.ino.bin` 存在且体积合理（ESP32 简单项目 200KB~1MB）。
- **构建目录必须是纯 ASCII 路径**：`ld.exe` 处理中文路径会失败（`cannot open output file ... .elf`）。脚本默认用 `C:/wokwi-toolchain/build`。
- 编译通过之前不要浪费仿真次数。

---

## 4. 跑仿真 + 回收证据

```bash
powershell -ExecutionPolicy Bypass -File scripts/simulate.ps1 -Project <项目目录> -Timeout 16000 -Expect "IP:","[HTTP] server started"
```

或用已配置的 Wokwi MCP（`start_simulation` / `get_serial_output`）。参数与坑见 `references/05-build-and-simulate.md`，重点是四条：

| 事实 | 含义 |
|---|---|
| `--timeout` 单位是**仿真毫秒** | 不是墙钟时间 |
| 本地仿真比真实时间慢 **1.5–5 倍**（视项目而定） | 16000 仿真毫秒可能要等 25–80 秒 |
| 持续运行的项目会以 **exit 42** 结束 | 属正常，只要日志里有目标行即通过 |
| `--screenshot-part` 只对有 framebuffer 的元件有效 | LED 只有 16×16 缩略图；整屏不设 part 常常 0 字节 |

所以验收标准永远是**串口日志里的断言**，不是"看起来跑过了"。

---

## 5. 生成可交互结果查看器（交付重点）

wokwi-cli 无头、不建网页工程、截不到全景。让用户"看到并操作"的最稳方案是本地查看器：

1. 复制 `assets/viewer-template.html` → `<项目目录>/sim-viewer.html`。
2. 按 `references/06-viewer.md` 改 `CFG`（actors / sequence / selection / rawLog）与两个原始文本块。
3. **必须做三重校验**：
   ```bash
   node scripts/verify_viewer.js <项目目录>     # 代码与真实文件逐字节一致 + JS 语法
   node scripts/domrun.js <项目目录>/sim-viewer.html   # 假 DOM 真跑 boot()，错误数必须为 0
   ```
4. 用 `present_files` 弹出预览。

**查看器四条铁律（血泪换来的，违反必炸）**：

1. 页面里的 `.ino` / `diagram.json` 必须是**实际编译通过的原文**，函数/宏/全局变量一个都不能删。
2. **绝不能用 JS 模板字符串承载 C/C++ 代码**（`\n` 会被 JS 解释成真换行，用户复制后 Wokwi 报 `missing terminating ' character`）。必须用 `<script type="text/plain" id="inoSrc">` 原始文本块。
3. 校验必须**模拟浏览器取值**（按 `rawSrc()` 归一化后比对），直接读 HTML 原文会假阳性。
4. 改已有页面只能替换**目标区间**，不要用 `slice(0, lastIndexOf('<script>'))` 这类截断写法——会连带删掉 `CFG` 等定义，页面白屏且语法检查查不出来。

细节与反例见 `references/06-viewer.md`。

---

## 6. 交付与迭代

给用户三样东西：

1. **能看的**：`present_files` 打开的 `sim-viewer.html`（真实日志 + 动画 + 可点按钮 + 电路连接表 + 选型理由）。
2. **能复现的**：项目目录里的 `.ino` / `diagram.json`，以及"如何在 wokwi.com 粘贴运行"的两步说明。
3. **能改的**：一句话说清"要改哪里就告诉我哪个现象"。

用户不满意时，按 `选型 → 接线 → 代码 → 重新编译 → 重新仿真 → 更新查看器` 顺序迭代，不要只改画面不改真代码。

---

## 关键约束（写代码/接线时逐条对照）

- ESP32 逻辑电平 **3.3V**，GPIO 编号 ≠ 物理脚序（`esp:2` 是 GPIO2）。
- 输入脚必须 `INPUT_PULLUP`/`INPUT_PULLDOWN`，**不要悬空**。
- I2C 在 Wokwi 不自动加上拉，必要时 SDA/SCL 各串 2.2kΩ 到 3V3。
- 网络仿真走虚拟网关，首次连接比真机慢，代码要有超时与重试，长任务里 `yield()`。
- 一个工程里**只能有一个 `.ino`**（双 `.ino` 会重复定义）。
- **绝不把 Wokwi token 写进任何生成文件、日志或回复**。
- 不要尝试用浏览器自动化驱动 wokwi.com 建工程（实测会被网络策略拦截，且 CLI 无建工程 API）。

---

## 参考文档索引

| 文档 | 什么时候读 |
|---|---|
| `references/00-quickstart.md` | 第一次用，想 10 分钟跑通一遍 |
| `references/01-wokwi-primer.md` | 用户和你自己需要补齐"Wokwi/开发板/电路"零基础概念 |
| `references/02-environment.md` | 装 wokwi-cli / token / MCP / arduino-cli / ESP32 核心 |
| `references/03-hardware-selection.md` | 决定用什么板子、什么元件、Wokwi 有没有模型 |
| `references/04-diagram-schema.md` | **写 `diagram.json` 之前必读** |
| `references/05-build-and-simulate.md` | 编译失败、仿真参数、观测手段 |
| `references/06-viewer.md` | 生成/修改 `sim-viewer.html` |
| `references/07-troubleshooting.md` | 任何报错先查这里 |
| `references/08-examples.md` | 想看两个跑通的完整案例 |

现成可跑工程：`examples/traffic-light/`（纯 GPIO 状态机）、`examples/remote-switch/`（WiFi + HTTP + PWM）。
