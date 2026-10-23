# Chrono Todo

Todo avec chronomètre par tâche, projets et sous-projets. Application web installable sur téléphone (PWA), utilisable hors-ligne.

## Fonctionnalités

- **Navigation** : quatre onglets, dans l’ordre du parcours — **Aujourd’hui** (agir sur la journée), **Tâches** (organiser : sous-vues « Liste » et « Projets »), **Planning** (prévoir), **Bilan** (ce qui a été fait : sous-vues « Réalisées » et « Temps »). Le **+** au centre de la barre crée une tâche depuis partout (rangée dans le projet ouvert). Pastilles : le nombre de choses qui restent à faire aujourd’hui, un point rouge s’il y a des tâches en retard. L’onglet actif s’allume d’une pastille qui s’étire ; la sous-vue choisie est gardée. Une aide s’affiche une fois après la mise à jour.
- **Ma journée** (onglet « Aujourd’hui », page d’accueil) : progression du jour et temps chronométré par projet dans un même en-tête (le toucher ouvre Bilan › Temps), une seule carte d’aide à la fois au-dessus, carte « Maintenant / Ensuite », programme du jour (événements, créneaux, créneaux libres, ligne « maintenant »), tâches du jour et en retard en blocs à valider (une fois réalisés, créneaux et tâches se barrent puis quittent la page : leur place redevient libre ; ils se retrouvent dans un petit menu discret « N réalisées aujourd’hui », avec ↺ pour annuler) (✓ ou balayage vers la droite ; balayage vers la gauche = reporter à demain), « Caler » / « Tout caler » dans les créneaux libres, prioritaires à ajouter, récap des tâches faites, aperçu de demain. Un créneau dont le chrono tourne encore après son heure de fin reste « en cours » (« +22 min ») au lieu de se griser, et s’allonge dans le planning jusqu’à l’heure actuelle ; à l’arrêt du chrono, il garde sa nouvelle fin (lancé après son heure, il se recale sur l’heure réelle).
- **Tâches** : titre (★ prioritaire à côté), projet, sous-projet, échéance, note. Badges « En retard », « Aujourd’hui », « Demain ». Recherche (titre, note, projet, sans accents) dès qu’il y a quelques tâches. Les cartes se balaient comme dans « Ma journée » (vers la droite : terminée ; vers la gauche : échéance demain), aussi sur la page d’un projet.
- **Étapes (checklist)** : dans la fiche d’une tâche (et dès sa création), des étapes à cocher : Entrée pour enchaîner, plusieurs lignes collées = plusieurs étapes (« - », « 1. », « [x] » compris), texte modifiable, ×  pour supprimer. Une liste écrite dans la note se transforme en étapes d’un toucher. Sur les cartes (Tâches, Ma journée) : avancement en petit anneau (« 2/5 ») et la prochaine étape, à cocher sans ouvrir la fiche (« Annuler » dans le message). Toutes faites : l’app propose de terminer la tâche. L’ordre des étapes se change en glissant la poignée ⋮⋮. La recherche trouve aussi le texte des étapes.
- **Fiche de création** compacte, sans défilement : échéance vide par défaut, en pastilles à bascule (Aujourd’hui, Demain, Dans 1 sem., Date…) ; une date écrite dans le titre (« demain », « vendredi », « le 25 », « 25/10 », « dans 3 jours »…) devient l’échéance, marquée ✨. **Créer** est le bouton principal (Entrée, ou Ctrl/⌘ + Entrée depuis la note) ; **Lancer** crée et démarre le chrono ; **Placer dans l’agenda** crée la tâche et la met « en main » dans le planning : elle suit la souris (aperçu du créneau), un clic ou un toucher la dépose, durée au choix dans la barre du bas, jour d’échéance signalé, Échap pour annuler. Après « Créer », le message propose aussi « Planifier ». Touche N : nouvelle tâche.
- **Suggestions à la création** (bouton +, agenda, page d’un projet, Ma journée), calculées sur l’appareil, sans rien envoyer :
  - titres déjà utilisés pendant la frappe (début de mot, dans n’importe quel ordre, sans accents) ; un toucher reprend le titre, le projet et le sous-projet. Titre encore vide : les tâches qui reviennent souvent ;
  - projet › sous-projet les plus probables, en pastilles sous le titre, avec la raison. D’abord l’historique (mots communs, surtout les rares ; tâches fréquentes et récentes ; même nom), puis le bon sens : un lexique (footing → course à pied, copies → correction, impôts → administratif, niveaux et matières scolaires, emojis…) reconnu dans les noms de SES projets et sous-projets ;
  - suggestion nette : présélectionnée et marquée « ✨ suggéré » (touche la pastille pour l’annuler). Un choix fait à la main n’est jamais remplacé. Depuis la page d’un projet, seul le sous-projet se propose.
