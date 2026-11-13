# Reçus, contrats, remboursements, export comptable, visites

## Reçus et contrats PDF
- **Reçu** : généré à la demande (« Télécharger le reçu ») pour toute demande payée. Il est aussi **envoyé par e-mail** au client dès que le paiement est confirmé, si l'envoi d'e-mails est configuré (`RESEND_API_KEY`, `MAIL_FROM`).
- **Contrat** : projet de **bail** (location) ou de **promesse de vente** pré-rempli (parties, bien, prix, acompte versé et n° de reçu). Les champs à compléter sont en pointillés. **C'est un modèle indicatif : faites-le relire par un notaire ou un juriste avant signature.**
- En-tête des documents : variables Vercel facultatives `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_PHONE`, `COMPANY_EMAIL`, `COMPANY_LEGAL` (RCCM, NIU…).

## Remboursements (super administrateur)
Paiements > Transactions > **Rembourser** : demande le mot de passe (et le code 2FA).
- Carte / Orange Money / MTN via Flutterwave et PayPal : le remboursement est fait **via l'API du fournisseur**.
- Espèces, Orange Money / MTN manuels, virement : le remboursement est **enregistré** (vous rendez l'argent vous-même).
- Si le fournisseur ne répond pas, le paiement reste « Remboursement… » (pour éviter un double remboursement) : vérifiez chez le fournisseur puis utilisez **Déjà remboursé**.
- Un paiement **en double** (même demande payée deux fois) apparaît en « Doublon » : il se rembourse de la même façon.
- Le remboursement est total (pas de remboursement partiel).

## Export comptable
Paiements > Transactions > **Exporter en CSV** : choisissez la période. Fichier ouvrable dans Excel (UTF-8, séparateur « ; », montants avec virgule), avec n° de reçu, client, moyen, statut, références. Chaque export est inscrit au journal de sécurité.

## Visites
- Le client choisit un **bien, une date et un créneau libre** (menu « Mes visites » ; lien « Planifier une visite » sur chaque demande).
- L'équipe voit les demandes dans **Visites** : Confirmer, Refuser, Reprogrammer, Marquer effectuée, Annuler. Le client est notifié (et sur WhatsApp s'il l'a activé).
- Un client peut **ajouter la visite à son calendrier** (.ics) et reçoit un **rappel la veille et le jour même** (tâche planifiée à 06:00 UTC).
- Un créneau ne peut pas être réservé deux fois pour le même bien (garanti par la base de données). Maximum 3 visites à venir par client.
- Réglages (variables Vercel, facultatives) : `SITE_TZ` (fuseau, défaut `Africa/Douala`), `VISIT_SLOTS` (défaut `09:00,10:00,11:00,14:00,15:00,16:00,17:00`), `VISIT_DAYS` (défaut `1,2,3,4,5,6` = lundi à samedi).
- **Rappels** : définissez `CRON_SECRET` (une longue phrase aléatoire) dans Vercel ; sans lui, la tâche de rappel est refusée.

## Mise en ligne
1. Déposer les fichiers sur GitHub en gardant les dossiers. **Ne remplacez pas `index.html` ni `html/admin.html`** : ils ne sont pas dans cette livraison.
2. (Facultatif) exécuter `migration-paiement-v2.sql` et `migration-visites.sql` dans Neon : le site crée aussi tout automatiquement.
3. Supervision > Code source > **Approuver la version actuelle**.
