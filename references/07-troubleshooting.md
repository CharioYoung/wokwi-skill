# 07 · 错误百科（真实踩过的坑）

**中文** | [English](07-troubleshooting.en.md)

排查顺序永远是：**读第一条错误 → 判断属于哪一层 → 只改那一层**。

| 层 | 典型报错 | 去哪看 |
|---|---|---|
| 环境层 | `command not found`、下载超时、TLS 失败 | A 组 |
| 编译层 | `error:`、`undefined reference`、`cannot find -l` | B 组 |
| 仿真层 | 无输出、卡住、exit 42、panic | C 组 |
| 交付层 | 页面白屏、复制后编译失败 | D 组 |

---

## A. 环境层

### A1. `基础连接已关闭，未能为 SSL/TLS 建立信任关系`

**原因**：老版 PowerShell 默认 TLS 1.0，GitHub 已拒绝。

**解决**：
```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
```
或直接用 `curl.exe -L -o out.zip <url>`。

### A2. 下载 300MB 的 ESP32 核心反复超时

**原因**：`storage.googleapis.com` / GitHub 大文件在本机网络下易断。

**解决**（按成功率排序）：
1. 重试 `arduino-cli core install esp32:esp32`；
2. 用浏览器/IDM 手动下 zip → 本地 HTTP 服务（`http://127.0.0.1:8765/`）→ 裁剪 `package_index.json` 指向本地 → `--additional-urls` 装；
3. 放弃本地工具链，改**生成模式**：只出 `sketch.ino` + `diagram.json`，去 wokwi.com 网页跑（云端编译，零依赖）。

### A3. `parse error: expected number near offset 0 of '﻿{...'`

**原因**：手写的 `installed.json` 带 UTF-8 BOM（`﻿` 不可见）。

**解决**：不要手写这个文件，让 `arduino-cli` 自己生成。已写坏的，删除后重装核心。

### A4. `parse error: expected number near offset 34 of '3.3.9'`

**原因**：手写的 `installed.json` 结构错。正确结构是 `{"packages":[...]}`，不是扁平对象。

**解决**：同上，交给 arduino-cli 生成，别手搓。

### A5. PowerShell 报 `意外的标记 }` / 中文乱码

**原因**：PowerShell 5.1 读无 BOM 的 UTF-8 `.ps1` 时按 GBK 解析，中文变乱码导致语法错。

**解决**：脚本**只用 ASCII**；路径含中文时用 `Join-Path $env:USERPROFILE "..."` 拼接，不要把中文写进脚本字面量。

### A6. `board esp32:esp32:esp32 not found`

**原因**：ESP32 核心没装，或 `--config-dir` 指错目录（装在一个目录、编译时看另一个）。

**解决**：
```bash
arduino-cli core list                       # 确认 esp32 已安装
arduino-cli --config-dir <同一目录> core list  # 确认编译时用的是同一个目录
```

### A7. `file://` 的板卡索引被静默忽略

**原因**：arduino-cli 不接受本地文件系统索引。

**解决**：起一个本地 HTTP 服务（Node/Python 都行），用 `http://127.0.0.1:<port>/package_index.json`。

### A8. 明明换了索引，`core search` 还显示线上版本

**原因**：Arduino 官方索引 `package_index.json` 里**也包含完整 esp32 条目**，只替换自建索引不够。

**解决**：两份索引都替换成裁剪版；或干脆放弃离线方案。

### A9. `Move-Item : 当文件已存在时，无法创建该文件`

**原因**：上次失败留下的半成品目录。

**解决**：解包前先 `Remove-Item -Recurse -Force <目标目录>`。

---

## B. 编译层

### B1. `'selfTest' was not declared in this scope`

**原因**：代码被"精简展示"过，调用了函数但把定义删了。

**解决**：用**真正编译通过的原文**。凡是给用户复制的内容，必须先在本机编译一次。

### B2. `missing terminating ' character`

```
error: missing terminating ' character
104 |   String cmd = Serial.readStringUntil('
105 | ');
```

**原因**：C 代码被放进了 JS 模板字符串，`\n` 被 JS 解释成真换行。

**解决**：改用 `<script type="text/plain" id="inoSrc">` 原始文本块 + `rawSrc()`。详见 `06-viewer.md` 铁律 2。

### B3. `Error during build: exit status 1`（在 wokwi.com 网页端）

**原因**：常见三种——板子没选对、用了第三方库但没建 `libraries.txt`、工程里有多个 `.ino`。

**解决**：
- 确认板子是 ESP32 DevKit C；
- 需要库的，新建 `libraries.txt` 写库名（每行一个）；
- **只保留一个 `.ino`**。

### B4. 双 `.ino` 重复定义

```
error: redefinition of 'void setup()'
```

**原因**：Wokwi/Arduino 会把工程目录下所有 `.ino` 拼起来编译。

**解决**：删掉多余的，只留一个（通常是 `sketch.ino`）。

### B5. `ld.exe: cannot open output file ... .elf` / `cannot find -l<lib>`

**原因**：**构建路径含中文**（如 `C:\Users\杨灿\...`），`ld.exe` 无法处理。

**解决**：构建目录换纯 ASCII：
```powershell
arduino-cli --config-dir C:\wokwi-toolchain\data compile `
  --fqbn esp32:esp32:esp32 --build-path C:\wokwi-toolchain\build <项目>
