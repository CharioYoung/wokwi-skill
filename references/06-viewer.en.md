# 06 · Result viewer: turning a headless simulation into a page you can see and click

[中文](06-viewer.md) | **English**

## Why it exists

`wokwi-cli` is a headless tool:

- it does not create a wokwi.com web project and returns no viewable URL;
- `--screenshot-part` only works on parts **with a display framebuffer** (OLED/LCD);
- simple parts such as an LED only yield a **16×16 thumbnail** (measured: 101 bytes), and without a part the file is often 0 bytes.

So the most reliable way to "let a human see and interact with it" is: **drive a local HTML page with the real serial log**, then open it with `present_files`.

The timing, states and values on the page all come from the real simulation log. The circuit picture is not decoration either: it is **rendered from `diagram.json`** (section 3), so the drawing cannot disagree with how the circuit is actually wired.

---

## 1. File structure (template convention)

```html
<script type="text/plain" id="inoSrc">   full .ino source (the browser does not interpret escapes)
</script>
<script type="text/plain" id="diaSrc">   full diagram.json source
</script>
<script>
/* === PCB-VIEW BEGIN ===  circuit renderer (generated from scripts/pcbview.js - do not edit here)
   PcbView.render(diagram, {brightness}) -> {svg, audit} */
/* === PCB-VIEW END === */
</script>
<script>
function rawSrc(id){ ... }
const INO = rawSrc("inoSrc");
const DIA = rawSrc("diaSrc");

const CFG = { name, actors[], sequence[], selection[], rawLog };   // <- must come before the renderer

/* page logic: drawPcb / setOne / setState / runAuto / log /
   renderNetlist / showTab / copyFile / boot */
</script>
```

`assets/viewer-template.html` already has this structure — copy it.

**Two sync tools (never copy by hand):**

| Command | What it does |
|---|---|
| `node scripts/sync_embed.js <projectDir>` | writes the real `.ino` / `diagram.json` into the page's two `text/plain` blocks |
| `node scripts/sync_pcbview.js` | writes `scripts/pcbview.js` into the PCB-VIEW block of every page |

Both accept `--check` (verify only); that is what CI runs. Pasting a `.ino` by hand has already caused one incident (a trimmed "demo" build produced `selfTest was not declared`), so the tool owns that step.

---

## 2. Customising from scratch: only edit CFG

### 2.1 `actors` — how many "things get driven"

```js
actors: [
  { id:"red",    label:"Red",    gpio:25, color:"#ef4444", on:"#ff5f57" },
  { id:"yellow", label:"Yellow", gpio:26, color:"#f59e0b", on:"#fbbf24" },
  { id:"green",  label:"Green",  gpio:27, color:"#22c55e", on:"#34d399" }
]
```

- `id` **must exactly match the part `id` in `diagram.json`** (the renderer maps by it);
- `gpio` is silkscreen text, display only;
- `color` is the off colour, `on` the lit colour.

### 2.2 `sequence` — the automatic cycle

```js
sequence: [
  { on:"green",  dur:4000, label:"GREEN" },
  { on:"yellow", dur:1000, label:"YELLOW" },
  { on:"red",    dur:4000, label:"RED" }
]
```

`dur` must be the **milliseconds from the real firmware** (`delay(4000)` → 4000). Projects without an automatic cycle use an empty array and rely on buttons.

### 2.3 `rawLog` — the real serial log

Paste the contents written by `--serial-log-file` **verbatim**. This is evidence, not decoration.

```js
rawLog: `=========================================
  ESP32 Traffic Light  (demo, no libs)
  cycle: GREEN 4s -> YELLOW 1s -> RED 4s
=========================================
[BOOT] self-test done
[TRAFFIC] GREEN  ON  (4s)`
```

### 2.4 `selection` — why these parts

```js
selection: [
  { need:"MCU that runs a state machine with observable serial", choice:"ESP32 DevKit C", reason:"enough GPIO; serial built in; Wokwi part = board-esp32-devkit-c-v4" },
  { need:"red/yellow/green indicators", choice:"wokwi-led x3", reason:"Wokwi only ships single-colour LED models; three parts with different color is the clearest" }
]
```

### 2.5 The two raw text blocks

**Paste the full, real `.ino` and `diagram.json` from the project** — not one character changed (see hard rule 1).

---

## 3. The circuit picture is rendered, not drawn

