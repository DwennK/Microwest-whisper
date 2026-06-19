# Backend whisper.cpp

## Etat livre

- Tauri appelle un backend Rust natif, sans lancer `engine/python/transcribe.py`.
- Le backend cherche `whisper-cli`, FFmpeg et un modele local au demarrage.
- La conversion audio passe par FFmpeg vers WAV PCM 16 kHz mono.
- `whisper-cli` est appele avec sortie JSON et SRT.
- Les segments sont normalises sans diarisation ni labels `SPEAKER_00`.
- Les exports generes sont:
  - `*.transcript.txt`
  - `*.transcript.md`
  - `*.clean.txt`
  - `*.segments.srt`
  - `*.segments.json`
  - `*.transcript.docx`
  - `*.whispercpp.json`
  - `transcription-history.jsonl`
- La licence IA Swiss reste geree par `src-tauri/src/license.rs`.
- L'UI ne montre plus les options diarisation, pyannote, Hugging Face ou renommage locuteurs.

## Resolution des binaires

Ordre de resolution:

1. Variables d'environnement:
   - `MICROWEST_WHISPER_CLI`
   - `MICROWEST_FFMPEG`
   - `MICROWEST_WHISPER_MODEL`
2. Racine optionnelle `MICROWEST_WHISPER_CPP_ROOT`.
3. Dossier repo ou ressource Tauri `engine/whispercpp`.
4. `PATH` pour `whisper-cli` et FFmpeg en mode dev.

Layout cible:

```text
engine/whispercpp/
  bin/<platform>/whisper-cli
  bin/<platform>/ffmpeg
  models/ggml-large-v3-turbo-q8_0.bin
```

`<platform>` vaut par exemple `macos-aarch64`, `macos-x86_64`, `windows-x86_64` ou `linux-x86_64`.

## Packaging restant

- Compiler ou recuperer des binaires `whisper-cli` par plateforme.
- Compiler ou recuperer FFmpeg par plateforme avec licence compatible distribution.
- Choisir le modele livre par defaut:
  - `large-v3-turbo-q8_0`: qualite recommandee, bundle plus lourd.
  - `large-v3-turbo-q5_0`: alternative plus legere.
- Ajouter ces fichiers au bundle Tauri et valider les chemins en app packagee.
- Signer/notariser macOS, signer Windows, valider Linux AppImage/deb/rpm.
- Supprimer definitivement `engine/python` quand la parite de production est confirmee.
