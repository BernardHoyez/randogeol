# RandoGéol

PWA (Progressive Web App) statique, sans backend, pour superposer un tracé GPX ou
KML sur les cartes géologiques du BRGM au 1/50 000, avec identification précise
de la formation géologique au clic (notation type J2b, t3-5…), à partir des
données vectorielles BD Charm-50.

Déployée sur GitHub Pages, par ex. `bernardhoyez.github.io/randogeol`.

## Fonctionnalités

### Fond de plan
- OpenStreetMap
- IGN Plan
- IGN Photographies aériennes

(sources IGN Géoplateforme `data.geopf.fr`, sans clé)

### Cartes géologiques BRGM 1/50 000 (WMS)
Trois couches au choix, avec curseur d'opacité :
- **SCAN_D_GEOL50** — carte scannée (papier + légende d'origine)
- **SCAN_H_GEOL50** — carte harmonisée
- **SCAN_H_RELIEF_GEOL50** — carte harmonisée + estompage du relief

Service : `https://geoservices.brgm.fr/geologie` (WMS 1.3.0).

⚠️ Ces couches ne s'affichent qu'à l'échelle ville/département, entre environ
1/9 000 et 1/251 000 (zoom Leaflet ~11 à 16 selon la latitude). Trop dézoomé,
la couche reste invisible quelle que soit l'opacité — c'est une limite du
service BRGM, pas un bug de l'app.

Un bouton **Légende** affiche la légende officielle (GetLegendGraphic) de la
couche active.

### Identification géologique précise (BD Charm-50, hors-ligne)
Les couches scannées/harmonisées ci-dessus sont des **images** : le BRGM les
déclare non interrogeables sur son WMS (`ServiceException: LayerNotQueryable`).
Pour obtenir la notation exacte d'un point (ex. J2b), l'app utilise en
parallèle les données **vectorielles** BD Charm-50 (couche des formations
géologiques), chargées par département :

- Le **Var (083)** est fourni directement avec l'app (`data/083.geojson`).
- Tout autre département s'ajoute **depuis l'app elle-même** (voir ci-dessous)
  — aucune intervention extérieure n'est nécessaire.

Un clic sur la carte :
1. cherche d'abord le polygone contenant le point parmi les départements
   chargés (point-dans-polygone calculé côté client, quelques millisecondes) ;
2. si le point est hors des départements chargés, affiche un message
   explicatif avec le lien du formulaire BRGM pour télécharger le département
   manquant, plus un lien optionnel pour tenter quand même une requête WMS
   brute (résultat non garanti, cf. ci-dessus).

### Ajouter un département
Dans le panneau, section **Ajouter un département** :
1. Télécharger le zip BD Charm-50 du département voulu depuis le
   [formulaire BRGM](https://infoterre.brgm.fr/formulaire/telechargement-cartes-geologiques-departementales-150-000-bd-charm-50)
   (fichier `GEO050K_HARM_0XX.zip`, non modifié).
2. Le sélectionner dans l'app, donner un nom (ex. « Alpes-Maritimes (06) »),
   cliquer sur **Importer**.

Traitement 100 % client (aucun envoi réseau) :
- dézippage (JSZip),
- lecture du shapefile + reprojection Lambert-93 → WGS84 via le `.prj`
  (shpjs, encodage forcé en `windows-1252` — les exports BRGM n'ont pas de
  `.cpg` alors que le `.dbf` est en Windows-1252),
- simplification géométrique (Douglas-Peucker, tolérance ≈ 30 m),
- conservation des seuls attributs utiles (`NOTATION`, `DESCR`, `CODE`,
  `CODE_LEG`, `CARTE`),
- stockage persistant dans IndexedDB (base `randogeol-db`), disponible
  hors-ligne dès l'import et aux sessions suivantes.

Import typique : quelques secondes à quelques dizaines de secondes selon
l'appareil et la taille du département.

Chaque département importé peut être supprimé individuellement depuis la
liste affichée sous le formulaire d'import.

### Sauvegarde entre appareils
Les départements importés (IndexedDB) sont propres à l'appareil/navigateur —
pas de synchronisation automatique. Pour les dupliquer (ex. PC → smartphone) :
1. **Exporter mes départements** → télécharge un fichier
   `randogeol-departements-AAAA-MM-JJ.json`.
2. Transférer ce fichier manuellement (e-mail, cloud, câble…).
3. Sur l'autre appareil, **Importer une sauvegarde** avec ce fichier.

Le Var, fourni avec l'app, n'a pas besoin d'être sauvegardé.

### Position GPS
Case à cocher « Afficher ma position sur la carte » : active le suivi GPS du
téléphone (`watchPosition`), affiche un marqueur avec son cercle de précision,
recentre la carte au premier point. Se désactive proprement à la décoche
(arrêt du GPS, économie de batterie).

### Tracé GPX / KML
Import d'un fichier `.gpx` ou `.kml` : trace le parcours, place les
waypoints nommés, recentre la carte, calcule la distance et le D+/D- (si
l'altitude est présente dans le fichier). Bouton pour effacer le tracé.

## Hors-ligne / PWA

- Installable (manifest + icônes).
- Service worker `sw.js` en cache "brise-cache" : versioning explicite
  (`randogeol-cache-vN`), purge des anciens caches à l'activation, activation
  immédiate (`skipWaiting`/`clients.claim`).
- La coquille de l'app (HTML/CSS/JS, Leaflet, JSZip, shpjs, icônes,
  `data/departments.json`) est préchargée à l'installation.
- Les tuiles de fond de plan, les tuiles/légendes WMS BRGM et les fichiers
  `data/<code>.geojson` des départements **ne sont pas préchargés** (trop
  volumineux ou nécessitant le réseau) : ils sont mis en cache au fil de
  l'usage (cache-first après premier chargement) ou stockés en IndexedDB
  pour les départements importés.
- À chaque mise à jour de fichiers de l'app, incrémenter `CACHE_NAME` dans
  `sw.js` pour forcer le rafraîchissement chez les utilisateurs.

## Architecture des fichiers

```
index.html
style.css
app.js                  // toute la logique (carte, GPX/KML, GPS, BD Charm-50, import, sauvegarde)
sw.js                   // service worker brise-cache
manifest.json
icon-192.png / icon-512.png
data/
  departments.json      // liste des départements fournis avec l'app (Var)
  083.geojson            // formations géologiques du Var (WGS84, simplifié)
vendor/
  leaflet/               // Leaflet 1.9.4 (carte)
  jszip/                 // JSZip (dézippage des imports BD Charm-50)
  shpjs/                 // shpjs (lecture shapefile + reprojection)
```

## Limites connues

- Les couches WMS scannées/harmonisées du BRGM ne sont utilisables qu'à une
  échelle ville/département (voir plus haut) et ne sont pas interrogeables
  directement (`LayerNotQueryable`) — l'identification précise passe
  uniquement par les données BD Charm-50 chargées dans l'app.
- Les départements importés sont stockés en IndexedDB, donc **propres à
  l'appareil et au navigateur** utilisés pour l'import ; utiliser la
  sauvegarde export/import pour les dupliquer ailleurs.
- La BD Charm-50 ne fournit pas de champ étage/sous-étage séparé pour tous
  les enregistrements : l'information d'âge, quand elle existe, est intégrée
  au champ `DESCR`.
- L'import d'un département volumineux peut prendre plusieurs dizaines de
  secondes sur un téléphone d'entrée de gamme (dézippage + lecture shapefile
  + simplification, tout en JavaScript côté client).

## Crédits

- Fonds de plan : © les contributeurs d'OpenStreetMap · © IGN — Géoplateforme.
- Cartes géologiques : © BRGM — GéoServices
  (`geoservices.brgm.fr/geologie`).
- Formations vectorielles : © BRGM — BD Charm-50 (Licence Ouverte).
