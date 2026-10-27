#!/usr/bin/env bash
#
# simulate.sh - Run a Wokwi headless simulation and assert on the serial log.
#
# Facts baked in:
#   * --timeout is in SIMULATION milliseconds (not wall clock).
#   * Local simulation runs roughly 5x slower than wall clock.
#   * A long-running sketch ends with exit code 42 (timeout) - that is normal.
#
# Usage:
#   ./simulate.sh examples/01-traffic-light 14000 "TRAFFIC"
#   ./simulate.sh <project-dir> [timeout] [expect1] [expect2] ...
#
set -uo pipefail

PROJ="${1:-}"
TIMEOUT="${2:-16000}"
shift 2 2>/dev/null || true
EXPECT=("$@")

if [ -z "$PROJ" ]; then
  echo "usage: $0 <project-dir> [timeout-ms] [expect-text ...]"
  exit 1
fi
if [ ! -d "$PROJ" ]; then echo "[FAIL] project not found: $PROJ"; exit 1; fi
if [ ! -f "$PROJ/wokwi.toml" ]; then
  echo "[FAIL] wokwi.toml not found in $PROJ"
  echo "       Create it with: [wokwi] version=1 firmware='build/<name>.ino.bin'"
  exit 1
fi

CLI="$(command -v wokwi-cli || true)"
if [ -z "$CLI" ]; then
  for c in "$HOME/.local/bin/wokwi-cli" "/usr/local/bin/wokwi-cli" "/opt/homebrew/bin/wokwi-cli"; do
    [ -x "$c" ] && CLI="$c" && break
  done
fi
if [ -z "$CLI" ]; then
  echo "[FAIL] wokwi-cli not found. https://github.com/wokwi/wokwi-cli/releases"
  exit 1
fi

if [ -z "${WOKWI_CLI_TOKEN:-}" ]; then
  echo "[FAIL] WOKWI_CLI_TOKEN is not set"
  echo "       export WOKWI_CLI_TOKEN=\"wok_...\""
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$PROJ/sim-$STAMP"
mkdir -p "$OUT"
LOG="$OUT/serial.log"

WALL_MIN=$(( TIMEOUT / 1000 * 3 / 2 ))
WALL_MAX=$(( TIMEOUT / 1000 * 5 ))

echo ""
echo "=== simulation ==="
echo "  project  : $PROJ"
echo "  timeout  : ${TIMEOUT} sim-ms (may take ${WALL_MIN}-${WALL_MAX}s wall clock; sim is 1.5x-5x slower)"
echo "  log file : $LOG"
echo ""

"$CLI" --timeout "$TIMEOUT" --serial-log-file "$LOG" "$PROJ"
CODE=$?

echo ""
echo "exit code    : $CODE"
if [ "$CODE" -eq 42 ]; then
  echo "note         : 42 = timeout reached, normal for long-running sketches"
fi

if [ ! -f "$LOG" ]; then
  echo "[FAIL] no serial log produced: $LOG"
  echo "       Check wokwi.toml firmware path and diagram.json serial wiring."
  exit 1
fi

BYTES=$(wc -c < "$LOG" | tr -d ' ')
echo "serial log   : $BYTES bytes"

if [ "$BYTES" -eq 0 ]; then
  echo ""
  echo "[FAIL] serial log is empty. The firmware probably did not start."
  echo "       Checklist: build/*.bin exists? wokwi.toml points to it? Serial.begin(115200) present?"
  exit 1
fi

PASS=1
if [ "${#EXPECT[@]}" -gt 0 ]; then
  echo ""
  echo "--- expect ---"
  for e in "${EXPECT[@]}"; do
    if grep -qF -- "$e" "$LOG"; then
      echo "  [PASS] found: $e"
    else
      echo "  [FAIL] missing: $e"
      PASS=0
    fi
  done
fi

if [ "$PASS" -eq 0 ]; then
  echo ""
  echo "[FAIL] assertions failed. Log: $LOG"
  echo "       See references/07-troubleshooting.md (section C)"
  exit 1
fi

echo ""
echo "[OK] simulation verified. Log: $LOG"
echo ""
echo "Next: use this log as the rawLog source for sim-viewer.html"
