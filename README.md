# Microwest Whisper

Microwest Whisper est une application desktop Tauri/React qui transcrit des fichiers audio localement avec un backend natif `whisper.cpp`.

L'objectif produit est simple: l'utilisateur final installe l'app et n'a pas à installer Python, FFmpeg, Node, Whisper ou un token Hugging Face.

## Etat actuel

- Application desktop Tauri v2 + React/Vite.
- Backend natif Rust qui lance `whisper-cli`.
- Conversion audio via FFmpeg vers WAV PCM 16 kHz mono.
- Modèles Whisper GGML téléchargés à la demande, hors Git.
- Pas de diarisation, pas de pyannote, pas de labels locuteur.
- Licence IA Swiss conservée.
- Auto-update manuel via GitHub Releases.
- Builds CI macOS, Windows et Linux.

## Fonctionnalités

- Sélection d'un fichier audio et d'un dossier de sortie.
- Validation et activation de licence IA Swiss.
- Choix du modèle `large-v3-turbo-q8_0` ou `large-v3-turbo-q5_0`.
- Téléchargement et suppression des modèles depuis l'app.
- Transcription locale avec segments horodatés.
- Exports générés:
  - Markdown;
  - TXT propre;
  - SRT;
  - DOCX;
  - segments JSON;
  - JSON brut `whisper.cpp`;
  - historique JSONL.

## Structure

```text
src/                         Interface React/Vite
src-tauri/                   Application Tauri et backend Rust
src-tauri/src/license.rs     Licence IA Swiss
src-tauri/src/transcription.rs
                             Backend transcription whisper.cpp
engine/whispercpp/           Racine des binaires natifs et modèles locaux
scripts/                     Préparation ressources et manifests release
docs/                        Notes backend et updater
```

## Prérequis développement

Pour développer l'app, il faut installer localement:

- Node.js + npm;
- Rust + Cargo;
- Python 3 pour le script de récupération des binaires natifs.

L'utilisateur final n'a pas besoin de ces outils.

## Installation dev

```bash
npm install
```

Récupérer les binaires natifs pour la plateforme courante:

```bash
python3 scripts/fetch-whispercpp-binaries.py
```

Lancer l'app en développement:

```bash
npm run dev
```

## Backend whisper.cpp

En développement, l'app résout `whisper-cli`, FFmpeg et les modèles dans cet ordre:

1. Variables d'environnement explicites.
2. Ressources `engine/whispercpp`.
3. Dossier data utilisateur.
4. `PATH`, seulement en mode dev.

Variables utiles:

```bash
export MICROWEST_WHISPER_CLI=/absolute/path/to/whisper-cli
export MICROWEST_FFMPEG=/absolute/path/to/ffmpeg
export MICROWEST_WHISPER_MODEL=/absolute/path/to/model.bin
export MICROWEST_MODEL_DIR=/absolute/path/to/models
```

Plateformes de binaires attendues:

```text
engine/whispercpp/bin/macos-aarch64/
engine/whispercpp/bin/macos-x86_64/
engine/whispercpp/bin/windows-x86_64/
engine/whispercpp/bin/linux-x86_64/
```

Sur Windows, `whisper-cli.exe` doit être accompagné des DLLs `whisper.cpp`/GGML nécessaires.

## Modèles

Les modèles ne sont pas commités dans Git.

Modèles supportés:

- `large-v3-turbo-q8_0`: environ 834 MiB.
- `large-v3-turbo-q5_0`: environ 547 MiB.

L'app télécharge le modèle choisi au premier usage et vérifie taille + SHA-256 avant installation.

Emplacements par défaut:

```text
macOS    ~/Library/Application Support/Microwest Whisper/models/
Windows  %LOCALAPPDATA%\Microwest Whisper\models\
Linux    ~/.local/share/microwest-whisper/models/
```

Nettoyage:

- Depuis l'app: bouton `Supprimer modèles`.
- Windows NSIS: le désinstalleur supprime le dossier modèles.
- macOS drag-and-drop: il n'y a pas de hook système à la suppression de l'app; supprimer les modèles depuis l'app avant de jeter l'app.

## Build desktop

Build local pour la plateforme courante:

```bash
npm run build
```

Le build exécute:

1. `npm run prepare:whispercpp`;
2. `npm run build:frontend`;
3. `tauri build`;
4. génération des bundles desktop.

Préparer explicitement une autre plateforme:

```bash
MICROWEST_BUNDLE_PLATFORM=windows-x86_64 npm run prepare:whispercpp
```

## Releases et auto-update

Les mises à jour passent par GitHub Releases.

Endpoint utilisé par l'app:

```text
https://github.com/DwennK/Microwest-whisper/releases/latest/download/latest.json
```

Publier une release:

1. Bumper la version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json`.
2. Committer.
3. Créer un tag `vX.Y.Z`.
4. Pousser `main` puis le tag.
5. GitHub Actions construit macOS, Windows et Linux.
6. Le workflow génère les signatures updater, `latest.json` et `SHA256SUMS.txt`.
7. La release GitHub publie les installateurs, signatures, checksums et le manifeste updater.

Commande release locale:

```bash
npm run build:release
```

Secrets GitHub nécessaires:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` si la clé est protégée par mot de passe.

Voir [docs/UPDATER.md](docs/UPDATER.md).

## Licence IA Swiss

L'app appelle l'API licence IA Swiss:

```text
POST https://iaswiss.com/api/licenses/activate
POST https://iaswiss.com/api/licenses/validate
```

Payload:

```json
{
  "licenseKey": "MW-XXXXX-XXXXX-XXXXX-XXXXX",
  "machineId": "machine-id-local",
  "appVersion": "0.2.2"
}
```

Aucune clé Stripe n'est embarquée dans l'application. Le backend IA Swiss vérifie l'abonnement.

Variables dev utiles:

```bash
export MICROWEST_LICENSE_API_BASE=https://iaswiss.com/api/licenses
export MICROWEST_LICENSE_STATE=/tmp/microwest-license.json
```

## Tests

```bash
npm run build:frontend
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

## Documentation

- [docs/WHISPER_CPP_BACKEND.md](docs/WHISPER_CPP_BACKEND.md): détails du backend natif.
- [docs/UPDATER.md](docs/UPDATER.md): signature et publication auto-update.

## Notes packaging

Avant une distribution commerciale complète:

- signer et notariser macOS;
- signer Windows pour réduire les alertes SmartScreen/antivirus;
- valider les bundles Linux AppImage/deb/rpm sur distributions cibles;
- vérifier la licence de redistribution FFmpeg selon les binaires utilisés.

L'app expose aussi un écran `À propos` avec version, backend, plateforme, licence, endpoint updater et chemins locaux.
