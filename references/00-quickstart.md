# 00 · Get through the first run in ten minutes

[中文](00-quickstart.zh.md) | **English**

This document gives **someone who has never touched Wokwi or a dev board** the shortest possible path. When you finish it you will know: what this thing actually does, what to type first, and how to tell whether it worked.

---

## Understand three things first (30 seconds)

1. **Wokwi is a fake circuit board inside a web page.** You paste in "circuit + code" and it simulates in the browser — LEDs light up, the serial console prints, even WiFi is simulated. Nothing burns, nothing costs money.
2. **A Wokwi project has only two core files**:
   - `diagram.json` — what the circuit looks like (board, parts, who connects to whom)
   - `sketch.ino` — the program running on the board
3. **What this skill does**: you describe a requirement → it writes those two files → compiles locally → pushes to Wokwi → turns the real serial log and runtime result into a clickable page for you.

---

## Route A: install nothing, just see it work (recommended the first time)

**Goal**: within 5 minutes, watch a lamp blink in the browser according to your code.

1. Open <https://wokwi.com>, click `Sign In` in the top right (you can run without signing in, but saving needs an account).
2. Click `+ New Project` (or go straight to <https://wokwi.com/projects/new/esp32>) → choose **ESP32 DevKit C**.
3. On the left there are two tabs: **diagram.json** and **sketch.ino**.
4. Paste the **entire** contents of this repo's `examples/traffic-light/diagram.json` into the diagram.json tab (it draws the board and three lamps automatically).
5. Paste the **entire** contents of `examples/traffic-light/traffic-light.ino` into the sketch.ino tab.
6. Click the green ▶ button at the top.

**What you should see**: three lamps cycling green → yellow → red, and the `Serial Monitor` at the bottom printing

```
=========================================
  ESP32 Traffic Light  (demo, no libs)
  cycle: GREEN 4s -> YELLOW 1s -> RED 4s
=========================================
[BOOT] self-test done
[TRAFFIC] GREEN  ON  (4s)
[TRAFFIC] YELLOW ON  (1s)
[TRAFFIC] RED    ON  (4s)
```

Seeing that means **you have closed Wokwi's core loop**. Everything else is automation.

> Note: the code file in Wokwi must be called `sketch.ino`. This repo's `traffic-light.ino` only differs in filename; paste the content as-is. **One `.ino` per project** — a second one causes duplicate definitions.

---

## Route B: install the toolchain and let the AI do it end to end (recommended long term)

**Goal**: say one sentence; the AI compiles, simulates, and opens the result page itself.

### B1. Install the skill

```powershell
# Windows
cd <this-repo>
powershell -ExecutionPolicy Bypass -File install.ps1
```
```bash
# macOS / Linux
cd <this-repo> && ./install.sh
```

### B2. Install the toolchain and self-check

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
```
```bash
bash scripts/check-env.sh
```

For every line that says `FAIL`, follow the matching section of `references/02-environment.md`. Repeat until **everything is PASS**.

### B3. Describe the requirement

```
wokwi: build an ESP32 traffic light, green 4 seconds, yellow 1 second, red 4 seconds
```

### B4. Decide whether it "really worked" (important)

The AI gives you a clickable result page. You should also be able to verify it yourself, on three things:

| Evidence | Where to look | Meaning |
|---|---|---|
| The firmware really built | `build/*.ino.bin` in the project directory | 200 KB–1 MB; 0 bytes means failure |
| The serial port really produced output | `sim-*/serial.log` in the project directory | contains real prints such as `[BOOT]`, `[TRAFFIC]` |
| The page really runs | `sim-viewer.html` | lamps move, serial panel scrolls, buttons respond |

**Only an assertion in the serial log counts as "it ran"**; a pretty page does not.

---

## One complete manual pass (to understand what the automation is doing)

```bash
# 1. create the project directory
mkdir -p wokwi-projects/my-led && cd wokwi-projects/my-led

# 2. write three files
#    sketch.ino    -- the program
#    diagram.json  -- the circuit
#    wokwi.toml    -- tells the CLI where the firmware is

# 3. build (ESP32 Arduino must be built by you; wokwi-cli will not do it)
powershell -File ../../scripts/compile.ps1 -Project .
#    -> build/my-led.ino.bin

# 4. run the simulation and capture the serial log
powershell -File ../../scripts/simulate.ps1 -Project . -Timeout 8000 -Expect "BOOT"

# 5. read the log
cat sim-*/serial.log
```

Contents of `wokwi.toml` (the filename must match the build output):

```toml
[wokwi]
version = 1
firmware = 'build/my-led.ino.bin'
```

---

## The five traps you are most likely to hit (knowing them saves two hours)

| Symptom | Cause | One-line fix |
|---|---|---|
| `'xxx' was not declared in this scope` | the code was "simplified" and a definition was dropped | always use the **verbatim source that compiles** |
| `missing terminating ' character` | the code went through a JS template literal and `\n` became a real newline | use a `<script type="text/plain">` raw block |
| `Error during build: exit status 1` and the board is not found | the ESP32 core is not installed | `arduino-cli core install esp32:esp32` |
| build fails with `cannot open output file` / `cannot find -l<lib>` | the **build path contains non-ASCII characters**; `ld.exe` cannot handle it | use a pure ASCII build directory (the scripts already do) |
| the simulation seems stuck / times out | `--timeout` is **simulated milliseconds** and this machine is about 1.5–5× slower | 8000 simulated ms ≈ 12–40 s of real waiting |

More in `references/07-troubleshooting.md`.

---

## What to read next

- Want to understand "why does an LED need a resistor" or "what is GPIO" → `01-wokwi-primer.md`
- Need to install the environment → `02-environment.md`
- Need to write your own `diagram.json` → `04-diagram-schema.md`
- Need to change the result page → `06-viewer.md`
