#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -x ./.venv/bin/python ]]; then
  echo "Virtual environment missing. Run ./setup-mac.sh first." >&2
  exit 1
fi

LATEST="$(
  ./.venv/bin/python - <<'PY'
from pathlib import Path

suffixes = {".m4a", ".mp3", ".wav", ".mp4", ".webm", ".flac", ".ogg"}
files = [p for p in Path("input").rglob("*") if p.is_file() and p.suffix.lower() in suffixes]
print(max(files, key=lambda p: p.stat().st_mtime) if files else "")
PY
)"

if [[ -z "${LATEST}" ]]; then
  echo "No audio file found in ./input." >&2
  exit 1
fi

./transcribe.sh "${LATEST}" "${HUGGINGFACE_TOKEN:-}" "${1:-}"
