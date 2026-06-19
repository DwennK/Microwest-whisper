# Microwest Whisper

Application desktop Tauri pour transcrire localement des fichiers audio avec un backend natif `whisper.cpp` et exports DOCX, Markdown, TXT, SRT et JSON.

La version principale est l'app Tauri/React. L'ancien moteur Python reste isole dans `engine/python` pour reference de migration, mais l'app Tauri appelle maintenant `whisper-cli` directement depuis Rust.

## Structure

```text
src/                 Interface React/Vite
src-tauri/           Application Tauri et bridge Rust
engine/whispercpp/   Racine packaging du backend natif whisper.cpp
engine/python/       Ancien moteur Python isole
docs/V2_PLAN.md      Audit V1 et plan d'architecture
tests/               Tests rapides du moteur Python
```

## Developpement

Prerequis:

- Node.js et npm;
- Rust et Cargo;
- en mode dev: `whisper-cli` et FFmpeg.

Installer le frontend:

```bash
npm install
```

Configurer le backend natif en mode dev:

```bash
export MICROWEST_WHISPER_CLI=/absolute/path/to/whisper-cli
export MICROWEST_FFMPEG=/absolute/path/to/ffmpeg
```

L'app peut télécharger les modèles `large-v3-turbo-q8_0` ou `large-v3-turbo-q5_0` au premier usage. Pour forcer un modèle local en développement, utilise `MICROWEST_WHISPER_MODEL`.

Lancer l'app:

```bash
npm run dev
```

Variables utiles:

- `MICROWEST_WHISPER_CPP_ROOT`: dossier racine du backend natif, par defaut `engine/whispercpp`.
- `MICROWEST_WHISPER_CLI`: executable `whisper-cli` a utiliser en developpement.
- `MICROWEST_FFMPEG`: executable FFmpeg a utiliser en developpement.
- `MICROWEST_WHISPER_MODEL`: modele GGML/GGUF local a utiliser en developpement.
- `MICROWEST_MODEL_DIR`: dossier alternatif pour les modèles téléchargés en developpement.
- `MICROWEST_LICENSE_API_BASE`: API licence alternative, par defaut `https://iaswiss.com/api/licenses`.
- `MICROWEST_LICENSE_STATE`: chemin de test pour le fichier `license.json`.

## Build desktop

```bash
npm run build
```

Le build Tauri prepare d'abord les ressources `whisper.cpp` pour la plateforme courante, lance `tsc && vite build`, compile l'application Rust, puis produit les bundles.

Les binaires natifs restent hors Git. Avant un build release, place les fichiers dans `engine/whispercpp/bin/<platform>/`, puis `npm run build` copie uniquement la plateforme courante vers `src-tauri/resources/engine/whispercpp`.

Pour preparer explicitement une autre plateforme:

```bash
MICROWEST_BUNDLE_PLATFORM=windows-x86_64 npm run prepare:whispercpp
```

## Auto-update

L'app inclut un bouton de verification manuelle des mises a jour via GitHub Releases. Les builds de tags `v*` generent les signatures Tauri et le manifeste `latest.json`; les builds classiques sur `main` ne signent pas d'artefacts updater.

Voir [docs/UPDATER.md](docs/UPDATER.md) pour les secrets GitHub et le flux de publication.

## Licence

L'app appelle uniquement l'API licence IA Swiss:

- activation: `POST https://iaswiss.com/api/licenses/activate`;
- validation: `POST https://iaswiss.com/api/licenses/validate`.

Payload envoye:

```json
{
  "licenseKey": "MW-XXXXX-XXXXX-XXXXX-XXXXX",
  "machineId": "machine-id-local",
  "appVersion": "0.2.0"
}
```

Aucune cle Stripe n'est embarquee dans l'application. Le backend IA Swiss verifie l'abonnement actif.

## Fonctionnalites actuelles

- validation de licence au lancement;
- activation et validation via l'API IA Swiss existante;
- selection audio et dossier output via les dialogues Tauri;
- parametrage modele, langue, threads, device CPU et filtres audio;
- téléchargement à la demande du modèle local `large-v3-turbo-q8_0` ou `large-v3-turbo-q5_0`;
- suppression des modèles téléchargés depuis l'app;
- lancement de `whisper-cli` en process separe depuis le backend Rust;
- progression derivee des logs existants;
- conversion audio vers WAV 16 kHz mono via FFmpeg;
- exports attendus: DOCX, Markdown, SRT, TXT, segments JSON, historique JSONL;
- apercu texte et historique JSONL.

## Tests

Les tests rapides ne chargent pas les modeles Whisper:

```bash
python3 -m unittest discover
cargo check --manifest-path src-tauri/Cargo.toml
npm run build:frontend
```

## Packaging final restant

En developpement, l'app peut utiliser les variables `MICROWEST_WHISPER_CLI`, `MICROWEST_FFMPEG` et `MICROWEST_WHISPER_MODEL`. Pour un produit vendable sans installation manuelle:

- macOS: bundle `whisper-cli` et FFmpeg, executables signes, notarisation Apple;
- Windows: bundle `whisper-cli.exe`, ses DLLs `whisper.cpp`/GGML et `ffmpeg.exe`, code signing, attention antivirus;
- Linux: AppImage/deb/rpm avec `whisper-cli` et FFmpeg, compatibilite glibc documentee;
- garder les modèles hors Git et les télécharger dans le dossier data utilisateur;
- ajouter les binaires par plateforme dans `engine/whispercpp/bin/<plateforme>/` avant les builds release.
