#!/usr/bin/env bash
#
# compile.sh - Compile an Arduino sketch for Wokwi simulation (macOS / Linux).
#
# Why: wokwi-cli does NOT compile ESP32 Arduino sketches. You must provide
#      a firmware binary. This wraps arduino-cli with sane defaults.
#
# Usage:
#   ./compile.sh examples/01-traffic-light
#   ./compile.sh <project-dir> [fqbn] [data-dir] [build-dir]
#
set -uo pipefail

PROJ="${1:-}"
FQBN="${2:-esp32:esp32:esp32}"
DATA_DIR="${3:-${ARDUINO_DATA_DIR:-$HOME/.arduino15}}"
BUILD_DIR="${4:-/tmp/wokwi-build}"

if [ -z "$PROJ" ]; then
  echo "usage: $0 <project-dir> [fqbn] [data-dir] [build-dir]"
  exit 1
fi
if [ ! -d "$PROJ" ]; then
  echo "[FAIL] project not found: $PROJ"
  exit 1
fi

ACLI="$(command -v arduino-cli || true)"
if [ -z "$ACLI" ]; then
  for c in "$HOME/.local/bin/arduino-cli" "/usr/local/bin/arduino-cli" "/opt/homebrew/bin/arduino-cli"; do
    [ -x "$c" ] && ACLI="$c" && break
  done
fi
if [ -z "$ACLI" ]; then
  echo "[FAIL] arduino-cli not found. Install: https://github.com/arduino/arduino-cli/releases"
  exit 1
fi

INOS=$(find "$PROJ" -maxdepth 1 -name '*.ino' -type f | wc -l | tr -d ' ')
if [ "$INOS" = "0" ]; then
  echo "[FAIL] no .ino file in $PROJ"
  exit 1
fi
if [ "$INOS" -gt 1 ]; then
  echo "[WARN] $INOS .ino files found; keep exactly one per project or you may get duplicate symbols"
  find "$PROJ" -maxdepth 1 -name '*.ino' -type f -printf '       - %f\n' 2>/dev/null || true
fi

# arduino-cli requires: <folder>/<folder>.ino  (folder name == sketch name)
if [ "$INOS" = "1" ]; then
  SKETCH=$(find "$PROJ" -maxdepth 1 -name '*.ino' -type f -exec basename {} .ino \;)
  FOLDER=$(basename "$PROJ")
  if [ "$SKETCH" != "$FOLDER" ]; then
    echo ""
    echo "[FAIL] sketch folder name must match the .ino file name."
    echo "       folder : $FOLDER"
    echo "       sketch : $SKETCH.ino"
    echo "       arduino-cli looks for: $FOLDER/$FOLDER.ino"
    echo "       fix    : rename the folder to '$SKETCH', or rename the .ino to '$FOLDER.ino'"
    exit 1
  fi
fi

if printf '%s' "$BUILD_DIR" | LC_ALL=C grep -q '[^ -~]'; then
  echo "[FAIL] build dir contains non-ASCII characters: $BUILD_DIR"
  echo "       Use an ASCII path such as /tmp/wokwi-build"
  exit 1
fi

mkdir -p "$BUILD_DIR" "$PROJ/build"

echo ""
echo "=== compiling ==="
echo "  project  : $PROJ"
echo "  fqbn     : $FQBN"
echo "  data dir : $DATA_DIR"
echo "  build    : $BUILD_DIR"
echo ""

"$ACLI" --config-dir "$DATA_DIR" compile --fqbn "$FQBN" \
  --build-path "$BUILD_DIR" --output-dir "$PROJ/build" "$PROJ"
CODE=$?

if [ "$CODE" -ne 0 ]; then
  echo ""
  echo "[FAIL] compile exit $CODE"
  echo "       See references/07-troubleshooting.md (section B)"
  exit "$CODE"
fi

echo ""
ls -la "$PROJ"/build/*.bin 2>/dev/null | awk '{printf "[OK] %s  %s bytes\n", $9, $5}'
echo ""
echo "Next: make sure wokwi.toml points at the firmware file name above"
