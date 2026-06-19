# Auto-update GitHub Releases

Microwest Whisper utilise le plugin updater Tauri v2 avec un manifeste statique publie sur GitHub Releases:

```text
https://github.com/DwennK/Microwest-whisper/releases/latest/download/latest.json
```

L'app embarque la cle publique Tauri dans `src-tauri/tauri.conf.json`. Les artefacts updater sont signes pendant les builds de release seulement, pas pendant les builds de validation sur `main`.

## Secrets GitHub requis

Le workflow de release attend ces secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: contenu de la cle privee Tauri.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optionnel; absent ou vide pour la cle actuelle.

La cle privee locale generee pendant la mise en place est ignoree par Git:

```text
.tauri/microwest-updater.key
```

Si cette cle est perdue, les installations deja distribuees ne pourront plus accepter de nouvelles mises a jour signees avec une autre cle.

## Publier une mise a jour

1. Mettre a jour la version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json`.
2. Committer le changement de version.
3. Creer et pousser un tag SemVer, par exemple `v0.2.3`.
4. Le workflow GitHub construit macOS, Windows et Linux.
5. Sur le tag, `npm run build:release` genere les signatures updater.
6. `scripts/generate-updater-manifest.mjs` cree `latest.json`.
7. Le workflow genere `SHA256SUMS.txt`.
8. La release GitHub publie les installateurs, signatures, checksums et `latest.json`.

## Comportement app

Le bouton `Mise a jour` lance une verification manuelle. Si une version superieure est disponible:

- l'app telecharge l'artefact correspondant a la plateforme;
- Tauri verifie la signature avec la cle publique embarquee;
- l'installateur est lance;
- l'app redemarre quand la plateforme le permet.

Sur Windows, Tauri quitte l'application au moment de l'installation de l'update, ce qui est le comportement attendu des installateurs Windows.

## Notes packaging

- Le manifeste actuel cible GitHub Releases, sans serveur dynamique.
- Le workflow choisit l'installateur NSIS `.exe` plutot que MSI quand les deux existent.
- Le manifeste macOS utilise `darwin-aarch64` par defaut pour les artefacts `.app.tar.gz` sans architecture dans le nom. Ajouter un build Intel/universal demandera d'ajuster la matrice macOS et `MACOS_UPDATER_TARGET`.
- Les checksums SHA-256 sont publies pour verification manuelle des artefacts, mais l'auto-update Tauri repose sur les signatures `.sig`.
