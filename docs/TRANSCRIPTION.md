# Local transcription

The Rust backend uses FFmpeg to decode the selected recording to mono, 16 kHz PCM. It feeds successive audio chunks to Parakeet Ultra through sherpa-onnx and maps each segment to the original recording time. Skipping silent passages preserves those timestamps.

## Models and native resources

The app checks for Parakeet under `engine/whispercpp/models/parakeet-ultra-int8/` in its resources and then in the user's model directory. The latter can be overridden with `MICROWEST_MODEL_DIR`. Each downloaded file is checked against its pinned byte count and SHA-256 hash. Removing downloaded models in Settings also clears recognized Whisper files left by older versions.

The resource directory retains its historical name. The packaged executable in `engine/whispercpp/bin/<platform>/` is FFmpeg. Developers can point `MICROWEST_FFMPEG` at their own copy. The prep script copies FFmpeg and its build notice from the selected platform.

## Output and diagnostics

Each recording produces TXT, DOCX, and SRT exports. The history in the output folder also lets you reopen earlier transcripts. Set `MICROWEST_KEEP_TEMP_WAV=1` to inspect the preprocessed audio. The default processing timeout is eight hours and can be changed with `MICROWEST_TRANSCRIPTION_TIMEOUT_SECONDS`.
