# Microwest Whisper

Microwest Whisper est une application desktop Tauri/React qui transcrit des fichiers audio localement avec un backend natif `whisper.cpp`.

L'objectif produit est simple: l'utilisateur final installe l'app et n'a pas à installer Python, FFmpeg, Node, Whisper ou un token externe.

## Etat actuel

- Application desktop Tauri v2 + React/Vite.
- Backend natif Rust qui lance `whisper-cli`.
- Conversion audio via FFmpeg vers WAV PCM 16 kHz mono.
- Modèles Whisper GGML téléchargés à la demande, hors Git.
- Pas de diarisation ni de labels locuteur dans la version actuelle.
- Licence IA Swiss conservée.
- Auto-update manuel via GitHub Releases.
- Checksums SHA-256 publiés comme asset et dans les notes GitHub Releases.
- Releases Mac Apple Silicon et Windows x64 ; tests CI sur Linux.

## Fonctionnalités

- Sélection d'un fichier audio et d'un dossier de sortie.
- Validation et activation de licence IA Swiss.
- Choix du modèle `large-v3-turbo-q8_0` ou `large-v3-turbo-q5_0`.
- Téléchargement et suppression des modèles depuis l'app.
- Transcription locale avec segments horodatés.
- Recherche dans la transcription, édition légère des segments et copie du texte.
- Lecteur audio synchronisé: clic sur un timestamp, lecture/pause et sauts clavier de 5 secondes.
- Préférences de transcription et dossier de sortie conservés localement.
- Aperçu SRT et export dédié des segments sélectionnés.
- Trois exports utilisateur : sous-titres SRT, texte propre et document Word.
- Historique technique conservé dans un fichier masqué ; anciens exports conservés.

## Diarisation

La version actuelle ne produit pas de diarisation. Les dossiers locaux ignorés par Git (`output/`, `Transcriptions/`, `work/`, `output-v2/`, `work-v2/`) peuvent contenir des sorties locales ou d'anciens essais de segmentation locuteur; ces fichiers sont des artefacts de développement hérités et ne font pas partie du contrat produit actuel.

La roadmap proposée pour une future diarisation est documentée dans [docs/DIARIZATION_V2.md](docs/DIARIZATION_V2.md).

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
- Python 3 pour le script de récupération des binaires natifs;
- CMake pour compiler la source `whisper.cpp` épinglée sur macOS.

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

### Tester sans licence en développement

```bash
MICROWEST_LICENSE_BYPASS=1 npm run dev
```

L’interface affiche **Mode développement**. Cette option ne fonctionne que dans les builds Rust avec `debug_assertions` (développement/debug). Elle ne contacte pas l’API licence et n’enregistre aucune licence. Les builds de production ignorent cette variable. Relancer sans cette variable pour tester le parcours normal d’activation.

### Parcours de transcription

Choisir un fichier dans **Audio**, puis cliquer sur **Transcrire**. Les **Réglages** restent accessibles dans la barre latérale et depuis l’écran Audio ; les préférences précédentes sont conservées. Un modèle manquant peut être téléchargé directement depuis Audio.

L’écran **Résultats** rassemble le lecteur, la recherche et la correction du texte. **Enregistrer les corrections** met à jour les fichiers complets ; **Exporter la sélection** génère des fichiers séparés pour les passages choisis. Changer de fichier ou de dossier avec des corrections en attente propose de les enregistrer, de les abandonner ou de rester.

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

Emplacements par défaut des transcriptions:

```text
macOS    ~/Documents/Microwest Whisper/Transcriptions/
Windows  %USERPROFILE%\Documents\Microwest Whisper\Transcriptions\
Linux    ~/Documents/Microwest Whisper/Transcriptions/
```

Les fichiers temporaires sont placés par défaut dans le dossier `work/` voisin.

Emplacements par défaut:

```text
macOS    ~/Library/Application Support/Microwest Whisper/models/
Windows  %LOCALAPPDATA%\Microwest Whisper\models\
Linux    ~/.local/share/microwest-whisper/models/
```

Nettoyage:

- Depuis l'app: bouton `Supprimer modèles`.
- Windows NSIS: le désinstalleur supprime le dossier modèles uniquement lors d'une désinstallation complète, pas pendant une mise à jour.
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
5. GitHub Actions construit Mac Apple Silicon (`.dmg`) et Windows x64 (`.exe`).
6. Le workflow génère les signatures updater, `latest.json` et `SHA256SUMS.txt`.
7. La release GitHub publie les installateurs, signatures, checksums et le manifeste updater.

Commande release locale:

```bash
npm run build:release
```

