# 示例 03 · 32 舵机环形阵列（复杂工程压测）

**中文** | [English](README.en.md)

**覆盖能力**：Arduino Mega 多引脚排布、32 路舵机数组、98 条连线的走线渲染、四段动画序列、第三方社区工程移植。

原始工程：[wokwi.com/projects/305336312628511297](https://wokwi.com/projects/305336312628511297)（作者 Koepel，Public Domain）。这是一个真实存在、被大量转发的「过度设计」演示：一块 Mega 上挂 32 个舵机，围成一圈，跑四段动画。

## 为什么加这个 case

前两个示例都是「7 个元件、9 条线」的入门电路。它们证明不了渲染器和校验脚本在真实复杂度下还站得住。这个工程的数字是：

| 指标 | 数值 |
|---|---|
| 元件 | 33（1 块 Mega + 32 个舵机） |
| 连线 | 98（32 PWM + 32 V+ 串接 + 32 GND 串接 + 2 根供电） |
| 板卡引脚 | 85（双排针，用到 34 个） |
| 串口输出 | 无（固件不打印，全部行为体现在舵机角度上） |

## 文件

| 文件 | 说明 |
|---|---|
| `ServoOverdone.ino` | 固件：原作者的 `ServoOverdone.ino`，一字未改（6628 字符） |
| `diagram.json` | 电路：由固件自带的 `GenerateDiagram()` 在真实仿真里打印出来（10340 字节） |
| `wokwi.toml` | 指向 `build/ServoOverdone.ino.hex` + `.elf`（AVR 产物是 hex，不是 bin） |
| `sim-viewer.html` | 结果查看器：整圈电路 + 四段序列可交互 + 舵机喇叭口真转 |

## `diagram.json` 是怎么来的（这段值得看）

32 个舵机沿圆周手工摆一遍不可能不出错，原作者也这么想，所以他在固件里写了一个 `GenerateDiagram()`：把摆位算好，用 `Serial.print` 一行行打印成 JSON。

于是移植路径是**可验证的**，不是「我照着截图抄的」：

```bash
# 1. 把 GenerateDiagram() 从 setup() 里调一次，跑真实仿真，抓串口
wokwi-cli . --timeout 6000 --serial-log-file dump_serial.txt

# 2. 串口里那 10340 字节就是 diagram.json
# 3. 用 Python 复现同一套浮点运算（Arduino 的 float 是 32 位，print 默认两位小数）
python gen_diagram.py > diagram.python.json

# 4. 逐字节对比
#    sim bytes: 10341 | python bytes: 10341
#    identical after CRLF normalisation: True
```

也就是说：**页面里嵌的 `diagram.json`，和 Wokwi 真实仿真打印出来的那份，逐字节相同**。`sim-viewer.html` 的 `CFG.rawLog` 里保留了原始串口开头，随时可以对账。

## 怎么跑

```bash
cd examples/servo-ring

# 1. 编译（Mega 用 arduino:avr:mega，需要 arduino:avr core）
ARDUINO_FQBN=arduino:avr:mega powershell -File ../../scripts/compile.ps1 -Project .
#    macOS/Linux: ARDUINO_FQBN=arduino:avr:mega bash ../../scripts/compile.sh .

# 2. 校验（三项全绿才算交付）
node ../../scripts/verify_viewer.js . --compile --build-dir C:/wokwi-tmp/chk
node ../../scripts/domrun.js sim-viewer.html
node ../../scripts/check_circuit.js

# 3. 看页面
#    浏览器打开 sim-viewer.html
```

## 预期输出

编译：

```
Sketch uses 5416 bytes (2%) of program storage space. Maximum is 253952 bytes.
Global variables use 433 bytes (5%) of dynamic memory, leaving 7759 bytes for local variables.
```

三项校验：

```
verify_viewer   INO identical (6628 chars) / DIA identical (10340 chars) / compiles cleanly (.hex, 5416 B)
domrun          RESULT: OK (0 runtime errors)
check_circuit   parts=33 wires=98/98 crossings=0 leads=60 pins=85/85 (34 wired) labels=32/96 shared=193.5u/0.55% bus=275.4u
```

`crossings=0` 是关键：98 条线里没有一条从 PCB 上横穿过去。`leads=60` 是允许的——见下。`labels=32/96` 是 32 个舵机、96 个引脚全都有名有姓（`servo17` / `舵机 · wokwi-servo` / `GND V+ PWM`），照着图就能接线；`shared=0.55%` 是这张最密的图里仅剩的几段共线（`bus=275.4u` 是同一引脚出发的汇合点，像原理图的母线，不算缺陷）。

## 这个 case 逼出来的三个修复

复杂工程的价值就在这里：前两个示例永远不会暴露下面这些。

1. **双排针的引脚在封装内部**。Mega 的数字排针是两列（间距 10 world unit），靠内那一列离板边还有 13 unit。旧的走线逻辑以「引脚位置 + 间距」算拐点，拐点落在板子里，竖线就贴着排针从 PCB 上划过去了。现在拐点一律以**板边**为基准。
2. **零件压在板边的引脚，导线只能从板子上起笔**。环形阵列每个拐角处的舵机，接插件正好搭在板子角上——它的引脚坐标就在板框内部。这种「引脚引线」是布局事实，不是走线选择，所以 `check_circuit` 把它单列为 `leads` 计数，既不放过真 bug，也不冤枉它。
3. **双列丝印没地方写字**。两列只隔 10 unit，焊盘直径 6.8，中间塞不下字。现在内列名字写在自己内侧，外列名字写在板边留白里；此前外列名字直接印到板外去了。

## 学到什么

- **AVR 和 ESP32 的产物不一样**：Mega 出 `.hex` + `.elf`，ESP32 出 `.bin`。`verify_viewer --compile` 一度只认 `.bin`，于是对着一个刚编译成功的工程报「compile failed」。
- **舵机是 3 根线不是 1 根**：PWM 之外还要 V+ 和 GND，32 个舵机就是 64 根电源线。图上红黑两条链就是它们，一头一尾接回板子的 5V/GND。
- **32 路舵机不能真的都从板子 5V 取电**（现实里会烧），但这是仿真工程，原作者就是这么接的——照实画，不美化。
- **没有串口输出的工程也要能验收**：这里的行为全在角度上，所以查看器把四段序列做成了可点的动画，角度读数实时显示。

## 想改造它

- 把 `delay()` 换成 `millis()` 状态机，四段序列并行跑。
- 加一个电位器（`wokwi-potentiometer`）当总速度旋钮。
- 换成 ESP32 + PCA9685（16 通道 PWM 扩展），顺便验证新板卡进 `BOARDS` 注册表要改哪几行。

改完记得：`sync_embed.js` 重新注入源码 → `sync_pcbview.js` 同步渲染器 → 三项校验。
