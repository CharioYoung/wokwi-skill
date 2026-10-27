# 06 · 结果查看器：让"无头仿真"变成能看能点的页面

**中文** | [English](06-viewer.en.md)

## 为什么需要它

`wokwi-cli` 是 headless 工具：

- 不创建 wokwi.com 网页工程，不返回可查看的 URL；
- `--screenshot-part` 只对**带显示缓存（framebuffer）**的元件有效（OLED/LCD）；
- LED 这类元件只能截到 **16×16 缩略图**（实测 101 字节），不设 part 时常常 0 字节。

所以"让人看到效果并交互"的最稳方案是：**用真实串口日志驱动一个本地 HTML**，再用 `present_files` 弹出来。

它不是"假动画"：页面里的时序、状态、数值全部来自真实仿真日志；图形区明确标注"示意图，非 Wokwi 渲染"，不冒充截图。

---

## 1. 文件结构（模板约定）

```html
<script type="text/plain" id="inoSrc">   完整 .ino 原文（浏览器不解析转义）
</script>
<script type="text/plain" id="diaSrc">   完整 diagram.json 原文
</script>
<script>
function rawSrc(id){ ... }
const INO = rawSrc("inoSrc");
const DIA = rawSrc("diaSrc");

const CFG = { name, actors[], sequence[], selection[], rawLog };   // ← 必须在渲染器之前

/* 渲染器：buildTower / setOne / setState / runAuto / log /
   renderNetlist / showTab / copyFile / boot */
</script>
```

`assets/viewer-template.html` 就是这套结构，复制即可用。

---

## 2. 从零定制：只改 CFG

### 2.1 `actors` —— 有几个"被执行的东西"

```js
actors: [
  { id:"red",    label:"红灯", gpio:25, color:"#ef4444", on:"#ff5f57" },
  { id:"yellow", label:"黄灯", gpio:26, color:"#f59e0b", on:"#fbbf24" },
  { id:"green",  label:"绿灯", gpio:27, color:"#22c55e", on:"#34d399" }
]
```

- `id` **必须与 `diagram.json` 里元件的 `id` 完全一致**（渲染器用它对应）；
- `gpio` 是丝印文字，仅显示；
- `color` 熄灭色、`on` 点亮色。

### 2.2 `sequence` —— 自动循环

```js
sequence: [
  { on:"green",  dur:4000, label:"GREEN" },
  { on:"yellow", dur:1000, label:"YELLOW" },
  { on:"red",    dur:4000, label:"RED" }
]
```

`dur` 用**真实固件里的毫秒数**（`delay(4000)` 就写 4000）。没有自动循环的项目留空数组，靠按钮控制。

### 2.3 `rawLog` —— 真实串口日志

把 `--serial-log-file` 落盘的内容**原样粘进来**。这是"证据"，不是装饰。

```js
rawLog: `=========================================
  ESP32 Traffic Light  (demo, no libs)
  cycle: GREEN 4s -> YELLOW 1s -> RED 4s
=========================================
[BOOT] self-test done
[TRAFFIC] GREEN  ON  (4s)`
```

### 2.4 `selection` —— 选型理由

```js
selection: [
  { need:"主控要能跑状态机、串口可观", choice:"ESP32 DevKit C", reason:"GPIO 够用；自带串口；Wokwi part = board-esp32-devkit-c-v4" },
  { need:"红/黄/绿三色指示", choice:"wokwi-led ×3", reason:"Wokwi 只提供单色 LED 模型，3 个不同 color 组合最直观" }
]
```

### 2.5 两个原始文本块

**直接粘贴项目里真实的 `.ino` 和 `diagram.json` 全文**，一个字都不要改（见铁律 1）。

---

## 3. 四条铁律（血泪换来的）

### 铁律 1：必须是"实际编译通过的原文"

**踩过的坑**：曾把"精简展示版"放进页面（调用了 `selfTest()` 却删掉了它的定义），用户复制到 Wokwi 直接：

```
error: 'selfTest' was not declared in this scope
```

展示版 ≠ 可编译版。函数、宏、全局变量，一个都不能删。注释可以少。

### 铁律 2：绝不能用 JS 模板字符串承载 C/C++ 代码

**踩过的坑（更阴）**：

```js
const INO = `... String cmd = Serial.readStringUntil('\n'); ...`
```

浏览器解析模板字符串时把 `\n` 变成**真换行**，用户复制到的代码变成：

```cpp
String cmd = Serial.readStringUntil('
');
```

Wokwi 报：

```
error: missing terminating ' character
```

凡是含 `\n` `\r` `\t` `\"` `\\` 的 C/C++ 代码都会中招。**JS 的转义规则和 C 的不是一回事。**

正确写法：

```html
<script type="text/plain" id="inoSrc">
...整段原文...
</script>
<script>
function rawSrc(id){
  const el = document.getElementById(id);
  if (!el) return "";
  return el.textContent.replace(/^\r?\n/, "").replace(/\s+$/, "") + "\n";
}
const INO = rawSrc("inoSrc");
</script>
```

好处：**页面显示的 = 剪贴板复制的 = 原始文件**，三者必然一致。

