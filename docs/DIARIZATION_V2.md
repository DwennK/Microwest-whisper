# Diarisation v2

## Statut

La diarisation n'est pas incluse dans la version actuelle de Microwest Whisper. Les exports supportes restent bases sur des segments `whisper.cpp` sans locuteur.

Les fichiers locaux nommes `whisperx.json`, `speaker-turns.*` ou `speaker-segments.srt` dans `output/` ou `work/` sont des artefacts de prototypes historiques. Ils sont hors Git, hors contrat produit et ne doivent pas etre presentes comme une fonctionnalite livree.

## Objectif v2

Ajouter une diarisation optionnelle sans casser le mode local simple:

- garder la transcription `whisper.cpp` comme chemin principal;
- rendre la diarisation explicitement optionnelle;
- eviter tout token Hugging Face requis au premier lancement;
- afficher clairement quand les labels locuteur sont estimes;
- conserver les exports actuels sans labels quand la diarisation est desactivee.

## Contrat d'exports cible

Si la diarisation revient, elle doit produire des fichiers separes:

- `*.speaker-turns.txt`
- `*.speaker-turns.md`
- `*.speaker-segments.srt`
- `*.diarized.json`

Les exports existants restent inchanges:

- `*.transcript.txt`
- `*.transcript.md`
- `*.clean.txt`
- `*.segments.srt`
- `*.segments.json`
- `*.transcript.docx`
- `*.whispercpp.json`

## Definition of Done

- Option UI explicite pour activer la diarisation.
- Message clair sur les contraintes de modele, CPU/GPU, confidentialite et temps de calcul.
- Tests backend pour parser et exporter des segments avec locuteur.
- Test de regression confirmant que les exports sans diarisation ne contiennent aucun label `SPEAKER_`.
- Documentation utilisateur indiquant que la diarisation est une estimation.
