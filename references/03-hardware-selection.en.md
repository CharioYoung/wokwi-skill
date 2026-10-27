# 03 · Part selection: from requirement to bill of materials

[中文](03-hardware-selection.md) | **English**

The output of selection must be a **three-column table**, which finally lands in the viewer's `CFG.selection`:

| Requirement | Choice | Reason / constraint |
|---|---|---|
| Web control over the network | ESP32 DevKit C | WiFi built in, can run an HTTP server; Wokwi part = `board-esp32-devkit-c-v4` |
| Indicator lamp | wokwi-led (red) | GPIO2 supports LEDC hardware PWM for breathing; a single-colour model is enough |
| Current limiting | 330Ω | an LED straight onto 3.3V over-currents; `wokwi-resistor value=330` |

**"Why not something else" matters more than "what was chosen"** — the user can only know what to change later if they understand the reason.

---

## 1. Decision tree: board first

```
Does the requirement mention networking / web / phone control / cloud / MQTT / HTTP?
├─ yes ─────────────────────────────→ ESP32 DevKit C   (board-esp32-devkit-c-v4)
└─ no
   ├─ just basic experiments with LEDs/buttons/buzzers/potentiometers?
   │   ├─ teaching demo, lots of material, 5V sensors ─→ Arduino Uno   (board-uno)
   │   └─ want one ecosystem, 3.3V, more pins ──────────→ ESP32 (still the default)
   ├─ needs tight timing / many PWM channels / low power → Raspberry Pi Pico (board-rp-pico)
   └─ needs a small footprint / specific package ────────→ ESP32-S3 (board-esp32-s3-devkitc-1)
```

**Default answer: ESP32 DevKit C.** Enough GPIOs, 3.3V, PWM/ADC/I2C/SPI, and the best-supported board in Wokwi. Do not switch unless there is a clear reason.

---

## 2. Requirement keywords → part mapping

| Words in the requirement | Pick this | Wokwi type | Notes |
|---|---|---|---|
| light / indicate / on-off / breathing / dimming | LED | `wokwi-led` | always with 220–330Ω; `attrs:{color}` |
| button / press / switch (physical) | tactile button | `wokwi-pushbutton` | pair with `INPUT_PULLUP` |
| knob / adjust / analogue | potentiometer | `wokwi-potentiometer` | wire to an ADC pin (34/35/36/39 or 32/33) |
| brightness / light sensor / night | photoresistor module | `wokwi-photoresistor-sensor` | outputs an analogue voltage |
| temperature / humidity | DHT22 | `wokwi-dht22` | needs the `DHT sensor library` |
| distance / obstacle avoidance | ultrasonic | `wokwi-hc-sr04` | Trig/Echo, two wires |
| display text / values / charts | OLED 128×64 | `wokwi-ssd1306` | I2C, address `0x3C`, needs a library |
| sound / beep | buzzer | `wokwi-buzzer` | active vs passive behave differently |
| rotate / pan mount / servo | servo | `wokwi-servo` | PWM 50Hz; 0–180° |
| motor / forward-reverse | DC motor | `wokwi-dc-motor` | usually with an L298N |
| relay / mains power | relay module | `wokwi-relay-module` | simulation only shows open/closed |
| IR remote / air conditioner | IR receiver/emitter | `wokwi-ir-receiver` / `wokwi-ir-remote` | learn the code and print it to serial to verify |
| key matrix / keypad | membrane keypad | `wokwi-membrane-keypad` | 4×4 |
| storage / logging | microSD | `wokwi-microsd-card` | SPI |
| see serial output | virtual monitor | `$serialMonitor` | must be wired to `esp:TX/RX` |

> The authoritative, searchable part list is the official documentation at <https://docs.wokwi.com/parts>. **Confirm the type exists before writing `diagram.json`** — one wrong letter means "the part does not appear".

---

## 3. Pin assignment conventions (avoid fighting over pins)

Allocate in this order on an ESP32 and you will rarely hit a conflict:

| Purpose | Recommended pins | Why |
|---|---|---|
| On-board / main LED | 2 | labelled on the silkscreen, the most obvious choice |
| Other LEDs / actuators | 4, 5, 13, 25, 26, 27 | general purpose, no special function |
| Buttons | 15, 16, 17, 18 | support internal pull-up |
| ADC inputs | 34, 35, 36, 39 | **input only, no pull-up**; 32/33 also have ADC but can output |
| I2C | 21 (SDA), 22 (SCL) | default `Wire` pins |
| SPI | 18 (SCK), 19 (MISO), 23 (MOSI), 5 (CS) | conflicts with some LED pins — check |
| Serial | 1 (TX), 3 (RX) | already used by the monitor; do not attach peripherals |
| **Forbidden** | 6–11 | wired to SPI flash; using them crashes the chip |

---

## 4. When Wokwi has no model for a part (must be stated honestly)

**Never pretend it ran.** Choose a fallback by priority and state clearly in the delivery notes "this is a simulation, not the real part".

### ① Equivalent substitute (preferred)

Replace it with a generic part that has the same output behaviour:

| Real part | Substitute | Explanation |
|---|---|---|
| Voice recognition module | serial input / web button | "turn on the light" → send `on` over serial; MCU logic unchanged |
| A specific temperature/humidity chip | `wokwi-dht22` | same one-wire protocol family |
| Touch button | `wokwi-pushbutton` | both are digital inputs |
| PIR motion sensor | button / potentiometer | output 0/1 or an analogue level |
| Current sensor | potentiometer | analogue voltage input |
| A specific ADC chip | the ESP32's built-in ADC | 12 bits is plenty for a demo |

### ② Signal injection

Feed data through Wokwi's interactive parts:

- potentiometer → simulate any sensor voltage;
- serial monitor → type commands by hand (`on`/`off`/`25.5`);
- button → trigger events.

### ③ Simulate only what can be simulated

Draw the unsupported module into `diagram.json` (as a placeholder, unwired) or leave it out entirely, and state explicitly:

> "Module XX has no model in Wokwi. This simulation verifies the MCU-side logic and the remaining peripherals; real-hardware wiring is in the table below."

Then provide the real wiring table (pins, voltages, protocol).

### ④ Switch to an equivalent design

If the core feature depends on a proprietary module (say a particular voice chip), switch to a generic approach:

- voice control → trigger from a web page or a serial command;
- a dedicated wireless module → the ESP32's built-in WiFi/Bluetooth.

### ⑤ State the boundary explicitly

At delivery, describe the limit in one sentence, for example:

> Voice recognition has no model in Wokwi, so I replaced the voice input stage with serial `on`/`off` commands. The module → ESP32 wiring and code are below; on real hardware, swap the serial input for the module's UART output.

---

## 5. Selection checklist

After writing the selection table, walk through this list:

- [ ] every `type` really exists in Wokwi (not invented by guessing)
- [ ] every LED has a series resistor
- [ ] every input pin has a pull-up/pull-down, nothing floating
- [ ] GPIO 6–11 are unused
- [ ] parts that need a library (OLED/DHT/servo) are listed in `libraries.txt`
- [ ] for network requirements, the board really has WiFi
- [ ] for parts without a model, the fallback and real wiring are documented
- [ ] every row carries a "why not something else" reason
