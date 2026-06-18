# Microwest Whisper

Application locale pour transcrire des fichiers audio longs en francais, avec exports propres et separation optionnelle des personnes.

Le projet fournit:

- une interface graphique PySide6;
- un pipeline WhisperX/MLX pour la transcription;
- une diarisation pyannote quand la separation des personnes est activee;
- des exports TXT, Markdown, SRT, JSON et DOCX;
- un historique et des checkpoints pour eviter de tout recalculer inutilement.

## Demarrage rapide

### macOS

```bash
./setup-mac.sh
./launch-gui.sh
```

Sur Mac Apple Silicon, le setup installe aussi `mlx-whisper`. Le backend `auto` utilise alors MLX pour la transcription brute, puis WhisperX pour l'alignement.

### Windows

Ouvre PowerShell dans ce dossier:

```powershell
.\setup.ps1
.\launch-gui.ps1
```

Le setup cree `.venv`, installe les dependances Python et verifie FFmpeg.

## Licence

Le logiciel peut etre telecharge publiquement depuis GitHub Releases:

https://github.com/DwennK/Microwest-whisper/releases/latest

L'utilisation du logiciel demande une cle de licence achetee sur IA Swiss. Apres paiement, la cle arrive par email.

Dans l'interface:

1. Ouvre l'onglet `Parametres`.
2. Colle la cle dans `Licence Microwest Whisper`.
3. Clique sur `Activer la licence`.

En ligne de commande:

```bash
python transcribe.py --activate-license "MW-XXXXX-XXXXX-XXXXX-XXXXX"
python transcribe.py --license-status
```

Par defaut, la licence est reverifiee regulierement avec l'API IA Swiss. Une verification valide autorise une courte utilisation hors ligne.

## Utiliser l'interface

1. Onglet `Audio`: choisis un fichier `.m4a`, `.mp3`, `.wav`, `.mp4`, etc.
2. Onglet `Reglages`: choisis le profil et les options.
3. Onglet `Execution`: lance la transcription et suis le journal.
4. Onglet `Resultats`: consulte les exports, renomme les locuteurs ou relance un fichier.

La separation des personnes est desactivee par defaut. C'est volontaire: une transcription simple est plus rapide, ne demande pas de token Hugging Face et echoue moins souvent au premier essai.

Active `Separer les personnes` seulement si tu veux une diarisation. Dans ce cas, renseigne le token Hugging Face dans l'onglet `Parametres`.

Avant une longue transcription, utilise `Verifier la configuration`. L'app controle `.venv`, FFmpeg, les dependances Python, le backend recommande et le token pyannote si la separation des personnes est activee.

## Token Hugging Face

Le token est necessaire uniquement pour separer les personnes.

1. Cree un compte Hugging Face.
2. Cree un token: https://huggingface.co/settings/tokens
3. Accepte les conditions de ces modeles:
   - https://huggingface.co/pyannote/speaker-diarization-community-1
   - https://huggingface.co/pyannote/speaker-diarization
   - https://huggingface.co/pyannote/segmentation

Dans l'app, colle le token dans `Parametres`. Si tu coches l'enregistrement, il est stocke dans `.env`.

En ligne de commande, tu peux aussi definir:

```bash
export HUGGINGFACE_TOKEN="hf_xxxxxxxxxxxxxxxxx"
```

PowerShell:

```powershell
$env:HUGGINGFACE_TOKEN = "hf_xxxxxxxxxxxxxxxxx"
```

## Profils recommandes

- `Qualite max (large-v3)`: meilleur choix si la qualite prime.
- `Rapide (large-v3-turbo)`: plus rapide, avec une petite concession possible sur la qualite.
- `CPU leger (medium + int8)`: utile sur une machine sans GPU ou avec peu de memoire.
- `Sans locuteurs`: transcription texte uniquement, sans diarisation.

Sur Apple Silicon, garde `Backend: auto` sauf besoin particulier: l'app utilisera MLX si disponible.

## Recalcul, checkpoints et relance

Le dossier `work` contient les fichiers intermediaires:

- WAV pretraite en mono 16 kHz;
- resultat ASR;
- alignement;
- resultat final avec ou sans diarisation.

Quand tu relances le meme audio avec les memes reglages, l'app reutilise les checkpoints et regenere les exports rapidement.

Si tu veux vraiment tout recalculer, coche `Recalculer sans reutiliser les checkpoints` dans les reglages avances, ou utilise `--force` en ligne de commande.

Les checkpoints tiennent compte des reglages importants: modele, backend, langue, filtre audio, batch, device, type de calcul et options de diarisation. Si tu changes ces options, l'ancien checkpoint est ignore automatiquement.

## Ligne de commande

Transcrire sans separation des personnes:

```bash
python transcribe.py --audio input/reunion.m4a --no-diarization
```

Transcrire avec separation des personnes:

```bash
python transcribe.py --audio input/reunion.m4a --hf-token "$HUGGINGFACE_TOKEN"
```

Forcer un recalcul complet:

```bash
python transcribe.py --audio input/reunion.m4a --force
```

Verifier l'environnement:

```bash
python transcribe.py --doctor
```

Tester le token Hugging Face:

```bash
python transcribe.py --check-token
```

Options utiles:

- `--model large-v3|large-v3-turbo|medium|small`
- `--asr-backend auto|whisperx|mlx`
- `--language auto|fr|en`
- `--audio-filter loudnorm|voice-clean|none`
- `--trim-silence`
- `--speakers 3`
- `--min-speakers 2 --max-speakers 5`
- `--speaker-map "SPEAKER_00=Alice,SPEAKER_01=Bruno"`
- `--rename-only --speaker-map ...`

Scripts pratiques:

```bash
./transcribe-latest.sh
```

```powershell
.\transcribe-latest.ps1 -HfToken "hf_xxxxxxxxxxxxxxxxx"
```

## Exports

Les fichiers sont ecrits dans `output`. Les noms contiennent le nom de l'audio et un identifiant court stable pour eviter les collisions.

- `*.speaker-turns.txt`: transcription lisible par tours de parole.
- `*.speaker-turns.md`: version Markdown.
- `*.clean.txt`: transcription simple sans timestamps.
- `*.speaker-segments.srt`: sous-titres avec locuteurs.
- `*.segments.json`: segments et tours regroupes.
- `*.notes.md`: notes automatiques avec actions, decisions et questions possibles.
- `*.transcript.docx`: transcription editable dans Word ou Google Docs.
- `*.whisperx.json`: sortie complete du pipeline.
- `transcription-history.jsonl`: historique des transcriptions.

## Installation comme package

```bash
python -m pip install -e .
microwest-whisper --audio input/reunion.m4a --no-diarization
microwest-whisper-gui
```

## Tests

Les tests rapides ne lancent pas les modeles Whisper:

```bash
python -m unittest discover
```

## Build desktop

Une base PyInstaller est fournie:

```bash
python -m pip install -e ".[desktop]"
pyinstaller pyinstaller-gui.spec
```

Les builds embarquent un fallback FFmpeg via `imageio-ffmpeg`, mais n'incluent pas les modeles Whisper/Hugging Face ni le token. Les modeles sont telecharges au premier usage dans le cache local.

## Releases GitHub

Le workflow `.github/workflows/build-release.yml` lance:

- les tests unitaires;
- un build PyInstaller macOS;
- un build PyInstaller Windows;
- une release automatique quand un tag `v*` est pousse.

Publier une release:

```bash
git tag v0.1.1
git push origin v0.1.1
```
