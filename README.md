# YouTube Companion

Une petite app web pour enfin venir à bout de sa playlist YouTube **« À regarder plus tard »**, même quand elle contient plus de 3 000 vidéos.

Elle importe ta liste et ton historique, **tague automatiquement** chaque vidéo (durée, relation au créateur, sujet, logiciel, techno, format…), puis t'aide à choisir quoi regarder : recherche, filtres par tag, tri « Pour moi », vidéos similaires et bouton « Surprends-moi ». Le lecteur intégré propose les vitesses ×1,25, ×1,5, ×1,75 et ×2. Quand une vidéo est vue à plus de 80 %, elle sort de la liste et l'app propose de l'ajouter à une autre playlist.

Statique (HTML/CSS/JS sans build), hébergée sur GitHub Pages. Tes données restent dans ton navigateur, avec en option une synchro dans un dossier caché de ton Google Drive.

> Projet indépendant [Harmonie Games](https://www.instagram.com/harmoniegames/), sans lien avec YouTube ni Google.

## Fonctionnalités

- **Tags automatiques**
  - *Durée* : Short, Rapide (moins de 5 min, réglable), Court, Moyen, Long, Très long
  - *Créateur* : Créateur préféré (abonné et souvent regardé, ou choisi à la main), Abonné, Habitué, **Alien** (chaîne jamais regardée)
  - *Statut* : Déjà vue (présente dans l'historique), Commencée, Indisponible, Récente, Vieille de la liste
  - *Logiciel, Techno, Sujet, Format/mood* : règles par mots-clés (Blender, Godot, Unity, IA, Raspberry Pi, pixel art, figurines, tuto, video essay, ASMR…), entièrement modifiables dans Réglages
  - *Catégorie YouTube*
- **Tags perso** à ajouter sur n'importe quelle vidéo, et tags auto masquables vidéo par vidéo
- **Filtres** : touche un tag pour filtrer, une 2ᵉ fois pour l'exclure (ex. « Rapide » sans « Tuto »), clic sur une chaîne pour ne voir qu'elle
- **Tri « Pour moi »** : créateurs regardés souvent, thèmes fréquents dans ton historique et centres d'intérêt choisis
- **Lecteur intégré** avec vitesses et reprise là où tu t'étais arrêté
- **Fin de vidéo** : retrait automatique à 80 % (réglable), ajout à une playlist (la dernière utilisée en un clic), vidéo similaire suivante
- **Retrait groupé** : par exemple, filtre « Déjà vue » puis « Retirer ces N vidéos »
- **Configuration guidée** au premier lancement
- Installable sur l'écran d'accueil (PWA)

## Pourquoi un favori (bookmarklet) ?

Depuis 2016, **l'API YouTube ne donne plus accès à « À regarder plus tard » ni à l'historique** : les requêtes renvoient une liste vide, même connecté. L'app contourne cette limite ainsi :

| Besoin | Méthode |
|---|---|
| Lire la liste | Favori **⤓ Export Plus Tard** lancé sur youtube.com/playlist?list=WL (ordinateur), qui télécharge un JSON. Le CSV de Google Takeout est aussi accepté. |
| Historique | Export **Google Takeout** (`watch-history.json` ou `.html`) |
| Durée, tags, catégorie, abonnements | API YouTube Data v3, via la connexion Google |
| Ajouter à une playlist | API YouTube Data v3 |
| Retirer de « À regarder plus tard » | Favori **✕ Purge Plus Tard** sur youtube.com : il retire d'un coup toutes les vidéos marquées dans l'onglet « À retirer » |

Les favoris s'exécutent dans ta session YouTube déjà ouverte. Ils n'envoient rien ailleurs et ne fonctionnent pas sur mobile (sur ordinateur, ou via la console du navigateur).

## Utilisation

1. Ouvre l'app et suis la configuration guidée.
2. Sur ordinateur, depuis l'onglet **Import**, glisse le favori « ⤓ Export Plus Tard » dans ta barre de favoris, ouvre ta playlist « À regarder plus tard » et clique dessus. Importe ensuite le fichier téléchargé.
3. *(Conseillé)* Demande ton historique sur [takeout.google.com](https://takeout.google.com) : seulement « YouTube et YouTube Music », historique au format **JSON**. Importe `watch-history.json` quand l'archive arrive.
4. Connecte-toi avec Google pour récupérer les infos détaillées des vidéos (environ 1 unité de quota pour 50 vidéos, donc ~64 unités pour 3 200 vidéos, sur 10 000 gratuites par jour).
5. Regarde ! Les vidéos vues ou retirées s'accumulent dans **À retirer** ; de temps en temps, sur ordinateur, copie la liste et lance le favori « ✕ Purge Plus Tard ».
6. Réimporte ta liste quand tu veux : les nouvelles vidéos sont ajoutées, et celles qui ont disparu de YouTube sont marquées comme retirées.

## Héberger sa propre copie

### 1. GitHub Pages

Dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`. L'app sera servie sur `https://<compte>.github.io/YoutubeCompanion/`.

### 2. Identifiant Google (Client ID OAuth)

1. Sur [console.cloud.google.com](https://console.cloud.google.com/), crée un projet.
2. **APIs & Services → Library** : active **YouTube Data API v3** et **Google Drive API**.
3. **Google Auth Platform → Branding** : nom de l'app, e-mail de contact. **Audience** : type *External*, puis ajoute ton adresse (et celles de tes testeurs) dans *Test users*.
4. **Data Access** : ajoute les scopes `…/auth/youtube` et `…/auth/drive.appdata`.
5. **Clients → Create client** : type *Web application*, origine JavaScript autorisée `https://<compte>.github.io` (et `http://localhost:8080` pour le développement).
6. Copie le Client ID dans `js/config.js` (`GOOGLE_CLIENT_ID`), ou colle-le dans **Réglages** de l'app.

> **Partager l'app avec d'autres.** Les scopes YouTube sont « sensibles » pour Google. Tant que l'app est en mode *Testing*, seuls les comptes ajoutés comme *Test users* peuvent se connecter (100 au maximum), avec un écran « Application non vérifiée » et une connexion qui expire au bout de 7 jours. Pour l'ouvrir à tous, il faut publier l'app et passer la vérification Google (page de politique de confidentialité, vidéo de démonstration…). Une autre solution : chacun héberge sa propre copie avec son propre Client ID.

## Développement

Aucune dépendance : un simple serveur statique suffit.

```bash
npm run serve        # http://localhost:8080
npm test             # tests unitaires (imports, tags)
node tests/e2e.mjs   # test navigateur avec Playwright (YouTube simulé)
```

Structure :

```
index.html            page unique
css/app.css           styles
js/app.js             interface (vues, lecteur, configuration guidée)
js/data.js            imports, enrichissement, file de retrait
js/tagger.js          règles de tags, pertinence, similarité
js/importers.js       lecture des fichiers (JSON favori, CSV Takeout, historique)
js/google.js          connexion Google, YouTube Data API, synchro Drive
js/player.js          lecteur YouTube intégré (vitesse, progression)
js/bookmarklets.js    scripts Export / Purge lancés sur youtube.com
js/store.js           état + IndexedDB
sw.js                 cache hors ligne
```

Le favori de purge utilise l'API interne de youtube.com (`edit_playlist`), qui n'est pas documentée. S'il cesse de fonctionner après une mise à jour de YouTube, c'est ce fichier qu'il faut adapter.

## Licence

[MIT](LICENSE) © 2026 Hugo — Harmonie Games
