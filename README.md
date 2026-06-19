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
- en mode dev: `whisper-cli`, FFmpeg et un modele GGML/GGUF local.

Installer le frontend:

```bash
npm install
```

Configurer le backend natif en mode dev:

```bash
export MICROWEST_WHISPER_CLI=/absolute/path/to/whisper-cli
export MICROWEST_FFMPEG=/absolute/path/to/ffmpeg
export MICROWEST_WHISPER_MODEL=/absolute/path/to/ggml-large-v3-turbo-q8_0.bin
```

Lancer l'app:

```bash
npm run dev
```

Variables utiles:

- `MICROWEST_WHISPER_CPP_ROOT`: dossier racine du backend natif, par defaut `engine/whispercpp`.
- `MICROWEST_WHISPER_CLI`: executable `whisper-cli` a utiliser en developpement.
- `MICROWEST_FFMPEG`: executable FFmpeg a utiliser en developpement.
- `MICROWEST_WHISPER_MODEL`: modele GGML/GGUF local a utiliser en developpement.
- `MICROWEST_LICENSE_API_BASE`: API licence alternative, par defaut `https://iaswiss.com/api/licenses`.
- `MICROWEST_LICENSE_STATE`: chemin de test pour le fichier `license.json`.

## Build desktop

```bash
npm run build
```

Le build Tauri lance `tsc && vite build`, compile l'application Rust, puis produit les bundles de la plateforme courante.

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

- macOS: bundle `whisper-cli`, FFmpeg et modele local, executables signes, notarisation Apple;
- Windows: bundle `whisper-cli.exe`, `ffmpeg.exe` et modele local, code signing, attention antivirus;
- Linux: AppImage/deb/rpm avec `whisper-cli`, FFmpeg et modele local, compatibilite glibc documentee;
- choisir le modele final a livrer: `large-v3-turbo-q8_0` pour qualite/taille elevee, ou `large-v3-turbo-q5_0` pour un bundle plus leger;
- ajouter les binaires par plateforme dans `engine/whispercpp/bin/<plateforme>/` avant les builds release.
