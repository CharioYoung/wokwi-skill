# 07 · Error encyclopaedia (traps we actually hit)

[中文](07-troubleshooting.en.md) | **English**

The triage order is always: **read the first error → decide which layer it belongs to → change only that layer**.

| Layer | Typical errors | Where to look |
|---|---|---|
| Environment | `command not found`, download timeouts, TLS failures | group A |
| Build | `error:`, `undefined reference`, `cannot find -l` | group B |
| Simulation | no output, hangs, exit 42, panic | group C |
| Delivery | blank page, compile failure after copying | group D |

---

## A. Environment layer

### A1. `The underlying connection was closed: Could not establish trust relationship for the SSL/TLS secure channel`

**Cause**: older PowerShell defaults to TLS 1.0, which GitHub now rejects.

**Fix**:
```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
```
Or just use `curl.exe -L -o out.zip <url>`.

### A2. The 300 MB ESP32 core download keeps timing out

**Cause**: large files from `storage.googleapis.com` / GitHub tend to drop on some networks.

**Fix** (ordered by success rate):
1. retry `arduino-cli core install esp32:esp32`;
2. download the zip manually with a browser/IDM → serve it over a local HTTP server (`http://127.0.0.1:8765/`) → trim `package_index.json` so `url` points locally → install with `--additional-urls`;
3. give up on the local toolchain and switch to **generation mode**: produce only `sketch.ino` + `diagram.json` and run them on wokwi.com (cloud compile, zero dependencies).

### A3. `parse error: expected number near offset 0 of '﻿{...'`

**Cause**: a hand-written `installed.json` carrying a UTF-8 BOM (the `﻿` is invisible).

**Fix**: do not hand-write that file — let `arduino-cli` generate it. If it is already corrupted, delete it and reinstall the core.

### A4. `parse error: expected number near offset 34 of '3.3.9'`

**Cause**: a hand-written `installed.json` with the wrong shape. The correct shape is `{"packages":[...]}`, not a flat object.

**Fix**: same as above — let arduino-cli generate it.

### A5. PowerShell reports `unexpected token }` / garbled Chinese

**Cause**: PowerShell 5.1 parses a BOM-less UTF-8 `.ps1` as GBK, so Chinese characters turn into garbage and break the syntax.

**Fix**: keep scripts **ASCII only**; when a path contains non-ASCII characters, build it with `Join-Path $env:USERPROFILE "..."` instead of writing the literal into the script.

### A6. `board esp32:esp32:esp32 not found`

**Cause**: the ESP32 core is not installed, or `--config-dir` points at the wrong directory (installed under one, compiled against another).

**Fix**:
```bash
arduino-cli core list                          # confirm esp32 is installed
arduino-cli --config-dir <same dir> core list  # confirm the build uses the same directory
```

### A7. A `file://` board index is silently ignored

**Cause**: arduino-cli does not accept a local filesystem index.

**Fix**: start a local HTTP server (Node or Python) and use `http://127.0.0.1:<port>/package_index.json`.

### A8. `core search` still shows the online version after swapping the index

**Cause**: Arduino's official index `package_index.json` **also contains the full esp32 entries**, so replacing only the custom index is not enough.

**Fix**: replace both indexes with the trimmed versions — or drop the offline approach entirely.

### A9. `Move-Item : Cannot create a file when that file already exists`

**Cause**: a half-finished directory left over from the previous failed attempt.

**Fix**: `Remove-Item -Recurse -Force <target>` before unpacking.

---

## B. Build layer

### B1. `'selfTest' was not declared in this scope`

**Cause**: the code was "simplified for display" — a function is called but its definition was removed.

**Fix**: use the **verbatim source that really compiled**. Anything you hand to the user for copying must be compiled once on this machine first.

### B2. `missing terminating ' character`

```
error: missing terminating ' character
104 |   String cmd = Serial.readStringUntil('
105 | ');
```

**Cause**: C code was placed inside a JS template literal and `\n` was interpreted by JS as a real newline.

**Fix**: switch to a `<script type="text/plain" id="inoSrc">` raw block plus `rawSrc()`. See hard rule 2 in `06-viewer.en.md`.

### B3. `Error during build: exit status 1` (on the wokwi.com web editor)

**Cause**: three usual suspects — wrong board selected, a third-party library used without a `libraries.txt`, or more than one `.ino` in the project.

**Fix**:
- make sure the board is ESP32 DevKit C;
- if a library is needed, create `libraries.txt` with one name per line;
- **keep exactly one `.ino`**.

### B4. Duplicate definitions from two `.ino` files

```
error: redefinition of 'void setup()'
```

**Cause**: Wokwi/Arduino concatenates every `.ino` in the project directory before compiling.

**Fix**: delete the extra one and keep a single file (usually `sketch.ino`).

### B5. `ld.exe: cannot open output file ... .elf` / `cannot find -l<lib>`

**Cause**: **the build path contains non-ASCII characters** (e.g. `C:\Users\<non-ascii>\...`), which `ld.exe` cannot handle.

**Fix**: move the build directory to a pure ASCII path:
```powershell
arduino-cli --config-dir C:\wokwi-toolchain\data compile `
  --fqbn esp32:esp32:esp32 --build-path C:\wokwi-toolchain\build <project>
