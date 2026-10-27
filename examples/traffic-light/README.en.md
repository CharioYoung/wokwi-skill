# Example 1 · ESP32 traffic light

[中文](README.md) | **English**

**Capabilities covered**: pure GPIO, a state machine, serial observability, and the result viewer. Zero third-party libraries.

## Request

> wokwi: build an ESP32 traffic light, green 4 seconds, yellow 1 second, red 4 seconds

## Files

| File | What it is |
|---|---|
| `traffic-light.ino` | firmware: three lamps in turn + a log line per phase + power-on self-test |
| `diagram.json` | circuit: ESP32 + 3×LED + 3×330Ω, LEDs on GPIO25/26/27 |
| `wokwi.toml` | points at `build/traffic-light.ino.bin` |
| `sim-viewer.html` | result viewer: three-lamp animation + real log replay + wiring table + selection rationale |

## How to run it

```bash
cd examples/traffic-light

# 1. build
powershell -File ../../scripts/compile.ps1 -Project .
#    macOS/Linux: bash ../../scripts/compile.sh .

# 2. simulate (about 70 seconds of real waiting)
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 14000 -Expect "TRAFFIC"

# 3. read the log
cat sim-*/serial.log

# 4. look at the page
#    open sim-viewer.html in a browser, or have the agent open it with present_files
```

## Expected output

Build: `Sketch uses 285,664 bytes (21%)`, artefact `build/traffic-light.ino.bin`.

Serial:

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

## What you learn here

- **Observability belongs in the firmware**: a power-on self-test plus one log line per phase makes headless verification possible.
- **An LED must have a series resistor**: 330Ω, otherwise the lamp turns grey in simulation (over-current).
- **`delay()` is not a sin**: with simple states, blocking delays are the most readable choice; bring in a state machine when the states get complicated.

## Ideas to modify it

- Add a pedestrian button (`wokwi-pushbutton`, GPIO4, `INPUT_PULLUP`): turn red within 5 seconds of a press.
- Make a real intersection: two sets of lamps (east-west and north-south) with interlock logic.
- Add a countdown display: switch to `wokwi-7segment` or an OLED.

After changing anything, re-run `compile.ps1` → `simulate.ps1` → update `CFG` and the two raw text blocks in `sim-viewer.html`.
