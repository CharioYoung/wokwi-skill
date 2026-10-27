# wokwi-skill

> 一句话：**说一句需求，得到一个真的在 Wokwi 里跑起来的电路。**

```
你：wokwi: 做一个按键控制的舵机云台，按下转 90 度，再按回 0 度
AI：需求解析 → 选型（ESP32 + wokwi-servo + 按键）
    → 生成 diagram.json / sketch.ino
    → 本地 arduino-cli 编译（947KB 固件）
    → wokwi-cli 无头仿真，抓回真实串口日志
    → 生成可交互查看器并弹出：舵机真的在转、串口在滚、接线表可逐条核对
```

这不是"让 AI 编一段 Arduino 代码给你"。它会**真的编译、真的跑仿真、把真实串口日志和真实 GPIO 行为**还给你，并把过程摊开给你看——包括为什么选这颗芯片、这根线接到哪、这段代码复制到 Wokwi 能不能编译。

---

## 这个 skill 解决什么

Wokwi（<https://wokwi.com>）是很棒的在线硬件仿真器，但把它接进 AI 工作流有三个硬坑，本 skill 全部踩过并给出可复现解法：

| 坑 | 真相 | 本 skill 的解法 |
|---|---|---|
| AI 生成的代码贴到 Wokwi 编译不过 | 模型爱"精简展示版"，删掉函数定义 | **编译原文 + 逐字节回归校验**（`scripts/verify_viewer.js`） |
| `wokwi-cli` 跑不起来 | 它**不编译 ESP32 Arduino**，必须自带固件 | `scripts/compile.ps1` 一键本地编译，含中文路径规避 |
| 全程"无头"，看不到效果 | CLI 只回串口；截图只对有 framebuffer 的屏有效 | **可交互结果查看器**（真实日志回放 + 动画 + 按钮） |

还有一个隐藏坑：把 C 代码塞进 JS 模板字符串后，`'\n'` 被 JS 解释成真换行，用户复制过去必然报 `missing terminating ' character`。这类"看着对、复制就错"的问题，本工程用原始文本块 + 运行时假 DOM 校验彻底堵住。

---

## 快速开始

### 1. 装 skill

```powershell
# Windows PowerShell
git clone https://github.com/<you>/wokwi-skill.git
cd wokwi-skill
powershell -ExecutionPolicy Bypass -File install.ps1
```

```bash
# macOS / Linux
git clone https://github.com/<you>/wokwi-skill.git
cd wokwi-skill && ./install.sh
```

安装脚本会把工程复制到 `~/.workbuddy/skills/wokwi-builder`（或 `~/.claude/skills/wokwi-builder`），并保留 `references/`、`scripts/`、`assets/`。

### 2. 装工具链（只做一次）

```bash
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1   # 先看缺什么
```

按 `references/02-environment.md` 补齐三样：`wokwi-cli`（+ token）、`arduino-cli`、`esp32` 核心。全 `PASS` 即可。

### 3. 说需求

在支持 skills 的 AI 客户端里直接说：

```
wokwi: 我想设计一款语音控制空调开关的控制器
wokwi: 做一个温湿度 + OLED 显示的桌面小屏
wokwi: 用 ESP32 做个红绿灯，绿灯4秒黄灯1秒红灯4秒
```

AI 会按 `SKILL.md` 的六步走完，最后弹出一个可点的结果页。

### 4. 不想装任何东西？

也能用。让 AI 只产出 `sketch.ino` + `diagram.json`，你自己去 wokwi.com 新建 ESP32 工程粘贴运行——`references/00-quickstart.md` 有 5 步图解说明。

---

## 它能做什么 / 不能做什么

**能做**（已验证跑通）

- 纯 GPIO 状态机：红绿灯、流水灯、按键消抖
- PWM：呼吸灯、调光、舵机角度
- WiFi + HTTP：网页远程开关、状态查询
- I2C：SSD1306 OLED 文字显示
- 模拟量：电位器、光敏电阻、DHT11/22 温湿度
- 无模型器件降级：等效替代 / 串口注入 / 标注"仿真外"

**不能做**（会如实告诉你，不假装跑通）

- 自动在 wokwi.com 建网页工程并给你一个可访问 URL（CLI 无此 API，浏览器自动化在受限网络下会被拦）
- 真实时序精度要求极高的项目（本地仿真约 1.5–5 倍慢于墙钟）
- Wokwi 元件库里根本没有的器件（如特定型号语音芯片，需降级方案）

---

## 目录结构