```
`scripts/compile.ps1` 已默认如此。

### B6. `Sketch too big` / 程序空间不足

**原因**：ESP32 默认分区只有 1.3MB 给程序。

**解决**：减少功能/库；或换 `--fqbn esp32:esp32:esp32:default` 之外的更大分区方案。

### B7. `Can't open sketch: main file missing from sketch: ...\my-project.ino`

```
arduino-cli.exe : Can't open sketch: main file missing from sketch:
                  D:\repo\my-project\blink.ino
```

**原因**：arduino-cli 要求 **sketch 目录名必须与 `.ino` 文件名相同**。目录叫 `my-project`，里面放 `blink.ino`，它就会去找 `my-project.ino`——找不到。

**解决**（二选一）：

```bash
# 方案 A：让文件名跟目录名一致（推荐）
mv my-project/blink.ino my-project/my-project.ino

# 方案 B：让目录名跟文件名一致
mv my-project blink
```

**预防**：建工程时就让目录名 = `.ino` 文件名，例如 `wokwi-projects/remote-switch/remote-switch.ino`。`scripts/compile.ps1` 会在编译前检查这一点并直接给出提示。

> 这条同样适用于 Wokwi 网页端：工程里的主文件叫 `sketch.ino`，所以**别把主文件重命名成别的**，否则可能编译不到入口。

---

## C. 仿真层

### C1. exit code 42

**结论**：**正常**。表示到达 `--timeout` 被终止。持续运行的程序必然如此。

**判据**：日志里有目标行即通过。别拿退出码当验收标准。

### C2. 仿真"卡住"很久没反应

**三种可能**，按顺序排查：

1. **只是慢**：本机仿真约 1.5–5 倍慢，16000 仿真毫秒 ≈ 80 秒真实等待。先等够时间。
2. **MCP 队列堵了**：上次 `start_simulation` 被中断，残留请求占着队列。重启客户端，或改用 `scripts/simulate.ps1`（CLI 直连）。
3. **网络问题**：`curl -I https://wokwi.com` 看是否 200。之前有过误判——HTTP/WebSocket 都正常，纯粹是慢+堵。

### C3. 串口一片空白

- `diagram.json` 没把 `esp:TX/RX` 接到 `$serialMonitor`；
- 代码里没有 `Serial.begin(115200)`；
- 波特率不匹配。

### C4. 代码在跑但 LED 不亮

- 忘了接 GND（最常见）；
- LED 极性接反（`A` 阳极 → 电阻 → GPIO，`C` 阴极 → GND）；
- 引脚号写错（`esp:2` vs 代码里的 `LED=4`）；
- 没串电阻导致过流，仿真里灯变灰。

### C5. WiFi 连不上 / 一直 `connecting...`

- Wokwi 虚拟网络 SSID 用 `"Wokwi-GUEST"`（无密码）；
- 首次连接比真机慢，要留 5–15 秒；
- 代码里加超时重试，不要在 `while(WiFi.status()!=WL_CONNECTED)` 里死等。

### C6. `Guru Meditation Error` / panic

- 数组越界 / 空指针；
- 用了 GPIO 6–11（接 Flash）；
- 在中断里做了耗时操作。

看日志第一行 backtrace，结合最近改的代码定位。

### C7. 想截个图看效果，结果是 0 字节或 16×16

**结论**：`--screenshot-part` 只对**有 framebuffer 的元件**（OLED/LCD）有效。LED 只有 16×16 缩略图；不设 part 时整屏常为 0 字节。

**解决**：想看画面就用 `sim-viewer.html`（本地回放）；想看真实屏幕就用 OLED 项目。

---

## D. 交付层（查看器）

### D1. 打开全白，控制台 `CFG is not defined`

**原因**：改造页面时用了 `slice(0, lastIndexOf('<script>'))` 之类的前缀截断，把 `CFG` 等定义整段删掉。

**解决**：补回定义；以后只替换目标区间，并跑 `node scripts/domrun.js` 验证。

### D2. 灯不显示 / 点了没反应

- `CFG.actors[].id` 与 `diagram.json` 的元件 `id` 不一致；
- `boot()` 没被调用（文件末尾少了 `boot();`）；
- JS 报错导致后续代码没执行——用 `domrun.js` 看错误数。

### D3. 复制出来的代码在 Wokwi 报错

- 报 `'xxx' was not declared` → 用了精简版（铁律 1）；
- 报 `missing terminating ' character` → 用了 JS 模板字符串（铁律 2）；
- 报重复定义 → 工程里有多个 `.ino`。

### D4. `verify_viewer.js` 说 `INO match real file: false`

**原因**：页面里的代码和项目里的 `.ino` 已经不同步（改了一边忘了另一边）。

**解决**：以**编译通过的那份**为准，重新贴进 `inoSrc` 块，再跑一次校验。

### D5. `domrun.js` 报 `requestAnimationFrame is not defined`

**原因**：测试桩没实现这个 API（有的查看器用 rAF 做动画）。

**解决**：这是**脚本**的问题，不是页面的问题。在 `domrun.js` 的 sandbox 里补：
```js
requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
cancelAnimationFrame: (id) => clearTimeout(id),
```

---

## E. 一条通用建议

遇到没见过的错，别急着改代码，先做三件事：

1. 把**完整报错**（含文件名、行号、上下文）贴出来，不要只贴最后一行；
2. 确认**哪一层**出的问题（编译？仿真？页面？）；
3. 用最小可复现工程验证假设——把项目砍到只剩一个 LED 和一个 `println`。

大部分"玄学问题"，砍到最小就现形了。
