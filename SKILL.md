---
name: wokwi-builder
description: 用自然语言在 Wokwi 在线仿真器里搭建、编译并运行 ESP32 / Arduino / 树莓派 Pico 电路，支持从零基础起步。当用户说 "wokwi: ..."、"用 wokwi 模拟..."、"生成一个 wokwi 项目/电路"、"在 wokwi 里跑一下..."，或提到 ESP32/LED 呼吸灯/按键/传感器/舵机/OLED/温湿度/远程开关等硬件仿真需求时使用。负责需求→选型→diagram.json+sketch.ino→本地编译→Wokwi 无头仿真→回收串口日志→生成可交互结果查看器，全链路闭环。 / Build, compile and run ESP32 / Arduino / Raspberry Pi Pico circuits in the Wokwi online simulator from natural language. Use when the user says "wokwi: ...", "simulate with wokwi", "generate a wokwi project/circuit", or mentions ESP32, breathing LED, button, sensor, servo, OLED, temperature/humidity or a web remote switch. Owns the full loop: requirement → part selection → diagram.json + sketch.ino → local build → headless Wokwi simulation → serial log capture → interactive result viewer.
license: MIT
metadata:
  version: "1.0.0"
  compatibility: "需要 wokwi-cli（含 `wokwi-cli mcp`）与 WOKWI_CLI_TOKEN；本地编译需要 arduino-cli + esp32 核心。Node 18+ 用于校验脚本。"
  tags: "wokwi, esp32, arduino, simulation, hardware, iot"
---

# Wokwi Builder

[中文](SKILL.zh.md) | **English**

Turn one sentence of natural language into a circuit project that **actually runs in Wokwi**, and deliver the result as an interactive page.

The target audience includes **people with no hardware background at all**: the user should not need to know what GPIO, resistors or PWM are — you do the translation.

> Every `scripts/`, `references/` and `assets/` path below is **relative to this skill directory** (after installation: `~/.workbuddy/skills/wokwi-builder/` or `~/.claude/skills/wokwi-builder/`). Resolve them to absolute paths when you execute.

---

## 0. Check the environment first (once per new session / new machine)

Never assume the tools exist from memory. Run:

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
# macOS / Linux
bash scripts/check-env.sh
```

- Any `FAIL` → install step by step following `references/02-environment.md`, and **finish installing before doing anything else**.
- Start taking requirements only when everything is `PASS`.
- If the machine has no tools at all, you can still **produce files only** (`sketch.ino` + `diagram.json`) and let the user paste them into the wokwi.com web editor — that is the zero-dependency fallback path.

---

## 1. Parse the requirement and select parts

Do three things, then **pick sensible defaults and move on** — do not interrogate the user with a chain of questions:

1. **Break down the function**: input (sensor / button / network), processing (logic / state machine), output (LED / display / servo / relay).
2. **Pick a board**: decision tree in `references/03-hardware-selection.md`. Default is **ESP32 DevKit C** (`board-esp32-devkit-c-v4`).
3. **Check the table**: confirm every part **has a model** in Wokwi (part table in `references/04-diagram-schema.md`). If a model does not exist, take the fallback path (equivalent substitute / signal injection / mark as "out of simulation scope") and **tell the user honestly**.

The selection result must be expressible as three columns — "requirement → choice → reason" — and end up in the viewer (`CFG.selection`) so the user can see why you chose it.

---

## 2. Produce the project files

Generate under `<workspace>/wokwi-projects/<project-name>/`:

| File | Purpose | Key points |
|---|---|---|
| `sketch.ino` | Arduino C++ firmware | ESP32 logic level is 3.3V; GPIO numbers are not physical pin order |
| `diagram.json` | Circuit topology | **Read** `references/04-diagram-schema.md` **before writing**; an LED must have a 220–330Ω series resistor |
| `wokwi.toml` | Tells wokwi-cli where the firmware is | `firmware = 'build/sketch.ino.bin'` |
| `libraries.txt` | Third-party libraries (optional) | One per line, e.g. `Adafruit SSD1306` |
| `sim-viewer.html` | Result viewer (produced in step 5) | Derived from `assets/viewer-template.html` |

**The firmware must carry its own observability** — that is the only "eye" you have in a headless simulation:

- `Serial.begin(115200)` plus `println` at key points (boot, self-test, IP, status, periodic reports).
- A power-on self-test (LED breathes twice / three lamps light in turn) so "did it start" is decidable by eye and by log.
- Network projects: print `WiFi.localIP()` and implement timeout plus retry.
- Stateful projects: print one status line every 1–2 seconds (`[STATUS] tick | mode=BREATHE | duty=207`).

---

## 3. Build locally (mandatory for ESP32 Arduino)

**Hard fact: wokwi-cli will not compile ESP32 Arduino code for you — you must supply the firmware.** (ESP-IDF / Pico SDK can be inferred automatically; Arduino cannot.)

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/compile.ps1 -Project <project-dir>
# macOS / Linux
bash scripts/compile.sh <project-dir>
```

