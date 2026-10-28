# 06 · 结果查看器：让"无头仿真"变成能看能点的页面

**中文** | [English](06-viewer.en.md)

## 为什么需要它

`wokwi-cli` 是 headless 工具：

- 不创建 wokwi.com 网页工程，不返回可查看的 URL；
- `--screenshot-part` 只对**带显示缓存（framebuffer）**的元件有效（OLED/LCD）；
- LED 这类元件只能截到 **16×16 缩略图**（实测 101 字节），不设 part 时常常 0 字节。

所以"让人看到效果并交互"的最稳方案是：**用真实串口日志驱动一个本地 HTML**，再用 `present_files` 弹出来。

它不是"假动画"：页面里的时序、状态、数值全部来自真实仿真日志。电路图也不是手画的装饰——它**直接解析 `diagram.json` 渲染**（见第 3 节），所以不会出现"图和实际接法对不上"的情况。

---

## 1. 文件结构（模板约定）

```html
<script type="text/plain" id="inoSrc">   完整 .ino 原文（浏览器不解析转义）
</script>
<script type="text/plain" id="diaSrc">   完整 diagram.json 原文
</script>
<script>
/* === PCB-VIEW BEGIN ===  电路渲染器（由 scripts/pcbview.js 生成，勿手改）
   PcbView.render(diagram, {brightness}) -> {svg, audit} */
/* === PCB-VIEW END === */
</script>
<script>
function rawSrc(id){ ... }
const INO = rawSrc("inoSrc");
const DIA = rawSrc("diaSrc");

const CFG = { name, actors[], sequence[], selection[], rawLog };   // ← 必须在渲染器之前

/* 页面逻辑：drawPcb / setOne / setState / runAuto / log /
   renderNetlist / showTab / copyFile / boot */
</script>
```

`assets/viewer-template.html` 就是这套结构，复制即可用。

**两个同步工具（别手抄）：**

| 命令 | 作用 |
|---|---|
| `node scripts/sync_embed.js <项目目录>` | 把真实 `.ino` / `diagram.json` 写进页面的两个 `text/plain` 块 |
| `node scripts/sync_pcbview.js` | 把 `scripts/pcbview.js` 写进所有页面的 PCB-VIEW 块 |

两者都支持 `--check`（只校验不写），CI 就跑这个模式。手抄一次 `.ino` 就出过事故（贴了"精简展示版"导致 `selfTest was not declared`），所以这一步交给工具。

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

## 3. 电路图是"渲染"出来的，不是画的

早期版本用 CSS 拼了一张"灰盒子 + 三个灯泡"，看着还行，但**没有引脚名、没有连线**，等于一张插图：既没法核对接法，也解释不了"为什么 GPIO25 接红灯"。现在改为由 `diagram.json` 实时渲染。

### 3.1 数据从哪来

| 内容 | 来源 |
|---|---|
| 元件 `top` / `left` / `attrs` / `rotate` | 项目自己的 `diagram.json` |
| LED、电阻、舵机的外形与引脚位置 | Wokwi 官方开源库 `@wokwi/elements`（MIT） |
| 电阻色环 | 官方色码表按 `value` 现算（`330` → 橙-橙-棕） |
| 排针间距 9.5 单位 | 官方元件里 19 个引脚的 `y` 值反推，等于真实 2.54 mm |
| Mega 的 85 个引脚坐标 | 官方 `arduino-mega-element` 的 `pinInfo` 原样搬进 `MEGA_PINS` |
| 连线端点与线色 | `connections` 逐条读；绿 = 信号，红 = V+，黑 = GND |

开发板是画出来的：开源库只有 30 脚的 `esp32-devkit-v1`，而 diagram 用的是 38 脚 `board-esp32-devkit-c-v4`，所以板框按真实 2.54 mm 排针网格重建。板卡进 `BOARDS` 注册表就能用，目前两张：

```js
'traffic-light', 'remote-switch'  →  board-esp32-devkit-c-v4   (38 脚)
'servo-ring'                      →  wokwi-arduino-mega        (85 脚)
```

**不认识的板卡直接抛错**，而不是猜一个板框画上去：

```js
throw new Error('diagram.json has no supported board. Known: ... ' +
  'Add one to BOARDS in pcbview.js (pin coordinates are in @wokwi/elements) instead of guessing.');
```

### 3.2 走线规则

导线一律**正交折线**，从引脚出发先走出器件，再绕到板外，**绝不横穿 PCB**：

- 一端在排针、另一端在板外且同侧 → 直接拐出去；
- 两端分居两侧 → 从最近的水平边绕过去，每条线占一条独立轨道（`lanes`），避免叠成一根粗线；
- 两端都是板外零件（舵机的 V+/GND 串接链）→ 提 10 种标准折法，用 Liang-Barsky 量每条压在板上的长度，**取压得最少、其次最短的那条**；
- 竖直线段也按"可用空隙"分配通道数（`VMAX`），密集的图会自动收敛而不是撞到旁边的元件。

