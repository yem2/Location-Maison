# Supervision (réservée au super administrateur)

Menu **Supervision** du tableau de bord, six onglets :

| Onglet | Ce que vous y voyez |
|---|---|
| Vue d'ensemble | État général, trafic API sur 14 jours, erreurs, tentatives suspectes, IP les plus actives, résultats des contrôles quotidiens |
| Base de données | Latence, taille, connexions, cache, transactions, blocages, tables, requêtes en cours et requêtes lentes |
| Serveur | Environnement (Node, région, version déployée), secrets configurés, sondes de disponibilité, en-têtes de sécurité, déploiements Vercel |
| Application & API | Bugs serveur (500), API incohérentes (404/405), requêtes invalides (400), lenteurs, bugs JavaScript des visiteurs |
| Sécurité & attaques | Connexions échouées, accès interdits, blocages anti-abus, par adresse IP |
| Code source | Intégrité (comparaison à la version approuvée), analyse de sécurité, dépendances vulnérables, conseils de protection |

## Comment ça marche
- Chaque appel d'API est enregistré automatiquement (compteurs par jour + journal des événements anormaux, conservé 30 jours, adresses IP comprises).
- Le navigateur des visiteurs signale ses erreurs JavaScript (sans données personnelles).
- Un **contrôle quotidien** (5 h UTC, Vercel Cron) vérifie la base, l'intégrité du code, les dépendances, les erreurs et les attaques. En cas de problème, une notification (et un WhatsApp si activé) est envoyée au super administrateur.

## Intégrité du code (contre les modifications non voulues)
1. Après un déploiement que vous avez vérifié, allez dans *Code source* > **Approuver la version actuelle**.
2. Dès qu'un fichier diffère de cette référence (modifié, ajouté, supprimé), une alerte apparaît (tableau de bord + contrôle quotidien).
3. Si ce sont vos changements : vérifiez-les puis réapprouvez. Sinon : changez vos accès GitHub et Vercel.

## Variables d'environnement (Vercel)
- `CRON_SECRET` : déjà ajoutée (autorise le contrôle quotidien).
- `SUPERVISION_PROJECT_ID`, `SUPERVISION_TEAM_ID` : déjà ajoutées.
- `SUPERVISION_VERCEL_TOKEN` (facultatif) : jeton Vercel en lecture (Account Settings > Tokens) pour afficher l'historique des déploiements.

## À compléter hors du site
- Un service d'uptime gratuit (UptimeRobot, Better Stack) sur `https://VOTRE-DOMAINE/api/monitor?a=health` pour être alerté si le site tombe.
- Console Neon > Monitoring (processeur, mémoire, facturation) ; Vercel > Logs (journaux bruts de la plateforme).
- GitHub : double authentification, protection de la branche principale, Dependabot, secret scanning.

## Limites
L'analyse du code est heuristique (erreurs courantes) et ne remplace pas un audit complet. Elle détecte une modification du code déployé, mais ne peut pas empêcher quelqu'un qui possède vos accès GitHub/Vercel de publier du code : d'où l'importance de la double authentification sur ces comptes.
