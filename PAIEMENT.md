# Paiement en ligne (Flutterwave)

Flutterwave regroupe en une seule page : cartes Visa/Mastercard, MTN Mobile Money et Orange Money (Cameroun), etc.

1. Créez un compte marchand sur https://dashboard.flutterwave.com et activez-le (dossier de l'entreprise).
2. Dans Settings > API, copiez la clé secrète (FLWSECK-...).
3. Dans Vercel > Settings > Environment Variables, ajoutez :
   - FLW_SECRET_KEY = votre clé secrète (type "Sensitive")
   - FLW_WEBHOOK_HASH = un secret de votre choix (déjà ajouté par l'assistant si indiqué)
4. Dans Flutterwave > Settings > Webhooks :
   - URL : https://VOTRE-DOMAINE/api/pay?a=webhook
   - Secret hash : la même valeur que FLW_WEBHOOK_HASH
5. Redéployez le projet. Testez d'abord avec les clés de test.

Sans FLW_SECRET_KEY, le bouton "Payer en ligne" reste désactivé et seul le paiement en espèces fonctionne.
