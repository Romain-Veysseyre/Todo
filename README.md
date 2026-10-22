# Chrono Todo

Todo avec chronomètre par tâche, projets et sous-projets. Application web installable sur téléphone (PWA), utilisable hors-ligne.

## Fonctionnalités

- **Ma journée** (onglet « Aujourd’hui », page d’accueil) : progression du jour, temps chronométré par projet, carte « Maintenant / Ensuite », programme du jour (événements, créneaux, créneaux libres, ligne « maintenant »), tâches du jour et en retard en blocs à valider (✓ ou balayage vers la droite ; balayage vers la gauche = reporter à demain), « Caler » / « Tout caler » dans les créneaux libres, prioritaires à ajouter, récap des tâches faites, aperçu de demain.
- **Tâches** : titre (★ prioritaire à côté), projet, sous-projet, échéance, note. Badges « En retard », « Aujourd’hui », « Demain ».
- **Fiche de création** compacte, sans défilement : échéance vide par défaut, en pastilles à bascule (Aujourd’hui, Demain, Dans 1 sem., Date…) ; une date écrite dans le titre (« demain », « vendredi », « le 25 », « 25/10 », « dans 3 jours »…) devient l’échéance, marquée ✨. **Créer** est le bouton principal (Entrée, ou Ctrl/⌘ + Entrée depuis la note) ; **Lancer** crée et démarre le chrono ; **Placer dans l’agenda** crée la tâche et la met « en main » dans le planning : elle suit la souris (aperçu du créneau), un clic ou un toucher la dépose, durée au choix dans la barre du bas, jour d’échéance signalé, Échap pour annuler. Après « Créer », le message propose aussi « Planifier ». Touche N : nouvelle tâche.
- **Suggestions à la création** (bouton +, agenda, page d’un projet, Ma journée), calculées sur l’appareil, sans rien envoyer :
  - titres déjà utilisés pendant la frappe (début de mot, dans n’importe quel ordre, sans accents) ; un toucher reprend le titre, le projet et le sous-projet. Titre encore vide : les tâches qui reviennent souvent ;
  - projet › sous-projet les plus probables, en pastilles sous le titre, avec la raison. D’abord l’historique (mots communs, surtout les rares ; tâches fréquentes et récentes ; même nom), puis le bon sens : un lexique (footing → course à pied, copies → correction, impôts → administratif, niveaux et matières scolaires, emojis…) reconnu dans les noms de SES projets et sous-projets ;
  - suggestion nette : présélectionnée et marquée « ✨ suggéré » (touche la pastille pour l’annuler). Un choix fait à la main n’est jamais remplacé. Depuis la page d’un projet, seul le sous-projet se propose.
- **Chrono** : bouton ▶ sur chaque tâche. Plusieurs chronos peuvent tourner en même temps (un par tâche) : lancer une tâche n’arrête pas les autres. Le bandeau du haut affiche une ligne par chrono, chacune avec son bouton d’arrêt. Les chronos continuent même si l’app est fermée. Au-delà de 4 h, l’app propose de corriger la durée (chrono oublié).
- **Journal** : chaque session est enregistrée, modifiable, et on peut ajouter du temps à la main.
- **Temps prévu** : une tâche planifiée terminée sans aucun temps chronométré propose d’enregistrer la durée prévue au planning (à l’heure du créneau, ou se terminant maintenant si elle est finie en avance). Si un chrono tourne, sa durée réelle est gardée et la question n’est pas posée. Pour une tâche régulière, la question porte sur le créneau validé du jour.
- **Projets / sous-projets** : couleurs, archivage (masqué mais gardé dans les stats).
- **Stats** : jour, semaine, mois, trimestre et année scolaire (août → juillet), par projet, sous-projet et tâche.
- **Sauvegarde** : export/import JSON, export du journal en CSV pour Excel.
- **Synchro entre appareils** (facultative) : mêmes tâches, projets, temps et chrono en cours sur le téléphone et l’ordinateur.
- **Deux profils (Romain / Rebecca)** : choix à l’ouverture de l’app ; chacun a ses tâches, projets, chronos et stats. Un seul code de synchro pour le foyer, chaque profil a son propre espace chiffré.
- **Tâches prioritaires** : l’étoile ★ fait passer une tâche en tête de liste.
- **Créneaux d’une tâche** : sa fiche liste ses prochains créneaux (à ouvrir ou retirer) et propose « Placer un autre créneau ».
- **Planning** (vue semaine ou jour, de 6h à 24h) : les tâches à placer sont dans une barre à droite sur ordinateur, et dans un bandeau en bas sur téléphone (réduit à une ligne, agrandi d’un geste sur la poignée, effacé pendant le glisser). Glisser-déposer dans la grille (appui long puis glisser au doigt), ou toucher une tâche puis un créneau, ou toucher un créneau vide puis choisir la tâche. Les blocs se déplacent, s’allongent (bord du bas) et se retirent en les déposant sur la zone « retirer ». Les anciens événements fixes (rayés) se transforment en tâche d’un toucher. Dessiner un créneau dans la grille (appui long puis glisser au doigt, ou cliquer-glisser à la souris) pour créer une tâche à ce moment-là. Balayer la grille vers la gauche / la droite : semaine suivante / précédente ; pincer : zoom des heures (pas de la page).
- **Tâches régulières** : en créant une tâche depuis l’agenda (ou depuis « Planifier dans l’agenda » dans sa fiche), « Répéter › Chaque semaine » choisit les jours et le nombre de semaines (1 à 52) ; un créneau est créé pour chaque jour. Chaque créneau se valide à part ; la fiche d’un créneau permet de mettre son horaire à tous les suivants ou de retirer la suite.
- **Tâches sur plusieurs jours** (voyage…) : durée « Plusieurs jours », du jour choisi jusqu’à la date de fin. Elles s’affichent en barre au-dessus des heures dans le planning et en tête de « Ma journée » (« Jour 2 sur 3 »).
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
- Chronos : ceux lancés sur chaque appareil sont réunis, sauf ceux arrêtés ailleurs. Si la même tâche a été lancée sur deux appareils sans connexion, le chrono le plus récent continue et l’autre est enregistré comme arrêté au démarrage du second.
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
