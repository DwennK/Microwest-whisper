# Dependency maintenance — 2026-09-15

## Updated

- Frontend dependencies use current stable releases, including React 19.3.0,
  Vite 8.3.0, Vitest 5.0.1, jsdom 30.0.1 and Tauri updater 2.11.0.
- Cargo.lock refreshes compatible direct and transitive dependencies.
  rustls 0.23.45 fixes RUSTSEC-2026-0285; chacha20 0.10.2 replaces a yanked release.
- whisper.cpp 1.9.4 is compiled from its SHA-256-pinned source on a matching
  macOS, Windows or Linux host. Metal is enabled on macOS. Native CPU tuning is
  disabled to avoid baking the CI runner's CPU features into distributed binaries.
- imageio-ffmpeg 0.6.0 remains the latest upstream package. Existing verified
  archive hashes and FFmpeg license checks are preserved.
- Node.js 24 remains the CI runtime. A newer non-LTS major is not required.

Some transitive crates remain at versions explicitly pinned by their upstream
parents (generic-array and the older TOML parsing stack). Cargo cannot upgrade
these independently without changing the parent dependency constraints.

## Audit boundaries

`npm audit` reports zero known vulnerabilities. `cargo audit` reports zero
vulnerability entries after the rustls update, but retains these upstream warnings:

- RUSTSEC-2024-0429: glib 0.18.5 has an unsound iterator implementation.
  Tauri's Linux GTK/WebKit dependency chain still requires glib 0.18;
  the upstream fix is in glib 0.20 or later. Updating it independently would
  require migrating the GTK dependency chain. This warning is not suppressed.
- Six unmaintained dependency warnings: proc-macro-error and five unic crates.
  These are transitive dependencies. No local fork or audit exclusion is added.

A clean audit is not proof that every native library has no vulnerability.
Existing installations receive these changes only after a new public release.

## Validation

Run with Node.js 24:

```sh
npm ci
npm test
npm run build:frontend
npm run verify:native-manifest
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
python3 scripts/fetch-whispercpp-binaries.py
npm run build
```

Local validation: 13 frontend tests, 18 native tests (plus the subprocess helper),
frontend compilation, the macOS application bundle and a real transcription of
the upstream JFK sample using large-v3-turbo-q8_0 with Metal. GitHub Actions validates and
builds the same commit on Linux, macOS and Windows. Public releases retain the
existing certificate and notarization requirements.
