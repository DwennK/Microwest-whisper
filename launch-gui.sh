#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -x ./.venv/bin/python ]]; then
  echo "Virtual environment missing. Run ./setup-mac.sh first." >&2
  exit 1
fi

./.venv/bin/python gui.py