### 铁律 3：校验必须模拟浏览器取值

**踩过的坑**：用正则从 HTML **原始文本**里抽 `const INO = \`...\`` 去编译——抽到的是 `\` + `n` 两个字符（原文就是这样），编译当然通过，**假阳性**，把真问题漏掉了。

必须按 `rawSrc()` 同样的归一化逻辑取 `textContent`，与真实文件**逐字节比对**，再编译：

```bash
node scripts/verify_viewer.js <项目目录>
```

### 铁律 4：改已有页面只能"外科手术"

**踩过的坑**：批量替换时用 `html.slice(0, html.lastIndexOf('<script>'))` 做前缀——等价于**丢弃 `<script>` 到目标位置之间的全部代码**。红绿灯页面正好把 `const CFG` 放在 `const INO` 之前，于是 CFG 被整段删掉，页面打开白屏（`CFG is not defined`），而 `node --check` **查不出来**（语法合法）。

规则：

1. 只替换目标区间（`const INO = \`` 到 `` \`; ``），不要从标签处截断；
2. 改动前后核对脚本里的顶层定义数量没少；
3. 改完必须跑运行时校验：

```bash
node scripts/domrun.js <项目目录>/sim-viewer.html
```

它会用假 DOM 真跑一遍 `boot()`，输出灯数、连接表字符数、选型表字符数、代码长度、串口行数、**错误数**。

**判据：错误数必须为 0**，tower 灯数与设计一致，连接表/选型表非空。

---

## 4. 适配不同类型项目

| 项目类型 | 改什么 |
|---|---|
| **数字量**（LED/继电器/蜂鸣器） | 直接用灯笼 `setOne(id,on)`；`sequence` 写各状态时长 |
| **PWM**（呼吸/调光） | 把 `setOne` 换成按 duty 设透明度 + `box-shadow`；`log` 里打 `duty=` |
| **传感器**（DHT/光敏/电位器） | 把灯笼区换成仪表盘/柱状条；`sequence` 改成定时采样，读数用真实日志值 |
| **OLED/LCD** | 可以**真截图**（有 framebuffer）：`--screenshot-part <id> --screenshot-file shot.png`；页面里再画一块"屏幕"回放文字 |
| **舵机/电机** | 画角度/转速指示器，`sequence` 驱动角度 |
| **网络类** | 加"请求模拟"按钮，点击时写入 `[HTTP] GET /on -> 200` 这类日志行 |

---

## 5. 必带的四块"反黑盒"内容

模板已内置，别删：

1. **电路连接表** —— 运行时 `JSON.parse(DIA)`，把 `parts` 和 `connections` 逐条列成表格，用户可以核对每根线。
2. **分文件复制** —— 两个按钮：「① 复制代码 → 贴到 sketch.ino」「② 复制电路 → 贴到 diagram.json」，明确哪个文件进哪个标签。
3. **直达空白工程** —— 打开 `https://wokwi.com/projects/new/esp32`。说明 Wokwi 没有"URL 带代码直接运行"的接口，新工程必空白、必须粘贴。
4. **选型决策表** —— `CFG.selection`，逐条写"需求点 → 选型 → 理由"。

图形区必须标注：**「示意图（据 diagram.json 绘制，非 Wokwi 渲染）」**，不要让人误以为是从 Wokwi 截的图。

---

## 6. 交互设计原则

- 点按钮 → **立即**改变画面 + 同时往串口区写一行日志（等价于固件收到命令）；
- 保留"自动/手动"两种模式，显示当前状态与剩余时间/读数；
- 顶部徽章写"仿真通过（真实日志回放）"，并提供"查看原始串口日志"的可展开证据块；
- 日志时间戳用真实节奏，不要快进到失真。

---

## 7. 交付前检查清单

- [ ] `verify_viewer.js` 输出 `INO match real file: true`、`DIA match real file: true`
- [ ] `domrun.js` 输出 `错误数: 0`
- [ ] tower 灯数 = `CFG.actors` 长度 = `diagram.json` 里对应元件数
- [ ] 连接表、选型表非空
- [ ] 串口区内容 = 项目里真实 `serial.log` 内容
- [ ] 页面里没有 `CFG` / `DIA` / `rawSrc` 的临时调试输出
- [ ] 图形区标注了"示意图"
- [ ] 没有把 token 写进页面

---

## 8. 常见故障

| 现象 | 原因 | 修复 |
|---|---|---|
| 打开全白、控制台 `CFG is not defined` | 改造时被截断 | 补回 `const CFG`，跑 `domrun.js` |
| 灯不显示 | `actors.id` 与 `diagram.json` 的 id 不一致 | 逐字对齐 |
| 复制代码到 Wokwi 报缺函数 | 用了精简版代码 | 换回编译原文 |
| 复制代码报 `missing terminating ' character` | 用了 JS 模板字符串 | 改用 `text/plain` 块 |
| 连接表空白 | `DIA` 为空或 JSON 解析失败 | 检查 `diaSrc` 块是否完整 |
| `domrun.js` 报 `requestAnimationFrame is not defined` | 测试桩未实现 | 属于脚本问题，不是页面问题；补桩即可 |
