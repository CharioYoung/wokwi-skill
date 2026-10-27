# 00 · 十分钟跑通第一遍

本文件给**完全没接触过 Wokwi 和开发板**的人一条最短路径。读完你会知道：这东西到底在干什么、第一步该敲什么、怎么判断成功了。

---

## 先理解三件事（30 秒）

1. **Wokwi 是一个网页里的假电路板**。你把"电路 + 代码"贴进去，它就在浏览器里模拟运行——LED 会亮、串口会打印、连 WiFi 也能模拟。不烧板子、不烧钱。
2. **一个 Wokwi 工程只有两个核心文件**：
   - `diagram.json` —— 电路长什么样（板子、元件、谁连谁）
   - `sketch.ino` —— 板子里跑的程序
3. **这个 skill 做的事**：你说需求 → 它写好这两个文件 → 在本机编译 → 推给 Wokwi 跑 → 把真实串口日志和运行结果做成一个能点的页面给你。

---

## 路线 A：什么都不装，先看效果（推荐第一次走这条）

**目标**：5 分钟内，在浏览器里看到一盏灯按你的代码闪。

1. 打开 <https://wokwi.com>，右上角 `Sign In`（不登录也能跑，但登录才能保存）。
2. 点 `+ New Project`（或直接访问 <https://wokwi.com/projects/new/esp32>）→ 选 **ESP32 DevKit C**。
3. 左边有两个标签页：**diagram.json** 和 **sketch.ino**。
4. 把本工程 `examples/traffic-light/diagram.json` 的内容**整段**贴进 diagram.json 标签（它会自动画出板子和三颗灯）。
5. 把 `examples/traffic-light/traffic-light.ino` 的内容**整段**贴进 sketch.ino 标签。
6. 点顶部绿色的 ▶ 按钮。

**你应该看到**：三颗灯按 绿→黄→红 循环切换，底部 `Serial Monitor` 打印

```
=========================================
  ESP32 Traffic Light  (demo, no libs)
  cycle: GREEN 4s -> YELLOW 1s -> RED 4s
=========================================
[BOOT] self-test done
[TRAFFIC] GREEN  ON  (4s)
[TRAFFIC] YELLOW ON  (1s)
[TRAFFIC] RED    ON  (4s)
```

看到这些 = **你已经跑通了 Wokwi 最核心的闭环**。剩下的一切都是自动化。

> 注意：Wokwi 里代码文件必须叫 `sketch.ino`。本工程的 `traffic-light.ino` 只是文件名不同，内容直接贴进去即可。**一个工程只能有一个 `.ino`**，多一个会报重复定义。

---

## 路线 B：装工具链，让 AI 全自动（推荐长期用）

**目标**：说一句话，AI 自己编译、跑仿真、弹结果页。

### B1. 装 skill

```powershell
# Windows
cd <本仓库目录>
powershell -ExecutionPolicy Bypass -File install.ps1
```
```bash
# macOS / Linux
cd <本仓库目录> && ./install.sh
```

### B2. 装工具链并自检

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
```
```bash
bash scripts/check-env.sh
```

输出里出现 `FAIL` 的项，按 `references/02-environment.md` 对应章节补。直到**全部 PASS**。

### B3. 说需求

```
wokwi: 用 ESP32 做一个红绿灯，绿灯 4 秒、黄灯 1 秒、红灯 4 秒
```

### B4. 判断"真的成功了"（重要）

AI 会给你一个可点的结果页。同时你要能自己核对，看这三样：

| 证据 | 在哪里看 | 说明 |
|---|---|---|
| 固件真的编译出来了 | 项目目录 `build/*.ino.bin` | 体积 200KB~1MB，0 字节 = 失败 |
| 串口真的有输出 | 项目目录 `sim-*/serial.log` | 里面有 `[BOOT]`、`[TRAFFIC]` 等真实打印 |
| 页面真的能跑 | `sim-viewer.html` | 灯在动、串口区在滚、能点按钮 |

**只有串口日志里的断言才算"跑通"**，页面好看不算。

---

## 一次完整的手工流程（理解自动化在做什么）

```bash
# 1. 建工程目录
mkdir -p wokwi-projects/my-led && cd wokwi-projects/my-led

# 2. 写三个文件
#    sketch.ino    —— 程序
#    diagram.json  —— 电路
#    wokwi.toml    —— 告诉 CLI 固件在哪

# 3. 编译（ESP32 Arduino 必须自己编译，wokwi-cli 不会帮你编）
powershell -File ../../scripts/compile.ps1 -Project .
#    → build/my-led.ino.bin

# 4. 跑仿真，抓串口
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 8000 -Expect "BOOT"

# 5. 看日志
cat sim-*/serial.log
```

`wokwi.toml` 内容（文件名要和编译产物对上）：

```toml
[wokwi]
version = 1
firmware = 'build/my-led.ino.bin'
```

---

## 最容易踩的五个坑（先知道，省两小时）

| 现象 | 原因 | 一句话解决 |
|---|---|---|
| `'xxx' was not declared in this scope` | 代码被"精简"过，函数定义被删了 | 永远用**能编译通过的原文** |
| `missing terminating ' character` | 代码经过 JS 模板字符串，`\n` 变成真换行 | 用 `<script type="text/plain">` 原始块 |
| `Error during build: exit status 1` + 找不到板子 | ESP32 核心没装 | `arduino-cli core install esp32:esp32` |
| 编译报 `cannot open output file` / `cannot find -l<lib>` | **构建路径含中文**，`ld.exe` 不认 | 构建目录换纯 ASCII（脚本默认已处理） |
| 仿真一直卡住 / 超时报错 | `--timeout` 是**仿真毫秒**，本机约 1.5–5 倍慢 | 8000 仿真毫秒约 12–40 秒真实等待 |

更多见 `references/07-troubleshooting.md`。

---

## 下一步读什么

- 想搞懂"为什么 LED 要串电阻""GPIO 是什么" → `01-wokwi-primer.md`
- 要装环境 → `02-environment.md`
- 要写自己的 `diagram.json` → `04-diagram-schema.md`
- 要改结果页面 → `06-viewer.md`