The first version was a CSS mock ("a grey box plus three bulbs"). It looked fine but had **no pin names and no wires**, which makes it an illustration: you cannot check a connection against it, and it never explains why GPIO25 drives the red LED. It is now rendered from `diagram.json`.

### 3.1 Where the data comes from

| What | Source |
|---|---|
| part `top` / `left` / `attrs` | the project's own `diagram.json` |
| LED and resistor outline plus pin positions | Wokwi's open-source `@wokwi/elements` (MIT) |
| resistor colour bands | the official colour table, computed from `value` (`330` -> orange-orange-brown) |
| 9.5-unit header pitch | reverse-engineered from the 19 pin `y` values in the official part; it equals the real 2.54 mm |
| wire endpoints and colours | read from `connections`; green = signal, black = GND |

The board outline is drawn here: the open-source package only ships the 30-pin `esp32-devkit-v1`, while diagrams use the 38-pin `board-esp32-devkit-c-v4`, so the board is rebuilt on the real 2.54 mm header grid.

### 3.2 Routing rules

Wires are always **orthogonal polylines**. They leave a pin, step clear of the board, then run outside it — **never across the PCB**:

- both ends on the same header side -> simple Z shape;
- one end on a header, the other outside on the same side -> step straight out;
- ends on opposite sides -> wrap around the nearer horizontal edge, each wire taking its own lane so they never stack into one thick band;
- vertical runs are also given a channel count derived from the free space (`VMAX`), so a dense diagram tightens up instead of ploughing through the parts beside the board.

