# 示例 01 · ESP32 三色红绿灯

**覆盖能力**：纯 GPIO、状态机、串口可观测性、结果查看器。零第三方库。

## 需求

> wokwi: 用 ESP32 做一个红绿灯，绿灯 4 秒、黄灯 1 秒、红灯 4 秒

## 文件

| 文件 | 说明 |
|---|---|
| `traffic-light.ino` | 固件：三灯轮流点亮 + 每段打日志 + 上电自检 |
| `diagram.json` | 电路：ESP32 + 3×LED + 3×330Ω，LED 接 GPIO25/26/27 |
| `wokwi.toml` | 指向 `build/traffic-light.ino.bin` |
| `sim-viewer.html` | 结果查看器：三灯动画 + 真实日志回放 + 接线表 + 选型理由 |

## 怎么跑

```bash
cd examples/traffic-light

# 1. 编译
powershell -File ../../scripts/compile.ps1 -Project .
#    macOS/Linux: bash ../../scripts/compile.sh .

# 2. 仿真（约 70 秒实际等待）
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 14000 -Expect "TRAFFIC"

# 3. 看日志
cat sim-*/serial.log

# 4. 看页面
#    用浏览器打开 sim-viewer.html，或让 agent 用 present_files 弹出
```

## 预期输出

编译：`Sketch uses 285,664 bytes (21%)`，产物 `build/traffic-light.ino.bin`。

串口：

```
=========================================
  ESP32 Traffic Light  (demo, no libs)
  cycle: GREEN 4s -> YELLOW 1s -> RED 4s
=========================================
[BOOT] self-test done
[TRAFFIC] GREEN  ON  (4s)
[TRAFFIC] YELLOW ON  (1s)
[TRAFFIC] RED    ON  (4s)
[TRAFFIC] GREEN  ON  (4s)
```

## 学到什么

- **可观测性要写进固件**：上电自检 + 每段一行日志，无头仿真也能验收。
- **LED 必须串电阻**：330Ω，否则仿真里灯变灰（过流）。
- **`delay()` 不是罪**：状态简单时用阻塞延时最直观；状态复杂了再上状态机。

## 想改造它

- 加一个行人按钮（`wokwi-pushbutton`，GPIO4，`INPUT_PULLUP`）：按键后 5 秒内变红。
- 换成真实交叉路口：东西向 + 南北向两套灯，加互锁逻辑。
- 加倒计时显示：换 `wokwi-7segment` 或 OLED。

改完记得重跑 `compile.ps1` → `simulate.ps1` → 更新 `sim-viewer.html` 的 `CFG` 与两个原始文本块。
