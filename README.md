# Transcription francaise avec diarisation

Ce dossier contient un pipeline local pour transcrire un fichier Apple Voice Recorder `.m4a` long, en francais, avec separation des locuteurs.

## Installation

Ouvre PowerShell dans ce dossier:

```powershell
cd C:\Users\Microwest-Dwenn\source\repos\whisper
.\setup.ps1
```

Le script utilise Python 3.11, cree `.venv`, installe WhisperX, puis verifie FFmpeg.

### macOS

Sur Mac, ouvre Terminal dans ce dossier:

```bash
./setup-mac.sh
```

Sur Apple Silicon, le setup installe aussi `mlx-whisper`. Le mode `auto` utilise alors MLX pour la transcription brute, puis WhisperX pour l'alignement et pyannote pour la diarisation.

## Token Hugging Face requis

La separation des personnes utilise pyannote. Il faut:

1. Creer un compte Hugging Face.
2. Creer un token: https://huggingface.co/settings/tokens
3. Accepter les conditions des modeles pyannote:
   - https://huggingface.co/pyannote/speaker-diarization
   - https://huggingface.co/pyannote/segmentation

Ensuite, soit tu passes le token a la commande, soit tu le mets dans PowerShell:

```powershell
$env:HUGGINGFACE_TOKEN = "hf_xxxxxxxxxxxxxxxxx"
```

Tu peux aussi copier `.env.example` en `.env` pour garder le token hors des commandes visibles.

## Utilisation

Mets le fichier audio dans `input`, par exemple:

```text
input\reunion.m4a
```

## Interface graphique

Lance l'interface Qt:

```powershell
.\launch-gui.ps1
```

Sur Mac:

```bash
./launch-gui.sh
```

Dans la fenetre, choisis le fichier audio, colle le token Hugging Face, indique le nombre de locuteurs si tu le connais, puis lance la transcription.

Les logs s'affichent en direct et les resultats sont ecrits dans `output`.

Le token Hugging Face est transmis au processus via la variable d'environnement `HUGGINGFACE_TOKEN`, pas dans les arguments de commande affiches par le systeme.

Avant une longue transcription, utilise `Verifier configuration` dans l'onglet Transcription. L'app controle `.venv`, FFmpeg, les dependances Python, le backend recommande et le token pyannote si la separation des personnes est activee.

Apres transcription, l'onglet Resultats sert d'espace de travail:

- apercu direct de la transcription;
- liste des locuteurs detectes avec champs de renommage;
- bouton `Regenerer les fichiers` sans relancer toute la transcription;
- acces rapide aux exports DOCX, Markdown et SRT;
- historique en table avec actions ouvrir, relancer, renommer et supprimer.

## Ligne de commande

Puis lance:

```powershell
.\transcribe.ps1 -Audio ".\input\reunion.m4a" -HfToken "hf_xxxxxxxxxxxxxxxxx"
```

Ou, plus simple, pour transcrire automatiquement le fichier audio le plus recent dans `input`:

```powershell
.\transcribe-latest.ps1 -HfToken "hf_xxxxxxxxxxxxxxxxx"
```

Sur Mac:

```bash
./transcribe-latest.sh
```

Pour verifier l'environnement:

```bash
python transcribe.py --doctor
```

Pour tester le token Hugging Face avant une longue transcription:

```bash
python transcribe.py --check-token
```

Si tu connais le nombre exact de personnes:

```powershell
.\transcribe.ps1 -Audio ".\input\reunion.m4a" -HfToken "hf_xxxxxxxxxxxxxxxxx" -Speakers 3
```

Si tu connais seulement une fourchette:

```powershell
.\transcribe.ps1 -Audio ".\input\reunion.m4a" -HfToken "hf_xxxxxxxxxxxxxxxxx" -MinSpeakers 2 -MaxSpeakers 5
```

## Options avancees

Le pipeline garde des checkpoints dans `work` pour reprendre apres un echec ou regenerer les exports sans tout recalculer. Utilise `--force` pour repartir de zero.

Tu peux aussi choisir un profil:

```bash
python transcribe.py --audio input/reunion.m4a --profile auto
python transcribe.py --audio input/reunion.m4a --profile cpu
```

Options utiles:

- `--language auto|fr|en`: langue source.
- `--audio-filter loudnorm|voice-clean|none`: normalisation ou nettoyage vocal.
- `--trim-silence`: rogne les silences en debut et fin de fichier.
- `--speaker-map "SPEAKER_00=Alice,SPEAKER_01=Bruno"`: renomme les locuteurs dans les exports.
- `--rename-only --speaker-map ...`: regenere les exports depuis un checkpoint existant.

## Sorties

Les resultats arrivent dans `output`. Les noms contiennent le nom du fichier audio et un identifiant court stable base sur son chemin, pour eviter les collisions entre deux fichiers qui portent le meme nom.

- `*.speaker-turns.txt`: transcription lisible par tours de parole.
- `*.speaker-turns.md`: version Markdown.
- `*.clean.txt`: transcription simple sans timestamps.
- `*.speaker-segments.srt`: sous-titres avec locuteurs.
- `*.segments.json`: segments propres et tours regroupes.
- `*.notes.md`: notes automatiques avec actions, decisions et questions possibles.
- `*.transcript.docx`: transcription editable dans Word ou Google Docs.
- `*.whisperx.json`: sortie complete WhisperX.
- `transcription-history.jsonl`: historique des transcriptions et fichiers generes.

## Packaging et tests

Le projet peut aussi etre installe comme package local:

```bash
python -m pip install -e .
microwest-whisper --audio input/reunion.m4a --no-diarization
microwest-whisper-gui
```

Les tests rapides ne lancent pas WhisperX:

```bash
python -m unittest discover
```

Une base PyInstaller est fournie pour produire une application desktop:

```bash
python -m pip install -e ".[desktop]"
pyinstaller pyinstaller-gui.spec
```

## Builds GitHub et releases

Le workflow GitHub Actions `.github/workflows/build-release.yml` lance:

- les tests unitaires;
- un build PyInstaller macOS;
- un build PyInstaller Windows;
- une release GitHub automatique quand un tag `v*` est pousse.

Pour publier une release:

```bash
git tag v0.1.1
git push origin v0.1.1
```

Tu peux aussi lancer le workflow manuellement depuis l'onglet Actions de GitHub. Le lancement manuel produit les artifacts, mais ne cree pas de release taggee.

Les builds embarquent un fallback FFmpeg via `imageio-ffmpeg`, donc l'app peut fonctionner meme si FFmpeg n'est pas installe globalement. Un FFmpeg systeme reste utilise en priorite s'il existe.

Les builds n'incluent pas les modeles Whisper/Hugging Face ni le token. L'utilisateur renseigne son token si la diarisation est activee, puis les modeles sont telecharges au premier usage dans le cache local.

## Notes qualite

- Le modele par defaut est `large-v3`, le meilleur choix local pour privilegier la qualite.
- Le script utilise `--language fr` par defaut pour ameliorer la precision, mais `--language auto` ou une autre langue peut etre choisi.
- Le M4A est converti en WAV mono 16 kHz avec normalisation sonore avant transcription.
- Sur Windows sans GPU NVIDIA, WhisperX/faster-whisper tourne en CPU avec un nombre de threads automatique.
- Sur Mac Apple Silicon, `--asr-backend auto` utilise MLX si disponible, ce qui exploite mieux le hardware Apple que faster-whisper CPU.
- Sur GPU NVIDIA compatible CUDA, WhisperX utilise CUDA.
- `large-v3-turbo` est plus rapide, mais `large-v3` reste le choix par defaut pour eviter une perte de qualite.
