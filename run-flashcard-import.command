#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================="
echo "DecipherStudy - Flashcard Import (Clickable)"
echo "============================================="
echo ""

read -r -p "Subject [economics/statistics] (default: economics): " SUBJECT
SUBJECT="${SUBJECT:-economics}"

read -r -p "Display name (required): " NAME
if [ -z "$NAME" ]; then
  echo "Display name is required."
  read -r -p "Press Enter to exit..." _
  exit 1
fi

read -r -p "Optional JSON file path (Enter = clipboard): " FILE_PATH

echo ""
if [ -n "$FILE_PATH" ]; then
  ./scripts/import-flashcard-from-clipboard.sh "$SUBJECT" "$NAME" --file "$FILE_PATH"
else
  ./scripts/import-flashcard-from-clipboard.sh "$SUBJECT" "$NAME"
fi

echo ""
read -r -p "Done. Press Enter to close..." _
