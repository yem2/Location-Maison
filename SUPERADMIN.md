# Super administrateur : pouvoirs et présence

## Menu regroupé (8 entrées)
Tableau de bord · Annonces · Commandes · **Clients** (Comptes, Activité) · **Messages** (Messagerie, Formulaire de contact, Suggestions, Notifications) · Supervision · **Équipe & sécurité** (Administrateurs, Journal de sécurité) · Mon profil.

## Maisons (Tableau de bord > « Gérer les maisons », et menu Annonces)
- **Ajouter**, **Modifier**, **Supprimer**.
- **Supprimer = archives** : l'annonce quitte le site mais reste récupérable. Dans l'onglet *Archives* : **Restaurer**, ou **Supprimer définitivement** (réservé au super administrateur, uniquement depuis les archives).

## Clients : même principe
- **Supprimer** un compte le place dans les *Archives* (connexion bloquée, invisible dans la supervision) ; **Restaurer** le réactive.
- **Supprimer définitivement** : super administrateur, depuis les archives seulement, et refusé si le client a un acompte payé.

## Profil
- Menu **Mon profil** : photo, nom affiché, ville, présentation, avec la pastille **En ligne** (vert) ou **Hors ligne** (gris, si la connexion réseau est perdue).
- La photo et le statut apparaissent aussi dans la barre latérale.

## Présence en ligne
- Tant que la page d'administration est ouverte, un signal est envoyé chaque minute (`/api/auth?a=ping`).
- Un utilisateur est « en ligne » s'il a une session ouverte **et** une activité dans les 5 dernières minutes.
- **Supervision > Utilisateurs en ligne** : tous les administrateurs et clients, en ligne ou non, avec dernière activité.

## Pouvoir sur les clients et l'application (super administrateur uniquement)
- Clients : modifier (nom, e-mail, téléphone), réinitialiser le mot de passe, **déconnecter**, désactiver / réactiver, **supprimer** le compte (refusé si le client a un acompte payé : désactivez-le, la comptabilité est conservée).
- Demandes de réservation : supprimer (sauf si l'acompte est payé). Supprimer une demande acceptée remet le bien « disponible ».
- Messagerie : supprimer n'importe quel message (support ou conversation privée).
- Administrateurs : créer, mot de passe, activer / désactiver, **déconnecter**, supprimer.
- Chaque action est inscrite dans le **Journal de sécurité**.

## Mot de passe oublié (administrateurs et clients)
- Lien « Mot de passe oublié ? » sur la connexion de l'administration (`/admin`) et de l'espace client (`/compte`, et fenêtre de connexion du site).
- Un lien à usage unique, valable **30 minutes**, est envoyé par e-mail. Seule son empreinte est stockée en base.
- La réponse est identique que le compte existe ou non ; 5 demandes par heure et par adresse IP ; un seul e-mail toutes les 2 minutes par compte.
- Administrateurs : 12 caractères minimum, et **le code de double authentification est exigé** s'il est activé. Clients : 8 caractères minimum.
- Après réinitialisation : toutes les sessions du compte sont fermées. L'action est inscrite au journal de sécurité.
- **Configuration obligatoire** (Vercel > Settings > Environment Variables) :
  - `RESEND_API_KEY` : clé API de resend.com
  - `MAIL_FROM` : expéditeur, ex. `Maison <no-reply@votre-domaine.com>` (domaine vérifié dans Resend)
  - `SITE_URL` : adresse du site, ex. `https://votre-domaine.com` (recommandé : fixe l'adresse des liens)
- Sans ces variables, la page l'indique : le super administrateur peut alors réinitialiser le mot de passe d'un client depuis *Clients > Mot de passe*.

## Mise en place
1. (Recommandé) exécuter `migration-superadmin.sql` dans Neon > SQL Editor. Le site crée aussi ces colonnes tout seul au premier usage.
2. Déployer, puis dans *Supervision > Code source* cliquer **Approuver la version actuelle** (les fichiers ont changé par rapport à la version de référence).
