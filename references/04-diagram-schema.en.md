# 04 · `diagram.json` quick reference (read before writing)

[中文](04-diagram-schema.en.md) | **English**

`diagram.json` is the single description of the circuit. Wokwi draws the board and wires from it, and the simulator computes electrical connections from it. **One wrong character and a part does not appear or a wire does not connect.**

---

## 1. Full structure

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

### Field meanings

| Field | Required | Meaning |
|---|---|---|
| `version` | ✅ | always `1` |
| `author` / `editor` | optional | metadata, no effect on simulation |
| `parts[]` | ✅ | list of parts |
| `parts[].type` | ✅ | **part type**, must be a name that really exists in Wokwi |
| `parts[].id` | ✅ | unique identifier, referenced by connections (`led1`) |
| `parts[].top` / `left` | ✅ | canvas coordinates in pixels (may be negative). Layout only, no electrical meaning |
| `parts[].attrs` | optional | part attributes such as LED colour or resistor value |
| `parts[].rotate` | optional | rotation (0/90/180/270) |
| `connections[]` | ✅ | list of wires |
| `connections[i]` | ✅ | `[source pin, target pin, wire colour, path array]` |
| `dependencies` | optional | legacy field, leave as `{}` |

### connections in detail

```json
[ "esp:2", "r1:1", "green", [] ]
```

| Index | Meaning | Notes |
|---|---|---|
| `[0]` | start | must be `<id>:<pin>`, e.g. `esp:2`, `led1:A` |
| `[1]` | end | same format |
| `[2]` | wire colour | `green`/`red`/`black`/`blue`/`gold`… **display only**, no electrical meaning |
| `[3]` | wire path | use `[]` to let Wokwi route automatically. **Always use `[]` when starting out** |

> A wrong coordinate in the path array only makes the wire look crooked; a wrong pin name silently fails to connect with no error. **Verify pin names character by character.**

---

## 2. Board types and pin names

| Board | type | Notes |
|---|---|---|
| ESP32 DevKit C (recommended) | `board-esp32-devkit-c-v4` | 38-pin, the most common |
| ESP32-S3 DevKitC-1 | `board-esp32-s3-devkitc-1` | USB-OTG, more pins |
| Xiao ESP32-C3 | `board-xiao-esp32-c3` | small footprint |
| Arduino Uno | `board-uno` | 5V logic |
| Raspberry Pi Pico | `board-rp-pico` | 3.3V |

### ESP32 pin notation

Both forms are legal; **plain numbers are recommended**:

| Form | Example | Notes |
|---|---|---|
| number | `esp:2` | GPIO2 ✅ recommended |
| with prefix | `esp:GPIO2` | equivalent |
| power | `esp:3V3`, `esp:5V`, `esp:VIN` | |
| ground | `esp:GND.1`, `esp:GND.2`, `esp:GND.3` | several GND pins, pick any |
| serial | `esp:TX`, `esp:RX` | wire to `$serialMonitor` |
| enable | `esp:EN` | reset pin, rarely needed |

> The number after `GND.` is "the nth pin with that name"; get it wrong and the pin is not found — when unsure, use `esp:GND.1`.

---

## 3. Common parts table

