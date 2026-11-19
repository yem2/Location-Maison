# Sauvegarde automatique des variables d'environnement Vercel

Le script `scripts/sync-env.mjs` lit **toutes** les variables de ton projet Vercel, les **chiffre** (AES-256-GCM) et les range
**hors du dépôt** (`~/vercel-env-backup`, c'est-à-dire `C:\Users\TonNom\vercel-env-backup` sous Windows).
À chaque passage il compare : s'il y a une variable **ajoutée, modifiée ou supprimée**, il crée une nouvelle sauvegarde datée
et l'écrit dans un journal (`changes.log`, noms seulement, jamais les valeurs).

## 1. Installation (5 minutes)
1. Installe Node 18 ou plus (nodejs.org).
2. Sur Vercel : **Account Settings › Tokens › Create Token** (nom « sauvegarde-env », expiration 90 jours, portée = ton équipe/compte). Copie le jeton.
3. Copie `.env.sync.example` en `.env.sync` et remplis `VERCEL_TOKEN`, `VERCEL_PROJECT` (nom du projet) et `BACKUP_PASSPHRASE`
   (une phrase longue : **sans elle les sauvegardes sont illisibles, personne ne peut la récupérer**).
   `VERCEL_TEAM_ID` seulement si le projet est dans une équipe.
4. Lance : `node scripts/sync-env.mjs` → la première sauvegarde se crée.

## 2. Déclenchement automatique
- **Surveillance continue** : `node scripts/sync-env.mjs --watch 15` (vérifie toutes les 15 minutes tant que la fenêtre reste ouverte).
- **Windows (recommandé)** : `powershell -ExecutionPolicy Bypass -File scripts\planifier-windows.ps1` crée une tâche planifiée toutes les 15 minutes, même après redémarrage.
- **Mac / Linux** : `crontab -e` puis `*/15 * * * * cd /chemin/du/projet && node scripts/sync-env.mjs >> ~/sync-env.log 2>&1`.

Remarque : Vercel n'envoie pas d'alerte fiable quand une variable change, donc le script **interroge** Vercel à intervalle régulier.
Une nouvelle variable est sauvegardée au plus tard 15 minutes après son ajout.

## 3. Commandes utiles
| Commande | Effet |
|---|---|
| `node scripts/sync-env.mjs --list` | Liste les variables sauvegardées (noms, environnements, pas les valeurs) |
| `node scripts/sync-env.mjs --check` | Compare avec les variables lues par le code (`api/*.js`) : signale les obligatoires manquantes |
| `node scripts/sync-env.mjs --show NOM --target production` | Affiche la valeur d'une variable |
| `node scripts/sync-env.mjs --restore .env.local --target development` | Recrée un fichier `.env` local (`--force` pour écraser) |

## 4. À savoir (sécurité)
- **Variables « Sensitive »** : Vercel ne rend jamais leur valeur, même avec un jeton. Le script sauvegarde leur **nom** et te le signale ; garde leur valeur ailleurs (gestionnaire de mots de passe).
- Ne mets jamais `.env.sync`, les sauvegardes ou le jeton dans GitHub : le `.gitignore` fourni les exclut, ne le supprime pas.
- Le jeton Vercel donne un accès large : mets une expiration, et révoque-le s'il a pu fuiter (vercel.com/account/tokens).
- Garde une copie de la sauvegarde chiffrée **et** de la phrase secrète à deux endroits différents (clé USB, gestionnaire de mots de passe).
- Les sauvegardes restent sur ton ordinateur. Si l'ordinateur est éteint, la surveillance est en pause et rattrape au prochain passage.
