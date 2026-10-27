# 02 · Environment setup (Windows / macOS / Linux)

[中文](02-environment.md) | **English**

Goal: make `check-env` all green. Takes about 20–40 minutes, most of it spent downloading the ESP32 core (~300 MB).

**Run the self-check first and fill only the gaps** — do not blindly follow a full install:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
```
```bash
bash scripts/check-env.sh
```

---

## A. wokwi-cli (the simulation engine)

### Install

Download the binary for your platform from <https://github.com/wokwi/wokwi-cli/releases>, put it under a **pure ASCII path** and add it to PATH:

```powershell
# Windows example
mkdir C:\wokwi\bin -Force
# put wokwi-cli.exe there, then:
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\wokwi\bin", "User")
```

```bash
# macOS / Linux
mkdir -p ~/.local/bin && mv wokwi-cli ~/.local/bin/ && chmod +x ~/.local/bin/wokwi-cli
```

### Token

1. Sign in at <https://wokwi.com>;
2. Click your avatar in the top right → find the **CI / API Token** page (the token section of your profile settings);
3. The generated string starts with `wok_` and is 44 characters long;
4. **Put it in an environment variable only — never into code or a repository**:

```powershell
setx WOKWI_CLI_TOKEN "wok_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# reopen the terminal for it to take effect, then verify:
wokwi-cli --version
```

```bash
export WOKWI_CLI_TOKEN="wok_..."
echo 'export WOKWI_CLI_TOKEN="wok_..."' >> ~/.bashrc
```

> If the token leaks, revoke and regenerate it in the Wokwi dashboard immediately.

### Hook it up as MCP (optional but recommended)

This lets the agent call the simulation directly instead of assembling command lines. Add to `~/.workbuddy/mcp.json` (or your client's MCP config):

```json
{
  "mcpServers": {
    "wokwi-cli": {
      "command": "C:\\wokwi\\bin\\wokwi-cli.exe",
      "args": ["mcp"],
      "env": { "WOKWI_CLI_TOKEN": "wok_..." }
    }
  }
}
```

Then **Trust** the server on your client's connectors/plugins page.

**Note**: the MCP process stays resident. If a `start_simulation` is interrupted mid-flight, a leftover request can block the queue and look like "it hangs forever". Fix: restart the client, or bypass MCP and use the CLI directly (`scripts/simulate.ps1` is a direct CLI call).

---

## B. arduino-cli (the compiler)

**Why it is mandatory**: `wokwi-cli` does **not** compile ESP32 **Arduino** projects in the cloud — you must supply the `.bin` firmware yourself. (Only ESP-IDF / Pico SDK projects can be inferred.)

### Install

Download the zip from <https://github.com/arduino/arduino-cli/releases>; it extracts to a single `arduino-cli.exe`:

```powershell
mkdir C:\wokwi\bin -Force
# extract arduino-cli.exe into C:\wokwi\bin\
C:\wokwi\bin\arduino-cli.exe version
```

```bash
# macOS
brew install arduino-cli
# Linux
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
```

### Install the ESP32 core (the slow part)

```bash
arduino-cli core update-index
arduino-cli core install esp32:esp32
```

This downloads roughly 300 MB (xtensa toolchain + libraries). **This is the step most likely to fail on a flaky network** — see `E. Network problems` below.

### ★ Critical: the data directory and build directory must be pure ASCII

This is the deepest pit this project hit. `ld.exe` (the linker) fails on **paths containing non-ASCII characters**:

```
cannot open output file C:\Users\<non-ascii>\...\sketch.ino.elf
cannot find -l<library>
```

The fix: move both the Arduino data directory and the build directory to pure ASCII paths.

```powershell
# one-off: use an ASCII directory as the data directory (an already installed core must be reinstalled there)
arduino-cli --config-dir C:\wokwi-toolchain\data core update-index
arduino-cli --config-dir C:\wokwi-toolchain\data core install esp32:esp32

