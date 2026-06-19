# Backend whisper.cpp

## Etat livre

- Tauri appelle un backend Rust natif, sans moteur Python.
- Le backend cherche `whisper-cli`, FFmpeg et un modele local au demarrage.
- Si le modele selectionne est absent, l'UI peut le télécharger depuis `ggerganov/whisper.cpp`.
- La conversion audio passe par FFmpeg vers WAV PCM 16 kHz mono.
- `whisper-cli` est appele avec sortie JSON et SRT.
- Les segments sont normalises sans diarisation ni labels locuteur.
- L'execution surveille FFmpeg et `whisper-cli` avec annulation, timeout et messages d'erreur par composant.
- Les WAV temporaires sont nettoyes automatiquement apres transcription, sauf si `MICROWEST_KEEP_TEMP_WAV=1`.
- L'UI expose la plateforme et l'architecture detectees pour diagnostiquer les bundles natifs.
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
- L'UI permet de supprimer les modèles téléchargés.

## Resolution des binaires

Ordre de resolution:

1. Variables d'environnement:
   - `MICROWEST_WHISPER_CLI`
   - `MICROWEST_FFMPEG`
   - `MICROWEST_WHISPER_MODEL`
2. Racine optionnelle `MICROWEST_WHISPER_CPP_ROOT`.
3. Dossier repo ou ressource Tauri `engine/whispercpp`.
4. Dossier modèles téléchargés de l'utilisateur.
5. `PATH` pour `whisper-cli` et FFmpeg en mode dev.

Timeout:

- Par defaut chaque commande externe peut tourner jusqu'a 8 heures.
- `MICROWEST_TRANSCRIPTION_TIMEOUT_SECONDS` permet de reduire ou augmenter ce delai.

Les modèles téléchargés sont stockés hors Git:

- macOS: `~/Library/Application Support/Microwest Whisper/models/`
- Windows: `%LOCALAPPDATA%\Microwest Whisper\models\`
- Linux: `$XDG_DATA_HOME/microwest-whisper/models/` ou `~/.local/share/microwest-whisper/models/`

Variables utiles:

- `MICROWEST_MODEL_DIR`: dossier alternatif pour tests/developpement.
- `MICROWEST_WHISPER_MODEL`: force un fichier modèle précis et court-circuite la resolution standard.

Layout cible:

```text
engine/whispercpp/
  bin/<platform>/whisper-cli
  bin/<platform>/ffmpeg
  models/ggml-large-v3-turbo-q8_0.bin
```

`<platform>` vaut par exemple `macos-aarch64`, `macos-x86_64`, `windows-x86_64` ou `linux-x86_64`.

Pendant le build, `scripts/prepare-whispercpp-resources.mjs` copie uniquement la plateforme courante vers `src-tauri/resources/engine/whispercpp`, puis Tauri embarque ce dossier comme ressource `engine/whispercpp`. Cela evite de mettre les binaires Windows dans le DMG macOS, ou les binaires macOS dans l'installeur Windows.

Pour verifier une plateforme depuis une autre machine:

```bash
MICROWEST_BUNDLE_PLATFORM=windows-x86_64 npm run prepare:whispercpp
```

Sur Windows, `whisper-cli.exe` doit etre accompagne des DLLs fournies par le paquet `whisper.cpp` (`whisper.dll`, `ggml*.dll`, etc.).

## Modeles telecharges

Modeles supportes:

- `large-v3-turbo-q8_0`: `ggml-large-v3-turbo-q8_0.bin`, 874188075 octets, environ 834 MiB.
- `large-v3-turbo-q5_0`: `ggml-large-v3-turbo-q5_0.bin`, 574041195 octets, environ 547 MiB.

Le téléchargement utilise un fichier temporaire `.part`, puis renomme le fichier seulement après verification taille + SHA-256.

Nettoyage:

- macOS DMG drag-and-drop: pas de hook d'uninstall système. L'utilisateur supprime les modèles depuis l'app avant de jeter l'app.
- Windows NSIS: `src-tauri/windows/hooks.nsh` supprime le dossier modèles pendant la désinstallation.

## Packaging restant

- Compiler ou recuperer des binaires `whisper-cli` par plateforme.
- Compiler ou recuperer FFmpeg par plateforme avec licence compatible distribution.
- Valider les binaires `whisper-cli`/FFmpeg dans les bundles packagés.
- Signer/notariser macOS, signer Windows, valider Linux AppImage/deb/rpm.
- Valider les exports sur un panel de fichiers longs avant release commerciale.
