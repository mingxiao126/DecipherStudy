#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "$#" -lt 2 ]; then
  echo "Usage: ./scripts/import-flashcard-from-clipboard.sh <economics|statistics|econ|stat> <display_name> [--file <path>]"
  exit 1
fi

node "$ROOT_DIR/scripts/import-from-clipboard.js" flashcard "$@"
