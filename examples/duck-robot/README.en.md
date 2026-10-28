# Example 04 · Duck Robot (many actuators, one sketch)

[中文](README.md) | **English**

**What it exercises**: four kinds of actuator/sensor in one sketch (LED, passive buzzer, servo, ultrasonic), servo PWM straight from the ESP32 LEDC peripheral (**no third-party library**), an event-driven state machine, a scenario file that proves the branch was taken, and a real circuit rendering.

## The ask

> wokwi: an ESP32 duck robot — eyes light up, legs swing like it is walking, and it quacks and dodges when something gets in the way

## Circuit

9 parts, 18 real wires (plus 2 virtual serial lines):

| Part | Type | Pins | Role |
|---|---|---|---|
| board | `board-esp32-devkit-c-v4` | — | 3.3V logic, 38 pins |
| `eyeL` / `eyeR` | `wokwi-led` (yellow) | A←`rL`/`rR`, C→GND | eyes, GPIO2 / GPIO4 |
| `rL` / `rR` | `wokwi-resistor` 330Ω | between board and LED | current limit; without it the LEDs go grey in simulation |
| `legL` / `legR` | `wokwi-servo` | PWM←GPIO14/27, V+→5V, GND | legs, 180° out of phase = walking |
| `buzz` | `wokwi-buzzer` (passive) | `1`←GPIO13, `2`→GND | `tone()` with two pitches = "quack" |
| `hc` | `wokwi-hc-sr04` | TRIG←GPIO5, ECHO→GPIO18, VCC/GND | obstacle ahead, <25cm triggers avoid |

## Files

| File | What it is |
|---|---|
| `duck-robot.ino` | Firmware: WALK ⇄ AVOID state machine, zero `#include` (servo via LEDC, no ESP32Servo) |
| `diagram.json` | Circuit: 9 parts / 18 wires, every pin name taken from the real `pinInfo` in `@wokwi/elements` |
| `wokwi.toml` | Points at `build/duck-robot.ino.bin` |
| `scenario.yaml` | Drives the HC-SR04 distance 120cm → 15cm → 120cm so the avoid branch actually runs |
| `sim-viewer.html` | Viewer: the circuit is `PcbView.render(diagram.json)` output, eyes/legs/quack/avoid are interactive, serial pane replays the real log |

## Running it

```bash
cd examples/duck-robot

# 1. compile
bash ../../scripts/compile.sh .
#    Windows: powershell -File ../../scripts/compile.ps1 -Project .

# 2. simulate (with the scenario - without it the distance never changes,
#    so the avoid branch is unreachable and the run proves nothing)
WOKWI_SCENARIO=scenario.yaml bash ../../scripts/simulate.sh . 16000 "AVOID" "resume"
#    Windows:
#    powershell -File ../../scripts/simulate.ps1 -Project . -Scenario .\scenario.yaml -Expect "AVOID","resume"

# 3. read the log, open the page
cat sim-*/serial.log
```

## Expected output

Build: `Sketch uses 302,171 bytes (23%)`, `Global variables use 22,312 bytes (6%)`.

Serial (real simulation, with `scenario.yaml`):

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

The `AVOID` line is the evidence: it can only appear after the scenario pulls the distance down to 15cm. A green run **without** a scenario proves nothing.

## Why this example is worth reading: three things that looked right and were all wrong

This was the most "working" looking of the examples and it was wrong on three levels at once.

**1. The viewer drew a duck, not a circuit.** It had a hand-written `<svg>`: a yellow ellipse body with two legs. Attractive, intuitive, and not a rendering of `diagram.json` — a missing wire or an invented part would be invisible to anyone looking at it. After this case, `verify_viewer.js` grew check 1b: no `PcbView.render(` in the page means FAIL.

**2. Seven pin names in `diagram.json` were invented.**

| Written | Real |
|---|---|
| `buzz:+` / `buzz:-` | `buzz:1` / `buzz:2` |
| `legL:SIG` / `legL:VCC` | `legL:PWM` / `legL:V+` (4 places, two servos) |
| `esp:GND.4/5/6` | ESP32 only has `GND.1`~`GND.3` (`GND.4` belongs to the Mega) |

The failure mode is not an error, it is **silent dropping**: the renderer cannot resolve the pin, skips the wire, and 9 connections vanish. The firmware never checks the hardware either — `digitalWrite` on an unconnected pin returns happily and the serial log still looks great. **A clean serial log is not proof the wiring is right.**

**3. Part placement ignored "pins face the board".** A servo's three pins sit on its left edge; park it left of the board and the wire has to cross the servo body to reach the board — on screen, a line straight through the part. Move it to the right and the pins naturally face the board. Same rule elsewhere: LED, buzzer and HC-SR04 have their pins on the bottom edge, so they belong above or below the board; a resistor has no polarity, so let the end nearer the board be the one that connects to it (`esp:2→rL:2`, `rL:1→eyeL:A`).

After the fix: `parts=9 wires=18/18 crossings=0 UNRESOLVED=0 pins=38/38`.

## Takeaways

- **An ESP32 can drive a servo with no library at all**: `ledcAttach(pin, 50, 16)` and convert `500 + angle*2000/180` µs into a 16-bit duty. One less dependency means the project still compiles when copied somewhere else.
- **Make the log prove the branch**: print one fixed-format line per state transition, then use `scenario.yaml` to create the trigger. In a headless simulation that is the only assertable evidence you get.
- **Numbers from the renderer must be challengeable**: `check_circuit.js` counts board-crossing segments (must be 0), hover hotspots vs. total pins (must be equal), empty `<title>`s (must be 0), **labels** (every non-board part prints its `id`, type and every pin name — the count must equal what `diagram.json` declares) and **shared length** (two unrelated wires drawn on each other must stay at or under 1% of total wire length; a run shared out of the *same* pin is a junction and is reported separately as `bus`). Those assertions exist because of failure mode 2 above — nobody noticed, because nothing was asserted.

## Verify (all three must be green)

```bash
node ../../scripts/verify_viewer.js .
node ../../scripts/domrun.js sim-viewer.html
node ../../scripts/check_circuit.js
```
