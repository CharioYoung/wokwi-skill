# 04 · diagram.json 格式速查（写之前必读）

**[中文](04-diagram-schema.zh.md)** | [English](04-diagram-schema.md)

`diagram.json` 是电路的唯一描述文件。Wokwi 用它画出板子和连线，仿真器用它计算电学连接。**格式错一个字符，元件就不显示或连线不通。**

---

## 1. 完整结构

```json
{
  "version": 1,
  "author": "Anonymous maker",
  "editor": "wokwi",
  "parts": [
    { "type": "board-esp32-devkit-c-v4", "id": "esp", "top": -40, "left": -60, "attrs": {} },
    { "type": "wokwi-led", "id": "led1", "top": 40, "left": 120, "attrs": { "color": "red" } },
    { "type": "wokwi-resistor", "id": "r1", "top": 40, "left": 40, "attrs": { "value": "330" } }
  ],
  "connections": [
    [ "esp:TX", "$serialMonitor:RX", "", [] ],
    [ "esp:RX", "$serialMonitor:TX", "", [] ],
    [ "esp:2", "r1:1", "green", [] ],
    [ "r1:2", "led1:A", "green", [] ],
    [ "led1:C", "esp:GND.1", "black", [] ]
  ],
  "dependencies": {}
}
```

### 字段含义

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | ✅ | 固定 `1` |
| `author` / `editor` | 可选 | 元信息，不影响仿真 |
| `parts[]` | ✅ | 元件列表 |
| `parts[].type` | ✅ | **元件类型**，必须是 Wokwi 真实存在的名字 |
| `parts[].id` | ✅ | 元件唯一标识，连线时用它引用（`led1`） |
| `parts[].top` / `left` | ✅ | 画布坐标（像素，可负）。只影响布局，不影响电气连接 |
| `parts[].attrs` | 可选 | 元件属性，如 LED 颜色、电阻阻值 |
| `parts[].rotate` | 可选 | 旋转角度（0/90/180/270） |
| `connections[]` | ✅ | 连线列表 |
| `connections[i]` | ✅ | `[源引脚, 目标引脚, 线色, 走线数组]` |
| `dependencies` | 可选 | 旧版字段，留 `{}` |

### connections 详解

```json
[ "esp:2", "r1:1", "green", [] ]
```

| 位置 | 含义 | 说明 |
|---|---|---|
| `[0]` | 起点 | 必须是 `<id>:<pin>`，如 `esp:2`、`led1:A` |
| `[1]` | 终点 | 同上 |
| `[2]` | 线色 | `green`/`red`/`black`/`blue`/`gold`… **纯显示**，不影响电气 |
| `[3]` | 走线路径 | 写 `[]` 让 Wokwi 自动布线。**初学一律写 `[]`** |

> 走线数组写错坐标只会让线画得歪，不会导致不工作；但引脚名写错会直接"连不上"且没有报错——所以**引脚名必须逐字核对**。

---

## 2. 开发板 type 与引脚名

| 板子 | type | 说明 |
|---|---|---|
| ESP32 DevKit C（推荐） | `board-esp32-devkit-c-v4` | 38pin，最常用 |
| ESP32-S3 DevKitC-1 | `board-esp32-s3-devkitc-1` | USB-OTG，引脚更多 |
| Xiao ESP32-C3 | `board-xiao-esp32-c3` | 小体积 |
| Arduino Uno | `board-uno` | 5V 逻辑 |
| 树莓派 Pico | `board-rp-pico` | 3.3V |

### ESP32 引脚写法

两种都合法，**推荐用纯数字**：

| 写法 | 例子 | 说明 |
|---|---|---|
| 数字 | `esp:2` | GPIO2 ✅ 推荐 |
| 带前缀 | `esp:GPIO2` | 等价 |
| 电源 | `esp:3V3`、`esp:5V`、`esp:VIN` | |
| 地 | `esp:GND.1`、`esp:GND.2`、`esp:GND.3` | 多个 GND 脚，任选 |
| 串口 | `esp:TX`、`esp:RX` | 接 `$serialMonitor` |
| 使能 | `esp:EN` | 复位脚，一般不用 |

> `GND.1` 后面的数字是"第几个同名引脚"，写错会找不到脚——不确定就先用 `esp:GND.1`。

---

## 3. 常用元件表

