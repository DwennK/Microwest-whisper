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

Les certificats payants Apple et Windows ne sont plus requis. Le bundle Mac utilise `signingIdentity: "-"` (signature locale ad hoc), sans notarisation ; l'installateur Windows NSIS `.exe` est non signé par un éditeur certifié. Cela peut déclencher des avertissements ou un blocage par la politique de sécurité du poste. Voir [RELEASE_INSTALLATION.md](RELEASE_INSTALLATION.md).

La signature Tauri updater reste obligatoire et distincte de la signature OS. Le preflight vérifie sa présence et l'accord entre le tag et les versions de l'application. Le manifeste refuse une publication incomplète : les deux plateformes et leurs signatures non vides sont obligatoires.

Les pushes sur `main` exécutent seulement les validations, y compris les tests Rust sur Linux. Les installateurs sont compilés et publiés sur un tag `v*` (ou un lancement manuel sur ce tag). Les builds ciblent explicitement `aarch64-apple-darwin` et `x86_64-pc-windows-msvc`, sur des runners standard. Les artefacts Actions intermédiaires expirent après un jour ; les assets publiés en release sont conservés.

La cle privee locale generee pendant la mise en place est ignoree par Git:

```text
.tauri/microwest-updater.key
```

Si cette cle est perdue, les installations deja distribuees ne pourront plus accepter de nouvelles mises a jour signees avec une autre cle.

## Publier une mise a jour

1. Mettre a jour la version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json`.
2. Committer le changement de version.
3. Creer et pousser un tag SemVer, par exemple `v0.2.3`.
4. Le workflow GitHub teste le code puis construit Mac Apple Silicon et Windows x64.
5. Sur le tag, `npm run build:release` genere les signatures updater.
6. `scripts/generate-updater-manifest.mjs` cree `latest.json`.
7. Le workflow genere `SHA256SUMS.txt`.
8. La release GitHub publie les installateurs, signatures, checksums et `latest.json`.
9. Les notes de release affichent les SHA-256 en clair, en plus de l'asset `SHA256SUMS.txt`.

## Comportement app

Le bouton `Mise a jour` lance une verification manuelle. Si une version superieure est disponible:

- l'app telecharge l'artefact correspondant a la plateforme;
- Tauri verifie la signature avec la cle publique embarquee;
- l'installateur est lance;
- l'app redemarre quand la plateforme le permet.

Sur Windows, Tauri quitte l'application au moment de l'installation de l'update, ce qui est le comportement attendu des installateurs Windows.

## Notes packaging

- Le manifeste actuel cible GitHub Releases, sans serveur dynamique.
- Le workflow produit un DMG Mac et un installateur NSIS Windows `.exe`, sans MSI ni installateur Linux.
- Le manifeste contient exactement `darwin-aarch64` et `windows-x86_64`. Les anciens fichiers Linux restent accessibles dans les anciennes releases, mais ces installations ne reçoivent plus de nouvelles versions.
- Les checksums SHA-256 sont publies dans les notes et dans `SHA256SUMS.txt` pour verification manuelle des artefacts, mais l'auto-update Tauri repose sur les signatures `.sig`.
- Les archives natives sont verrouillées par URL et SHA-256 dans `scripts/native-dependencies.json`; leurs notices sont incluses dans les ressources de l'application.
