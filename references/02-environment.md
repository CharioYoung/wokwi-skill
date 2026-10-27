# 02 · 环境安装（Windows / macOS / Linux）

**中文** | [English](02-environment.en.md)

目标：让 `check-env` 全绿。全程约 20–40 分钟，主要时间花在下载 ESP32 核心（约 300MB）。

**先跑自检，缺什么补什么**，不要盲目照着装一遍：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
```
```bash
bash scripts/check-env.sh
```

---

## A. wokwi-cli（仿真引擎）

### 安装

从 <https://github.com/wokwi/wokwi-cli/releases> 下载对应平台的可执行文件，放到一个**纯 ASCII 路径**下并加入 PATH：

```powershell
# Windows 示例
mkdir C:\wokwi\bin -Force
# 把 wokwi-cli.exe 放进去，然后：
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\wokwi\bin", "User")
```

```bash
# macOS / Linux
mkdir -p ~/.local/bin && mv wokwi-cli ~/.local/bin/ && chmod +x ~/.local/bin/wokwi-cli
```

### Token

1. 登录 <https://wokwi.com>；
2. 右上角头像 → 找到 **CI / API Token** 相关页面（个人设置里的 token 区）；
3. 生成后得到 `wok_` 开头、共 44 字符的字符串；
4. **只放进环境变量，不要写进代码或仓库**：

```powershell
setx WOKWI_CLI_TOKEN "wok_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# 重开终端生效，然后验证：
wokwi-cli --version
```

```bash
export WOKWI_CLI_TOKEN="wok_..."
echo 'export WOKWI_CLI_TOKEN="wok_..."' >> ~/.bashrc
```

> token 泄露请立刻去 Wokwi 后台吊销重发。

### 接入 MCP（可选，但推荐）

让 agent 直接调用仿真能力，而不是自己拼命令行。在 `~/.workbuddy/mcp.json`（或客户端对应的 MCP 配置）里加：

```json
{
  "mcpServers": {
    "wokwi-cli": {
      "command": "C:\\wokwi\\bin\\wokwi-cli.exe",
      "args": ["mcp"],
      "env": { "WOKWI_CLI_TOKEN": "wok_..." }
    }
  }
}
```

然后在客户端的连接器/插件页**信任（Trust）**这个 server。

**注意**：MCP 进程会常驻。如果某次 `start_simulation` 被中途打断，残留请求可能堵住队列，表现为"一直卡住"。解决：重启客户端，或改用 CLI 直连（`scripts/simulate.ps1` 就是 CLI 直连）。

---

## B. arduino-cli（编译器）

**为什么必须装**：`wokwi-cli` 对 ESP32 **Arduino** 项目不做云端编译，必须你自己给出 `.bin` 固件。（ESP-IDF / Pico SDK 项目才能自动推断。）

### 安装

从 <https://github.com/arduino/arduino-cli/releases> 下载 zip，解压得到单个 `arduino-cli.exe`：

```powershell
mkdir C:\wokwi\bin -Force
# 解压 arduino-cli.exe 到 C:\wokwi\bin\
C:\wokwi\bin\arduino-cli.exe version
```

```bash
# macOS
brew install arduino-cli
# Linux
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
```

### 安装 ESP32 核心（最耗时的一步）

```bash
arduino-cli core update-index
arduino-cli core install esp32:esp32
```

会下载约 300MB（含 xtensa 工具链 + 库）。**这一步最容易因网络失败**，见下面 `E. 网络问题`。

### ★ 关键：数据目录和构建目录必须纯 ASCII

这是本项目踩过最深的坑。`ld.exe`（链接器）处理**含中文的路径**会失败：

```
cannot open output file C:\Users\杨灿\...\sketch.ino.elf
cannot find -l<library>
```

解决办法：把 Arduino 数据目录和构建目录都放到纯 ASCII 路径。

```powershell
# 一次性：用 ASCII 目录做数据目录（已装好的核心需要重新装到新目录）
arduino-cli --config-dir C:\wokwi-toolchain\data core update-index
arduino-cli --config-dir C:\wokwi-toolchain\data core install esp32:esp32

