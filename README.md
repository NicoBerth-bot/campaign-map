# Bain de Sang – Prototype (Version légère)

Prototype statique (HTML/JS) pour gérer une campagne « Bain de Sang dans les Terres Arides » : carte PNG, grille d'hexagones paramétrable, placement/déplacement d'armées, export/import JSON.

## Démarrage local
Ouvrez `index.html` dans votre navigateur (Chrome/Firefox).

## Déploiement GitHub Pages
1. Poussez ces fichiers sur la branche `main` du dépôt.
2. Dans **Settings → Pages** : *Source* → **Deploy from a branch**, Branche **main** / dossier **/** (root).
3. Attendez que la page soit disponible (URL `https://<votre-user>.github.io/<repo>/`).

## Remplacer la carte
- Placez votre image dans `assets/` (ex: `map.jpg` haute résolution).
- Éditez `data/config.json` → `mapImage` pour pointer vers votre fichier.

## Paramètres
- `hexSize` : rayon des hex en pixels (pointy-top).
- `gridVisible` : grille visible ou non.
- `snapToGrid` : accrochage des armées au centre des hex.

## Données
- **Export** : bouton "Exporter l'état" (télécharge `armies.json`).
- **Import** : bouton "Importer état".
- État également mis en **localStorage** (persiste sur votre navigateur).

Bon jeu !