Secrets GitHub nécessaires:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` si la clé est protégée par mot de passe.

Aucun certificat payant Apple ou Windows n'est nécessaire. Le Mac utilise une signature locale ad hoc, sans notarisation ; l'installateur Windows n'est pas signé par un éditeur certifié. Les avertissements et blocages possibles à l'installation sont décrits dans [docs/RELEASE_INSTALLATION.md](docs/RELEASE_INSTALLATION.md).

La clé Tauri reste obligatoire pour vérifier l'authenticité des mises à jour. Les pushes ordinaires sur `main` exécutent les tests sans compiler d'installateurs. Les tags `v*` exécutent les tests, les deux builds puis la publication ; un lancement manuel sur un tag permet de reprendre une publication. Les artefacts Actions intermédiaires sont conservés un jour ; les fichiers de release restent disponibles. Les anciennes releases Linux sont conservées.

Voir [docs/UPDATER.md](docs/UPDATER.md).

## Licence IA Swiss

L'app appelle l'API licence IA Swiss:

```text
POST https://licences.iaswiss.com/api/licenses/activate
POST https://licences.iaswiss.com/api/licenses/validate
```

Payload:

```json
{
  "licenseKey": "MW-XXXXX-XXXXX-XXXXX-XXXXX",
  "machineId": "machine-id-local",
  "appVersion": "0.3.1"
}
```

Aucune clé privée de signature ni clé Stripe n'est embarquée dans l'application. Le backend IASwiss vérifie l'abonnement ou la licence offerte. Les anciennes routes `iaswiss.com/api/licenses/*` restent compatibles.

Depuis **0.3.4**, le cache doit contenir un droit Ed25519 signé par IASwiss, lié à la licence, au produit `microwest-whisper`, à l'identifiant d'installation et à une expiration (7 jours par défaut). Le code natif vérifie ce droit avant d'autoriser une transcription. Modifier `valid_until` ou inventer un fichier JSON ne donne aucun accès. Un ancien cache conserve sa clé et son installation, mais exige une première vérification en ligne après mise à jour.

Un refus explicite du serveur supprime le droit hors ligne et persiste après redémarrage. Les réponses déjà en vol ne peuvent pas le rétablir. Les modifications du cache utilisent un verrou interprocessus et un remplacement atomique du fichier. Une panne réseau, HTTP 429 ou HTTP 5xx conserve seulement un droit signé encore valide.

`MICROWEST_LICENSE_BYPASS` et `MICROWEST_LICENSE_API_BASE` fonctionnent uniquement dans les builds de développement. Ils sont ignorés dans un binaire de release. L'identifiant local n'est pas une attestation matérielle : une personne contrôlant le poste peut copier un cache signé ou modifier un binaire. La révocation hors ligne reste bornée par l'expiration du dernier droit signé ; elle n'est pas instantanée sans connexion.

Variables dev utiles:

```bash
export MICROWEST_LICENSE_API_BASE=https://licences.iaswiss.com/api/licenses
export MICROWEST_LICENSE_STATE=/tmp/microwest-license.json
```

## Tests

```bash
npm test
npm run build:frontend
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run verify:native-manifest
```

Le moteur whisper.cpp **1.9.4** est compilé depuis la même archive source vérifiée sur macOS, Windows et Linux. CMake et un compilateur C++ sont requis pour préparer les binaires (Xcode Command Line Tools sur macOS, Visual Studio C++ sur Windows, GCC/Clang sur Linux). Les bibliothèques whisper/ggml sont liées statiquement ; Metal reste activé sur macOS. FFmpeg reste fourni par imageio-ffmpeg 0.6.0, sa dernière version disponible.

Les versions, URLs, SHA-256 et licences des archives `whisper.cpp` et imageio-ffmpeg sont verrouillés dans `scripts/native-dependencies.json`. Le téléchargement vérifie chaque hash avant extraction. Les notices sont intégrées aux ressources packagées via `engine/whispercpp/THIRD_PARTY_NOTICES.md` et la configuration de licence FFmpeg est archivée dans `FFMPEG_BUILD.txt` pour chaque plateforme.

## Documentation

- [docs/WHISPER_CPP_BACKEND.md](docs/WHISPER_CPP_BACKEND.md): détails du backend natif.
- [docs/UPDATER.md](docs/UPDATER.md): signature et publication auto-update.

## Notes packaging

Avant une distribution commerciale complète:

- vérifier l’installation des bundles Mac Apple Silicon et Windows x64 sur les systèmes cibles;
- faire valider les obligations GPL et codecs transitifs listées dans les notices FFmpeg.

L'app expose aussi un écran `À propos` avec version, backend, modèle, plateforme, licence, endpoint updater et chemins locaux.
