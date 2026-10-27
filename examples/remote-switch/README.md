# 示例 02 · WiFi 网页远程开关 + PWM 呼吸灯

**中文** | [English](README.en.md)

**覆盖能力**：WiFi 连接、HTTP 服务器、LEDC 硬件 PWM、串口命令、复杂可观测性。零第三方库（`WiFi.h`/`WebServer.h` 是 ESP32 核心自带）。

## 需求

> wokwi: 用 ESP32 做一个能通过网页远程控制的开关，顺便有个呼吸灯效果

## 文件

| 文件 | 说明 |
|---|---|
| `remote-switch.ino` | 固件：PWM 呼吸 + HTTP `/on` `/off` `/breathe` `/status` + 串口命令 |
| `diagram.json` | 电路：ESP32 + 1×LED（GPIO2）+ 330Ω |
| `wokwi.toml` | 指向 `build/remote-switch.ino.bin` |
| `sim-viewer.html` | 结果查看器：PWM 呼吸动画 + 日志回放 + 可点按钮（等价于 HTTP 端点） |

## 怎么跑

```bash
cd examples/remote-switch

powershell -File ../../scripts/compile.ps1 -Project .
#    macOS/Linux: bash ../../scripts/compile.sh .

# 注意：这个项目要等 WiFi 连上，timeout 至少 16000（约 80 秒实际等待）
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 16000 -Expect "IP:","server started"

cat sim-*/serial.log
```

## 预期输出

编译：`Sketch uses 947,568 bytes (72%)`，产物 `build/remote-switch.ino.bin`。

串口：

```
[BOOT] self-test: PWM fade on GPIO2 (2 cycles)
[BOOT] fade cycle 1/2 done
[BOOT] fade cycle 2/2 done
[BOOT] self-test done, switching to auto breathing
[SHOW] holding LED ON 3s for screenshot verification
[WIFI] connecting....
[WIFI] connected
IP: 10.13.37.2
[HTTP] server started on port 80
[STATUS] ready | mode=BREATHE | led=OFF | duty=0
[STATUS] tick | mode=BREATHE | led=ON | duty=3
[STATUS] tick | mode=BREATHE | led=ON | duty=207
[STATUS] tick | mode=BREATHE | led=ON | duty=93
```

`duty` 在 0~255 之间跳动 = **PWM 真的在变**，这是呼吸灯在工作的硬证据。

## 三个坑（都踩过）

1. **`--timeout` 太小会看不到 WiFi**：给 16000 以上，否则日志停在 `[SHOW] holding LED ON 3s`。
2. **`10.13.37.2` 只存在于虚拟网内**：你本机浏览器打不开它，只有 Wokwi 仿真内的浏览器能访问。
3. **`--interactive` 需要真 TTY**：用管道喂 `on` 命令不生效。要验证 HTTP 逻辑，看日志里的 `[HTTP]` 行即可。

## 学到什么

- **ESP32 core 3.x 的 PWM API 是 `ledcAttach(pin, freq, res)`**；2.x 是 `ledcSetup` + `ledcAttachPin`，版本不匹配会编译失败。
- **网络类项目必须有超时重试**，不要 `while(WiFi.status()!=WL_CONNECTED);` 死等。
- **常亮 3 秒的"展示窗口"**：让"灯亮着"这件事有一个确定的观测窗口，人眼和截图都能抓住。
- **HTTP 端点 + 串口命令双通道**：无头环境用串口验证逻辑，有界面时用网页交互。

## 想改造它

- 加一个按钮（`wokwi-pushbutton`，GPIO4）物理切换，与网页控制共存。
- 把 `/status` 返回 JSON，网页轮询显示实时 duty。
- 加 MQTT（需 `PubSubClient` 库，并在 `libraries.txt` 里声明）——注意 Wokwi 虚拟网是否能连到公共 broker，多数组件只能访问仿真内地址。
