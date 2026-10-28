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
| part `top` / `left` / `attrs` / `rotate` | the project's own `diagram.json` |
| LED, resistor and servo outline plus pin positions | Wokwi's open-source `@wokwi/elements` (MIT) |
| resistor colour bands | the official colour table, computed from `value` (`330` -> orange-orange-brown) |
| 9.5-unit header pitch | reverse-engineered from the 19 pin `y` values in the official part; it equals the real 2.54 mm |
| the Mega's 85 pin coordinates | the official `arduino-mega-element` `pinInfo`, copied verbatim into `MEGA_PINS` |
| wire endpoints and colours | read from `connections`; green = signal, red = V+, black = GND |

The board outline is drawn here: the open-source package only ships the 30-pin `esp32-devkit-v1`, while diagrams use the 38-pin `board-esp32-devkit-c-v4`, so the board is rebuilt on the real 2.54 mm header grid. A board only has to enter the `BOARDS` registry to work; there are two today:

```js
'traffic-light', 'remote-switch'  ->  board-esp32-devkit-c-v4   (38 pins)
'servo-ring'                      ->  wokwi-arduino-mega        (85 pins)
```

**An unknown board throws instead of guessing an outline:**

```js
throw new Error('diagram.json has no supported board. Known: ... ' +
  'Add one to BOARDS in pcbview.js (pin coordinates are in @wokwi/elements) instead of guessing.');
```

### 3.2 Routing rules

Wires are always **orthogonal polylines**. They leave a pin, step clear of the part, then run outside the board — **never across the PCB**:

- one end on a header, the other outside on the same side -> step straight out;
- ends on opposite sides -> wrap around the nearer horizontal edge, each wire taking its own lane so they never stack into one thick band;
- both ends outside the board (the chained servo V+/GND runs) -> propose ten standard bends, measure how much of each would land on the PCB with Liang-Barsky, and keep the one that crosses least and is then shortest;
- vertical runs are also given a channel count derived from the free space (`VMAX`), so a dense diagram tightens up instead of ploughing through the parts beside the board.

Three hard rules, all forced out by a real project:

1. **Measure the turn from the board edge, not from the pin.** The Mega's digital header is a double column and its inner column sits 13 units inside the edge; measuring "pin plus a gap" put the turn inside the footprint, and the vertical run then slid across the PCB along the header.
2. **A pin in the inner column has to lead out past the edge.** `out = min(ox - depth, bx0 - depth)` — take whichever of "from the pin" and "from the edge" is further out.
3. **A wire between two off-board parts cannot just be an L.** "Left-side servo to right-side servo V+" always cuts the board as an L; it has to wrap over the top or bottom edge.

`PcbView.render()` returns `audit` as the hard numbers:

| Field | Meaning | Requirement |
|---|---|---|
| `wires` | connections resolved and drawn | equals `connections` minus the virtual ones |
| `crossings` | segments overlapping the board footprint (Liang-Barsky, segment by segment) | **must be 0** |
| `leads` | segments overlapping the board whose endpoint is a pin itself | not part of the verdict, reported only |
| `mode` | `avoid` (default) / `direct` | - |

Why `leads` is not an error: when a part sits on the board edge — which the 32-servo ring does at every corner — its pin coordinate is **inside the footprint**, so the wire can only start on the PCB. That is a layout fact, not a routing choice.

`route:'direct'` is the escape hatch: step 14 units out of the pin and join orthogonally without avoiding the board. It exists for boards whose pins face up or down, which `avoid` does not model. **Do not use it on a dense diagram** — the 32-servo ring gets 21 segments across the PCB with `direct`, and 0 with the default `avoid`.

### 3.3 Interaction