# and pass an ASCII build directory when compiling
arduino-cli --config-dir C:\wokwi-toolchain\data compile ^
  --fqbn esp32:esp32:esp32 --build-path C:\wokwi-toolchain\build <project-dir>
```

`scripts/compile.ps1` already defaults to `C:\wokwi-toolchain\{data,build}`; override with `-DataDir` / `-BuildDir`.

> Already installed the core in the default location? You do not need to reinstall — point `-DataDir` at your existing `Arduino15` directory and change only `-BuildDir` to an ASCII path. **The build directory is the one that must change.**

---

## C. Node.js (verification scripts)

Version 18 or newer. Used by `scripts/verify_viewer.js` (viewer code consistency) and `scripts/domrun.js` (runtime check).

```bash
node --version   # v18+ is enough
```

The skill works without Node, but you lose those two checks — and they have caught real incidents, so **installing it is strongly recommended**.

---

## D. Environment self-check

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
```

Expected output:

```
[PASS] wokwi-cli        0.29.1
[PASS] WOKWI_CLI_TOKEN  wok_****  (44 chars)
[PASS] arduino-cli      1.5.1
[PASS] esp32 core       3.3.9
[PASS] node             v22.x
[PASS] build dir        C:\wokwi-toolchain\build (ASCII, writable)
```

Every `FAIL` comes with a suggested fix.

---

## E. Network problems (common in mainland China)

### E1. `The underlying connection was closed: Could not establish trust relationship for the SSL/TLS secure channel`

Older PowerShell defaults to TLS 1.0, which GitHub rejects. Run this in the session first:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
```

Or simply download with `curl.exe` (bundled with Windows 10+):

```powershell
curl.exe -L -o arduino-cli.zip https://github.com/arduino/arduino-cli/releases/download/1.5.1/arduino-cli_1.5.1_Windows_64bit.zip
```

### E2. `core install` times out

Symptoms: stuck on `Downloading esp32-core-3.3.9.zip`, or the xtensa toolchain keeps dropping.

Try, in order:

1. **Different time of day / a mirror**: simply retry `arduino-cli core install esp32:esp32 --run-post-install` a few times.
2. **Download manually, then install locally** (most reliable):
   - copy the direct zip URL from the arduino-cli download log and fetch it with a browser / download manager;
   - put the files in one directory and serve them over a **local HTTP server** (`file://` URLs are silently ignored — it must be `http://`);
   - write a trimmed `package_index.json` whose `url` points at `http://127.0.0.1:8765/xxx.zip`;
   - `arduino-cli --config-dir <dir> core install esp32:esp32 --additional-urls http://127.0.0.1:8765/package_index.json`
   - note: Arduino's official index (`package_index.json`) also carries full esp32 entries, so **both indexes must be replaced**, otherwise it still goes online.

> The least painful alternative: **generation mode only** — skip the toolchain, let the AI produce `sketch.ino` + `diagram.json`, and paste them into wokwi.com (the web editor compiles in the cloud and needs no local tools at all).

### E3. `parse error: expected number near offset 0 of '﻿{...'`

`installed.json` carries a UTF-8 BOM. **Do not hand-write that file** — let `arduino-cli` generate it. If it is already corrupted, delete it and reinstall the core.

---

## F. macOS / Linux differences

| Item | Windows | macOS / Linux |
|---|---|---|
| Path separator | `C:\...` | `/Users/...` |
| Build directory | `C:\wokwi-toolchain\build` | `~/.wokwi-toolchain/build` (careful: **a non-ASCII home directory breaks it the same way** — use `/tmp/wokwi-build`) |
| Compile command | `compile.ps1` | `compile.sh` |
| Serial device | `COM3` etc. | `/dev/ttyUSB0`, `/dev/cu.usbserial-*` (not needed for simulation) |

---

## G. Uninstall / reset

```powershell
# clear only the build cache (keeps installed cores)
Remove-Item -Recurse -Force C:\wokwi-toolchain\build
```
```bash
rm -rf ~/.wokwi-toolchain/build
```

Full reinstall: delete the data directory and run `core install` again.
