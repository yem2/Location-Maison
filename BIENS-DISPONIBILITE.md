# Disponibilité des biens : un bien ne se loue / ne se vend qu'une fois

États d'un bien : **Disponible → Réservé → Loué / Vendu** (ou Indisponible, choix manuel de l'administrateur).

- **Demande acceptée** : le bien passe en **Réservé** de façon atomique. Si deux administrateurs acceptent en même temps, seul le premier réussit ; l'autre reçoit « n'est plus disponible ». La base de données interdit aussi deux demandes acceptées pour un même bien.
- Les **autres demandes en attente** pour ce bien sont **refusées automatiquement** et les clients sont prévenus.
- **Acompte encaissé** (en ligne ou confirmé par l'équipe) : le bien passe automatiquement en **Loué** (location) ou **Vendu** (vente).
- **Sans acompte** : bouton **Marquer comme loué / vendu** sur la demande acceptée (module Commandes).
- Un bien Loué / Vendu est **grisé sur le site** (carte et fiche), son bouton devient « Déjà loué » / « Déjà vendu », **plus aucune demande ni visite** n'est possible.
- **Annulation** : si la demande acceptée est annulée ou si l'acompte est **remboursé**, le bien redevient **Disponible** (sauf s'il est déjà loué / vendu sans remboursement : un administrateur peut alors le rouvrir en modifiant l'annonce).
- L'administrateur peut aussi choisir l'état à la main dans la fiche d'annonce.
