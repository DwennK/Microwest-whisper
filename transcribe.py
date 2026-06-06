from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


load_dotenv()


SUPPORTED_EXTENSIONS = {".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".wav", ".webm", ".flac", ".ogg"}


@dataclass(frozen=True)
class Paths:
    audio: Path
    output_dir: Path
    work_dir: Path
    wav: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="High-quality French transcription with WhisperX alignment and speaker diarization."
    )
    parser.add_argument("--audio", required=True, help="Path to the source audio file, for example recording.m4a.")
    parser.add_argument("--output-dir", default="output", help="Directory where transcript files are written.")
    parser.add_argument("--work-dir", default="work", help="Directory for intermediate WAV files.")
    parser.add_argument("--model", default="large-v3", help="Whisper model. Use large-v3 for best quality.")
    parser.add_argument(
        "--asr-backend",
        choices=["auto", "whisperx", "mlx"],
        default="auto",
        help="ASR engine. auto uses MLX on Apple Silicon when installed, otherwise WhisperX/faster-whisper.",
    )
    parser.add_argument(
        "--mlx-model",
        default="auto",
        help="MLX model repo/path. auto maps large-v3 to mlx-community/whisper-large-v3-mlx.",
    )
    parser.add_argument("--language", default="fr", help="Input language code. French is 'fr'.")
    parser.add_argument("--batch-size", type=int, default=8, help="WhisperX batch size. Lower this if RAM is tight.")
    parser.add_argument(
        "--threads",
        type=int,
        default=0,
        help="CPU threads for faster-whisper. 0 chooses a sensible automatic value.",
    )
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--compute-type", default="auto", help="auto, float16, int8, int8_float16, float32.")
    parser.add_argument("--hf-token", default=os.environ.get("HUGGINGFACE_TOKEN"), help="Hugging Face token for pyannote.")
    parser.add_argument("--no-diarization", action="store_true", help="Transcribe without speaker diarization.")
    parser.add_argument("--speakers", type=int, default=None, help="Exact number of speakers, if known.")
    parser.add_argument("--min-speakers", type=int, default=None, help="Minimum number of speakers.")
    parser.add_argument("--max-speakers", type=int, default=None, help="Maximum number of speakers.")
    parser.add_argument("--delete-work", action="store_true", help="Delete the intermediate WAV file after success.")
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def slugify(value: str) -> str:
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("_.")
    return value or "audio"


def build_paths(args: argparse.Namespace) -> Paths:
    audio = Path(args.audio).expanduser().resolve()
    if not audio.exists():
        fail(f"Audio file not found: {audio}")
    if audio.suffix.lower() not in SUPPORTED_EXTENSIONS:
        fail(f"Unsupported audio extension '{audio.suffix}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")

    output_dir = Path(args.output_dir).resolve()
    work_dir = Path(args.work_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    wav = work_dir / f"{slugify(audio.stem)}.16k-mono.wav"
    return Paths(audio=audio, output_dir=output_dir, work_dir=work_dir, wav=wav)


def run(command: list[str]) -> None:
    print("+ " + " ".join(f'"{part}"' if " " in part else part for part in command))
    subprocess.run(command, check=True)


def find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        package_root = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        if package_root.exists():
            matches = sorted(package_root.rglob("ffmpeg.exe"))
            if matches:
                ffmpeg_path = str(matches[0])
                os.environ["PATH"] = f"{str(matches[0].parent)}{os.pathsep}{os.environ.get('PATH', '')}"
                return ffmpeg_path
    return None


def ensure_ffmpeg() -> str:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        fail("FFmpeg is not available in PATH. Install it with: winget install --id Gyan.FFmpeg -e")
    return ffmpeg


def prepare_wav(paths: Paths) -> None:
    ffmpeg = ensure_ffmpeg()
    if paths.wav.exists() and paths.wav.stat().st_mtime >= paths.audio.stat().st_mtime:
        print(f"Using existing preprocessed WAV: {paths.wav}")
        return

    print("Preparing clean 16 kHz mono WAV for ASR...")
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(paths.audio),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-c:a",
            "pcm_s16le",
            str(paths.wav),
        ]
    )


def select_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def select_compute_type(device: str, requested: str) -> str:
    if requested != "auto":
        return requested
    return "float16" if device == "cuda" else "int8"


def select_threads(requested: int) -> int:
    if requested > 0:
        return requested
    cpu_count = os.cpu_count() or 4
    return max(4, min(cpu_count - 1, 12))


