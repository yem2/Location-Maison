# Maison

Site immobilier statique en HTML, CSS et JavaScript, sans installation ni étape de compilation.

## Fichiers

```text
site/
├── index.html
├── html/
│   ├── acheter.html  # Annonces à vendre
│   ├── louer.html    # Annonces à louer
│   ├── favoris.html  # Sélection enregistrée dans le navigateur
│   └── contact.html  # Contact et formulaire WhatsApp
├── css/
│   ├── style.css       # Point d’entrée CSS
│   ├── base.css        # Couleurs, typographie et en-tête
│   ├── layout.css      # Recherche, annonces et sections
│   ├── components.css  # Boutons, cartes et fenêtres de contact
│   └── responsive.css  # Affichage mobile et tablette
├── js/
│   ├── script.js       # Démarrage du site
│   ├── data.js         # Annonces, numéro WhatsApp et liens sociaux
│   ├── listings.js     # Recherche, filtres et fiches des biens
│   ├── favorites.js    # Favoris enregistrés dans le navigateur
│   ├── contact.js      # Formulaire et liens WhatsApp
│   └── navigation.js   # Menu et fermeture des fenêtres
└── assets/
    └── images/         # Photos WebP des annonces
```

La page d’accueil reste dans `index.html` à la racine pour être détectée directement par GitHub Pages et Netlify. Les pages indépendantes Acheter, Louer, Favoris et Contact se trouvent dans `html/`. Bootstrap 5 est chargé depuis jsDelivr ; une connexion Internet est nécessaire pour ses styles et scripts. Les fichiers JavaScript sont chargés dans l’ordre indiqué dans chaque page. Pour changer le destinataire, modifiez `whatsappPhone` dans `js/data.js` avec l’indicatif du pays suivi du numéro, sans `+`, espaces ni zéros initiaux. Les boutons et formulaires utilisent ce numéro pour ouvrir WhatsApp avec un message prérempli.

## Prévisualiser

Ouvrez `index.html` dans un navigateur. Vous pouvez aussi lancer `python -m http.server 8000` dans ce dossier puis visiter `http://localhost:8000`.

Les annonces sont des exemples à remplacer par vos informations avant publication. Pensez aussi à remplacer `facebookUrl` et `instagramUrl` dans `js/data.js` par les adresses de vos profils professionnels. Aucun compte, base de données ou service d’envoi n’est nécessaire : le visiteur confirme lui-même l’envoi dans WhatsApp.

Les pages de vente et de location proposent la recherche multicritère, le tri par prix, les favoris, le détail et le partage des annonces ainsi qu’un comparateur de trois biens. Les favoris sont enregistrés localement dans le navigateur.

## Mise en ligne

- **GitHub Pages** : dans les paramètres du dépôt, activez Pages depuis la branche publiée et choisissez la racine (`/`) comme dossier.
- **Netlify** : choisissez le dépôt, laissez la commande de build vide et indiquez `.` comme dossier de publication.

Dans les deux cas, ne déplacez pas `index.html` : les hébergeurs le servent comme page d’accueil. Bootstrap est chargé depuis jsDelivr, donc ses ressources nécessitent une connexion Internet.

Le fichier `netlify.toml` configure déjà Netlify pour publier la racine du dépôt. Après avoir lié le dépôt GitHub à Netlify, chaque `push` sur la branche de production déclenche automatiquement une nouvelle publication. Sur GitHub Pages, activez Pages depuis la branche choisie dans les paramètres du dépôt ; les modifications envoyées sur cette branche seront publiées automatiquement.

## Moyens de paiement, documents et sécurité (v2)
- **Paiement** : espèces, Orange Money, MTN Mobile Money, carte Visa/Mastercard (Flutterwave), PayPal, virement. Les numéros et comptes se saisissent dans **Demandes & paiements › Moyens de paiement** (super administrateur, avec mot de passe + 2FA si activée).
- **Variables Vercel** : `FLW_SECRET_KEY`, `FLW_WEBHOOK_HASH`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`, (`PAYPAL_ENV=sandbox` pour tester), `SITE_URL` (ex. https://votre-site.com), `APP_SECRET`, `RESEND_API_KEY` + `MAIL_FROM` (e-mails « mot de passe oublié »), `CRON_SECRET`.
- **Webhooks** : Flutterwave → `https://VOTRE-SITE/api/pay?a=webhook` ; PayPal → `https://VOTRE-SITE/api/pay?a=pp_webhook`.
- **Documents PDF** : reçus de paiement et contrats (location, vente, réservation) — onglet **Contrats & reçus** ; le client les télécharge dans « Mes demandes ».
- **Archives** : toute suppression est récupérable (onglet **Archives**, super administrateur).
- Détail des routes : voir `API.md`. Tables : `migration-paiements-documents.sql` (facultatif, créées automatiquement sinon).

## Visites et loyers mensuels
- **Visites** : le client choisit un bien, une date et un créneau libre (depuis « Planifier une visite » sur la fiche du bien, ou l'onglet Visites). L'agence confirme dans **Demandes & paiements › Visites** ; le client peut ajouter la visite à son calendrier. Un créneau ne peut pas être réservé deux fois.
- **Loyers** : **Demandes & paiements › Loyers** → « Nouveau bail » crée l'échéancier (12 mois puis ajout automatique chaque mois). Le locataire voit ses échéances dans **Loyers**, déclare son paiement (Orange/MTN/virement/espèces) ; l'agence confirme et la **quittance PDF** est générée.
- **Rappels automatiques** (notification + WhatsApp si activé) : visites la veille et le jour même ; loyers 3 jours avant, le jour J, puis tous les 3 jours de retard. Ils partent par une tâche planifiée Vercel à 06:00 UTC : **ajoutez la variable `CRON_SECRET`** (une longue valeur aléatoire) dans Vercel, sinon la tâche est refusée.

## Incidents, propriétaires et statistiques
- **Incidents** : dans **Mon logement**, le locataire signale un problème (catégorie, photo, case « urgent »). L'agence le traite dans **Demandes & paiements › Incidents** (les urgents remontent en premier) ; le locataire est prévenu à chaque changement de statut.
- **Propriétaires** (super administrateur) : **Demandes & paiements › Propriétaires** → créer le propriétaire, fixer sa commission, affecter ses biens. Le **relevé mensuel** additionne les loyers encaissés du mois, retire la commission et donne le net à reverser (PDF). « Marquer reversé » garde la trace du reversement (une seule fois par mois).
- **Statistiques** : **Tableau de bord › Statistiques** (demandes, visites, encaissements, nouveaux clients, biens les plus demandés, loyers en retard).