- **Bilan › Réalisées** : les tâches réalisées jour par jour (heure, projet, temps passé, créneau), avec en tête les chiffres du jour, de la semaine (comparée à la précédente), la série de jours d’affilée et un graphique des 14 derniers jours (toucher une barre mène au jour). Recherche, filtre par projet, « ↺ » pour remettre une tâche à faire. Les créneaux validés d’une tâche régulière y figurent aussi.
- **Tâche terminée** : petite animation (la coche se remplit d’un rebond et le ✓ se dessine, un éclat de rayons et de paillettes, le titre se barre de gauche à droite, un reflet balaie la carte, puis la carte glisse et la liste se resserre), avec retour haptique (Android, iPhone sous iOS 18 et plus). Sans carte visible, une pastille ✓ apparaît au centre. Animations réduites si le téléphone le demande.
- **Chrono** : bouton ▶ sur chaque tâche. Plusieurs chronos peuvent tourner en même temps (un par tâche) : lancer une tâche n’arrête pas les autres. Le bandeau du haut affiche une ligne par chrono, chacune avec son bouton d’arrêt. Les chronos continuent même si l’app est fermée.
- **Fiche « Chrono »** (toucher le bandeau, ou « Corriger » dans la fiche de la tâche) : grand compteur avec anneau (vers la durée prévue au planning, sinon au fil de l’heure) ; « Commencé à » se corrige (−5 / −15 / −30 min) ; **arrêter à une heure passée** quand on a oublié de l’arrêter (il y a 15 min, 30 min, 1 h, à la fin du créneau, ou à une heure précise), avec une frise de ce qui est gardé et retiré ; ou annuler le chrono sans rien compter. **Pomodoro** (25 / 5 ou 50 / 10) : le cadran devient un compte à rebours de concentration puis de pause (anneau vert), avec un petit carillon, une vibration et un message à chaque changement ; la phase s’affiche aussi dans le bandeau et l’onglet du navigateur. Le temps de la tâche continue d’être compté. « Annuler » dans le message qui suit. Au-delà de 3 h, le bandeau prévient (« Chrono oublié ? ») et le bouton d’arrêt ouvre directement cette fiche.
- **Journal** : chaque session est enregistrée et modifiable (jour, début, fin, durée en direct, « −5 min / −15 min / −30 min / −1 h » pour retirer du temps), et on peut ajouter du temps à la main.
- **Temps prévu** : une tâche planifiée terminée sans aucun temps chronométré propose d’enregistrer la durée prévue au planning (à l’heure du créneau, ou se terminant maintenant si elle est finie en avance). Si un chrono tourne, sa durée réelle est gardée et la question n’est pas posée. Pour une tâche régulière, la question porte sur le créneau validé du jour.
- **Projets / sous-projets** : couleurs, archivage (masqué mais gardé dans les stats).
- **Bilan › Temps** : jour, semaine, mois, trimestre et année scolaire (août → juillet), par projet, sous-projet et tâche, et la liste des sessions. Comparaison avec la période précédente (au même stade si elle est en cours) et moyenne par jour actif ; toucher une colonne du graphique affiche sa valeur et son détail par projet.
- **Fluidité** : les pages glissent légèrement d’un onglet à l’autre, les fiches se ferment en glissant ; toucher l’onglet ouvert remonte en haut. Raccourcis sur ordinateur : 1 à 4 (onglets), / (rechercher), N (nouvelle tâche). L’app vérifie toujours s’il existe une version plus récente.
- **Sauvegarde** : export/import JSON, export du journal en CSV pour Excel.
- **Synchro entre appareils** (facultative) : mêmes tâches, projets, temps et chrono en cours sur le téléphone et l’ordinateur.
- **Deux profils (Romain / Rebecca)** : choix à l’ouverture de l’app ; chacun a ses tâches, projets, chronos et stats. Un seul code de synchro pour le foyer, chaque profil a son propre espace chiffré.
- **Tâches prioritaires** : l’étoile ★ fait passer une tâche en tête de liste.
- **Créneaux d’une tâche** : sa fiche liste ses prochains créneaux (à ouvrir ou retirer) et propose « Placer un autre créneau ».
- **Planning** (vue semaine ou jour, de 6h à 24h) : les tâches à placer sont dans une barre à droite sur ordinateur, et dans un bandeau en bas sur téléphone (réduit à une ligne, agrandi d’un geste sur la poignée, effacé pendant le glisser). Glisser-déposer dans la grille (appui long puis glisser au doigt), ou toucher une tâche puis un créneau, ou toucher un créneau vide puis choisir la tâche. Les blocs se déplacent, s’allongent (bord du bas) et se retirent en les déposant sur la zone « retirer ». Les anciens événements fixes (rayés) se transforment en tâche d’un toucher. Dessiner un créneau dans la grille (appui long puis glisser au doigt, ou cliquer-glisser à la souris) pour créer une tâche à ce moment-là. Balayer la grille vers la gauche / la droite : semaine suivante / précédente ; pincer : zoom des heures (pas de la page). Un créneau réalisé garde sa couleur, en dégradé lumineux, avec une encoche ✓, « Fait » et une fine rayure.
- **Tâches régulières** : en créant une tâche depuis l’agenda, « Répéter › Régulièrement » choisit le rythme (chaque semaine, une sur deux, sur trois, sur quatre), les jours et le nombre de semaines (1 à 52) ; un créneau est créé pour chaque jour. Chaque créneau se valide à part ; la fiche d’un créneau permet de mettre son horaire à tous les suivants ou de retirer la suite.
- **Quand, en toutes lettres** : à la création (fiche d’un créneau : champ « Quand » ; bouton + : « Ou écris quand », ou directement dans le titre), on écrit la planification comme on la dirait : « tous les lundis de 8h30 à 10h30 pendant 6 semaines », « une semaine sur deux », « un mardi sur deux à 17h », « le mardi et le jeudi à 18h », « en semaine à 7h », « tous les jours à 7h », « 3 fois par semaine », « 6 fois », « jusqu’au 15 décembre », « à partir du 3 novembre », « vendredi 14h », « demain à midi », « dans 3 jours à 10h »… Dans le champ « Quand » : « maintenant » (ou « tout de suite »), « maintenant pendant 30 min », « dans 20 min », « dans une heure ». La fiche se règle aussitôt (jour, heure, durée, rythme) et affiche ce qui a été compris (✨). Lue dans le titre, la planification en est retirée (« Footing tous les lundis à 7h » → tâche « Footing ») ; × pour l’ignorer. Dans le titre, seul ce qui est sûr est pris : une répétition, ou un jour avec une heure (« Réunion 14h » ou « le 25 » restent des titres, ou une échéance).
- **Tâches sur plusieurs jours** (voyage…) : durée « Plusieurs jours », du jour choisi jusqu’à la date de fin. Elles s’affichent en barre au-dessus des heures dans le planning et en tête de « Ma journée » (« Jour 2 sur 3 »).
- **Page projet** : tâches rangées par sous-projet, ajout direct, transformation d’un projet en sous-projet, « Nouveau sous-projet ».
- **Sous-projets** : toucher le nom d’un sous-projet (✎) sur la page de son projet ouvre sa fiche : le renommer (avec emoji), le déplacer dans un autre projet (ses tâches et son temps suivent ; même nom déjà présent : on propose de les réunir), voir son temps passé et ses tâches à faire, en faire un projet à part entière, ou le supprimer (ses tâches restent dans le projet). « Annuler » dans le message qui suit. La fiche s’ouvre aussi depuis l’onglet Tâches (✎ à côté des filtres d’un sous-projet) et depuis le menu « Sous-projet » de la fiche d’une tâche (« Modifier … », puis retour à la tâche).
- **Ordre des projets** : glisser la poignée ⋮⋮ dans Tâches › Projets (ordre synchronisé). Les sous-projets aussi, dans la fiche « Modifier » du projet : leur ordre est repris sur la page du projet et dans les menus.
- **Emojis** dans les noms (tâches, projets, sous-projets, événements) : bouton 🙂 avec recherche en français, thèmes et récents.

Les données sont enregistrées sur l’appareil (localStorage). Sans synchro, rien n’est envoyé sur internet ; « Ma journée » rappelle alors discrètement de faire une sauvegarde quand la dernière date de plus de 30 jours (« Sauvegarder », « Activer la synchro », ou plus tard).

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
