# Paiements : cartes, Orange Money, MTN Mobile Money, PayPal, espèces, virement

Le super administrateur gère tout depuis **Paiements** (menu de gauche, ou « Plus » sur mobile) :
- **Moyens de paiement** : activer / désactiver chaque moyen, renseigner les **numéros et comptes à créditer** (Orange Money, MTN, virement…), le titulaire et les instructions affichées au client.
- **Transactions** : toutes les tentatives de paiement, avec **Confirmer / Refuser** pour les paiements manuels et espèces, et **Revérifier** pour un paiement en ligne resté « en cours ».
- **Sécurité & API** : état des clés (jamais leur valeur), adresse du webhook, liste des protections.

## Comment le client paie
Depuis « Mon compte > Mes demandes > Payer l'acompte », il choisit parmi les moyens activés :

| Moyen | Fonctionnement |
|---|---|
| Carte Visa / Mastercard | Page sécurisée Flutterwave (aucune donnée de carte ne passe par le site) |
| Orange Money, MTN MoMo | **Automatique** (via Flutterwave) ou **manuel** : le client envoie l'argent à votre numéro, saisit la référence reçue par SMS, un administrateur confirme |
| PayPal | API PayPal (capture et vérification côté serveur). PayPal n'accepte pas le XAF : le moyen est masqué pour cette devise |
| Espèces | Le client annonce son passage, un administrateur confirme la réception |
| Virement / autre | Manuel, comme Orange Money manuel |

## Mise en place
1. (Recommandé) Exécuter `migration-paiement-v2.sql` dans Neon > SQL Editor. Le site crée aussi les tables tout seul au premier usage.
2. **Clés API** dans Vercel > Settings > Environment Variables (type « Sensitive »), puis redéployer :
   - Flutterwave (cartes, Orange Money, MTN) : `FLW_SECRET_KEY`, `FLW_WEBHOOK_HASH` (un secret de votre choix).
     Flutterwave > Settings > Webhooks : URL `https://VOTRE-DOMAINE/api/pay?a=webhook`, même secret.
   - PayPal : `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, et `PAYPAL_ENV=live` en production (sans cela : mode test).
   - `APP_SECRET` : longue phrase aléatoire qui chiffre les numéros de compte.
   - `SITE_URL` : `https://votre-domaine.com`.
3. Se connecter en super administrateur > Paiements > Moyens de paiement : saisir les numéros, activer les moyens. Tester d'abord avec les clés de test.
4. Supervision > Code source > **Approuver la version actuelle** (les fichiers ont changé).

**Ne saisissez jamais une clé secrète dans le tableau de bord** : elle serait stockée en base. Les clés restent dans Vercel.

## Sécurité (ce qui est appliqué)
- Montant et devise lus **dans la base**, jamais envoyés par le navigateur.
- Paiement en ligne validé **seulement après vérification auprès du fournisseur** (montant, devise, référence) ; le contenu du webhook n'est jamais cru tel quel ; signature du webhook comparée en temps constant.
- **Idempotent** : un webhook rejoué ne crédite rien deux fois ; un seul paiement « payé » par demande (index unique) ; un double paiement est marqué « Doublon » et signalé aux administrateurs pour remboursement.
- Une **référence de transaction** (Orange Money, MTN…) ne peut servir qu'une fois.
- Numéros de compte **chiffrés** en base (AES-256-GCM) ; leur modification exige **mot de passe + code 2FA** du super administrateur, est inscrite au **journal de sécurité** et notifiée aux autres administrateurs.
- Limitation anti-abus (12 tentatives / 10 min), refus des requêtes d'un autre site (CSRF), délais maximum sur les appels aux fournisseurs.
- Seuls les administrateurs confirment un paiement manuel ; chaque confirmation est journalisée.

## Limites à connaître
- Les connexions directes aux API Orange Money / MTN MoMo exigent un contrat marchand propre à chaque pays. En attendant, Orange Money et MTN passent par **Flutterwave** (un seul contrat) ou par le mode **manuel**.
- Sans les clés, les moyens « en ligne » restent désactivés ; espèces et paiements manuels fonctionnent.

## Rapidité
- Moins d'allers-retours base de données : session + « dernière activité » en une requête, limitation de débit en une requête.
- Annonces publiques mises en cache en bordure (CDN) ; CSS / JS / images en cache navigateur.
- Index ajoutés sur les demandes et les paiements.
- **À faire une fois** : dans Vercel > Settings > Functions, choisir la **région la plus proche de votre base Neon** (c'est le gain de vitesse le plus important).
