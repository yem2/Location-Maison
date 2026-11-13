# Référence des API

Toutes les routes sont sous `/api/<fichier>?a=<action>`. Les actions modifiantes exigent la méthode POST/PATCH/DELETE, un en-tête `Origin` identique au site et une session valide.

| Fichier | Rôle | Actions (`a=`) |
|---|---|---|
| `admins` | Gestion des administrateurs (super administrateur) | `GET`, `POST`, `PATCH ?id=`, `DELETE ?id=` |
| `auth` | Connexion des administrateurs (login, logout, me, forgot, reset, 2FA, mot de passe) | `forgot`, `login`, `logout`, `me`, `password`, `ping`, `profile`, `reset`, `totp_disable`, `totp_enable`, `totp_setup` |
| `chat` | Messagerie clients ↔ support et clients ↔ clients | `admin_delete_message`, `admin_messages`, `admin_send`, `admin_threads`, `messages`, `send`, `start`, `threads` |
| `console` | Console d'administration (compteurs, clients, archives, suggestions, activité) | `activity`, `archives`, `audit`, `counts`, `customers`, `notifications`, `purge`, `restore`, `stats`, `suggestions` |
| `customer` | Comptes clients (signup, login, logout, me, profil, notifications, forgot, reset) | `forgot`, `login`, `logout`, `me`, `notifications`, `password`, `profile`, `reset`, `signup`, `suggest`, `track` |
| `image` | Envoi et lecture des images (JPEG / PNG / WebP vérifiées) | `GET ?id=` (lire), `POST` (envoyer) |
| `messages` | Formulaire de contact (public) et boîte de réception (admin) | — |
| `monitor` | Supervision (santé, base, serveur, erreurs, sécurité, intégrité du code) | `approve`, `client_error`, `code`, `cron`, `db`, `deps`, `events`, `health`, `overview`, `server`, `users` |
| `orders` | Demandes de réservation (client : créer/annuler ; admin : accepter/refuser/archiver) | — |
| `pay` | Paiement côté client (choisir un moyen, retours et webhooks Flutterwave / PayPal) | `config`, `markpaid`, `methods`, `pp_return`, `pp_webhook`, `return`, `start`, `webhook` |
| `payments` | Module Paiements (admin), contrats et reçus PDF | `agency`, `confirm`, `contract`, `contract_create`, `contract_void`, `contracts`, `export`, `list`, `mydocs`, `receipt`, `reject`, `settings` |
| `properties` | Annonces (public : liste ; admin : créer/modifier/archiver) | — |

## Conventions
- Noms d'actions en minuscules, mots séparés par `_` (`admin_threads`, `contract_create`).
- Lecture = GET, création/validation = POST, modification partielle = PATCH, suppression = DELETE (la suppression envoie vers **Archives**, récupérable).
- Réponses d'erreur : `{ "error": "message lisible" }` avec le bon code HTTP (400 données, 401 non connecté, 403 droits, 404 introuvable, 409 conflit, 429 trop de requêtes).
- Montants et devises : toujours calculés par le serveur à partir de la demande, jamais lus dans la requête du navigateur.
- Limite Vercel gratuit : 12 fonctions maximum (une par fichier `api/*.js` sans `_`). Les documents PDF sont donc servis par `payments`.
