# Chrono Todo

Todo avec chronomètre par tâche, projets et sous-projets. Application web installable sur téléphone (PWA), utilisable hors-ligne.

## Fonctionnalités

- **Tâches** : titre, projet, sous-projet, échéance, notes. Badges « En retard », « Aujourd’hui », « Demain ».
- **Chrono** : bouton ▶ sur chaque tâche. Un seul chrono à la fois (lancer une tâche arrête la précédente). Il continue même si l’app est fermée. Au-delà de 4 h, l’app propose de corriger la durée (chrono oublié).
- **Journal** : chaque session est enregistrée, modifiable, et on peut ajouter du temps à la main.
- **Projets / sous-projets** : couleurs, archivage (masqué mais gardé dans les stats).
- **Stats** : jour, semaine, mois, trimestre et année scolaire (août → juillet), par projet, sous-projet et tâche.
- **Sauvegarde** : export/import JSON, export du journal en CSV pour Excel.
- **Synchro entre appareils** (facultative) : mêmes tâches, projets, temps et chrono en cours sur le téléphone et l’ordinateur.
- **Deux profils (Romain / Rebecca)** : choix à l’ouverture de l’app ; chacun a ses tâches, projets, chronos et stats. Un seul code de synchro pour le foyer, chaque profil a son propre espace chiffré.
- **Tâches prioritaires** : l’étoile ★ fait passer une tâche en tête de liste.
- **Planning** (vue semaine ou jour, de 6h à 24h) : les tâches à placer sont dans une barre à droite sur ordinateur, et dans un bandeau en bas sur téléphone (réduit à une ligne, agrandi d’un geste sur la poignée, effacé pendant le glisser). Glisser-déposer dans la grille (appui long puis glisser au doigt), ou toucher une tâche puis un créneau, ou toucher un créneau vide puis choisir la tâche. Les blocs se déplacent, s’allongent (bord du bas) et se retirent en les déposant sur la zone « retirer ». Événements fixes récurrents (travail, cours…) affichés en fond pour caler les tâches autour. Balayer la grille vers la droite / la gauche : semaine suivante / précédente ; pincer : zoom des heures (pas de la page).
- **Page projet** : tâches rangées par sous-projet, ajout direct, transformation d’un projet en sous-projet.
- **Ordre des projets** : glisser la poignée ⋮⋮ dans l’onglet Projets (ordre synchronisé).
- **Emojis** dans les noms (tâches, projets, sous-projets, événements) : bouton 🙂 avec recherche en français, thèmes et récents.

Les données sont enregistrées sur l’appareil (localStorage). Sans synchro, rien n’est envoyé sur internet.

## Synchronisation

Dans **Réglages › Synchronisation** :

1. Sur le premier appareil : **Activer la synchro**. L’app affiche un code secret de 20 caractères (`XXXX-XXXX-XXXX-XXXX-XXXX`).
2. Sur l’autre appareil : **J’ai déjà un code**, puis saisir ce code.

Fonctionnement :

- Le code ne quitte jamais les appareils. L’app en tire l’identifiant de stockage et la clé de chiffrement (AES-GCM) : le serveur ne reçoit que des données chiffrées, illisibles sans le code.
- Synchro au démarrage, au retour au premier plan, au retour du réseau, toutes les 30 s quand l’app est ouverte et quelques secondes après chaque modification. Hors-ligne, l’app fonctionne normalement et envoie ses modifications dès que possible.
- Fusion élément par élément (tâche, projet, sous-projet, session) : la version la plus récente gagne. Les suppressions sont propagées (marqueurs gardés 180 jours). Si la même tâche est modifiée sur les deux appareils avant qu’ils se synchronisent, c’est la modification la plus récente qui l’emporte pour toute la tâche.
- Chrono : si deux chronos ont été lancés sur deux appareils sans connexion, le plus récent continue et l’autre est enregistré comme arrêté au démarrage du second.
- L’affichage (onglet, filtres, période des stats) reste propre à chaque appareil.

Côté serveur, `worker.js` expose `GET`/`PUT /api/sync/<id>` et stocke le bloc chiffré dans Cloudflare KV (binding `SYNC`).

### Mise en place sur Cloudflare (une seule fois)

1. Tableau de bord Cloudflare › **Storage & Databases › Workers KV** › **Create instance** (ou *Create namespace*). Nom : `chronotodo-sync`.
2. Copier l’**ID** du namespace créé (32 caractères hexadécimaux).
3. Dans `wrangler.jsonc`, remplacer `REMPLACER_PAR_ID_DU_NAMESPACE_KV` par cet ID. Le binding `SYNC` y est déjà déclaré : inutile de l’ajouter dans le tableau de bord (le déploiement reprend la configuration de `wrangler.jsonc`).
4. Pousser sur `main` : le déploiement automatique met en ligne l’app et l’API.

L’ID du namespace n’est pas un secret (il ne donne accès à rien sans les identifiants du compte Cloudflare) : il peut figurer dans ce dépôt public. Le plan gratuit de KV (1 000 écritures et 100 000 lectures par jour) suffit largement : une écriture par envoi de modifications.

## Structure

- `public/` : l’application (HTML/CSS/JS, sans dépendance ni étape de build)
- `worker.js` : l’API de synchronisation (Cloudflare Worker)
- `wrangler.jsonc` : déploiement sur Cloudflare Workers (fichiers statiques + API)

## Lancer en local

Avec l’API de synchro (KV simulé en local, dans `.wrangler/`) :

```bash
npx wrangler dev --ip 127.0.0.1
```

Pour tester la synchro entre deux « appareils » sur le même ordinateur, ouvrir `http://localhost:8787` et `http://127.0.0.1:8787` : ce sont deux origines, donc deux stockages séparés.

Sans la synchro, un simple serveur statique suffit :

```bash
python -m http.server 8787 --directory public
```

## Déploiement

Chaque `git push` sur `main` déclenche un déploiement automatique sur Cloudflare (Workers Builds, commande `npx wrangler deploy`).
