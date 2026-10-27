# 01 · From zero: Wokwi, dev boards and circuits

[中文](01-wokwi-primer.en.md) | **English**

This document assumes you have **never connected a wire or written a line of microcontroller code**. After reading it you will be able to follow the project the AI generates — and judge whether it is making things up.

---

## 1. What Wokwi is

Wokwi is an **electronics circuit simulator that runs in the browser**. You draw a circuit, write firmware and press run; it simulates real electrical behaviour:

- LEDs light up, and brightness/colour depend on current;
- the serial monitor scrolls, exactly like a real board plugged into USB;
- buttons can be pressed, potentiometers turned, OLED screens display;
- **WiFi is simulated too**: the ESP32 gets a virtual IP (usually `10.13.37.2`) and you can open the web page it serves from the built-in browser.

It does **not** run your PC in the cloud — it runs a compiled CPU emulator plus a circuit solver inside the browser.

### What it can and cannot simulate

| Can | Cannot |
|---|---|
| Digital levels (high/low, buttons, LEDs, relays) | Analogue-circuit accuracy (noise, thermal drift, EMI) |
| PWM (breathing LED, servo angles) | Strict real time (local simulation is **1.5–5× slower** than hardware) |
| ADC (potentiometer, photoresistor) | Parts with no model (Wokwi's library is finite) |
| I2C / SPI / UART (OLED, DHT, SD card) | Complex protocols that need external services (partially possible) |
| WiFi + HTTP + MQTT (virtual network) | Real internet access (the virtual network only exists inside the simulation) |

---

## 2. Boards: ESP32 / Arduino Uno / Pico

A microcontroller (MCU) is "a tiny computer that runs a program". A dev board = MCU + power circuitry + pin headers, so you can wire things up.

| Board | Characteristics | When to choose it | Wokwi `type` |
|---|---|---|---|
| **ESP32 DevKit C** | dual core 240 MHz, **WiFi + Bluetooth built in**, 3.3V, many GPIOs, PWM/ADC/I2C | needs networking, web control, or moderately complex logic (**default first choice**) | `board-esp32-devkit-c-v4` |
| Arduino Uno | 5V, ATmega328, few IOs, no networking | classic teaching, 5V sensors, the simplest code | `board-uno` |
| Raspberry Pi Pico | dual core 133 MHz, 3.3V, no WiFi (Pico W has it) | tighter timing/PIO, low cost | `board-rp-pico` |

### 3.3V vs 5V: where things get burned

- **ESP32 IOs are 3.3V**: a high output is ≈3.3V and the inputs generally tolerate only 3.3V.
- **Arduino Uno is 5V.**
- Feeding a 5V signal straight into an ESP32 IO → burns on real hardware; in simulation it often shows up as "the reading is always wrong".
- Boards usually expose both `3V3` and `5V` (or `VIN`) rails — **read the label before connecting**.

### What GPIO means

GPIO = General Purpose Input/Output, a pin a program can drive as:

- **Output**: `digitalWrite(pin, HIGH)` → 3.3V; `LOW` → 0V
- **Input**: `digitalRead(pin)` → reads 1 or 0
- **Analogue input**: `analogRead(pin)` → 0–4095 (ESP32 has a 12-bit ADC)
- **PWM output**: `ledcWrite()` → duty cycle controls brightness/speed/angle
- **Alternate functions**: I2C (SDA/SCL), SPI, UART all occupy specific GPIOs

**Key point: GPIO numbers ≠ physical pin order.** A pin labelled `D2` may be GPIO2, but `D15` may be GPIO15 — trust the pinout diagram. In Wokwi, `esp:2` means GPIO2.

ESP32 pins worth memorising:

| Purpose | GPIO | Notes |
|---|---|---|
| On-board LED | 2 | simplest heartbeat lamp |
| General output | 4, 5, 13, 25, 26, 27 | 25/26/27 are also common for LEDs |
| Button input | 4, 15, 16, 17 | pair with `INPUT_PULLUP` |
| ADC | 34, 35, 36, 39 | **input only**, no pull-up |
| I2C | 21 (SDA), 22 (SCL) | common for OLED/DHT |
| Serial | TX=1, RX=3 | must be wired to `$serialMonitor` to see output |
| **Avoid** | 6–11 | connected to flash; touching them crashes the chip |

---

## 3. Minimum circuit knowledge

### A loop = power → load → back to ground

For an LED to light, the circuit must be closed:

```
GPIO2 ──→ resistor ──→ LED (A anode) ──→ LED (C cathode) ──→ GND
```

Current leaves the GPIO, is limited by the resistor, passes through the LED and returns to GND. **Without GND it will never light** — 80% of beginner "the lamp won't light" cases are a missing ground.

### Why an LED always needs a series resistor

An LED has very low internal resistance; connecting it straight to 3.3V draws too much current → destroyed on real hardware, and in simulation the lamp goes **grey/dark** (Wokwi reports over-current).

Ohm's law: an LED drops about 2V (red) and we want 10mA:

```
R = (3.3V - 2.0V) / 0.01A = 130Ω
```

In practice **220Ω–330Ω** is safe (lower current, slightly dimmer). That is why every example uses `330Ω`.

### Three basic parts

| Part | Role | Wokwi type | Pins |
|---|---|---|---|
| LED | light (digital/PWM) | `wokwi-led` | `A` anode, `C` cathode |
| Resistor | current limiting / dividing / pull-up | `wokwi-resistor` | `1`, `2` (no polarity) |
| Button | input | `wokwi-pushbutton` | `1.l/2.l` one side, `1.r/2.r` the other; only a press bridges sides |

Button wiring (avoids a floating pin): one side to GPIO4, the other to GND, and `pinMode(4, INPUT_PULLUP)` in code. Then **not pressed = HIGH, pressed = LOW** — inverted, so don't mix it up.

---

## 4. Serial: your only pair of eyes

The board cannot talk to you directly, only through serial prints:

```cpp
void setup() {
  Serial.begin(115200);          // baud rate; the Wokwi monitor defaults to 115200 too
  Serial.println("boot ok");
}
void loop() {
  Serial.printf("duty=%d\n", 207);
  delay(1000);
}
```

To see the output in Wokwi, `diagram.json` must contain these two connections:

```json
[ "esp:TX", "$serialMonitor:RX", "", [] ],
[ "esp:RX", "$serialMonitor:TX", "", [] ]
```

> Forget these two lines and the code runs perfectly while the monitor stays blank. This is the most common beginner misdiagnosis of "the program didn't run?".

**In headless simulation (this skill's default mode) the serial log is the acceptance criterion**: is `[BOOT]` there, is `IP:` there, is `duty=` changing. That is why AI-generated firmware prints at key points — it is design, not noise.

---

## 5. Common peripherals at a glance

| Peripheral | How it communicates | Watch out |
|---|---|---|
| Potentiometer `wokwi-potentiometer` | analogue voltage → ADC | three legs: `1`=GND, `2`=signal, `3`=VCC |
| Photoresistor `wokwi-photoresistor-sensor` | analogue/digital | good stand-in for a sensor with no model |
| Buzzer `wokwi-buzzer` | digital / PWM frequency | `+`/`-` |
| Servo `wokwi-servo` | PWM 50Hz, 500–2500µs pulse | 0–180°, external 5V is steadier |
| OLED `wokwi-ssd1306` | I2C | address `0x3C`; Wokwi adds no pull-ups — 2.2kΩ to 3V3 if needed |
| DHT22 `wokwi-dht22` | one-wire | needs the `DHT sensor library` |
| Ultrasonic `wokwi-hc-sr04` | Trig/Echo | Echo is 5V; use a divider on a 3.3V board (simulation is forgiving, real hardware is not) |

---

## 6. Vocabulary you should remember

| Term | Meaning in one line |
|---|---|
| GPIO | a pin a program can control |
| PWM | pulse-width modulation — fast switching that emulates intermediate brightness |
| duty cycle | fraction of a period spent high (0–255 or 0–100%) |
| ADC | analogue-to-digital conversion; turns a voltage into 0–4095 |
| I2C | a two-wire bus (SDA+SCL); several devices distinguished by address |
| pull-up | resistor that holds a floating input at high level |
| GND | ground — the common reference every circuit must share |
| firmware | the program flashed into the board |
| FQBN | fully qualified board name, e.g. `esp32:esp32:esp32` |
| headless | no GUI; you only have logs |

---

## 7. Self-check: did you really get it

If you can answer these four questions, you are ready to start:

1. Why does an LED need a 330Ω resistor, and what happens without one?
2. What does `esp:2` refer to? Is it the same as the `D2` printed on the board?
3. You wrote `Serial.println` in Wokwi but the monitor shows nothing. What do you check first?
4. Can an ESP32 IO be connected directly to a 5V sensor output?

<details>
<summary>Answers</summary>

1. Current limiting. Without it the current is too high: real hardware destroys the LED, simulation shows a grey, unlit lamp.
2. GPIO2. It usually corresponds to `D2`, but **trust the pinout diagram** — the number is not the physical position.
3. First check whether `diagram.json` connects `esp:TX/RX` to `$serialMonitor`.
4. No. ESP32 IOs are 3.3V and 5V will damage them; use a level shifter or a divider.

</details>
