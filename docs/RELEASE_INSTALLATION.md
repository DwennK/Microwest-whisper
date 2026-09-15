## Téléchargements

- **Mac Apple Silicon (M1 et suivants)** : `Microwest-Whisper-mac.dmg`.
- **Windows x64 (Intel/AMD 64 bits)** : `Microwest-Whisper-windows.exe`.

Les nouvelles releases ne proposent plus d'installateur Linux ni de build Mac Intel. Les anciennes releases restent disponibles.

## Installation et mises à jour

Sur Mac, ouvrir le DMG puis glisser l'application dans Applications. L'application utilise une signature locale ad hoc ; elle n'est pas notariée par Apple. macOS peut demander une autorisation dans **Réglages Système > Confidentialité et sécurité > Ouvrir quand même** après une première tentative d'ouverture.

Sur Windows, lancer l'installateur `.exe`. Il n'est pas signé avec un certificat d'éditeur Windows ; SmartScreen peut afficher un avertissement. Les politiques de sécurité du poste peuvent empêcher l'installation.

Les mises à jour depuis l'application restent protégées par les signatures cryptographiques Tauri. Les fichiers `.sig`, `.app.tar.gz` et `latest.json` servent à ces mises à jour ; pour une première installation, choisir le `.dmg` ou le `.exe` ci-dessus.
