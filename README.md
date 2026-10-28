# wokwi-skill

[中文](README.zh.md) | **English**

[![verify](https://github.com/CharioYoung/wokwi-skill/actions/workflows/verify.yml/badge.svg)](https://github.com/CharioYoung/wokwi-skill/actions/workflows/verify.yml)

> In one sentence: **say what you want, get a circuit that actually runs in Wokwi.**

```
You: wokwi: a button-controlled servo pan mount — press to 90 degrees, press again to 0
AI:  parse intent → pick parts (ESP32 + wokwi-servo + pushbutton)
     → write diagram.json / sketch.ino
     → compile locally with arduino-cli (947 KB firmware)
     → run a headless wokwi-cli simulation and capture the real serial log
     → generate an interactive viewer and open it: the servo really turns,
       the serial console really scrolls, every wire can be checked line by line
```

This is not "ask a model to write some Arduino code". It **compiles for real, simulates for real, and hands back the real serial log plus real GPIO behaviour** — and lays the process open: why this chip, where this wire goes, and whether the code you copy into Wokwi will actually build.

---

## Live demos (click and it renders — nothing to install)

All four pages are **viewers produced after a real simulation run**, not screen recordings: lamp timing is driven by the firmware's own logic, the serial panel replays the raw log from a headless Wokwi run, and the `sketch.ino` / `diagram.json` embedded in the code panel are byte-identical to the sources that compiled.

| Demo | What it shows | Open it |
|---|---|---|
| 🚦 **ESP32 traffic light** | Pure GPIO, no third-party library. 4 s green → 1 s yellow → 4 s red, manual override | **<https://charioyoung.github.io/wokwi-skill/examples/traffic-light/sim-viewer.html>** |
| 💡 **ESP32 remote switch + breathing LED** | WiFi + HTTP server + PWM, `/on` `/off` `/breathe` endpoints | **<https://charioyoung.github.io/wokwi-skill/examples/remote-switch/sim-viewer.html>** |
| 🎡 **32-servo ring (Mega)** | 33 parts, 98 connections, four clickable sequences; the `diagram.json` was printed by a real simulation and matches byte for byte | **<https://charioyoung.github.io/wokwi-skill/examples/servo-ring/sim-viewer.html>** |
| 🦆 **Duck robot (many actuators)** | 9 parts, 18 wires: LED eyes + servo legs + buzzer + HC-SR04, zero third-party libraries; `scenario.yaml` drives the distance so the log proves the avoid branch ran | **<https://charioyoung.github.io/wokwi-skill/examples/duck-robot/sim-viewer.html>** |

Landing page with all four links and the doc index: <https://charioyoung.github.io/wokwi-skill/>

> Why not a wokwi.com link? See the FAQ below — `wokwi-cli` has no API for creating a web project, so this project ships a **viewer driven by real logs** instead, plus a 30-second migration path ("copy code / copy circuit" → "open a blank Wokwi project").

---

## What problem this skill solves

Wokwi (<https://wokwi.com>) is a great online hardware simulator, but wiring it into an AI workflow hits three hard walls. This project hit all of them and ships reproducible fixes:

| Wall | The truth | How this skill fixes it |
|---|---|---|
| AI-generated code won't compile in Wokwi | Models love to "simplify for display" and drop function definitions | **Verbatim source + byte-for-byte regression check** (`scripts/verify_viewer.js`) |
| `wokwi-cli` won't run | It does **not compile ESP32 Arduino** — you must supply a firmware binary | `scripts/compile.ps1` builds locally in one step, with non-ASCII path avoidance |
| Everything is "headless", you never see it | The CLI only returns serial output; screenshots only work on parts with a framebuffer | **Interactive result viewer** (real log replay + animation + buttons) |

There is also a hidden trap: putting C code inside a JS template literal makes `'\n'` become a real newline, so whatever the user copies is guaranteed to fail with `missing terminating ' character`. This class of "looks right, breaks when copied" bug is closed off completely here with raw text blocks plus a runtime fake-DOM check.

---

## Quick start

### 1. Install the skill

```powershell
# Windows PowerShell
git clone https://github.com/CharioYoung/wokwi-skill.git
cd wokwi-skill
powershell -ExecutionPolicy Bypass -File install.ps1
```

```bash
# macOS / Linux
git clone https://github.com/CharioYoung/wokwi-skill.git
cd wokwi-skill && ./install.sh
```

The installer copies the project to `~/.workbuddy/skills/wokwi-builder` (or `~/.claude/skills/wokwi-builder`) and keeps `references/`, `scripts/` and `assets/`.

### 2. Install the toolchain (once)

```bash
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1   # see what is missing
```

Follow `references/02-environment.md` to fill in three things: `wokwi-cli` (+ token), `arduino-cli`, and the `esp32` core. All `PASS` means you are done.

### 3. Ask for something

In any AI client that supports skills:

```
wokwi: design a voice-controlled air conditioner switch
wokwi: a small desktop display with temperature/humidity + OLED
wokwi: an ESP32 traffic light, green 4s, yellow 1s, red 4s
```

The AI follows the six steps in `SKILL.md` and ends by opening a clickable result page.

### 4. Don't want to install anything?

That works too. Ask the AI to produce only `sketch.ino` + `diagram.json`, then create an ESP32 project on wokwi.com yourself and paste them in — `references/00-quickstart.md` has a five-step walkthrough with screenshots of the UI.

---

## What it can and cannot do

**Can do** (verified end to end)

- Pure GPIO state machines: traffic light, running lights, button debouncing
- PWM: breathing LED, dimming, servo angles
- WiFi + HTTP: web remote switch, status queries
- I2C: SSD1306 OLED text output
- Analog input: potentiometer, photoresistor, DHT11/22 temperature and humidity
- Fallbacks for parts Wokwi has no model for: equivalent substitutes / serial injection / explicitly marked "out of simulation scope"

**Cannot do** (it will say so plainly instead of pretending)

- Create a wokwi.com web project automatically and hand you a public URL (the CLI has no such API, and browser automation gets blocked on restricted networks)
- Projects with very tight real-time requirements (local simulation runs roughly 1.5–5× slower than wall clock)
- Parts that simply do not exist in Wokwi's component library (e.g. some specific voice chips — those need a fallback plan)

---

## Repository layout

```
wokwi-skill/
├── SKILL.md                     # Skill entry point: six-step workflow + hard rules (English, default)
├── SKILL.zh.md                  # Chinese version of the skill entry point
├── README.md                    # English (this file)
├── README.zh.md                 # Chinese
├── index.html                   # GitHub Pages landing page (live demos)
├── LICENSE                       # MIT
├── .gitattributes / .gitignore   # line-ending normalisation / ignored artifacts
├── .github/workflows/verify.yml  # CI: syntax + consistency + runtime, three-way check
├── install.ps1 / install.sh     # install into an agent's skills directory
├── references/                  # knowledge base (loaded on demand; every file has a .zh.md twin)
│   ├── 00-quickstart.md         #   get through the first run in 10 minutes
│   ├── 01-wokwi-primer.md       #   zero background: Wokwi / boards / GPIO / circuits
│   ├── 02-environment.md        #   toolchain install and repair
│   ├── 03-hardware-selection.md #   selection decision tree + fallback strategy
│   ├── 04-diagram-schema.md     #   diagram.json format and part table (read before writing)
│   ├── 05-build-and-simulate.md #   compiling, simulation flags, ways to observe
│   ├── 06-viewer.md             #   viewer spec (the hard rules, incl. §3.4 "things not to do")
│   ├── 07-troubleshooting.md    #   error encyclopaedia (12 real cases)
│   ├── 08-examples.md           #   full walkthrough of the examples
│   └── 09-enclosure.md          #  3D-printed body: enclosure.json, the fit checks, the STL
├── scripts/
│   ├── check-env.ps1 / .sh      # environment self-check
│   ├── compile.ps1 / compile.sh # parameterised build (ASCII path avoidance)
│   ├── simulate.ps1 / .sh       # run a simulation + assert on key log lines
│   ├── verify_viewer.js         # viewer code consistency + compilability check
│   ├── domrun.js                # fake-DOM runtime check (catches undefined crashes)
│   ├── pcbview.js               # circuit renderer: diagram.json -> real board/pins/wires
│   ├── sync_pcbview.js          # inline pcbview.js into every page (--check for CI)
│   ├── enclosure.js             # enclosure builder + fit checker (enclosure.json -> shells, STL)
│   ├── check_enclosure.js       # the gate: parts fit / ports reach / every part held / shells closed
│   ├── sync_enclosure.js        # inline enclosure.js into every page (--check for CI)
│   └── sync_embed.js            # write the real .ino / diagram.json / enclosure.json into a page (--check for CI)
├── assets/
│   └── viewer-template.html     # config-driven result viewer template
└── examples/
    ├── traffic-light/           # pure GPIO traffic light (fully runnable, has README.md + README.zh.md)
    ├── remote-switch/           # WiFi web remote switch + PWM breathing LED (fully runnable, has README.md + README.zh.md)
    ├── servo-ring/              # 32-servo ring on a Mega, 85 pins (complex-project stress test, has README.md + README.zh.md)
    └── duck-robot/              # Duck robot: LED / servo / buzzer / ultrasonic in one sketch (has README.md + README.zh.md)
                                 #   + enclosure.json: a 96x80x58 duck body that holds all nine parts
```

> **Bilingual**: the default `.md` in this repository is English; every one has a `.zh.md` Chinese twin (`README.md` ↔ `README.zh.md`, `references/06-viewer.md` ↔ `references/06-viewer.zh.md`), and each file links to its counterpart at the top via `中文 | English`.

## How it works

```
natural language
   │
   ├─ select ─────────── references/03-hardware-selection.md (decision tree + part table)
   │
   ├─ produce ────────── sketch.ino + diagram.json + wokwi.toml
   │
   ├─ compile ────────── arduino-cli (local; ESP32 must ship its own firmware)
   │                        └─ on failure → references/07-troubleshooting.md
   │
   ├─ simulate ───────── wokwi-cli --timeout N --serial-log-file log
   │                        └─ acceptance = assertions on the log, not "it looked like it ran"
   │
   └─ deliver ────────── sim-viewer.html (real log replay + animation + interaction)
                            └─ three checks: byte-identical / compiles / zero runtime errors
```

## Requirements

| Dependency | Version | Purpose | Required? |
|---|---|---|---|
| `wokwi-cli` | ≥ 0.29 | headless simulation, MCP server | yes, to run simulations automatically |
| `WOKWI_CLI_TOKEN` | starts with `wok_` | authentication (generate on your wokwi.com profile page) | same as above |
| `arduino-cli` | ≥ 1.0 | build ESP32 Arduino firmware | yes, for ESP32 projects |
| esp32 core | 3.x | board support package (~300 MB) | same as above |
| Node.js | ≥ 18 | verification scripts, viewer checks | recommended |

Generation-only mode (just produce the files and paste them into the web editor yourself) **needs no dependencies at all**.

## FAQ

**Q: Why not use Wokwi's cloud compiler directly?**
For ESP32 Arduino projects `wokwi-cli` does not compile in the cloud (only ESP-IDF/Pico support automatic inference). That is the tool's design, not a configuration mistake — which is why this project ships a local build chain.

**Q: Why is the result a local page instead of a wokwi.com link?**
`wokwi-cli` has no API for creating a web project. The local viewer is driven by the **real serial log**: you can look at it, click it, and verify every wire — which beats waiting for a URL that will never exist. If you want the native experience, the viewer has "copy code / copy circuit" and "open a blank project" buttons; 30 seconds and you're there.

**Q: What if the AI breaks a page?**
`scripts/domrun.js` really executes the initialisation in a fake DOM and reports lamp count, table content and error count. A non-zero error count blocks delivery — this is written into the hard rules in `SKILL.md`.

## Contributing

PRs are welcome: new example projects (`examples/`), real error messages for `references/07-troubleshooting.md`, and additions to the part table.
When filing an issue, include the `check-env` output and the full error — not just a single line.

## License

MIT — see [LICENSE](LICENSE).