```
`scripts/compile.ps1` already does this by default.

### B6. `Sketch too big` / program space exhausted

**Cause**: the default ESP32 partition table only gives 1.3 MB to the program.

**Fix**: trim features/libraries, or pick a larger partition scheme than `--fqbn esp32:esp32:esp32:default`.

### B7. `Can't open sketch: main file missing from sketch: ...\my-project.ino`

```
arduino-cli.exe : Can't open sketch: main file missing from sketch:
                  D:\repo\my-project\blink.ino
```

**Cause**: arduino-cli requires **the sketch directory name to equal the `.ino` filename**. The directory is `my-project` but contains `blink.ino`, so it looks for `my-project.ino` — which does not exist.

**Fix** (either one):

```bash
# option A: make the filename match the directory (recommended)
mv my-project/blink.ino my-project/my-project.ino

# option B: make the directory match the filename
mv my-project blink
```

**Prevention**: name the directory after the `.ino` from the start, e.g. `wokwi-projects/remote-switch/remote-switch.ino`. `scripts/compile.ps1` checks this before building and tells you directly.

> The same applies on the Wokwi web editor: the main file is called `sketch.ino`, so **do not rename the main file**, or the entry point may not be compiled.

---

## C. Simulation layer

### C1. exit code 42

**Verdict**: **normal**. It means the run was stopped at `--timeout`. Any continuously running program ends this way.

**Criterion**: passing means the target lines are in the log. Do not use the exit code as the acceptance criterion.

### C2. The simulation "hangs" for a long time

**Three possibilities**, in order:

1. **It is just slow**: local simulation is about 1.5–5× slower, so 16000 simulated ms ≈ 80 s of real waiting. Wait long enough first.
2. **The MCP queue is blocked**: the previous `start_simulation` was interrupted and a leftover request still occupies the queue. Restart the client, or use `scripts/simulate.ps1` (direct CLI).
3. **Network problem**: check `curl -I https://wokwi.com` for 200. There has been a misdiagnosis before — HTTP and WebSocket were both fine, it was purely slow plus blocked.

### C3. The serial output is completely blank

- `diagram.json` does not connect `esp:TX/RX` to `$serialMonitor`;
- the code has no `Serial.begin(115200)`;
- the baud rates do not match.

### C4. The code runs but the LED stays dark

- missing GND (most common);
- LED polarity reversed (`A` anode → resistor → GPIO, `C` cathode → GND);
- wrong pin number (`esp:2` vs `LED=4` in the code);
- no series resistor causing over-current, so the lamp turns grey in simulation.

### C5. WiFi will not connect / stuck on `connecting...`

- the Wokwi virtual network SSID is `"Wokwi-GUEST"` (no password);
- the first connection is slower than real hardware; allow 5–15 seconds;
- add a timeout and retry in the code; never spin forever in `while(WiFi.status()!=WL_CONNECTED)`.

### C6. `Guru Meditation Error` / panic

- array out of bounds / null pointer;
- GPIO 6–11 used (they are wired to flash);
- a long operation performed inside an interrupt.

Read the backtrace on the first log line and correlate it with your most recent change.

### C7. You wanted a screenshot but got 0 bytes or 16×16

**Verdict**: `--screenshot-part` only works on **parts with a framebuffer** (OLED/LCD). An LED yields a 16×16 thumbnail; without a part the full-canvas image is often 0 bytes.

**Fix**: to see the picture, use `sim-viewer.html` (local replay); to see a real screen, use an OLED project.

---

## D. Delivery layer (the viewer)

### D1. Opens completely blank, console says `CFG is not defined`

**Cause**: editing used a prefix truncation such as `slice(0, lastIndexOf('<script>'))`, which deleted definitions like `CFG` wholesale.

**Fix**: restore the definition; from now on replace only the target range, and verify with `node scripts/domrun.js`.

### D2. A lamp does not render / clicking does nothing

- `CFG.actors[].id` does not match the part `id` in `diagram.json`;
- `boot()` was never called (the trailing `boot();` is missing);
- a JS error stopped the rest of the script — check the error count with `domrun.js`.

### D3. The copied code fails in Wokwi

- `'xxx' was not declared` → a simplified version was used (hard rule 1);
- `missing terminating ' character` → a JS template literal was used (hard rule 2);
- duplicate definitions → more than one `.ino` in the project.

### D4. `verify_viewer.js` says the INO does not match the real file

**Cause**: the code on the page and the project's `.ino` have drifted apart (one side changed, the other forgotten).

**Fix**: take **the version that compiles** as the source of truth, paste it into the `inoSrc` block again, and re-run the check.

### D5. `domrun.js` reports `requestAnimationFrame is not defined`

**Cause**: the test stub does not implement the API (some viewers animate with rAF).

**Fix**: this is a **script** problem, not a page problem. Add to the sandbox in `domrun.js`:
```js
requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
cancelAnimationFrame: (id) => clearTimeout(id),
```

---

## E. One general piece of advice

When you hit an unfamiliar error, do not rush to edit code. Do three things first:

1. paste the **complete error** (filename, line number, context) — not just the last line;
2. decide **which layer** it belongs to (build? simulation? page?);
3. validate the hypothesis with a minimal reproduction — cut the project down to one LED and one `println`.

Most "mysterious" problems reveal themselves once cut down to the minimum.