- Success criterion: `build/<name>.ino.bin` exists and its size is plausible (200 KB–1 MB for a simple ESP32 project).
- **The build directory must be a pure ASCII path**: `ld.exe` fails on non-ASCII paths (`cannot open output file ... .elf`). The scripts default to `C:/wokwi-toolchain/build`.
- Do not waste simulation runs before the build passes.

---

## 4. Run the simulation and collect evidence

```bash
powershell -ExecutionPolicy Bypass -File scripts/simulate.ps1 -Project <project-dir> -Timeout 16000 -Expect "IP:","[HTTP] server started"
```

Or use the configured Wokwi MCP (`start_simulation` / `get_serial_output`). Flags and traps are in `references/05-build-and-simulate.md`; the four that matter:

| Fact | Meaning |
|---|---|
| `--timeout` is in **simulated milliseconds** | not wall-clock time |
| Local simulation is **1.5–5× slower** than real time (project dependent) | 16000 simulated ms may take 25–80 s |
| Continuously running projects end with **exit 42** | that is normal; passing means the target lines are in the log |
| `--screenshot-part` only works on parts with a framebuffer | an LED gives a 16×16 thumbnail; a full-canvas shot with no part is often 0 bytes |

So the acceptance criterion is always **an assertion on the serial log**, never "it looked like it ran".

---

## 5. Generate the interactive result viewer (the real deliverable)

wokwi-cli is headless, does not create web projects, and cannot capture the whole canvas. The most reliable way to let the user "see and operate" it is a local viewer:

1. Copy `assets/viewer-template.html` → `<project-dir>/sim-viewer.html`.
2. Edit `CFG` (actors / sequence / selection / rawLog) following `references/06-viewer.md`.
3. **Do not paste the two raw text blocks by hand** — let the tool write them:
   ```bash
   node scripts/sync_embed.js <project-dir>     # real .ino / diagram.json -> the page's text/plain blocks
   ```
4. **Never draw the circuit - render it**: the PCB-VIEW block parses `diagram.json` and renders the real board, pins and wires, with LED brightness driven by page state, click-to-switch, and hover-to-identify wires. To change the renderer, edit `scripts/pcbview.js` and run `node scripts/sync_pcbview.js`.

4b. **If the project gets a body, it gets `enclosure.json`** (see `references/09-enclosure.md`). `diagram.json` has no physical scale, so where the board actually sits, whether the USB plug reaches with the lid on, and whether the sonar is standing on anything are all unknowable from it. Write `enclosure.json` in millimetres, then:
   ```bash
   node scripts/check_enclosure.js <project-dir> --parts   # every part's real box, and every reason it cannot print
   node scripts/sync_embed.js <project-dir>                # enclosure.json -> the page's encSrc block
   node scripts/sync_enclosure.js                          # enclosure.js -> every page
   ```
   The page then grows a card with **外观 / 剖视 / 爆炸 / 下载 .stl**, all rendered from that one file, with the checker's findings printed on the card. No body (breadboard project, bare frame)? Leave the block empty — the card hides itself, and `sync_embed.js` blanks it so another project's box cannot leak in.

   > A duck, a grey box or three bulbs is not a circuit: the reader cannot see which pin goes where, and a drawing **hides a broken `diagram.json`** (a wrong pin name makes the renderer skip that wire; a drawing shows it anyway). `verify_viewer.js` fails when the page never calls `PcbView.render(`.
5. **Three checks are mandatory**:
   ```bash
   node scripts/verify_viewer.js <project-dir>              # code byte-identical to the real files + JS syntax
   node scripts/domrun.js <project-dir>/sim-viewer.html     # fake DOM really runs boot(); error count must be 0
   node scripts/check_circuit.js <project-dir>              # geometry + pins + labels: crossings 0, UNRESOLVED 0, labels complete, shared <= 1%
   ```
6. Open the preview with `present_files`.

**Seven hard rules for the viewer (each learned the hard way — break one and it explodes)**:

1. The `.ino` / `diagram.json` on the page must be the **verbatim source that actually compiled**; not a single function, macro or global may be removed.
2. **Never carry C/C++ code inside a JS template literal** (`\n` becomes a real newline in JS, and after the user copies it Wokwi reports `missing terminating ' character`). Use a `<script type="text/plain" id="inoSrc">` raw text block instead.
3. Verification must **simulate how the browser reads the value** (normalise exactly like `rawSrc()` and compare); reading the HTML source directly gives false positives.
4. When editing an existing page, replace only **the target range** — do not use truncation like `slice(0, lastIndexOf('<script>'))`, which also deletes definitions such as `CFG`, leaving a blank page that no syntax check will catch.
5. **The circuit must come from `PcbView.render(diagram)`.** A working serial log does not prove the wiring: firmware never checks hardware, and `digitalWrite` to an unconnected pin returns happily. `UNRESOLVED` in `check_circuit.js` is the only evidence that it is wired right.
6. **The picture must say what each part is and which leg is which, and two unrelated wires may never share a line.** Every non-board part prints its `id` + exact type + every pin name; `labels=` in `check_circuit.js` must equal what `diagram.json` declares and `shared=` must stay at or under 1% (`bus=` is a junction out of one pin — reported only).

7. **The enclosure card must be rendered from `enclosure.json`, never drawn, and it must show the checker's verdict.** A hand-drawn box with the right number of holes says nothing about whether the board fits; `verify_viewer.js` fails a page that carries an enclosure without calling `Enclosure.render(`. The card's metadata line must not claim "all placed, no interference" while `problems` is non-empty.

Details and counter-examples are in `references/06-viewer.md`.

---

## 6. Deliver and iterate

Give the user three things:

1. **Something to look at**: the `sim-viewer.html` opened by `present_files` (real log + animation + clickable buttons + circuit connection table + selection rationale).
2. **Something to reproduce**: the `.ino` / `diagram.json` in the project directory, plus two-step instructions for pasting them into wokwi.com.
3. **Something to change**: one sentence saying "tell me which symptom you want different and I'll change it".

When the user is unhappy, iterate in this order — `selection → wiring → code → rebuild → re-simulate → update viewer` — never change only the picture without changing the real code.

---

## Key constraints (check each line while writing code or wiring)

- ESP32 logic level is **3.3V**; GPIO numbers ≠ physical pin order (`esp:2` is GPIO2).
- Input pins must be `INPUT_PULLUP` / `INPUT_PULLDOWN`, **never floating**.
- Wokwi does not add I2C pull-ups automatically; add 2.2 kΩ from SDA/SCL to 3V3 when needed.
- Network simulation goes through a virtual gateway and the first connection is slower than real hardware; add timeouts and retries, and call `yield()` inside long tasks.
- **Only one `.ino` per project** (two `.ino` files cause duplicate definitions).
- **Never write the Wokwi token into any generated file, log or reply.**
- Do not try to drive wokwi.com with browser automation to create a project (in practice it gets blocked by network policy, and the CLI has no project-creation API anyway).

---

## Reference index

| Document | When to read it |
|---|---|
| `references/00-quickstart.md` | First time, want a run through in 10 minutes |
| `references/01-wokwi-primer.md` | The user or you need the "Wokwi / boards / circuits" basics |
| `references/02-environment.md` | Installing wokwi-cli / token / MCP / arduino-cli / ESP32 core |
| `references/03-hardware-selection.md` | Deciding the board, the parts, and whether Wokwi has a model |
| `references/04-diagram-schema.md` | **Mandatory before writing `diagram.json`** |
| `references/05-build-and-simulate.md` | Build failures, simulation flags, ways to observe |
| `references/06-viewer.md` | Generating or editing `sim-viewer.html` |
| `references/07-troubleshooting.md` | First place to look for any error |
| `references/08-examples.md` | Want to see the four complete worked examples |
| `references/09-enclosure.md` | Giving the project a 3D-printed body: `enclosure.json`, the fit checks, the STL |

Runnable projects included: `examples/traffic-light/` (pure GPIO state machine), `examples/remote-switch/` (WiFi + HTTP + PWM), `examples/servo-ring/` (Mega + 32 servos + 98 wires, a complex-project stress test), `examples/duck-robot/` (LED/servo/buzzer/ultrasonic together, plus scenario injection).

> Every reference also exists in English with the `.md` suffix, e.g. `references/06-viewer.md`.
