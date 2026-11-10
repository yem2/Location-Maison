# Super administrateur : pouvoirs et présence

## Maisons (Tableau de bord > « Gérer les maisons », et menu Annonces)
- **Ajouter**, **Modifier**, **Supprimer** (définitif) et **Archiver / Restaurer** une annonce.
- Une annonce archivée disparaît du site public mais reste en base ; « Restaurer » la remet en ligne.
- Le menu Annonces propose les filtres Actives / Archivées / Toutes.

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

## Mise en place
1. (Recommandé) exécuter `migration-superadmin.sql` dans Neon > SQL Editor. Le site crée aussi ces colonnes tout seul au premier usage.
2. Déployer, puis dans *Supervision > Code source* cliquer **Approuver la version actuelle** (les fichiers ont changé par rapport à la version de référence).
