# Chrono Todo

Todo avec chronomètre par tâche, projets et sous-projets. Application web installable sur téléphone (PWA), utilisable hors-ligne.

## Fonctionnalités

- **Tâches** : titre, projet, sous-projet, échéance, notes. Badges « En retard », « Aujourd’hui », « Demain ».
- **Chrono** : bouton ▶ sur chaque tâche. Un seul chrono à la fois (lancer une tâche arrête la précédente). Il continue même si l’app est fermée. Au-delà de 4 h, l’app propose de corriger la durée (chrono oublié).
- **Journal** : chaque session est enregistrée, modifiable, et on peut ajouter du temps à la main.
- **Projets / sous-projets** : couleurs, archivage (masqué mais gardé dans les stats).
- **Stats** : jour, semaine, mois, trimestre et année scolaire (août → juillet), par projet, sous-projet et tâche.
- **Sauvegarde** : export/import JSON, export du journal en CSV pour Excel.

Les données restent sur l’appareil (localStorage) : rien n’est envoyé sur un serveur.

## Structure

- `public/` : l’application (HTML/CSS/JS, sans dépendance ni étape de build)
- `wrangler.jsonc` : déploiement sur Cloudflare Workers (fichiers statiques)

## Lancer en local

```bash
python -m http.server 8787 --directory public
```

## Déploiement

Chaque `git push` sur `main` déclenche un déploiement automatique sur Cloudflare (Workers Builds, commande `npx wrangler deploy`).
