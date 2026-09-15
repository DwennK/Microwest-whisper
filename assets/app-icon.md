# Microwest Whisper — icône

Source : `app-icon.png` (1254 × 1254, RGBA), créée avec l’outil intégré Image Gen le 15 septembre 2026. Le fond extérieur est transparent. `app-icon-small.png` est la version 128 px utilisée dans l’interface et comme favicon.

Les déclinaisons desktop sont dans `src-tauri/icons/` : PNG, ICNS macOS et ICO Windows. Elles sont produites directement depuis la source, sans redessin.

## Régénérer les formats

Depuis la racine du dépôt :

```sh
npm run tauri -- icon assets/app-icon.png --output /tmp/microwest-new-icon
```

Copier uniquement les fichiers à la racine de ce dossier dans `src-tauri/icons/` (les sous-dossiers iOS et Android ne sont pas utilisés). Copier `128x128.png` vers `assets/app-icon-small.png`.

## Prompt Image Gen

Use case: logo-brand. Create ONE finished desktop application icon for Microwest Whisper, a premium private local audio transcription app. A completely new symbol, not a monogram with typography. Square 1024x1024 PNG asset. Transparent pixels outside the icon silhouette. Composition: a deep ink navy (#16212a) rounded square macOS-style icon tile, centered, occupying 86% of canvas, generous consistent transparent outer margin. Within it ONE bold sculptural mint (#b8dfd8) ribbon tracing a smooth audio waveform that subtly forms a W, with rounded ends, three elegant rising/falling strokes united as one continuous shape. The mark is extremely simple, chunky, iconic and highly legible at 32 pixels, centered and filling about 65% of the tile width. A sophisticated satin ceramic/material finish with very restrained dimensional shading, gentle top-left illumination, subtle teal depth along the ribbon edges; almost flat, with just enough crafted tactile depth to feel like a first-class Mac app. The background tile is dark navy with an extremely subtle depth gradient, no decorative elements. Calm, confident, beautifully balanced silhouette, crisp polished edges. No text, no letters printed on it, no tiny details, no microphone pictogram, no speech-bubble cliché, no sparkles, no AI stars, no metallic chrome, no multicolor neon, no glass transparency on the tile. No mockup, no device, no scene, no captions, no surrounding checkerboard baked into the image. This is the actual production-ready isolated icon asset, not a presentation sheet. Genuine transparent background outside the navy rounded tile.
