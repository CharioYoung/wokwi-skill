# Example 3 · 32-servo ring (complex-project stress test)

[中文](README.zh.md) | **English**

**Capabilities covered**: a big Arduino Mega pin map, a 32-servo array, wire rendering for 98 connections, four animation sequences, and porting a third-party community project.

Original project: [wokwi.com/projects/305336312628511297](https://wokwi.com/projects/305336312628511297) by Koepel (Public Domain). It is a real, widely shared "overdone" demo: one Mega driving 32 servos arranged in a circle, running four animation sequences.

## Why this case

The first two examples are 7-part, 9-wire beginner circuits. They cannot prove the renderer and the checkers still hold up under real complexity. The numbers here:

| Metric | Value |
|---|---|
| Parts | 33 (1 Mega + 32 servos) |
| Connections | 98 (32 PWM + 32 chained V+ + 32 chained GND + 2 supply) |
| Board pins | 85 (double-row headers, 34 wired) |
| Serial output | none (the firmware prints nothing - all behaviour is in the servo angles) |

## Files

| File | What it is |
|---|---|
| `ServoOverdone.ino` | firmware: the author's original, unchanged (6628 chars) |
| `diagram.json` | circuit: printed by the firmware's own `GenerateDiagram()` inside a real simulation (10340 bytes) |
| `wokwi.toml` | points at `build/ServoOverdone.ino.hex` + `.elf` (AVR emits hex, not bin) |
| `sim-viewer.html` | result viewer: the whole ring + four clickable sequences + horns that actually turn |

## Where `diagram.json` comes from (this part matters)

Placing 32 servos around a circle by hand cannot come out right, and the original author knew it - so he wrote `GenerateDiagram()` into the firmware: compute the layout, then `Serial.print` it out as JSON, line by line.

That makes the port **verifiable** rather than "I copied it from a screenshot":

```bash
# 1. call GenerateDiagram() once from setup(), run a real simulation, capture serial
wokwi-cli . --timeout 6000 --serial-log-file dump_serial.txt

# 2. those 10340 bytes on the serial line ARE diagram.json
# 3. reproduce the same floating-point math in Python
#    (Arduino's float is 32-bit, and Serial.print(float) defaults to 2 decimals)
python gen_diagram.py > diagram.python.json

# 4. byte-for-byte
#    sim bytes: 10341 | python bytes: 10341
#    identical after CRLF normalisation: True
```

In other words: **the `diagram.json` embedded in the page is byte-identical to the one a real Wokwi simulation printed.** The head of that raw serial dump is kept in `CFG.rawLog` inside `sim-viewer.html`, so the claim stays checkable.

## How to run it

```bash
cd examples/servo-ring

# 1. build (Mega needs arduino:avr:mega and the arduino:avr core)
ARDUINO_FQBN=arduino:avr:mega powershell -File ../../scripts/compile.ps1 -Project .
#    macOS/Linux: ARDUINO_FQBN=arduino:avr:mega bash ../../scripts/compile.sh .

# 2. verify (all three green before calling it done)
node ../../scripts/verify_viewer.js . --compile --build-dir C:/wokwi-tmp/chk
node ../../scripts/domrun.js sim-viewer.html
node ../../scripts/check_circuit.js

# 3. view
#    open sim-viewer.html in a browser
```

## Expected output

Build:

```
Sketch uses 5416 bytes (2%) of program storage space. Maximum is 253952 bytes.
Global variables use 433 bytes (5%) of dynamic memory, leaving 7759 bytes for local variables.
```

The three checks:

```
verify_viewer   INO identical (6628 chars) / DIA identical (10340 chars) / compiles cleanly (.hex, 5416 B)
domrun          RESULT: OK (0 runtime errors)
check_circuit   parts=33 wires=98/98 crossings=0 leads=60 pins=85/85 (34 wired) labels=32/96 shared=193.5u/0.55% bus=275.4u
```

`crossings=0` is the point: not one of the 98 wires runs across the PCB. `leads=60` is allowed - see below. `labels=32/96` means all 32 servos and all 96 pins are named (`servo17` / `舵机 · wokwi-servo` / `GND V+ PWM`), so the drawing can be wired from; `shared=0.55%` is the last few shared runs in the densest diagram here (`bus=275.4u` is a run shared out of one pin - a junction, the way a schematic draws a bus, not a defect).

## The three fixes this case forced out

This is what a complex project is for: the first two examples would never have exposed any of these.

1. **Double-row header pins sit inside the footprint.** The Mega's digital header is two columns 10 world units apart, and the inner column is 13 units in from the board edge. The old router measured its turn from *the pin plus a gap*, so the turn landed inside the board and the vertical run slid across the PCB along the header. Turns are now measured from the **board edge**.
2. **A part parked on the board edge has to start its wire over the PCB.** At every corner of the ring, a servo's connector sits on the board corner - its pin coordinate is literally inside the footprint. That lead is a layout fact, not a routing choice, so `check_circuit` counts it separately as `leads`: real bugs still fail, this never gets blamed on the router.
3. **Two columns leave no room for silkscreen.** The columns are 10 units apart and a pad is 6.8 wide. Inner-column names now print inboard of themselves; outer-column names print in the margin inside the board edge. Before, the outer names printed off the PCB entirely.

## What you learn

- **AVR and ESP32 do not emit the same artifact**: Mega produces `.hex` + `.elf`, ESP32 produces `.bin`. `verify_viewer --compile` used to accept only `.bin`, and duly reported "compile failed" on a sketch that had just built cleanly.
- **A servo is three wires, not one**: PWM plus V+ plus GND - 32 servos means 64 power wires. Those are the red and black chains in the drawing, joined back to the board's 5V/GND at each end.
- **32 servos cannot really run off the board's 5V** (that would cook it in real life), but this is a simulation project and that is how the author wired it. It is drawn as-is, not prettified.
- **A project with no serial output still has to be verifiable**: all the behaviour is in the angles, so the viewer turns the four sequences into clickable animations with live angle readouts.

## Ideas to change it

- Replace `delay()` with a `millis()` state machine so the four sequences can overlap.
- Add a `wokwi-potentiometer` as a global speed dial.
- Move to ESP32 + PCA9685 (16-channel PWM expander) and see exactly which lines a new board needs in the `BOARDS` registry.

After any change: re-run `sync_embed.js` to inject the sources, `sync_pcbview.js` to sync the renderer, then the three checks.