def is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def can_import_mlx_whisper() -> bool:
    try:
        import mlx_whisper  # noqa: F401

        return True
    except Exception:
        return False


def resolve_asr_backend(requested: str) -> str:
    if requested == "mlx":
        if not can_import_mlx_whisper():
            fail("MLX backend requested but mlx-whisper is not installed. On Mac, run ./setup-mac.sh.")
        return "mlx"
    if requested == "whisperx":
        return "whisperx"
    if is_apple_silicon() and can_import_mlx_whisper():
        return "mlx"
    return "whisperx"


def resolve_mlx_model(model: str, requested: str) -> str:
    if requested != "auto":
        return requested
    mapping = {
        "large-v3": "mlx-community/whisper-large-v3-mlx",
        "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
        "medium": "mlx-community/whisper-medium-mlx",
        "small": "mlx-community/whisper-small-mlx",
        "base": "mlx-community/whisper-base-mlx",
        "tiny": "mlx-community/whisper-tiny",
    }
    return mapping.get(model, f"mlx-community/whisper-{model}-mlx")


def transcribe_with_mlx(paths: Paths, args: argparse.Namespace) -> dict[str, Any]:
    import mlx_whisper

    model_name = resolve_mlx_model(args.model, args.mlx_model)
    print(f"ASR backend: mlx-whisper")
    print(f"MLX model: {model_name}")
    print("Transcribing with MLX on Apple Silicon...")
    kwargs: dict[str, Any] = {
        "path_or_hf_repo": model_name,
        "language": args.language,
        "task": "transcribe",
        "word_timestamps": False,
        "verbose": False,
    }
    try:
        result = mlx_whisper.transcribe(str(paths.wav), **kwargs)
    except TypeError:
        kwargs.pop("verbose", None)
        result = mlx_whisper.transcribe(str(paths.wav), **kwargs)

    segments = []
    for segment in result.get("segments", []):
        text = " ".join(str(segment.get("text", "")).split())
        if not text:
            continue
        segments.append(
            {
                "start": float(segment.get("start", 0.0)),
                "end": float(segment.get("end", 0.0)),
                "text": text,
            }
        )

    return {
        "segments": segments,
        "language": result.get("language") or args.language,
        "text": result.get("text", ""),
        "asr_backend": "mlx",
        "mlx_model": model_name,
        "source_audio": str(paths.audio),
        "preprocessed_wav": str(paths.wav),
    }


def transcribe_with_whisperx(audio: Any, args: argparse.Namespace) -> tuple[dict[str, Any], str]:
    import gc

    import whisperx

    device = select_device(args.device)
    compute_type = select_compute_type(device, args.compute_type)
    print(f"ASR backend: whisperx/faster-whisper")
    print(f"Device: {device}")
    print(f"Compute type: {compute_type}")
    threads = select_threads(args.threads)
    print(f"CPU threads: {threads}")
    print(f"Model: {args.model}")

    print("Loading ASR model...")
    try:
        model = whisperx.load_model(
            args.model,
            device,
            compute_type=compute_type,
            language=args.language,
            threads=threads,
        )
    except ValueError as exc:
        if device == "cpu" and compute_type != "float32":
            print(f"Retrying on CPU with float32 after: {exc}")
            compute_type = "float32"
            model = whisperx.load_model(
                args.model,
                device,
                compute_type=compute_type,
                language=args.language,
                threads=threads,
            )
        else:
            raise

    print("Transcribing...")
    result = model.transcribe(audio, batch_size=args.batch_size, language=args.language)
    result["asr_backend"] = "whisperx"

    del model
    gc.collect()
    return result, device


