# Sécurité : mémo

- Les mots de passe sont stockés sous forme d'empreinte (scrypt). Jamais en clair.
- Les secrets (DATABASE_URL, FLW_SECRET_KEY, WA_ACCESS_TOKEN, APP_SECRET…) restent dans les variables d'environnement Vercel (type « Sensitive »).
- APP_SECRET chiffre les secrets de double authentification : ne le changez pas après activation de la 2FA (sinon les administrateurs devront la réactiver).
- Administrateurs : mot de passe de 12 caractères minimum, double authentification (application d'authentification) recommandée, surtout pour le super administrateur.
- Blocage temporaire après 5 échecs de connexion et limitation de débit par adresse IP.
- Journal de sécurité (onglet réservé au super administrateur) : connexions, échecs, changements de mot de passe, actions d'administration.
- Serveur Linux avec SSH (VPS) : voir serveur/securiser-ssh.sh. Le site hébergé sur Vercel n'a ni SSH ni port 22.
