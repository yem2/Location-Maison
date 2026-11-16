# WhatsApp : Green API (même méthode que octoplus) ou API Cloud de Meta

**Comment ça marche.** Chaque notification du site (nouveau message, demande, acceptation, paiement, visite, rappel…) part aussi sur **WhatsApp** vers le numéro enregistré dans le profil. Chaque envoi est inscrit dans un **journal** (Supervision > **WhatsApp**) avec son résultat et, en cas d'échec, la cause en clair.

**Variables Vercel** (type « Sensitive », puis redéployer) — mêmes noms que dans octoplus :
- `GREENAPI_ID` (idInstance), `GREENAPI_TOKEN` (apiTokenInstance), `GREENAPI_URL` (ex. `https://7107.api.greenapi.com`).
- Les anciens noms `ID_INSTANCE`, `API_TOKEN_INSTANCE`, `API_URL` (et leurs copies en `…1`) fonctionnent aussi ; les `GREENAPI_*` sont prioritaires.
- L'instance Green API doit être **autorisée** (QR code scanné avec le WhatsApp de l'entreprise).

**Qui reçoit quoi**
- **Équipe (super administrateur et administrateurs)** : toutes les notifications, sur le numéro de leur profil (« Mon profil »). Désactivable avec `WA_ADMINS=off`.
- **Clients** : leurs notifications et les messages de l'équipe, seulement s'ils ont coché la case WhatsApp dans leur profil.
- **Messagerie** : chaque message part sur WhatsApp (la notification dans l'application reste unique tant que des messages ne sont pas lus).
- Sécurité du numéro : **8 messages par minute et par destinataire maximum** (au-delà, ignoré et journalisé), pour éviter tout blocage du numéro.
- Option : `WA_ONLY_OFFLINE=1` n'envoie rien aux personnes connectées depuis moins de 5 minutes.

**Pour vérifier** : Supervision > WhatsApp > *Envoyer un test à mon numéro* (renseignez d'abord votre numéro avec l'indicatif dans « Mon profil »). Si l'état n'est pas « Instance connectée », scannez le QR code dans Green API. Le plan gratuit « Developer » de Green API est limité (quota) : l'erreur s'affiche dans le journal.

---

# Notifications WhatsApp (API Cloud de Meta)

Le site envoie un message WhatsApp à un utilisateur (client ou administrateur) seulement si :
- il a **coché la case** « Recevoir mes notifications sur WhatsApp » et fourni son numéro ;
- il n'est **pas connecté** au site (aucune activité depuis 5 minutes) ;
- il n'a pas déjà reçu un message WhatsApp depuis 3 minutes.

Sont concernés : messages du chat, réponses du support, demande acceptée/refusée, paiement reçu, bien devenu indisponible (et, pour le super administrateur, nouveaux comptes/demandes/suggestions).

## Configuration
1. Créez un compte Meta Business et une application « WhatsApp » sur https://developers.facebook.com
2. Ajoutez un numéro WhatsApp Business et notez le **Phone Number ID**. Créez un **jeton d'accès permanent** (utilisateur système).
3. Créez un **modèle de message** (catégorie « Utilitaire », langue Français) nommé par exemple `notification_maison` avec ce corps :
   `Maison : {{1}}`
   et attendez son approbation par Meta. (WhatsApp impose un modèle approuvé pour écrire à quelqu'un qui ne vous a pas écrit dans les 24 h.)
4. Dans Vercel > Settings > Environment Variables, ajoutez (type « Sensitive ») :
   - `WA_ACCESS_TOKEN` = le jeton d'accès
   - `WA_PHONE_ID` = le Phone Number ID
   - `WA_TEMPLATE` = notification_maison
   - `WA_LANG` = fr  (facultatif)
   - `DEFAULT_COUNTRY_CODE` = 237  (facultatif ; ajouté aux numéros à 9 chiffres commençant par 6)
5. Redéployez.

Sans ces variables, rien n'est envoyé sur WhatsApp : les notifications restent dans l'application.