三条硬规矩，都是被真实工程打出来的：

1. **拐点按板边算，不按引脚算**。Mega 的数字排针是双列，内列离板边还有 13 unit；以"引脚 + 间距"算拐点，拐点就落在板子里，竖线贴着排针从 PCB 上划过去。
2. **双列中内列的引线必须穿出板边**。`out = min(ox - depth, bx0 - depth)` —— 取"从引脚算"和"从板边算"里更靠外的那一个。
3. **板外零件之间的线不能只画 L 形**。环形阵列里"左右两侧的舵机连 V+" 这种线，L 形一定穿板，必须绕上/下边。

`PcbView.render()` 返回的 `audit` 是硬指标：

| 字段 | 含义 | 要求 |
|---|---|---|
| `wires` | 解析成功并画出来的连线数 | 等于 `connections` 去虚线的数量 |
| `crossings` | 压到板框的线段数（Liang-Barsky 逐段求交） | **必须 0** |
| `leads` | 压到板框、但端点是引脚自身的那一小段 | 不参与判定，只报数 |
| `mode` | `avoid`（默认）/ `direct` | —— |

`leads` 为什么不算错：零件压在板边时（32 舵机环每个拐角都这样），它的引脚坐标**就在板框内部**，导线只能从板子里起笔。这是布局事实，不是走线选择。

`route:'direct'` 是逃生舱：出引脚 14 unit 就正交连过去，不绕板。只用于板卡引脚朝上/朝下这种 `avoid` 不认识的布局。**密集图不要用它** —— 32 舵机环用 direct 会有 21 段线横穿 PCB，用默认的 avoid 是 0 段。

### 3.3 交互

- **LED 亮度**由页面状态驱动：`PcbView.setBrightness(host, partId, 0..1)`，PWM 项目直接喂 `duty/255`；
- **舵机角度**：`PcbView.setAngle` 只改一个件的喇叭口（不重绘整图），`transform` 由 `PcbView.hornTransform(deg)` 给出；32 个舵机每秒更新几十次也不掉帧；
- 点图上的灯 = 切到该灯的手动模式；
- 悬停**任意引脚**（用到没用到的都算）显示 `引脚名 · → 目标`，空闲引脚显示 `引脚名 · (未使用)`；悬停时该焊盘会亮起青色环；
- 悬停**导线**显示 `起点 → 终点`（`<title>`），线会变粗；**不要再给导线加 `cursor:help`** —— 浏览器会在箭头旁画一个问号，用户会当成报错（已经踩过）；
- 「放大」按钮把整张图铺满视口（`position:fixed` + `inset:0`），再点「还原」或按 <kbd>Esc</kbd>
  回到卡片里。

  两条踩过的坑，改之前先看：

  1. **放大不能只是「解除 `max-height`」**。如果那张图本来就没被裁（多数图在常见窗口下都没裁），
     解除后一个像素都不会变，用户会直接判定按钮坏了。要真的换一个铺满视口的状态。
  2. **`fixed` 元素的高度必须写 `100vh`，不能写 `100%`**。靠 `top/bottom:0` 拉伸出来的高度，
     其 computed height 仍然是 `auto`，子元素的百分比高度会据此失效、退回 `auto` —— 于是 svg
     按宽度撑高、冲出视口被 `overflow:hidden` 裁掉一截。svg 撑满视口后，默认的
     `preserveAspectRatio(meet)` 会自己把整图居中放进去，任何一角都不会丢。

引脚丝印是**全部引脚都打印**的（真实板子就是这么印的），其中电路用到的引脚更亮、并带青色环；只印用到的引脚会让人问"旁边那些空脚是什么"。

双列排针的丝印要特殊处理，否则名字全压在焊盘上：两列只隔 10 unit、焊盘直径 6.8，中间塞不下字。**内列名字写在自己内侧，外列名字写在板边留白里**。

### 3.4 不要做的事

- **不要为某个项目手改这张图**。图跟着 `diagram.json` 变，改图等于骗人。
- **`viewBox` 必须包住旋转后的元件外形**。舵机转 11° 就比它自己的 footprint 高 30 个单位，
  用 `left/top + size` 算会把底部的喇叭口裁掉 15 单位。带 `rotate` 的元件一律改用旋转后的
  AABB：`w' = |w·cos| + |h·sin|`、`h' = |w·sin| + |h·cos|`，再以 footprint 中心加减一半。
  这种裁切在卡片里被 `max-height` 盖住看不出来，只有放大到全屏才暴露 —— 所以别只信缩略图。