- **LED brightness** follows page state via `PcbView.setBrightness(host, partId, 0..1)`; a PWM project just feeds `duty/255`;
- **servo angle**: `PcbView.setAngle` turns one horn without redrawing the diagram, and `PcbView.hornTransform(deg)` gives the `transform`; 32 servos updating dozens of times a second still hold frame rate;
- clicking a lamp in the drawing switches to that lamp's manual mode;
- hovering **any pin** (used or not) shows `pin · -> target`, and a free pin shows `pin · (unused)`; the pad lights up with a cyan ring while hovered;
- hovering a **wire** shows `from -> to` (SVG `<title>`) and thickens it. **Do not put `cursor: help` on wires** — the browser then paints a question mark beside the arrow and users read it as an error (this already happened);
- the **zoom** button lifts the drawing into a full-viewport layer (`position:fixed` + `inset:0`);
  **还原** or <kbd>Esc</kbd> puts it back in the card.

  Two traps, both already hit:/n
  1. **Zoom must not be "remove `max-height`".** A drawing that was never clipped - which is most
     of them at normal window sizes - does not change by a single pixel, and the user reports the
     button as broken. Swap in a genuinely different, viewport-sized state.
  2. **A `fixed` element needs `100vh`, not `100%`.** Its height comes from the `top`/`bottom`
     stretch, so its computed height stays `auto`; a child's percentage height then resolves
     against `auto`, falls back to `auto`, and the svg grows by width until `overflow:hidden`
     cuts it off. Once the svg fills the viewport, the default `preserveAspectRatio(meet)`
     centres the whole drawing inside it and nothing is lost.

Every pin name is printed, the way a real board is silkscreened; the pins the circuit uses are brighter and carry a cyan ring. Printing only the used ones made people ask "what are all those empty pins?"

A double-row header needs special treatment or every name lands on a pad: the columns are only 10 units apart and a pad is 6.8 wide, so there is no gutter for text. **The inner column is named inboard of itself, the outer one in the margin inside the board edge.**

### 3.4 Things not to do

- **Do not hand-draw the circuit.** However convincing it looks - a duck, a grey box, three bulbs - it is
  not a circuit, and the reader cannot see which pin goes where. Worse, a drawing **hides a broken
  `diagram.json`**: one project had seven invented pin names (`buzz:+` instead of `buzz:1`, `servo:SIG`
  instead of `PWM`, `esp:GND.6` when an ESP32 only has GND.1-GND.3). The renderer skips those wires;
  a drawing happily shows them anyway, so everything looks fine. `verify_viewer.js` now fails when the
  page never calls `PcbView.render(`.
- **A healthy serial log does not mean the wiring is right.** Firmware never checks the circuit: a
  `digitalWrite` to a pin with no LED still returns, and the log still prints. The only proof is that
  `check_circuit.js` reports 0 `UNRESOLVED`.
- **Place each part so its pins face the board.** A servo has its three pins on the left edge; put it
  left of the board and every wire has to cut straight through the servo body to reach the header. Put
  it on the right and the pins already point at the board - shortest wire, nothing crossed. Resistors
  are unpolarised, so connect whichever end faces the board. LEDs, buzzers and the HC-SR04 have their
  pins on the bottom edge: park them above or below the board so the wire can leave downwards.
- **Do not hand-edit the drawing for one project.** It follows `diagram.json`; editing it by hand means lying.
- **The `viewBox` must contain a rotated part's real outline.** A servo turned by 11 degrees is
  30 units taller than its own footprint, so `left/top + size` clips 15 units off the bottom horns.
  For anything with `rotate`, use the rotated AABB instead:/n  `w' = |w*cos| + |h*sin|`, `h' = |w*sin| + |h*cos|`, centred on the footprint centre. That crop is
  invisible while the card caps the height with `max-height` - it only shows at full screen, so do
  not trust the thumbnail.
- **Do not hand-edit the PCB-VIEW block.** It is generated from `scripts/pcbview.js`; edit that and run `node scripts/sync_pcbview.js`.
- **Do not move parts in `diagram.json` just to make a diagram reach `crossings=0`.** The drawing has to match the real simulation; move a part and it is no longer the same circuit. (The one exception is a part parked 7 units inside the board — an obvious data defect handled by `nudge()`, and the viewer has to say so.)
- The element library currently covers the ESP32 board, the Arduino Mega, `wokwi-led`, `wokwi-resistor`, `wokwi-servo`, `wokwi-buzzer` and `wokwi-hc-sr04`. To add a button or an OLED: copy the pins from the official `pinInfo` into `pinsOf()`, set the size in `sizeOf()` as `mm * 3.7402`, and write an `xxxSvg()`. **An unregistered part returns `{}` and its wires are skipped silently** - so after adding a part type, run `check_circuit.js` and confirm `UNRESOLVED=0`.

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
