from __future__ import annotations

import hashlib
import re
from pathlib import Path


SUPPORTED_AUDIO_EXTENSIONS = {".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".wav", ".webm", ".flac", ".ogg"}

OUTPUT_SUFFIXES = (
    ".speaker-turns.txt",
    ".speaker-turns.md",
    ".clean.txt",
    ".speaker-segments.srt",
    ".segments.json",
    ".notes.md",
    ".transcript.docx",
    ".whisperx.json",
)


def slugify(value: str) -> str:
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("_.")
    return value or "audio"


def source_id(audio: Path) -> str:
    resolved = str(audio.expanduser().resolve(strict=False))
    return hashlib.sha1(resolved.encode("utf-8")).hexdigest()[:8]


def transcript_stem(audio: Path) -> str:
    return f"{slugify(audio.stem)}-{source_id(audio)}"


def work_wav_path(audio: Path, work_dir: Path) -> Path:
    return work_dir / f"{transcript_stem(audio)}.16k-mono.wav"


def expected_output_paths(audio: Path, output_dir: Path) -> list[Path]:
    stem = transcript_stem(audio)
    return [output_dir / f"{stem}{suffix}" for suffix in OUTPUT_SUFFIXES]
