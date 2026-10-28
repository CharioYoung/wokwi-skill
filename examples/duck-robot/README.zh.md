# 示例 04 · 小鸭机器人（多执行器协同）

**[中文](README.zh.md)** | [English](README.md)

**覆盖能力**：4 类执行器/传感器协同（LED、无源蜂鸣器、舵机、超声波）、ESP32 原生 LEDC 输出舵机 PWM（**零第三方库**）、事件驱动状态机、scenario 注入验证分支、真实电路渲染。

## 需求

> wokwi: 用 ESP32 做一个小鸭机器人，两只眼睛会亮，两条腿来回摆像走路，遇到障碍物就叫一声躲开

## 电路

9 个元件、18 条真实连线（另 2 条串口虚拟线）：

| 元件 | 型号 | 引脚 | 作用 |
|---|---|---|---|
| 主板 | `board-esp32-devkit-c-v4` | — | 3.3V 逻辑，38 脚 |
| `eyeL` / `eyeR` | `wokwi-led`（yellow） | A←`rL`/`rR`，C→GND | 两只眼睛，GPIO2 / GPIO4 |
| `rL` / `rR` | `wokwi-resistor` 330Ω | 串在板与 LED 之间 | 限流，缺了仿真里灯会变灰 |
| `legL` / `legR` | `wokwi-servo` | PWM←GPIO14/27，V+→5V，GND | 两条腿，相位差 180° 摆动 = 走路感 |
| `buzz` | `wokwi-buzzer`（无源） | `1`←GPIO13，`2`→GND | 用 `tone()` 双频短音模拟「嘎」 |
| `hc` | `wokwi-hc-sr04` | TRIG←GPIO5，ECHO→GPIO18，VCC/GND | 前方障碍，<25cm 触发避障 |

## 文件

| 文件 | 说明 |
|---|---|
| `duck-robot.ino` | 固件：WALK ⇄ AVOID 状态机，零 `#include`（舵机走 LEDC，不用 ESP32Servo） |
| `diagram.json` | 电路：9 元件 / 18 连线，引脚名全部按 `@wokwi/elements` 的真实 `pinInfo` |
| `wokwi.toml` | 指向 `build/duck-robot.ino.bin` |
| `scenario.yaml` | 场景：把 HC-SR04 距离在 120cm → 15cm → 120cm 之间改，逼出真实避障分支 |
| `sim-viewer.html` | 结果查看器：电路由 `PcbView.render(diagram.json)` 渲染，眼亮/摆腿/叫/避障可交互，串口区回放真实日志 |

## 怎么跑

```bash
cd examples/duck-robot

# 1. 编译
powershell -File ../../scripts/compile.ps1 -Project .
#    macOS/Linux: bash ../../scripts/compile.sh .

# 2. 仿真（带 scenario，否则距离恒为初值，避障分支永远不会被走到）
WOKWI_SCENARIO=scenario.yaml bash ../../scripts/simulate.sh . 16000 "AVOID" "resume"
#    Windows:
#    powershell -File ../../scripts/simulate.ps1 -Project . -Scenario .\scenario.yaml -Expect "AVOID","resume"

# 3. 看日志与页面
cat sim-*/serial.log
#    浏览器打开 sim-viewer.html
```

## 预期输出

编译：`Sketch uses 302,171 bytes (23%)`、`Global variables use 22,312 bytes (6%)`。

串口（真实仿真，`scenario.yaml` 生效）：

```
=========================================
  小鸭机器人 Duck Robot  (ESP32 @ Wokwi)
  walk  <-->  avoid  on HC-SR04 obstacle
=========================================
[BOOT] self-test ...
[BOOT] self-test done
[WALK] started - waddling around
[QUACK] *嘎*
[AVOID] obstacle @ 15.1 cm -> QUACK + turn
[WALK] path clear (dist=121.7 cm) -> resume
[QUACK] *嘎*
```

`AVOID` 那行是关键证据：它只可能在 `scenario.yaml` 把距离压到 15cm 后才出现。**没有 scenario 的"跑通了"什么也证明不了。**

## 这个示例为什么值得读：三处「看起来对、其实全错」

它原本是这批示例里最像"能跑"的一个，实际上三个层面同时是错的。

**1. 页面画的是一只鸭子，不是电路。** 查看器里手写了一个 `<svg>`，黄色椭圆身体加两条腿。它很好看，也很直观，但它不是 `diagram.json` 的渲染结果——图上少一条线、多一个不存在的元件，观众无法察觉。这个示例之后，`verify_viewer.js` 增加了 check 1b：页面里找不到 `PcbView.render(` 直接 FAIL。

**2. `diagram.json` 里有 7 个编出来的引脚名。**

| 写的 | 实际 |
|---|---|
| `buzz:+` / `buzz:-` | `buzz:1` / `buzz:2` |
| `legL:SIG` / `legL:VCC` | `legL:PWM` / `legL:V+`（两个舵机共 4 处） |
| `esp:GND.4/5/6` | ESP32 只有 `GND.1`~`GND.3`（`GND.4` 是 Mega 的） |

后果不是报错，而是**静默丢线**：渲染器查不到引脚就把那条线跳过，9 条线凭空消失。而固件根本不检查硬件，`digitalWrite` 打在没接灯的脚上照样返回，串口日志依旧漂亮。**串口跑通 ≠ 接线正确。**

**3. 元件摆位违背「引脚朝向板」。** 舵机的三个脚在封装左边缘，摆在板左侧时，线必须横穿舵机机身才能到板——图上就是一条线从舵机中间划过去。改到板右侧，引脚自然对着板。同理：LED、蜂鸣器、HC-SR04 的引脚在底边，就该摆在板的上/下方；电阻无极性，让靠近板的那一端接板（`esp:2→rL:2`、`rL:1→eyeL:A`）。

修好后的数字：`parts=9 wires=18/18 crossings=0 UNRESOLVED=0 pins=38/38`。

## 学到什么

- **ESP32 驱动舵机不需要库**：`ledcAttach(pin, 50, 16)` + 脉宽 `500 + angle*2000/180` 微秒换算成 16 位占空比即可。少一个依赖，工程就能被原样复制到别处编译。
- **要让日志证明分支**：状态机的每条转移打一行固定格式日志，再用 `scenario.yaml` 制造触发条件。这是无头仿真里唯一能自动断言的证据。
- **渲染器的数字要能被质疑**：`check_circuit.js` 会算穿板段数（必须 0）、悬停热点数与引脚总数（必须相等）、空 `<title>` 数（必须 0）、**标注数**（每个非主器件的 `id` + 型号 + 每个引脚名都要印出来，必须等于 `diagram.json` 的声明值）、**共线长度**（两根不相干的线压在一起的比例必须 ≤ 1%，同一引脚汇合出来的母线单列为 `bus` 只报告）。这些断言存在的理由，就是上面第 2 条那种"没有断言所以没人发现"的错误。

## 校验（三项全绿才算交付）

```bash
node ../../scripts/verify_viewer.js .
node ../../scripts/domrun.js sim-viewer.html
node ../../scripts/check_circuit.js
```

`check_circuit` 这一行会打印 `labels=8/20`（8 个非主器件、20 个引脚名）和 `shared=0u/0.00%`
（没有两根线压在一起），两个都必须落在上面说的门槛内。
