# 05 · Build and simulate: really getting the firmware to run

[中文](05-build-and-simulate.en.md) | **English**

This document covers two things: **how to turn an `.ino` into firmware**, and **how to run it in Wokwi and bring the evidence back**.

---

## 1. Why a local build is mandatory

`wokwi-cli` is designed as "**you give me firmware, I run it**":

| Project type | Does wokwi-cli compile for you? |
|---|---|
| ESP-IDF | ✅ yes (inferred from `CMakeLists.txt`) |
| Raspberry Pi Pico SDK | ✅ yes |
| **ESP32 Arduino (`.ino`)** | ❌ **no** — you must supply the `.bin` |

So the correct shape for an ESP32 Arduino project is:

```
sketch.ino  --arduino-cli-->  build/sketch.ino.bin  --wokwi-cli-->  simulation
```

Skip the first step and you get `Firmware file not found`, or a simulation that starts but prints nothing.

---

## 2. Building with arduino-cli

### Basic command

```bash
arduino-cli compile \
  --fqbn esp32:esp32:esp32 \
  --build-path /tmp/wokwi-build \
  --output-dir <project-dir>/build \
  <project-dir>
```

| Flag | Purpose | Watch out |
|---|---|---|
| `--fqbn` | fully qualified board name | ESP32 DevKit C uses `esp32:esp32:esp32` |
| `--build-path` | intermediate artefacts | **must be pure ASCII**, otherwise `ld.exe` fails |
| `--output-dir` | where the final `.bin` goes | usually `<project>/build`, matching `wokwi.toml` |
| `--config-dir` | Arduino data directory (where cores live) | if the core is installed under a non-ASCII path, pass an ASCII one |
| `--warnings` | warning level | `all` while debugging |

### FQBN reference

| Board | FQBN |
|---|---|
| ESP32 DevKit C | `esp32:esp32:esp32` |
| ESP32-S3 | `esp32:esp32:esp32s3` |
| ESP32-C3 | `esp32:esp32:esp32c3` |
| Arduino Uno | `arduino:avr:uno` |
| Pico | `rp2040:rp2040:rpipico` |

### Success criteria

```
Sketch uses 285664 bytes (21%) of program storage space.
Global variables use 22084 bytes (6%) of dynamic memory.
```

and `<build>/<name>.ino.bin` exists with a size > 0.

Size reference: an empty ESP32 project is about 250–300 KB; with WiFi + WebServer it is about 900 KB–1 MB.

### When you need third-party libraries

```bash
arduino-cli lib install "DHT sensor library"
arduino-cli lib install "Adafruit SSD1306"
arduino-cli lib install "Adafruit GFX Library"
```

Also write the library names into the project's `libraries.txt` (one per line) so that creating the same file on the wokwi.com web editor installs them automatically.

---

## 3. wokwi.toml

```toml
[wokwi]
version = 1
firmware = 'build/sketch.ino.bin'
```

- the path is **relative to the directory holding `wokwi.toml`**;
- use single quotes and forward slashes;
- ESP32 Arduino projects **must** include it;
- the filename must match the build output (`traffic-light.ino` → `traffic-light.ino.bin`).

---

## 4. Running the simulation with wokwi-cli

```bash
wokwi-cli --timeout 16000 \
          --serial-log-file sim/serial.log \
          --expect-text "IP:" \
          <project-dir>
```

### Flag reference

| Flag | Purpose | Trap |
|---|---|---|
| `--timeout <ms>` | simulation timeout, **in simulated milliseconds** | not wall clock! this machine is 1.5–5× slower, so 16000 simulated ms may take 25–80 s |
| `--serial-log-file <path>` | write serial output to disk | **always use it** — this is the only reliable evidence |
| `--expect-text <s>` | success when the text appears in the log | can be given several times |
| `--fail-text <s>` | failure when the text appears | use it to catch `Guru Meditation`, panics |
| `--screenshot-part <id>` | screenshot one part | **only works on parts with a framebuffer** (OLED/LCD) |
| `--screenshot-time <ms>` | screenshot at simulated millisecond N | simulation time, not wall clock |
| `--screenshot-file <path>` | output path for the screenshot | without a part it is often 0 bytes |
| `--interactive` | interactive mode, keyboard into serial | needs a real TTY; piping commands does not work |
| `--elapsed-time` | print the actual elapsed time | useful for tuning pacing |

### Exit codes

| Code | Meaning | Normal? |
|---|---|---|
| 0 | finished normally | ✅ |
| 42 | killed by `--timeout` | ✅ **every continuously running program ends this way; passing just means the target lines are in the log** |
| 1 | build/start/assertion failure | ❌ read the log |

