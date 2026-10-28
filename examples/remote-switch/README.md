# Example 2 · WiFi web remote switch + PWM breathing LED

[中文](README.zh.md) | **English**

**Capabilities covered**: WiFi connection, an HTTP server, LEDC hardware PWM, serial commands, and richer observability. Zero third-party libraries (`WiFi.h` / `WebServer.h` ship with the ESP32 core).

## Request

> wokwi: an ESP32 switch that can be controlled remotely from a web page, with a breathing LED effect

## Files

| File | What it is |
|---|---|
| `remote-switch.ino` | firmware: PWM breathing + HTTP `/on` `/off` `/breathe` `/status` + serial commands |
| `diagram.json` | circuit: ESP32 + 1×LED (GPIO2) + 330Ω |
| `wokwi.toml` | points at `build/remote-switch.ino.bin` |
| `sim-viewer.html` | result viewer: PWM breathing animation + log replay + clickable buttons (equivalent to the HTTP endpoints) |

## How to run it

```bash
cd examples/remote-switch

powershell -File ../../scripts/compile.ps1 -Project .
#    macOS/Linux: bash ../../scripts/compile.sh .

# note: this project waits for WiFi, so timeout must be at least 16000 (about 80 s of real waiting)
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 16000 -Expect "IP:","server started"

cat sim-*/serial.log
```

## Expected output

Build: `Sketch uses 947,568 bytes (72%)`, artefact `build/remote-switch.ino.bin`.

Serial:

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

`duty` moving across 0–255 means **the PWM is really changing** — hard evidence the breathing effect works.

## Three traps (all hit for real)

1. **Too small a `--timeout` and you never see WiFi**: give 16000 or more, otherwise the log stops at `[SHOW] holding LED ON 3s`.
2. **`10.13.37.2` only exists inside the virtual network**: your host browser cannot open it; only the browser inside the Wokwi simulation can.
3. **`--interactive` needs a real TTY**: piping `on` into it does nothing. To verify the HTTP logic, just read the `[HTTP]` lines in the log.

## What you learn here

- **The ESP32 core 3.x PWM API is `ledcAttach(pin, freq, res)`**; 2.x used `ledcSetup` + `ledcAttachPin`, and a version mismatch fails the build.
- **Network projects must have timeout and retry** — never spin in `while(WiFi.status()!=WL_CONNECTED);`.
- **The 3-second steady-on "showcase window"** gives "the lamp is on" a deterministic observation window that both eyes and screenshots can catch.
- **Two channels: HTTP endpoints plus serial commands** — serial verifies the logic headlessly, the web page provides interaction when a UI is available.

## Ideas to modify it

- Add a button (`wokwi-pushbutton`, GPIO4) for physical toggling alongside the web control.
- Make `/status` return JSON and have the page poll it for the live duty value.
- Add MQTT (needs the `PubSubClient` library, declared in `libraries.txt`) — note that the Wokwi virtual network may not reach a public broker; most components can only talk to addresses inside the simulation.
