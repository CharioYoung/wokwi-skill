#!/usr/bin/env bash
#
# install.sh - Install the wokwi-builder skill into an agent skills directory.
#
# Usage:
#   ./install.sh                    # auto-detect target
#   ./install.sh ~/my/skills        # explicit base directory
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${1:-}" ]; then
  BASE="$1"
elif [ -d "$HOME/.workbuddy" ]; then
  BASE="$HOME/.workbuddy/skills"
else
  BASE="$HOME/.claude/skills"
fi

DEST="$BASE/wokwi-builder"

if [ -d "$DEST" ]; then
  echo "removing previous install: $DEST"
  rm -rf "$DEST"
fi
mkdir -p "$DEST"

for item in SKILL.md README.md LICENSE references scripts assets examples; do
  if [ -e "$SRC/$item" ]; then
    cp -R "$SRC/$item" "$DEST/"
  fi
done

chmod +x "$DEST"/scripts/*.sh 2>/dev/null || true

echo ""
echo "[OK] installed to: $DEST"
echo ""
echo "Next steps:"
echo "  1. verify toolchain : bash \"$DEST/scripts/check-env.sh\""
echo "  2. read the manual  : references/00-quickstart.md"
echo "  3. try it           : wokwi: make an ESP32 traffic light"
