# YouTube Companion — consignes

- App statique (HTML/CSS/JS sans build) servie par GitHub Pages depuis `main`. Interface et textes en français.
- **À chaque changement visible pour l'utilisateur, ajouter une entrée dans `CHANGELOG.md`** (nouvelle version `## x.y.z — date — résumé` en haut, puces courtes, tutoiement). L'app affiche ce fichier derrière la cloche 🔔 ; la cloche signale toute version non lue.
- Si un fichier JS/CSS est ajouté, l'ajouter à `SHELL` dans `sw.js` et incrémenter `CACHE`.
- Modifier `companion.user.js` → incrémenter `@version` (Tampermonkey s'appuie dessus pour les mises à jour).
- Tests : `npm test` (unitaires), `node tests/e2e.mjs` et `node tests/e2e-sync.mjs` (Playwright, serveur local sur :8080).