| Part | type | Pins | attrs example |
|---|---|---|---|
| LED | `wokwi-led` | `A` (anode), `C` (cathode) | `{"color":"red"}`, one of red/green/blue/yellow/white/orange |
| RGB LED | `wokwi-rgb-led` | `R` `G` `B` `COM` | `{"common":"cathode"}` |
| Resistor | `wokwi-resistor` | `1` `2` (no polarity) | `{"value":"330"}` |
| Button | `wokwi-pushbutton` | `1.l` `2.l` `1.r` `2.r` | `{"color":"green"}` |
| Slide switch | `wokwi-slide-switch` | `1` `2` `3` | |
| Potentiometer | `wokwi-potentiometer` | `1` (GND) `2` (signal) `3` (VCC) | `{"value":"0"}` initial position |
| Photoresistor module | `wokwi-photoresistor-sensor` | `VCC` `GND` `AO` `DO` | |
| Buzzer | `wokwi-buzzer` | `1` (+) `2` (-) | `{"volume":"0.1"}` |
| Servo | `wokwi-servo` | `GND` `VCC` `PWM` | `{"pin":"..."}` rarely needed |
| DC motor | `wokwi-dc-motor` | `1` `2` | |
| Relay module | `wokwi-relay-module` | `VCC` `GND` `IN` `NO` `NC` `COM` | |
| OLED 128×64 | `wokwi-ssd1306` | `GND` `VCC` `SDA` `SCL` | `{"i2c-address":"0x3C"}` |
| LCD 1602 (I2C) | `wokwi-lcd1602` | `GND` `VCC` `SDA` `SCL` | `{"pins":"i2c"}` |
| DHT22 | `wokwi-dht22` | `VCC` `SDA` `GND` | |
| Ultrasonic | `wokwi-hc-sr04` | `VCC` `TRIG` `ECHO` `GND` | |
| IR receiver | `wokwi-ir-receiver` | `VCC` `GND` `DAT` | |
| IR remote | `wokwi-ir-remote` | no pins | `{"remote":"NEC"}` |
| Membrane keypad | `wokwi-membrane-keypad` | `R1..R4` `C1..C4` | |
| microSD | `wokwi-microsd-card` | `VCC` `GND` `CS` `MOSI` `MISO` `SCK` | |
| Logic analyser | `wokwi-logic-analyzer` | multi-channel | a great tool for debugging PWM/I2C |
| **Virtual serial monitor** | `$serialMonitor` | `RX` `TX` | not listed in parts, only used in connections |

---

## 4. Five connection rules to remember

1. **Always provide ground**: every loop must return to `esp:GND.x`, otherwise nothing works.
2. **An LED must have a series resistor**: `GPIO → resistor → LED:A → LED:C → GND`; order does not matter, the resistor does.
3. **Serial must be wired**: `esp:TX → $serialMonitor:RX` and `esp:RX → $serialMonitor:TX`, otherwise there is no output.
4. **I2C can be shared**: several devices tie SDA together and SCL together and are distinguished by address; Wokwi **adds no pull-ups**, so add 2.2kΩ to `3V3` when needed.
5. **One net can have many points**: several LEDs sharing a single GND pin is fine.

---

## 5. Layout advice (`top`/`left`)

Coordinates only affect appearance, but tidiness helps the user understand at a glance:

- put the board at `top:-40, left:-60`;
- arrange parts in signal order, left to right then top to bottom, with ≥ 60px spacing;
- align similar parts in the same column;
- never let parts overlap (they become hard to select and look broken in a screenshot).

---

## 6. How to validate (find errors without simulating)

```bash
# JSON syntax
node -e "JSON.parse(require('fs').readFileSync('diagram.json','utf8')); console.log('JSON OK')"
```

Then check three things by hand:

- [ ] every `<id>` used in `connections` exists in `parts`
- [ ] every pin name really exists on that part (compare with the table above)
- [ ] at least one path runs from a GPIO through a part back to GND

---

## 7. wokwi.toml (for wokwi-cli simulation)

```toml
[wokwi]
version = 1
firmware = 'build/sketch.ino.bin'
```

- `firmware` points at the **arduino-cli build output**; the filename matches the `.ino` (`my-led.ino` → `my-led.ino.bin`).
- The path is relative to the project directory (where `wokwi.toml` lives).
- Note the **single quotes**; on Windows use forward slashes or doubled backslashes.
- ESP-IDF / Pico SDK projects may omit it (the CLI can infer); **ESP32 Arduino projects cannot**.

---

## 8. Common error reference

| Symptom | Cause |
|---|---|
| A part does not appear | `type` misspelled (e.g. `wokwi-leds`) or `id` missing in `parts` |
| Wire will not connect, pin turns red | wrong pin name (`led:ANODE` should be `led:A`) |
| Lamp stays dark but the code runs | missing GND, or LED polarity reversed (`A`/`C` swapped) |
| Lamp turns grey / over-current warning | no series resistor |
| Serial monitor completely blank | `$serialMonitor` not wired |
| I2C scan finds no device | SDA/SCL not wired, wrong address, or no pull-ups |
| Whole page reports a JSON error | trailing comma / unbalanced bracket |
