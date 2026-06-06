#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

find_python311() {
  if command -v python3.11 >/dev/null 2>&1; then
    command -v python3.11
    return
  fi
  if command -v python3 >/dev/null 2>&1 && python3 - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)
PY
  then
    command -v python3
    return
  fi
  return 1
}

if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  else
    echo "FFmpeg is required. Install Homebrew, then run: brew install ffmpeg" >&2
    exit 1
  fi
fi

PYTHON="$(find_python311 || true)"
if [[ -z "${PYTHON}" ]]; then
  if command -v brew >/dev/null 2>&1; then
    brew install python@3.11
    PYTHON="$(find_python311 || true)"
  fi
fi

if [[ -z "${PYTHON}" ]]; then
  echo "Python 3.11 is required. Install it with Homebrew: brew install python@3.11" >&2
  exit 1
fi

if [[ ! -d .venv ]]; then
  "${PYTHON}" -m venv .venv
fi

./.venv/bin/python -m pip install --upgrade pip setuptools wheel
if [[ "$(uname -m)" == "arm64" ]]; then
  ./.venv/bin/python -m pip install -r requirements-mac.txt
else
  ./.venv/bin/python -m pip install -r requirements.txt
fi

echo
echo "Ready."
echo "Launch the GUI with: ./launch-gui.sh"