> Many people see exit 42 and assume failure. It actually means "I cut you off at the timeout" — a normal exit.

### Sense of time: simulation is slower than real time

Measured on this machine: 16000 ms of simulated time took about 80 s of real waiting. Therefore:

- to see "boot + self-test + WiFi connect + one status line", give `--timeout` at least 12000–16000;
- to verify something that happens after 30 seconds, `--timeout` 150000 means 12 minutes of real waiting — **not recommended**; add a shortened test mode to the firmware instead.

---

## 5. Running through MCP (agent automation mode)

Configuration is in `02-environment.en.md`. The usual tools:

- `start_simulation` — start
- `get_serial_output` — fetch serial output
- `stop_simulation` — stop

**Known trap**: the MCP process is resident, so one interrupted `start_simulation` leaves a pending request blocking the queue, which looks like "it never returns". Handling:

1. restart the client (cleanest);
2. or bypass MCP and call the CLI directly: `scripts/simulate.ps1`.

**Telling network problems apart**: first run `curl -I https://wokwi.com` and check for HTTP 200. People have suspected "Wokwi is unreachable" when the real cause was slow simulation plus a blocked queue.

---

## 6. Observation methods, ranked (most to least reliable)

| Grade | Method | What it proves | Reliability |
|---|---|---|---|
| ★★★ | **serial log** | where execution reached, variable values, IP, state | always available |
| ★★★ | log assertions (`--expect-text`) | the critical path was really executed | always available |
| ★★ | **OLED/LCD screenshot** | what is really displayed on screen | only parts with a framebuffer |
| ★★ | logic analyser (`wokwi-logic-analyzer`) | pin timing, PWM waveform, I2C frames | needs extra wiring |
| ★ | LED screenshot | only a 16×16 thumbnail, nearly useless | ❌ don't count on it |
| ✗ | browser automation scraping wokwi.com | blocked by network policy, frequently just fails | ❌ don't depend on it |

**Conclusion: design observability into the firmware** instead of hoping for a screenshot afterwards.

### What the firmware should print

```cpp
void setup() {
  Serial.begin(115200);
  Serial.println("[BOOT] start");        // proves the program really started
  ...
  Serial.println("[BOOT] self-test done");
  Serial.printf("[WIFI] ip=%s\n", WiFi.localIP().toString().c_str());
}
void loop() {
  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    Serial.printf("[STATUS] tick | mode=%s | duty=%d\n", mode, duty);  // proves the main loop is running
  }
}
```

Always end with `\n`, otherwise log lines glue together.

---

## 7. The standard verification loop

```bash
# 1. build
powershell -File scripts/compile.ps1 -Project <dir>
# 2. simulate + assert
powershell -File scripts/simulate.ps1 -Project <dir> -Timeout 16000 -Expect "IP:","server started"
# 3. read the log yourself
tail -40 <dir>/sim-*/serial.log
```

After three failed attempts, stop guessing and use the tree below.

---

## 8. Failure triage tree

```
no simulation output
├─ build/*.bin missing ────────→ the build failed; read the build log
├─ bin exists but serial is empty
│   ├─ wokwi.toml firmware path wrong ─→ check the filename
│   ├─ diagram.json has no $serialMonitor → add the two wires
│   └─ no Serial.begin() in the code ──────→ add it with 115200
├─ serial is garbage characters
│   └─ baud rate differs from the monitor ──→ use 115200 everywhere
├─ runs halfway then hangs
│   ├─ stuck in WiFi.begin() ─────────────→ add timeout+retry, or skip networking first
│   └─ no yield() in a tight loop ─────────→ add yield()/delay(1)
└─ Guru Meditation / panic
    ├─ null pointer / array out of bounds
    ├─ GPIO 6–11 used
    └─ read the backtrace on the first log line, cross-check 07-troubleshooting.en.md
```

---

## 9. The helper scripts

| Script | Purpose | Key behaviour |
|---|---|---|
| `scripts/compile.ps1` | build | ASCII data/build directories by default; prints the firmware size |
| `scripts/simulate.ps1` | simulate | reads the token automatically; treats exit 42 as normal; asserts with `-Expect` |
| `scripts/check-env.ps1` | self-check | checks toolchain, token format, core, Node |

All `.ps1` files are **pure ASCII** on purpose: Windows PowerShell 5.1 reads BOM-less UTF-8 as GBK, and non-ASCII characters cause an immediate parse failure (`unexpected token }`). Keep them ASCII when editing.