# 编译时也指定 ASCII 构建目录
arduino-cli --config-dir C:\wokwi-toolchain\data compile ^
  --fqbn esp32:esp32:esp32 --build-path C:\wokwi-toolchain\build <项目目录>
```

`scripts/compile.ps1` 已默认使用 `C:\wokwi-toolchain\{data,build}`，可用 `-DataDir` / `-BuildDir` 覆盖。

> 已经在默认目录装好核心了？不用重装，用 `-DataDir` 指到你现有的 `Arduino15` 目录，只把 `-BuildDir` 换成 ASCII 路径即可——**构建目录是必须换的那个**。

---

## C. Node.js（校验脚本）

≥ 18 即可。用于 `scripts/verify_viewer.js`（查看器代码一致性校验）和 `scripts/domrun.js`（运行时校验）。

```bash
node --version   # v18+ 即可
```

没有 Node 也能用 skill，只是少了这两道校验——但**强烈建议装**，它们拦下过真实事故。

---

## D. 环境自检

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
```

期望输出：

```
[PASS] wokwi-cli        0.29.1
[PASS] WOKWI_CLI_TOKEN  wok_****...**** (44 chars)
[PASS] arduino-cli      1.5.1
[PASS] esp32 core       3.3.9
[PASS] node             v22.x
[PASS] ascii build dir  C:\wokwi-toolchain\build
```

任何 `FAIL` 会附带修复建议。

---

## E. 网络问题（中国大陆常见）

### E1. `基础连接已关闭，未能为 SSL/TLS 建立信任关系`

老版本 PowerShell 默认 TLS 1.0，被 GitHub 拒绝。在会话里先执行：

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
```

或者干脆改用 `curl.exe` 下载（Windows 10+ 自带）：

```powershell
curl.exe -L -o arduino-cli.zip https://github.com/arduino/arduino-cli/releases/download/1.5.1/arduino-cli_1.5.1_Windows_64bit.zip
```

### E2. `core install` 下载超时

现象：卡在 `Downloading esp32-core-3.3.9.zip`，或 xtensa 工具链反复断。

按顺序尝试：

1. **换时段/换镜像**：先试 `arduino-cli core install esp32:esp32 --run-post-install` 重试几次。
2. **手动下载再本地装**（最可靠）：
   - 从 arduino-cli 的下载日志里复制 zip 的直链，用浏览器/迅雷/IDM 下好；
   - 放进一个目录，用**本地 HTTP 服务**提供（`file://` 源会被静默忽略，必须 `http://`）；
   - 写一份裁剪过的 `package_index.json`，把 `url` 指向 `http://127.0.0.1:8765/xxx.zip`；
   - `arduino-cli --config-dir <dir> core install esp32:esp32 --additional-urls http://127.0.0.1:8765/package_index.json`
   - 注意：Arduino 官方索引（`package_index.json`）里也包含完整 esp32 条目，**两份索引都要替换**，否则仍会走线上。

> 一个最省事的替代方案：**只做"生成模式"**——不装工具链，让 AI 产出 `sketch.ino` + `diagram.json`，你到 wokwi.com 网页粘贴运行（网页版云端编译，不需要本地任何工具）。

### E3. `parse error: expected number near offset 0 of '﻿{...'`

`installed.json` 里带了 UTF-8 BOM。**不要手写这个文件**——让 `arduino-cli` 自己生成。如果已经写坏，删掉重装核心。

---

## F. macOS / Linux 差异

| 项目 | Windows | macOS / Linux |
|---|---|---|
| 路径分隔 | `C:\...` | `/Users/...` |
| 构建目录 | `C:\wokwi-toolchain\build` | `~/.wokwi-toolchain/build`（注意：**家目录含中文时同样会出问题**，改用 `/tmp/wokwi-build`） |
| 编译命令 | `compile.ps1` | `compile.sh` |
| 串口设备 | `COM3` 等 | `/dev/ttyUSB0`、`/dev/cu.usbserial-*`（仿真用不到） |

---

## G. 卸载 / 重置

```powershell
# 只清构建缓存（保留已装核心）
Remove-Item -Recurse -Force C:\wokwi-toolchain\build
```
```bash
rm -rf ~/.wokwi-toolchain/build
```

彻底重装：删除数据目录 + 重新 `core install`。
