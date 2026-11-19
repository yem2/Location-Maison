# Inventaire des API

Toutes les API sont sous `/api/<nom>` ; l'action se choisit avec `?a=<action>` (sauf `orders`, `properties`, `messages`, `admins` qui utilisent aussi les verbes HTTP).
Convention : `domaine_action` en minuscules avec underscore ; préfixe `admin_` = réservé à l'équipe ; `visit_` = visites ; `wa_` = WhatsApp.
Toute écriture (POST/PUT/PATCH/DELETE) exige un en-tête `Origin` identique au site (protection CSRF).

| API | Actions |
|---|---|
| `orders` (visites) | `visit_reminders`, `visits_admin`, `visit_set`, `visits`, `visit_slots`, `visit_ics`, `visit_book`, `visit_cancel` |
| `admins` | verbes HTTP |
| `auth` | `me`, `ping`, `logout`, `forgot`, `reset`, `login`, `wa_test`, `profile`, `password`, `totp_setup`, `totp_enable`, `totp_disable` |
| `chat` | `admin_threads`, `admin_delete_message`, `admin_messages`, `admin_send`, `threads`, `start`, `messages`, `send` |
| `console` | `counts`, `stats`, `suggestions`, `audit`, `notifications`, `customers`, `activity` |
| `customer` | `me`, `notifications`, `logout`, `track`, `profile`, `password`, `suggest`, `signup`, `forgot`, `reset`, `login` |
| `image` | `GET ?id=` (lecture), `POST` (téléversement, administrateur) |
| `messages` | verbes HTTP |
| `monitor` | `health`, `client_error`, `cron`, `overview`, `whatsapp`, `users`, `events`, `db`, `server`, `code`, `deps`, `approve` |
| `orders` | verbes HTTP |
| `pay` | `config`, `return`, `paypal_return`, `paypal_cancel`, `webhook`, `receipt`, `contract`, `export`, `admin_methods`, `admin_status`, `admin_payments`, `markpaid`, `admin_confirm`, `admin_reject`, `admin_recheck`, `admin_save`, `admin_toggle`, `admin_delete`, `admin_refund`, `methods`, `start`, `cash`, `online` |
| `properties` | verbes HTTP |

## Niveaux d'accès
- **Public** : `auth` (ping, login, forgot, reset), `customer` (inscription, login, forgot, reset), `properties` (GET liste publique), `messages` (formulaire de contact), `pay` (config, return, paypal_*, webhook signé).
- **Client connecté** : `customer` (me, profile, password…), `orders`, `chat`, `visits`, `visit_*`, `pay` (methods, start, receipt, contract).
- **Administrateur** : `console`, `orders?admin=1`, `properties` (écriture), `chat` (admin_*), `visits_admin`, `visit_set`, `pay` (admin_payments, admin_confirm, admin_reject, admin_recheck, markpaid).
- **Super administrateur uniquement** : `admins`, `monitor`, `pay` (admin_methods, admin_status, admin_save, admin_toggle, admin_delete, admin_refund, export), journal de sécurité et liste des clients (`console`).

## Points d'attention (appellations)
- `markpaid`, `cash`, `online` (dans `pay`) sont d'anciens noms conservés pour compatibilité ; les noms actuels sont `admin_confirm`, `start`.
- `visits` (liste du client) / `visits_admin` (liste de l'équipe) / `visit_set` : singulier et pluriel mélangés mais sans ambiguïté ; ne pas renommer sans migrer l'interface.
- `wa_test` est dans `auth` (test depuis « Mon profil ») ; l'état et le journal WhatsApp sont dans `monitor?a=whatsapp`.
- Un fichier `api/*.js` = une fonction Vercel (12 maximum sur le plan gratuit). Les fichiers commençant par `_` sont des aides et ne comptent pas.
