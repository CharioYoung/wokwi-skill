# 08 · Two complete worked examples

[中文](08-examples.md) | **English**

Both examples live under `examples/` and are **fully runnable sets** (`.ino` + `diagram.json` + `wokwi.toml` + `sim-viewer.html`).

| Example | Capabilities covered | Difficulty |
|---|---|---|
| `traffic-light` | pure GPIO, state machine, observable serial | ★ |
| `remote-switch` | WiFi + HTTP server + PWM breathing + serial commands | ★★★ |

---

## Example 1: ESP32 traffic light

### The original request

> wokwi: build an ESP32 traffic light, green 4 seconds, yellow 1 second, red 4 seconds

### Part selection (written into the viewer's `CFG.selection`)

| Requirement | Choice | Reason |
|---|---|---|
| run a state machine, observable serial | ESP32 DevKit C | enough GPIO; serial built in; `board-esp32-devkit-c-v4` |
| three-colour indication | `wokwi-led` ×3 | Wokwi only has single-colour LEDs, so combine three with different colors |
| current limiting | 330Ω ×3 | an LED straight onto 3.3V over-currents |
| verifiable headlessly | serial status prints | print `[TRAFFIC]` on every transition, the log is the evidence |

### Wiring (`diagram.json` summary)

```
GPIO25 → rr(330Ω) → red:A    ; red:C    → GND.1
GPIO26 → ry(330Ω) → yellow:A ; yellow:C → GND.2
GPIO27 → rg(330Ω) → green:A  ; green:C  → GND.3
TX/RX  → $serialMonitor
```

### Code highlights (`traffic-light.ino`)

```cpp
#define R_PIN 25
#define Y_PIN 26
#define G_PIN 27

void setLights(bool r, bool y, bool g) {
  digitalWrite(R_PIN, r ? HIGH : LOW);
  digitalWrite(Y_PIN, y ? HIGH : LOW);
  digitalWrite(G_PIN, g ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(R_PIN, OUTPUT); pinMode(Y_PIN, OUTPUT); pinMode(G_PIN, OUTPUT);
  // power-on self-test: each lamp 300ms -- makes "did it start" decidable even headlessly
  setLights(1,0,0); delay(300);
  setLights(0,1,0); delay(300);
  setLights(0,0,1); delay(300);
  setLights(0,0,0);
  Serial.println("[BOOT] self-test done");
}

void loop() {
  setLights(0,0,1); Serial.println("[TRAFFIC] GREEN  ON  (4s)"); delay(4000);
  setLights(0,1,0); Serial.println("[TRAFFIC] YELLOW ON  (1s)"); delay(1000);
  setLights(1,0,0); Serial.println("[TRAFFIC] RED    ON  (4s)"); delay(4000);
}
```

**Design intent**: `delay()` blocks, but every phase here is short, so no state machine is needed; observability comes from one log line per phase plus the power-on self-test.

### Real result (`sim-*/serial.log`)

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

### Run it yourself

```bash
cd examples/traffic-light
powershell -File ../../scripts/compile.ps1 -Project .
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 14000 -Expect "TRAFFIC"
```

Firmware size: **285,664 bytes** (21% program / 6% RAM).

---

## Example 2: WiFi web remote switch + breathing LED

### The original request

> wokwi: an ESP32 switch that can be controlled remotely from a web page, with a breathing LED effect

### Part selection

| Requirement | Choice | Reason |
|---|---|---|
| web remote control | ESP32 DevKit C | WiFi built in, can run `WebServer` |
| show on/off/breathing | `wokwi-led` (red, GPIO2) | GPIO2 supports LEDC hardware PWM for smooth brightness |
| current limiting | 330Ω | as above |
| verifiable headlessly | serial + 3 s steady-on | self-test breathes twice, holds on 3 s, prints duty every 2 s |
| interaction | HTTP `/on` `/off` `/breathe` `/status` | the virtual WiFi assigns `10.13.37.2` |

### Key code structure