def format_ts(seconds: float | None, sep: str = ",") -> str:
    if seconds is None:
        seconds = 0.0
    milliseconds = round(float(seconds) * 1000)
    hours, rest = divmod(milliseconds, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{millis:03d}"


def normalize_segments(result: dict[str, Any]) -> list[dict[str, Any]]:
    segments = result.get("segments", [])
    normalized: list[dict[str, Any]] = []
    for segment in segments:
        text = " ".join(str(segment.get("text", "")).split())
        if not text:
            continue
        normalized.append(
            {
                "start": float(segment.get("start", 0.0)),
                "end": float(segment.get("end", 0.0)),
                "speaker": segment.get("speaker", "SPEAKER_UNKNOWN"),
                "text": text,
                "words": segment.get("words", []),
            }
        )
    return normalized


def merge_turns(segments: list[dict[str, Any]], max_gap: float = 1.2) -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    for segment in segments:
        if (
            turns
            and turns[-1]["speaker"] == segment["speaker"]
            and segment["start"] - turns[-1]["end"] <= max_gap
        ):
            turns[-1]["end"] = max(turns[-1]["end"], segment["end"])
            turns[-1]["text"] = f'{turns[-1]["text"]} {segment["text"]}'.strip()
        else:
            turns.append({key: segment[key] for key in ("start", "end", "speaker", "text")})
    return turns


def write_txt(path: Path, turns: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for turn in turns:
            handle.write(
                f'[{format_ts(turn["start"], sep=".")} - {format_ts(turn["end"], sep=".")}] '
                f'{turn["speaker"]}: {turn["text"]}\n\n'
            )


def write_srt(path: Path, segments: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for index, segment in enumerate(segments, start=1):
            handle.write(f"{index}\n")
            handle.write(f'{format_ts(segment["start"])} --> {format_ts(segment["end"])}\n')
            handle.write(f'{segment["speaker"]}: {segment["text"]}\n\n')


def write_markdown(path: Path, turns: list[dict[str, Any]], source: Path) -> None:
    with path.open("w", encoding="utf-8") as handle:
        handle.write(f"# Transcription\n\n")
        handle.write(f"Source: `{source.name}`\n\n")
        for turn in turns:
            handle.write(
                f'**{turn["speaker"]}** '
                f'`{format_ts(turn["start"], sep=".")} - {format_ts(turn["end"], sep=".")}`\n\n'
            )
            handle.write(f'{turn["text"]}\n\n')


def write_outputs(paths: Paths, result: dict[str, Any]) -> None:
    stem = slugify(paths.audio.stem)
    segments = normalize_segments(result)
    turns = merge_turns(segments)

    raw_json = paths.output_dir / f"{stem}.whisperx.json"
    segments_json = paths.output_dir / f"{stem}.segments.json"
    txt = paths.output_dir / f"{stem}.speaker-turns.txt"
    srt = paths.output_dir / f"{stem}.speaker-segments.srt"
    md = paths.output_dir / f"{stem}.speaker-turns.md"

    with raw_json.open("w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    with segments_json.open("w", encoding="utf-8") as handle:
        json.dump({"segments": segments, "turns": turns}, handle, ensure_ascii=False, indent=2)
    write_txt(txt, turns)
    write_srt(srt, segments)
    write_markdown(md, turns, paths.audio)

    print("")
    print("Done. Files written:")
    for path in (txt, md, srt, segments_json, raw_json):
        print(f"- {path}")


def transcribe(paths: Paths, args: argparse.Namespace) -> dict[str, Any]:
    import gc

    import whisperx

    audio = whisperx.load_audio(str(paths.wav))
    backend = resolve_asr_backend(args.asr_backend)

    if backend == "mlx":
        result = transcribe_with_mlx(paths, args)
        device = "cpu"
    else:
        result, device = transcribe_with_whisperx(audio, args)

    result["source_audio"] = str(paths.audio)
    result["preprocessed_wav"] = str(paths.wav)

    print("Aligning timestamps...")
    model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
    result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)

    del model_a
    gc.collect()

    if args.no_diarization:
        print("Diarization skipped.")
        for segment in result.get("segments", []):
            segment["speaker"] = "SPEAKER_00"
        return result

    if not args.hf_token:
        fail("Hugging Face token missing. Pass --hf-token or set HUGGINGFACE_TOKEN.")

    print("Running speaker diarization with pyannote...")
    diarize_model = whisperx.diarize.DiarizationPipeline(token=args.hf_token, device=device)
    diarize_kwargs: dict[str, int] = {}
    if args.speakers:
        diarize_kwargs["num_speakers"] = args.speakers
    if args.min_speakers:
        diarize_kwargs["min_speakers"] = args.min_speakers
    if args.max_speakers:
        diarize_kwargs["max_speakers"] = args.max_speakers

    diarize_segments = diarize_model(audio, **diarize_kwargs)
    result = whisperx.assign_word_speakers(diarize_segments, result)
    return result


def main() -> None:
    args = parse_args()
    paths = build_paths(args)
    prepare_wav(paths)
    result = transcribe(paths, args)
    write_outputs(paths, result)
    if args.delete_work:
        paths.wav.unlink(missing_ok=True)
        print(f"Intermediate WAV deleted: {paths.wav}")
    else:
        print(f"Intermediate WAV kept for reuse: {paths.wav}")


if __name__ == "__main__":
    main()
