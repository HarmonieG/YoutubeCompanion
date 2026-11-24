# YouTube Companion

Une petite app web pour enfin venir à bout de sa playlist YouTube **« À regarder plus tard »**, même quand elle contient plus de 3 000 vidéos.

Elle importe ta liste et ton historique, **tague automatiquement** chaque vidéo (durée, relation au créateur, sujet, logiciel, techno, format…), puis t'aide à choisir quoi regarder : recherche, filtres par tag, tri « Pour moi », vidéos similaires et bouton « Surprends-moi ». Le lecteur intégré propose les vitesses ×1,25, ×1,5, ×1,75 et ×2. Quand une vidéo est vue à plus de 80 %, elle sort de la liste et l'app propose de l'ajouter à une autre playlist.

Statique (HTML/CSS/JS sans build), hébergée sur GitHub Pages. Tes données restent dans ton navigateur, avec en option une synchro dans un dossier caché de ton Google Drive.

> Projet indépendant [Harmonie Games](https://www.instagram.com/harmoniegames/), sans lien avec YouTube ni Google.

## Fonctionnalités

- **Accueil = curation automatique**, présentée en rayons : À reprendre, un rayon selon l'heure (Pour le café, Pause déj, Pour la soirée…), Pour toi, Vite vu, Tes créateurs préférés, Tes habitués, tes thèmes (Godot, Figurines…), Les Aliens, Apprendre, À méditer, Détente, Fraîchement publiées, Déjà vues ? (à vider d'un geste)
- **Liste = enchaînement** : « J'ai 15 min / 30 min / 1 h / 2 h » compose une session de vidéos variées (jamais deux fois la même chaîne d'affilée), lue à la suite avec un compte à rebours entre deux vidéos
- **ⓘ Pourquoi cette vidéo ?** sur chaque vignette : le détail des **+** et des **−** qui la font remonter (créateur, thèmes habituels, centres d'intérêt, déjà vue…), avec des boutons **+ / −** pour en demander plus ou moins (par thème ou par chaîne)
- **Tags automatiques**
  - *Durée* : Short, Rapide (moins de 5 min, réglable), Court, Moyen, Long, Très long
  - *Créateur* : Créateur préféré (abonné et souvent regardé, ou choisi à la main), Abonné, Habitué, **Alien** (chaîne jamais regardée)
  - *Statut* : Déjà vue (présente dans l'historique), Commencée, Indisponible, Récente
  - *Logiciel, Techno, Sujet, Format/mood* : règles par mots-clés (Blender, Godot, Unity, IA, Raspberry Pi, pixel art, figurines, tuto, video essay, ASMR…), entièrement modifiables dans Réglages
  - *Catégorie YouTube*
- **Tags perso** à ajouter sur n'importe quelle vidéo, et tags auto masquables vidéo par vidéo
- **Filtres** : touche un tag pour filtrer, une 2ᵉ fois pour l'exclure (ex. « Rapide » sans « Tuto »), clic sur une chaîne pour ne voir qu'elle
- **Lecteur intégré** avec vitesses ×1 à ×2 et reprise là où tu t'étais arrêté
- **Fin de vidéo** : retrait automatique à 80 % (réglable), ajout à une playlist (la dernière utilisée en un clic), vidéo suivante
- **Configuration guidée** en 3 étapes (script, synchro, goûts), adaptée à l'appareil (iPhone ou ordinateur)
- Installable sur l'écran d'accueil (PWA)

## Pourquoi un script ?

Depuis 2016, **l'API YouTube ne donne plus accès à « À regarder plus tard » ni à l'historique** : les requêtes renvoient une liste vide, même connecté. L'app contourne cette limite ainsi :

| Besoin | Méthode |
|---|---|
| Lire la liste | **Script Companion** (`companion.user.js`) qui tourne sur youtube.com et interroge l'API interne du site : environ 3 000 vidéos en une dizaine de secondes, sans faire défiler la page. En secours : favori d'export ou CSV Google Takeout. |
| Retirer les vidéos vues | Le même script, pendant la synchro (ou favori de purge sur ordinateur) |
| Historique | Export **Google Takeout** (`watch-history.json` ou `.html`) |
| Durée, tags, catégorie, abonnements | API YouTube Data v3, via la connexion Google |
| Ajouter à une playlist | API YouTube Data v3 |

Le script n'envoie rien ailleurs qu'à l'app : il lui transmet la liste par `postMessage`, ou en repli par le presse-papiers ou un fichier. Il fonctionne avec **Tampermonkey** sur ordinateur et l'extension Safari **Userscripts** (gratuite) sur iPhone/iPad.

⚠️ L'API interne de youtube.com n'est pas documentée : si YouTube la modifie, le script peut cesser de fonctionner jusqu'à sa mise à jour.

### Déroulé d'une synchro

1. Dans l'app, **Synchroniser** ouvre `youtube.com/playlist?list=WL#yc-sync=<vidéos à retirer>`.
2. Le script retire ces vidéos, puis lit toute la liste.
3. **Envoyer à Companion** ouvre l'app, qui reçoit la liste : les nouvelles vidéos sont ajoutées, celles retirées de YouTube passent en « retirées ». Tes tags sont conservés.

## Utilisation

1. Ouvre l'app, connecte-toi avec Google et suis la configuration guidée.
2. Installe Tampermonkey (ordinateur) ou Userscripts (iPhone), puis le **Script Companion** depuis l'onglet **Import**.
3. Touche **Synchroniser**, puis « Envoyer à Companion » dans le panneau qui apparaît sur YouTube.
4. *(Conseillé)* Demande ton historique sur [takeout.google.com](https://takeout.google.com) : seulement « YouTube et YouTube Music », historique au format **JSON**. Importe `watch-history.json` quand l'archive arrive.
5. Les infos détaillées des vidéos sont récupérées via l'API officielle (environ 1 unité de quota pour 50 vidéos, donc ~64 unités pour 3 200 vidéos, sur 10 000 gratuites par jour).
6. Regarde ! Les vidéos vues ou retirées s'accumulent dans **À retirer**. Elles disparaissent de YouTube à la prochaine synchro.

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
npm test                  # tests unitaires (imports, tags)
node tests/e2e.mjs        # test navigateur avec Playwright (YouTube simulé)
node tests/e2e-sync.mjs   # test du script de synchro sur un faux youtube.com
```

Structure :

```
index.html            page unique
css/app.css           styles
js/app.js             interface (vues, lecteur, configuration guidée)
js/data.js            imports, enrichissement, file de retrait
js/tagger.js          règles de tags, score « Pour moi » et ses raisons (+/−), similarité
js/curation.js        rayons de l'accueil et enchaînements de la Liste
js/importers.js       lecture des fichiers (JSON favori, CSV Takeout, historique)
js/google.js          connexion Google, YouTube Data API, synchro Drive
js/player.js          lecteur YouTube intégré (vitesse, progression)
js/bookmarklets.js    favoris Export / Purge (méthode de secours)
companion.user.js     script de synchro à installer dans Tampermonkey / Userscripts
js/store.js           état + IndexedDB
sw.js                 cache hors ligne
```

Le script et le favori de purge utilisent l'API interne de youtube.com (`browse` et `browse/edit_playlist`), qui n'est pas documentée. S'ils cessent de fonctionner après une mise à jour de YouTube, c'est `companion.user.js` qu'il faut adapter.

## Licence

[MIT](LICENSE) © 2026 Hugo — Harmonie Games
