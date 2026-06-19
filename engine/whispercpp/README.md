# Native whisper.cpp engine

This directory is the packaging root for the native Microwest Whisper backend.

Expected layout for a packaged build:

```text
engine/whispercpp/
  bin/
    macos-aarch64/whisper-cli
    macos-aarch64/ffmpeg
    macos-x86_64/whisper-cli
    macos-x86_64/ffmpeg
    windows-x86_64/whisper-cli.exe
    windows-x86_64/ffmpeg.exe
    linux-x86_64/whisper-cli
    linux-x86_64/ffmpeg
  models/
    ggml-large-v3-turbo-q8_0.bin
    ggml-large-v3-turbo-q5_0.bin
```

Development overrides:

- `MICROWEST_WHISPER_CPP_ROOT`: alternate directory with the same layout.
- `MICROWEST_WHISPER_CLI`: absolute path to a `whisper-cli` executable.
- `MICROWEST_FFMPEG`: absolute path to an FFmpeg executable.
- `MICROWEST_WHISPER_MODEL`: absolute path to a local GGML/GGUF model.

The Tauri app currently resolves these paths at runtime. Final release packaging
still needs signed per-platform `whisper-cli` and FFmpeg binaries plus one chosen
local model in `models/`.
