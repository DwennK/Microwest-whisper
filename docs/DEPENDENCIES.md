# Dependency maintenance — 2026-11-26

## Versions

- React 19.3.1, Vite 8.4.0, Vitest 5.1.2, jsdom 31.0.1 and jest-dom 8.0.0.
- Tauri 2.12.7 (Rust), 2.12.5 (JavaScript API) and 2.12.6 (CLI). Both updater plugins use 2.14.1.
- Parakeet Ultra INT8 runs with sherpa-onnx 2.0.3 linked into the Rust application.
  The three ONNX files and vocabulary are pinned by revision, size and SHA-256 in `src-tauri/src/model_assets.rs`.
- The Word exporter and the Tauri dependency tree now share zip 9.8.2.
- The native dependency manifest pins the five imageio-ffmpeg 0.8.1 wheels and their SHA-256 checksums.
- CI uses Node.js 26 LTS and Python 3.15.

## Audit

npm audit and cargo audit reported no known vulnerabilities in the lockfiles.
RustSec reports five unmaintained crates: chrono, proc-macro-error, zbus_names,
zvariant and zvariant_derive. Each is already at the newest version allowed by its
parent or by the application.

RustSec also reports RUSTSEC-2024-0429 for glib 0.18.5 in Tauri's Linux GTK
dependencies. The fix requires glib 0.20 or later. The current GTK dependency
chain requires glib 0.18.

## Validation

For the original 0.4.0 release on Windows x64, 34 frontend tests, 21 Rust tests and 7 release tooling tests
passed. FFmpeg converted a five-second audio sample to mono PCM at 16 kHz,
and whisper.cpp transcribed it with the large-v3-turbo-q8_0 model.
The Parakeet integration also transcribed a 133-second French recording and wrote
SRT, TXT and DOCX exports.

Run from the repository root with the platform build tools installed:

```sh
npm ci
npm outdated
npm audit
npm test
npm run build:frontend
node --test scripts/check-release.mjs
npm run verify:native-manifest
python3 scripts/fetch-whispercpp-binaries.py
npm run prepare:whispercpp
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
npm run build
```
