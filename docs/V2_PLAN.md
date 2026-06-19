# Plan Tauri

## Audit de l'ancienne app

Fichiers principaux avant migration:

- `gui.py`: application PySide6, onglets Audio, Reglages, Execution, Resultats, Historique et Parametres.
- `transcribe.py`: CLI moteur avec preparation FFmpeg, WhisperX/MLX, diarisation pyannote, checkpoints et exports.
- `license_client.py`: client licence IA Swiss, cache local et machine id.
- `transcript_paths.py`: contrat de nommage stable des fichiers output.
- `pyproject.toml` et `requirements*.txt`: dependances Python critiques.

Transcription:

- l'ancienne UI lancait `.venv/bin/python -u transcribe.py ...` via `QProcess`;
- les logs stdout/stderr pilotaient la progression;
- `transcribe.py` validait la licence avant de calculer;
- les checkpoints vivaient dans `work`, les outputs dans `output`.

Exports conserves:

- `*.speaker-turns.txt`
- `*.speaker-turns.md`
- `*.clean.txt`
- `*.speaker-segments.srt`
- `*.segments.json`
- `*.notes.md`
- `*.transcript.docx`
- `*.whisperx.json`
- `transcription-history.jsonl`

Licence:

- API par defaut: `https://iaswiss.com/api/licenses`;
- activation: `POST /activate` avec `licenseKey`, `machineId`, `appVersion`;
- validation: `POST /validate` avec les memes champs;
- le backend refuse les licences sans abonnement Stripe actif;
- l'app Tauri stocke `license.json` dans le meme emplacement que l'ancienne version pour eviter une reactivation inutile.

Dependances critiques du moteur:

- Python 3.11;
- `whisperx==3.8.6`;
- `python-docx==1.2.0`;
- `imageio-ffmpeg==0.6.0`;
- `mlx-whisper==0.4.3` sur Mac Apple Silicon;
- token Hugging Face seulement si diarisation activee.

## Architecture actuelle

Structure:

```text
src/                 UI React/Vite
src-tauri/src/       commandes Rust Tauri
  license.rs         client licence compatible avec l'ancien cache
  transcription.rs   bridge process vers le moteur Python
  paths.rs           contrat outputs
engine/python/       moteur Python isole
docs/V2_PLAN.md
```

Frontend:

- React + TypeScript + Vite;
- UI operationnelle en cinq ecrans: Licence, Audio, Reglages, Progression, Resultats;
- dialogues fichiers via plugin Tauri.

Bridge Tauri:

- commandes `activate_license`, `validate_license`, `engine_status`, `start_transcription`, `expected_outputs`, `read_history`, `read_text_preview`;
- evenement `transcription-event` pour les logs et la progression;
- `engine/python/transcribe.py` reste un process separe afin de garder le moteur isolable.

Packaging moteur:

- Phase 1: sidecar Python existant, pilote par `MICROWEST_ENGINE_ROOT` et `MICROWEST_PYTHON`;
- Phase 2: bundle Python standalone ou PyInstaller sidecar avec FFmpeg;
- Phase 3: remplacement progressif par `whisper.cpp` ou `faster-whisper` derriere le meme contrat Tauri.

Risques Windows/macOS:

- taille et signature du bundle si Python, Torch et WhisperX sont inclus;
- telechargement initial des modeles Whisper/Hugging Face;
- notarisation macOS avec sidecars executables;
- false positives antivirus Windows pour un sidecar Python ou FFmpeg;
- CUDA/GPU Windows: versions drivers, torch et compute type;
- Apple Silicon: MLX favorable, mais fallback WhisperX necessaire.
