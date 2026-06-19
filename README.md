# Microwest Whisper

Application desktop Tauri pour transcrire localement des fichiers audio avec Whisper, diarisation optionnelle et exports DOCX, Markdown et SRT.

La version principale est maintenant l'app Tauri. L'ancienne interface Qt/PySide a ete retiree. Le moteur Python reste isole dans `engine/python` et est appele comme process par Tauri, afin de garder une migration progressive vers `whisper.cpp` ou `faster-whisper` possible plus tard.

## Structure

```text
src/                 Interface React/Vite
src-tauri/           Application Tauri et bridge Rust
engine/python/       Moteur transcription Python
docs/V2_PLAN.md      Audit V1 et plan d'architecture
tests/               Tests rapides du moteur Python
```

## Developpement

Prerequis:

- Node.js et npm;
- Rust et Cargo;
- Python 3.11;
- FFmpeg disponible via `imageio-ffmpeg` ou dans le PATH.

Installer le frontend et le moteur Python:

```bash
npm install
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -r engine/python/requirements.txt
```

Sur Mac Apple Silicon, ajoute le backend MLX:

```bash
python -m pip install -r engine/python/requirements-mac.txt
```

Lancer l'app:

```bash
npm run dev
```

Variables utiles:

- `MICROWEST_ENGINE_ROOT`: dossier qui contient `transcribe.py`, par defaut `engine/python`.
- `MICROWEST_PYTHON`: interpreteur Python a utiliser pour le moteur, par defaut `.venv/bin/python` ou `python3`.
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
- parametrage modele, langue, backend, diarisation, batch, threads et filtres audio;
- lancement de `engine/python/transcribe.py` en process separe;
- progression derivee des logs existants;
- exports attendus: DOCX, Markdown, SRT, TXT, JSON;
- apercu texte et historique JSONL.

## Tests

Les tests rapides ne chargent pas les modeles Whisper:

```bash
python3 -m unittest discover
cargo check --manifest-path src-tauri/Cargo.toml
npm run build:frontend
```

## Packaging final restant

En developpement, l'app utilise encore `.venv` ou `MICROWEST_PYTHON`. Pour un produit vendable sans installation manuelle:

- macOS: bundle Python standalone ou sidecar signe, FFmpeg inclus, notarisation Apple;
- Windows: Python embedded ou sidecar, FFmpeg inclus, code signing, attention antivirus;
- Linux: AppImage/deb/rpm avec sidecar ou moteur natif, compatibilite glibc/CUDA documentee;
- moyen terme: remplacer le sidecar Python par `whisper.cpp` ou `faster-whisper` derriere le meme contrat Tauri.
