# WhatsApp : Green API ou API Cloud de Meta

**Option A — Green API (instance personnelle, la plus simple).** Variables Vercel (type « Sensitive ») : `ID_INSTANCE`, `API_TOKEN_INSTANCE`, `API_URL` (ex. `https://7107.api.greenapi.com`). Les copies nommées `ID_INSTANCE1`, `API_TOKEN_INSTANCE1`, `API_URL1` sont prioritaires si elles existent. L'instance doit être **autorisée** (QR code scanné avec le WhatsApp de l'entreprise). Les messages sont du texte libre signé du nom de l'agence (`COMPANY_NAME`). Le plan gratuit « Developer » est limité par Green API.

**Pour vérifier :** Supervision/Profil > « Mon profil » > renseignez votre numéro, cochez la case WhatsApp, enregistrez, puis **Tester WhatsApp**.

**Option B — API Cloud de Meta** (ci-dessous). Green API est utilisé en priorité s'il est configuré.

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
