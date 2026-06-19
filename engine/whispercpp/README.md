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
    windows-x86_64/*.dll
    linux-x86_64/whisper-cli
    linux-x86_64/ffmpeg
  models/
    optional preloaded GGML/GGUF models
```

Development overrides:

- `MICROWEST_WHISPER_CPP_ROOT`: alternate directory with the same layout.
- `MICROWEST_WHISPER_CLI`: absolute path to a `whisper-cli` executable.
- `MICROWEST_FFMPEG`: absolute path to an FFmpeg executable.
- `MICROWEST_WHISPER_MODEL`: absolute path to a local GGML/GGUF model.
- `MICROWEST_MODEL_DIR`: alternate directory for downloaded models.

The Tauri app resolves these paths at runtime. Final release packaging still
needs signed per-platform `whisper-cli` and FFmpeg binaries. On Windows,
keep the `whisper.cpp`/GGML DLLs next to `whisper-cli.exe`.

`npm run build` runs `scripts/prepare-whispercpp-resources.mjs`, which stages
only the current platform into `src-tauri/resources/engine/whispercpp` before
Tauri bundles the app.

Models are downloaded on demand into the user's app data directory unless a
model is preloaded here or forced with `MICROWEST_WHISPER_MODEL`.