```cpp
#define LED 2
#define PWM_FREQ 5000
#define PWM_RES 8          // 8-bit -> duty 0..255

WebServer server(80);
enum Mode { MODE_BREATHE, MODE_MANUAL };
Mode mode = MODE_BREATHE;
int duty = 0, step = 3;

void applyDuty(int d) { duty = constrain(d, 0, 255); ledcWrite(LED, duty); }

void handleOn()      { mode = MODE_MANUAL; applyDuty(255); server.send(200,"text/plain","LED ON"); }
void handleOff()     { mode = MODE_MANUAL; applyDuty(0);   server.send(200,"text/plain","LED OFF"); }
void handleBreathe() { mode = MODE_BREATHE;                 server.send(200,"text/plain","BREATHE"); }

void setup() {
  Serial.begin(115200);
  ledcAttach(LED, PWM_FREQ, PWM_RES);   // ESP32 core 3.x API
  selfTest();                            // breathe twice
  applyDuty(255); delay(3000);           // hold on for 3s: a deterministic window for screenshots/eyes
  WiFi.begin("Wokwi-GUEST");
  server.on("/on", handleOn);
  server.on("/off", handleOff);
  server.on("/breathe", handleBreathe);
  server.on("/status", handleStatus);
  server.begin();
  Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.println("[HTTP] server started on port 80");
}

void loop() {
  server.handleClient();
  if (mode == MODE_BREATHE) {
    int n = duty + step;
    if (n >= 255 || n <= 0) { step = -step; n = constrain(n, 0, 255); }
    applyDuty(n);
    delay(20);
  }
}
```

### Real result

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

`duty` jumping between 3 / 207 / 93 / 117 means **the PWM is really changing**. That is hard evidence the breathing effect is working.

**Note**: give `--timeout` at least 16000 (about 80 s of real waiting), otherwise WiFi has not connected before the run is cut off — a trap this project actually hit.

### Three easy mistakes

1. **`ledcAttach` vs `ledcSetup`**: ESP32 core 3.x uses `ledcAttach(pin, freq, res)`; 2.x uses `ledcSetup(ch, freq, res) + ledcAttachPin(pin, ch)`. A version mismatch fails the build.
2. **`--interactive` needs a real TTY**: piping `on` into it does nothing, so do not count on scripted serial interaction. To verify HTTP logic, the `[HTTP]` lines in `--serial-log-file` are enough.
3. **`10.13.37.2` is only reachable inside the virtual network**: your host browser cannot open it; only the browser inside the Wokwi simulation can.

### Run it yourself

```bash
cd examples/remote-switch
powershell -File ../../scripts/compile.ps1 -Project .
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 16000 -Expect "IP:","server started"
```

Firmware size: **947,568 bytes** (72% program / 14% RAM).

---

## From an example to a new requirement: change only three things

Suppose you want "a button-controlled servo pan mount":

| Step | What to change | Reference |
|---|---|---|
| 1. selection | swap the LED for `wokwi-servo`, add `wokwi-pushbutton`; consult the mapping table in 03 | `03-hardware-selection.en.md` |
| 2. circuit | edit `diagram.json`: `GPIO13 → servo:PWM`, `GPIO4 → button → GND` | `04-diagram-schema.en.md` |
| 3. code | keep the "self-test + loop + print every 2 s" skeleton, replace the business logic | the skeletons above |
| 4. viewer | change `CFG.actors` to the servo (draw an angle indicator), `sequence` to an angle sequence, `rawLog` to the real log | `06-viewer.en.md` |

**The skeleton never changes**: `Serial.begin` → initialise peripherals → self-test → main loop → periodic prints. That structure fits 90% of simulation projects.

---

## What else works (verified feasible)

| Requirement | Key parts | Notes |
|---|---|---|
| temperature/humidity display | `wokwi-dht22` + `wokwi-ssd1306` | needs `DHT sensor library` + `Adafruit SSD1306`; the OLED supports a **real screenshot** |
| photoresistor night light | `wokwi-photoresistor-sensor` + LED | threshold on the ADC reading, log the raw value |
| servo pan mount | `wokwi-servo` + button | PWM 50Hz, 500–2500µs pulse |
| ultrasonic distance | `wokwi-hc-sr04` + OLED | `pulseIn` to measure the echo width |
| IR remote air conditioner | `wokwi-ir-receiver` + `wokwi-ir-remote` | print the received code to verify the protocol |
| button counter + 7-segment | `wokwi-7segment` | debouncing matters (20 ms) |

---

## Not suitable for simulation (tell the user honestly)

| Requirement | Why | Alternative |
|---|---|---|
| real voice recognition | Wokwi has no microphone/recognition model | serial commands instead |
| calling real internet APIs | the virtual network is isolated | verify the other direction (the board acts as the HTTP server) |
| strict millisecond timing | simulation is not real time (1.5–5× slower) | verify on hardware; the simulation only checks logic |
| a specific proprietary chip | no model | equivalent substitute + provide real wiring |
| high current / mains power | simulation does not model power | verify only the control-signal logic |
