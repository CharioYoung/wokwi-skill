#!/usr/bin/env bash
# check-env.sh - Verify the toolchain needed by wokwi-builder (macOS / Linux).
#
# Usage:
#   bash scripts/check-env.sh
#   bash scripts/check-env.sh --data-dir "$HOME/.arduino15" --build-dir /tmp/wokwi-build
#
# Exit code: 0 = all pass, 1 = something failed.

set -u

DATA_DIR=""
BUILD_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir)  DATA_DIR="${2:-}"; shift 2 ;;
    --build-dir) BUILD_DIR="${2:-}"; shift 2 ;;
    -h|--help)   sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

FAIL=0
WARN=0
PASS=0

ok()   { PASS=$((PASS + 1)); printf '[PASS] %-16s %s\n' "$1" "$2"; }
bad()  { FAIL=$((FAIL + 1)); printf '[FAIL] %-16s %s\n' "$1" "$2"; }
warn() { WARN=$((WARN + 1)); printf '[WARN] %-16s %s\n' "$1" "$2"; }

is_ascii() { printf '%s' "$1" | LC_ALL=C grep -q '[^ -~]' && return 1 || return 0; }

echo " "
echo "=== wokwi-builder environment check ==="
echo " "

# --- 1. wokwi-cli ---
WOKWI=""
WOKWI="$(command -v wokwi-cli 2>/dev/null || true)"
if [ -z "$WOKWI" ] && [ -x "$HOME/.wokwi/bin/wokwi-cli" ]; then WOKWI="$HOME/.wokwi/bin/wokwi-cli"; fi
if [ -n "$WOKWI" ]; then
  ok "wokwi-cli" "$("$WOKWI" --version 2>/dev/null | head -1)  ($WOKWI)"
else
  bad "wokwi-cli" "not found. Install from https://github.com/wokwi/wokwi-cli/releases"
fi

# --- 2. token ---
TOKEN="${WOKWI_CLI_TOKEN:-}"
TOKEN_SRC="env"
if [ -z "$TOKEN" ]; then
  for f in "$HOME/.workbuddy/mcp.json"; do
    if [ -f "$f" ]; then
      TOKEN="$(sed -n 's/.*"WOKWI_CLI_TOKEN"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -1)"
      [ -n "$TOKEN" ] && TOKEN_SRC="mcp.json"
    fi
  done
fi
if [ -n "$TOKEN" ]; then
  LEN=${#TOKEN}
  case "$TOKEN" in
    wok_*) PREFIX_OK=1 ;;
    *)     PREFIX_OK=0 ;;
  esac
  if [ "$PREFIX_OK" = "1" ] && [ "$LEN" = "44" ]; then
    # Never echo the secret itself, only its length and source.
    ok "WOKWI_CLI_TOKEN" "wok_****  ($LEN chars, from $TOKEN_SRC)"
  else
    warn "WOKWI_CLI_TOKEN" "unexpected format: len=$LEN. Expected 44 chars starting with wok_"
  fi
else
  bad "WOKWI_CLI_TOKEN" "not set. Generate one at wokwi.com (CI/API token page)"
fi

# --- 3. arduino-cli ---
ACLI="$(command -v arduino-cli 2>/dev/null || true)"
if [ -z "$ACLI" ] && [ -x "/usr/local/bin/arduino-cli" ]; then ACLI="/usr/local/bin/arduino-cli"; fi
if [ -n "$ACLI" ]; then
  ok "arduino-cli" "$("$ACLI" version 2>/dev/null | head -1)  ($ACLI)"
else
  bad "arduino-cli" "not found. Install from https://github.com/arduino/arduino-cli/releases"
fi

# --- 4. esp32 core ---
if [ -z "$DATA_DIR" ]; then
  if [ -d "$HOME/.arduino15" ]; then DATA_DIR="$HOME/.arduino15"; else DATA_DIR="$HOME/.arduino15"; fi
fi
if [ -n "$ACLI" ]; then
  CORE="$("$ACLI" --config-dir "$DATA_DIR" core list 2>/dev/null | grep '^esp32:esp32' || true)"
  if [ -n "$CORE" ]; then
    ok "esp32 core" "$CORE  (data dir: $DATA_DIR)"
  else
    bad "esp32 core" "not installed in $DATA_DIR. Run: arduino-cli --config-dir $DATA_DIR core install esp32:esp32"
  fi
  if ! is_ascii "$DATA_DIR"; then
    warn "data dir" "contains non-ASCII characters; the linker may fail. Use an ASCII path."
  fi
fi

# --- 5. node ---
if command -v node >/dev/null 2>&1; then
  NODE_V="$(node --version 2>/dev/null)"
  NODE_MAJOR="$(printf '%s' "$NODE_V" | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "${NODE_MAJOR:-0}" -ge 18 ]; then
    ok "node" "$NODE_V  ($(command -v node))"
  else
    warn "node" "$NODE_V is old; scripts need v18+"
  fi
else
  warn "node" "not found; verify_viewer.js / domrun.js will be unavailable"
fi

# --- 6. build dir ---
[ -z "$BUILD_DIR" ] && BUILD_DIR="/tmp/wokwi-build"
if ! is_ascii "$BUILD_DIR"; then
  bad "build dir" "$BUILD_DIR contains non-ASCII characters; ld will fail. Use an ASCII path."
elif mkdir -p "$BUILD_DIR" 2>/dev/null && [ -w "$BUILD_DIR" ]; then
  ok "build dir" "$BUILD_DIR  (ASCII, writable)"
else
  bad "build dir" "$BUILD_DIR is not writable"
fi

# --- summary ---
echo " "
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: all checks passed ($WARN warning(s))"
  echo " "
  exit 0
else
  echo "RESULT: $FAIL check(s) failed, $WARN warning(s)"
  echo "See references/02-environment.md for the fix for each item."
  echo " "
  exit 1
fi
