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

## Mise en place après mise à jour
1. Neon (SQL Editor) : exécuter `migration-paiement.sql` puis `migration-v3.sql` (messagerie + supervision). Les deux sont relançables sans risque.
2. Vercel : variables `FLW_SECRET_KEY`, `FLW_WEBHOOK_HASH` (paiement), `CRON_SECRET` (contrôle quotidien, `vercel.json` le planifie à 5 h UTC). Voir PAIEMENT.md et SUPERVISION.md.
3. Pages : `/compte` = tableau de bord client (demandes, paiements, favoris, messagerie, notifications, profil) ; `/admin` = onglets Support et Supervision.