- **不要手改页面里的 PCB-VIEW 块**。它由 `scripts/pcbview.js` 生成，改完跑 `node scripts/sync_pcbview.js`。
- **不要为了让某个图 `crossings=0` 去挪 `diagram.json` 里的零件**。图的出处必须和真实仿真一致；挪了就不是同一个电路了。（唯一例外是零件压进板子里 7 unit 这种明显的数据缺陷，处理方式见 `nudge()`，且要在查看器里写明。）
- 元件库目前覆盖 ESP32 开发板、Arduino Mega、`wokwi-led`、`wokwi-resistor`、`wokwi-servo`。要加按键/OLED，在 `pinsOf()` 里补上该元件的引脚坐标即可（空元件的 `pinsOf` 返回 `{}`，对应的线会被跳过而不是画错）。

---

## 4. 四条铁律（血泪换来的）

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

## 5. 适配不同类型项目

| 项目类型 | 改什么 |
|---|---|
| **数字量**（LED/继电器/蜂鸣器） | 直接用灯笼 `setOne(id,on)`；`sequence` 写各状态时长 |
| **PWM**（呼吸/调光） | 把 `setOne` 换成按 duty 设透明度 + `box-shadow`；`log` 里打 `duty=` |
| **传感器**（DHT/光敏/电位器） | 把灯笼区换成仪表盘/柱状条；`sequence` 改成定时采样，读数用真实日志值 |
| **OLED/LCD** | 可以**真截图**（有 framebuffer）：`--screenshot-part <id> --screenshot-file shot.png`；页面里再画一块"屏幕"回放文字 |
| **舵机/电机** | 画角度/转速指示器，`sequence` 驱动角度 |
| **网络类** | 加"请求模拟"按钮，点击时写入 `[HTTP] GET /on -> 200` 这类日志行 |

---

## 6. 必带的四块"反黑盒"内容

模板已内置，别删：

1. **电路连接表** —— 运行时 `JSON.parse(DIA)`，把 `parts` 和 `connections` 逐条列成表格，用户可以核对每根线。
2. **分文件复制** —— 两个按钮：「① 复制代码 → 贴到 sketch.ino」「② 复制电路 → 贴到 diagram.json」，明确哪个文件进哪个标签。
3. **直达空白工程** —— 打开 `https://wokwi.com/projects/new/esp32`。说明 Wokwi 没有"URL 带代码直接运行"的接口，新工程必空白、必须粘贴。
4. **选型决策表** —— `CFG.selection`，逐条写"需求点 → 选型 → 理由"。

图形区要标注**数据来源**：现在的模板写的是「由 diagram.json 实时渲染，含真实引脚与连线」。这句话是真的（见第 3 节），但也别让它被读成"Wokwi 官方渲染"——它不是 Wokwi 的渲染引擎，没有实时电气仿真。

---

## 7. 交互设计原则

- 点按钮 → **立即**改变画面 + 同时往串口区写一行日志（等价于固件收到命令）；
- 保留"自动/手动"两种模式，显示当前状态与剩余时间/读数；
- 顶部徽章写"仿真通过（真实日志回放）"，并提供"查看原始串口日志"的可展开证据块；
- 日志时间戳用真实节奏，不要快进到失真。

---

## 8. 交付前检查清单

- [ ] `verify_viewer.js` 输出 `INO match real file: true`、`DIA match real file: true`
- [ ] `domrun.js` 输出 `错误数: 0`
- [ ] tower 灯数 = `CFG.actors` 长度 = `diagram.json` 里对应元件数
- [ ] 连接表、选型表非空
- [ ] 串口区内容 = 项目里真实 `serial.log` 内容
- [ ] 页面里没有 `CFG` / `DIA` / `rawSrc` 的临时调试输出
- [ ] 图形区标注了数据来源（由 diagram.json 渲染，非 Wokwi 引擎）
- [ ] 没有把 token 写进页面

---

## 9. 常见故障

| 现象 | 原因 | 修复 |
|---|---|---|
| 打开全白、控制台 `CFG is not defined` | 改造时被截断 | 补回 `const CFG`，跑 `domrun.js` |
| 灯不显示 | `actors.id` 与 `diagram.json` 的 id 不一致 | 逐字对齐 |
| 复制代码到 Wokwi 报缺函数 | 用了精简版代码 | 换回编译原文 |
| 复制代码报 `missing terminating ' character` | 用了 JS 模板字符串 | 改用 `text/plain` 块 |
| 连接表空白 | `DIA` 为空或 JSON 解析失败 | 检查 `diaSrc` 块是否完整 |
| `domrun.js` 报 `requestAnimationFrame is not defined` | 测试桩未实现 | 属于脚本问题，不是页面问题；补桩即可 |
