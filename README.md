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

Si tu connais le nombre exact de personnes:

```powershell
.\transcribe.ps1 -Audio ".\input\reunion.m4a" -HfToken "hf_xxxxxxxxxxxxxxxxx" -Speakers 3
```

Si tu connais seulement une fourchette:

```powershell
.\transcribe.ps1 -Audio ".\input\reunion.m4a" -HfToken "hf_xxxxxxxxxxxxxxxxx" -MinSpeakers 2 -MaxSpeakers 5
```

## Sorties

Les resultats arrivent dans `output`:

- `*.speaker-turns.txt`: transcription lisible par tours de parole.
- `*.speaker-turns.md`: version Markdown.
- `*.speaker-segments.srt`: sous-titres avec locuteurs.
- `*.segments.json`: segments propres et tours regroupes.
- `*.whisperx.json`: sortie complete WhisperX.

## Notes qualite

- Le modele par defaut est `large-v3`, le meilleur choix local pour privilegier la qualite.
- Le script force `--language fr` pour ameliorer la precision et eviter les erreurs de detection.
- Le M4A est converti en WAV mono 16 kHz avec normalisation sonore avant transcription.
- Sur Windows sans GPU NVIDIA, WhisperX/faster-whisper tourne en CPU avec un nombre de threads automatique.
- Sur Mac Apple Silicon, `--asr-backend auto` utilise MLX si disponible, ce qui exploite mieux le hardware Apple que faster-whisper CPU.
- Sur GPU NVIDIA compatible CUDA, WhisperX utilise CUDA.
- `large-v3-turbo` est plus rapide, mais `large-v3` reste le choix par defaut pour eviter une perte de qualite.
