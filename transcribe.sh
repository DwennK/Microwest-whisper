#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 AUDIO [HF_TOKEN] [SPEAKERS]"
}

cd "$(dirname "$0")"

if [[ ! -x ./.venv/bin/python ]]; then
  echo "Virtual environment missing. Run ./setup-mac.sh first." >&2
  exit 1
fi

AUDIO="${1:-}"
HF_TOKEN="${2:-${HUGGINGFACE_TOKEN:-}}"
SPEAKERS="${3:-}"

if [[ -z "${AUDIO}" ]]; then
  usage
  exit 1
fi

ARGS=(
  transcribe.py
  --audio "${AUDIO}"
  --model large-v3
  --asr-backend auto
  --language fr
)

if [[ -n "${HF_TOKEN}" ]]; then
  ARGS+=(--hf-token "${HF_TOKEN}")
else
  ARGS+=(--no-diarization)
fi

if [[ -n "${SPEAKERS}" ]]; then
  ARGS+=(--speakers "${SPEAKERS}")
fi

./.venv/bin/python "${ARGS[@]}"
