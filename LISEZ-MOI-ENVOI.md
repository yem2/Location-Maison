# Comment envoyer les fichiers sans casser le site

1. Décompressez le zip sur votre ordinateur.
2. Sur GitHub : **Add file > Upload files**, glissez **tout** le contenu (dossiers compris), puis **un seul** « Commit changes ». Ne faites pas plusieurs envois séparés : un fichier envoyé sans son voisin fait planter le site (erreur 500).
3. Ne mettez jamais plus de 12 fichiers dans `api/` qui ne commencent pas par `_` (limite du plan gratuit Vercel). Supprimez les fichiers inutiles (poubelle sur GitHub).
4. Après le déploiement : ouvrez `https://VOTRE-SITE/api/auth?a=ping` : vous devez voir `{"ok":true…}`.
5. Garde-fou : si les fichiers sont incohérents, Vercel **annule** le déploiement (« Canceled ») et garde l'ancienne version en ligne ; le journal de déploiement explique quel fichier manque.