`PcbView.render()` returns `audit.crossings` as a hard number: a Liang-Barsky segment/rectangle test flags every segment that overlaps the board footprint (except the pin's own short stub). CI runs this, and a non-zero count fails the build.

### 3.3 Interaction

- **LED brightness** follows page state via `PcbView.setBrightness(host, partId, 0..1)`; a PWM project just feeds `duty/255`;
- clicking a lamp in the drawing switches to that lamp's manual mode;
- hovering a wire shows `from -> to` (SVG `<title>`);
- the "zoom" button widens the drawing to the full column so the pin names are readable.

### 3.4 Things not to do

- **Do not hand-edit the drawing for one project.** It follows `diagram.json`; editing it by hand means lying.
- **Do not hand-edit the PCB-VIEW block.** It is generated from `scripts/pcbview.js`; edit that and run `node scripts/sync_pcbview.js`.
- The element library currently covers the ESP32 board, `wokwi-led` and `wokwi-resistor`. To add a button, servo or OLED, add that part's pin coordinates to `pinsOf()`; an unknown part returns `{}`, so its wires are skipped rather than drawn in the wrong place.

---

## 4. The four hard rules (each paid for in blood)

### Hard rule 1: it must be the verbatim source that actually compiled

**What happened**: a "simplified display version" was put on the page (it called `selfTest()` but the definition had been removed). The user copied it into Wokwi and got:

```
error: 'selfTest' was not declared in this scope
```

A display version is not a compilable version. Functions, macros and globals — none may be removed. Comments may be trimmed.

### Hard rule 2: never carry C/C++ code in a JS template literal

**What happened (subtler)**:

```js
const INO = `... String cmd = Serial.readStringUntil('\n'); ...`
```

When the browser parses the template literal, `\n` becomes a **real newline**, so what the user copies is:

```cpp
String cmd = Serial.readStringUntil('
');
```

Wokwi then reports:

```
error: missing terminating ' character
```

Any C/C++ code containing `\n` `\r` `\t` `\"` `\\` is affected. **JS escaping rules are not C escaping rules.**

The correct form:

```html
<script type="text/plain" id="inoSrc">
...the entire source...
</script>
<script>
function rawSrc(id){
  const el = document.getElementById(id);
  if (!el) return "";
  return el.textContent.replace(/^\r?\n/, "").replace(/\s+$/, "") + "\n";
}
const INO = rawSrc("inoSrc");
</script>
```

The benefit: **what the page shows = what the clipboard copies = the original file**, guaranteed.

### Hard rule 3: verification must simulate how the browser reads the value

**What happened**: a regex pulled `const INO = \`...\`` out of the HTML **source text** and compiled it — but it extracted the two characters `\` + `n` (which is how the source stores it), so compilation passed. A **false positive** that hid the real bug.

You must read `textContent` with the same normalisation as `rawSrc()`, compare **byte for byte** with the real file, and only then compile:

```bash
node scripts/verify_viewer.js <project-dir>
```

### Hard rule 4: editing an existing page must be surgical

**What happened**: a batch replacement used `html.slice(0, html.lastIndexOf('<script>'))` as the prefix — which is equivalent to **discarding everything between `<script>` and the target position**. The traffic-light page happened to place `const CFG` before `const INO`, so CFG was deleted wholesale and the page opened blank (`CFG is not defined`), while `node --check` **could not catch it** (the syntax was valid).

Rules:

1. replace only the target range (`const INO = \`` through `` \`; ``), never truncate from a tag;
2. compare the number of top-level definitions in the script before and after;
3. always run the runtime check afterwards:

```bash
node scripts/domrun.js <project-dir>/sim-viewer.html
```

It really executes `boot()` in a fake DOM and reports lamp count, netlist characters, selection-table characters, code length, serial line count and **error count**.

**Acceptance: the error count must be 0**, the tower lamp count must match the design, and the netlist/selection tables must be non-empty.

---

## 5. Adapting to different project types

| Project type | What to change |
|---|---|
| **Digital** (LED/relay/buzzer) | use the lamp helper `setOne(id,on)`; put per-state durations in `sequence` |
| **PWM** (breathing/dimming) | replace `setOne` with opacity + `box-shadow` driven by duty; log `duty=` |
| **Sensors** (DHT/photoresistor/potentiometer) | swap the lamp area for a gauge or bar; `sequence` becomes periodic sampling with real values from the log |
| **OLED/LCD** | a **real screenshot** is possible (framebuffer): `--screenshot-part <id> --screenshot-file shot.png`; additionally draw a "screen" in the page and replay the text |
| **Servo/motor** | draw an angle or speed indicator; `sequence` drives the angle |
| **Network projects** | add a "simulate request" button that appends log lines such as `[HTTP] GET /on -> 200` |

---

## 6. The four anti-black-box sections that must be present

Built into the template — do not delete them:

1. **Circuit connection table** — `JSON.parse(DIA)` at runtime and list every `parts` and `connections` entry so the user can verify each wire.
2. **Per-file copy** — two buttons: "① copy code → paste into sketch.ino" and "② copy circuit → paste into diagram.json", making clear which file goes into which tab.
3. **Direct link to a blank project** — opens `https://wokwi.com/projects/new/esp32`. Explain that Wokwi has no "run code from a URL" API, so a new project is always blank and pasting is required.
4. **Selection rationale table** — `CFG.selection`, one row per "requirement → choice → reason".

The drawing area must state its **data source**; the template says "rendered live from diagram.json, with real pins and wires". That is true (section 3), but it must not be read as "rendered by Wokwi" — this is not Wokwi's rendering engine and there is no live electrical simulation behind it.

---

## 7. Interaction design principles

- clicking a button **immediately** changes the picture and appends a log line at the same time (equivalent to the firmware receiving a command);
- keep both "auto" and "manual" modes and show the current state plus remaining time / reading;
- put a "simulation passed (real log replay)" badge at the top, and provide an expandable "view raw serial log" evidence block;
- keep log timestamps at the real pace — do not fast-forward into distortion.

---

## 8. Pre-delivery checklist

- [ ] `verify_viewer.js` reports `INO identical ... [PASS]` and `DIA identical ... [PASS]`
- [ ] `domrun.js` reports `errors: 0`
- [ ] tower lamp count = `CFG.actors.length` = the number of matching parts in `diagram.json`
- [ ] netlist and selection tables are non-empty
- [ ] the serial panel content equals the real `serial.log` in the project
- [ ] no leftover debug output of `CFG` / `DIA` / `rawSrc`
- [ ] the drawing area states its data source (rendered from diagram.json, not the Wokwi engine)
- [ ] no token anywhere on the page

---

## 9. Common failures

| Symptom | Cause | Fix |
|---|---|---|
| opens completely blank, console says `CFG is not defined` | truncated during editing | restore `const CFG`, run `domrun.js` |
| lamp does not render | `actors.id` does not match the id in `diagram.json` | align them character by character |
| copying the code into Wokwi reports a missing function | a simplified version was used | switch back to the compiled source |
| copying reports `missing terminating ' character` | a JS template literal was used | switch to a `text/plain` block |
| netlist table is blank | `DIA` is empty or JSON parsing failed | check the `diaSrc` block is complete |
| `domrun.js` reports `requestAnimationFrame is not defined` | the test stub is incomplete | that is a script problem, not a page problem — extend the stub |