| 元件 | type | 引脚 | attrs 示例 |
|---|---|---|---|
| LED | `wokwi-led` | `A`(阳极) `C`(阴极) | `{"color":"red"}`，可选 red/green/blue/yellow/white/orange |
| RGB LED | `wokwi-rgb-led` | `R` `G` `B` `COM` | `{"common":"cathode"}` |
| 电阻 | `wokwi-resistor` | `1` `2`（无方向） | `{"value":"330"}` |
| 按键 | `wokwi-pushbutton` | `1.l` `2.l` `1.r` `2.r` | `{"color":"green"}` |
| 拨动开关 | `wokwi-slide-switch` | `1` `2` `3` | |
| 电位器 | `wokwi-potentiometer` | `1`(GND) `2`(信号) `3`(VCC) | `{"value":"0"}` 初始位置 |
| 光敏模块 | `wokwi-photoresistor-sensor` | `VCC` `GND` `AO` `DO` | |
| 蜂鸣器 | `wokwi-buzzer` | `1`(+) `2`(-) | `{"volume":"0.1"}` |
| 舵机 | `wokwi-servo` | `GND` `VCC` `PWM` | `{"pin":"..."}` 一般不用 |
| 直流电机 | `wokwi-dc-motor` | `1` `2` | |
| 继电器模块 | `wokwi-relay-module` | `VCC` `GND` `IN` `NO` `NC` `COM` | |
| OLED 128×64 | `wokwi-ssd1306` | `GND` `VCC` `SDA` `SCL` | `{"i2c-address":"0x3C"}` |
| LCD 1602 (I2C) | `wokwi-lcd1602` | `GND` `VCC` `SDA` `SCL` | `{"pins":"i2c"}` |
| DHT22 | `wokwi-dht22` | `VCC` `SDA` `GND` | |
| 超声波 | `wokwi-hc-sr04` | `VCC` `TRIG` `ECHO` `GND` | |
| 红外接收 | `wokwi-ir-receiver` | `VCC` `GND` `DAT` | |
| 红外遥控 | `wokwi-ir-remote` | 无引脚 | `{"remote":"NEC"}` |
| 矩阵键盘 | `wokwi-membrane-keypad` | `R1..R4` `C1..C4` | |
| microSD | `wokwi-microsd-card` | `VCC` `GND` `CS` `MOSI` `MISO` `SCK` | |
| 逻辑分析仪 | `wokwi-logic-analyzer` | 多通道 | 调试 PWM/I2C 神器 |
| **虚拟串口监视器** | `$serialMonitor` | `RX` `TX` | 不写进 parts，只在 connections 里用 |

---

## 4. 五个必须记住的连接规则

1. **一定要接地**：任何回路都要回到 `esp:GND.x`，否则不工作。
2. **LED 必须串电阻**：`GPIO → 电阻 → LED:A → LED:C → GND`，顺序无所谓，但电阻不能少。
3. **串口要接线**：`esp:TX → $serialMonitor:RX`、`esp:RX → $serialMonitor:TX`，否则看不到打印。
4. **I2C 可并联**：多个设备 SDA 接一起、SCL 接一起，靠地址区分；Wokwi **不自动加上拉**，必要时各串 2.2kΩ 到 `3V3`。
5. **同一网络可以多点**：多个 LED 共用一个 GND 脚没问题。

---

## 5. 布局建议（`top`/`left`）

坐标只影响观感，但排得整齐，用户一眼能看懂：

- 板子放 `top:-40, left:-60`；
- 元件按信号顺序从左到右、从上到下排，间距 ≥ 60px；
- 同类元件对齐同一列；
- 别让元件重叠（重叠后难以点选，截图上看着也像坏了）。

---

## 6. 校验方法（不跑仿真也能查错）

```bash
# JSON 语法
node -e "JSON.parse(require('fs').readFileSync('diagram.json','utf8')); console.log('JSON OK')"
```

再人工核对三件事：

- [ ] 每个 `connections` 里的 `<id>` 都在 `parts` 里存在
- [ ] 每个引脚名都是该元件真实有的（对照上表）
- [ ] 至少有一条路径从 GPIO 经过元件回到 GND

---

## 7. wokwi.toml（配合 wokwi-cli 仿真）

```toml
[wokwi]
version = 1
firmware = 'build/sketch.ino.bin'
```

- `firmware` 指向 **arduino-cli 编译产物**；文件名要跟 `.ino` 同名（`my-led.ino` → `my-led.ino.bin`）。
- 路径相对于项目目录（`wokwi.toml` 所在目录）。
- 注意是**单引号**，Windows 反斜杠用正斜杠或双反斜杠。
- ESP-IDF / Pico SDK 项目可省略（CLI 能自动推断）；**ESP32 Arduino 项目不能省**。

---

## 8. 常见错误对照

| 现象 | 原因 |
|---|---|
| 元件不显示 | `type` 拼错（如 `wokwi-leds`）或 `parts` 里缺 `id` |
| 线连不上、引脚发红 | 引脚名写错（`led:ANODE` 应为 `led:A`） |
| 灯不亮但代码在跑 | 忘了接 GND，或 LED 极性反了（`A`/`C` 接反） |
| 灯变灰 / 提示过流 | 没串电阻 |
| 串口一片空白 | 没接 `$serialMonitor` |
| I2C 扫描不到设备 | 没接 SDA/SCL，或地址写错，或没加上拉 |
| 整个页面报 JSON 错 | 末尾多了逗号 / 少了括号 |