```
wokwi-skill/
├── SKILL.md                     # 技能入口：六步工作流 + 硬约束
├── README.md
├── LICENSE                       # MIT
├── .gitattributes / .gitignore   # 换行符统一 / 产物忽略
├── .github/workflows/verify.yml  # CI：语法 + 一致性 + 运行时三重校验
├── install.ps1 / install.sh     # 安装到 agent 的 skills 目录
├── references/                  # 知识库（按需加载）
│   ├── 00-quickstart.md         #   10 分钟跑通第一遍
│   ├── 01-wokwi-primer.md       #   零基础：Wokwi / 开发板 / GPIO / 电路
│   ├── 02-environment.md        #   工具链安装与排错
│   ├── 03-hardware-selection.md #   选型决策树 + 降级策略
│   ├── 04-diagram-schema.md     #   diagram.json 格式与元件表（写前必读）
│   ├── 05-build-and-simulate.md #   编译、仿真参数、观测手段
│   ├── 06-viewer.md             #   结果查看器规范（四条铁律）
│   ├── 07-troubleshooting.md    #   错误百科（12 个真实案例）
│   └── 08-examples.md           #   完整案例讲解
├── scripts/
│   ├── check-env.ps1 / .sh      # 环境自检
│   ├── compile.ps1 / compile.sh # 参数化编译（ASCII 路径规避）
│   ├── simulate.ps1 / .sh       # 跑仿真 + 断言关键日志
│   ├── verify_viewer.js         # 查看器代码一致性 + 可编译性校验
│   └── domrun.js                # 假 DOM 运行时校验（抓 undefined 崩）
├── assets/
│   └── viewer-template.html     # 配置驱动的结果查看器模板
└── examples/
    ├── traffic-light/           # 纯 GPIO 三色红绿灯（全套可跑）
    └── remote-switch/           # WiFi 网页远程开关 + PWM 呼吸灯（全套可跑）
```

## 工作原理

```
自然语言
   │
   ├─ 选型 ──────────── references/03-hardware-selection.md（决策树 + 元件表）
   │
   ├─ 产出 ──────────── sketch.ino + diagram.json + wokwi.toml
   │
   ├─ 编译 ──────────── arduino-cli（本地，ESP32 必须自带固件）
   │                      └─ 失败 → references/07-troubleshooting.md
   │
   ├─ 仿真 ──────────── wokwi-cli --timeout N --serial-log-file log
   │                      └─ 验收 = 日志里的断言，不是"看起来跑过了"
   │
   └─ 交付 ──────────── sim-viewer.html（真实日志回放 + 动画 + 交互）
                          └─ 三重校验：逐字节一致 / 可编译 / 运行时 0 错误
```

## 环境要求

| 依赖 | 版本 | 用途 | 是否必需 |
|---|---|---|---|
| `wokwi-cli` | ≥ 0.29 | 无头仿真、MCP server | 自动跑仿真时必需 |
| `WOKWI_CLI_TOKEN` | `wok_` 开头 | 认证（wokwi.com 个人页生成） | 同上 |
| `arduino-cli` | ≥ 1.0 | 编译 ESP32 Arduino 固件 | ESP32 项目必需 |
| esp32 核心 | 3.x | 板级支持包（约 300MB） | 同上 |
| Node.js | ≥ 18 | 校验脚本、查看器校验 | 推荐 |

纯生成模式（只出文件、用户自己去网页粘贴）**不需要任何依赖**。

## 常见问题

**Q：为什么不直接调 Wokwi 的云端编译？**
ESP32 Arduino 项目 wokwi-cli 不做云端编译（ESP-IDF/Pico 才支持自动推断）。这是工具定位，不是配置问题——所以本工程内置本地编译链路。

**Q：为什么结果是个本地页面，不是 wokwi.com 的链接？**
wokwi-cli 没有创建网页工程的 API。本地查看器用**真实串口日志**驱动，能看、能点、能核对接线，比等一个不存在的 URL 更实在。想要原生体验，查看器里有"复制代码/电路"和"打开空白工程"按钮，30 秒粘完。

**Q：AI 改坏了页面怎么办？**
`scripts/domrun.js` 会用假 DOM 真跑一遍初始化，输出灯数/表格/错误数。错误数不为 0 就不许交付——这条已写进 `SKILL.md` 的铁律。

## 贡献

欢迎 PR：新增示例工程（`examples/`）、补充 `references/07-troubleshooting.md` 的真实报错、扩充元件表。
提 issue 请附上 `check-env` 输出与完整报错，不要只贴一行。

## License

MIT — 见 [LICENSE](LICENSE)。
