# Audit du site (sécurité, bugs, affichage, rapidité, SQL, API)

## 1. Incidents observés en production
| Constat | Cause | Statut |
|---|---|---|
| Erreur 500 à la connexion / sur /admin (signalée par un navigateur le 16/11 à 13:57) | **Envoi partiel de fichiers** : un fichier récent (`auth.js`…) envoyé avec un ancien `_lib.js` → la fonction plante au chargement, avant même d'être enregistrée dans les journaux | **Corrigé** : garde-fou de déploiement (`scripts/check-deploy.mjs`) qui annule un déploiement incohérent et garde l'ancienne version en ligne |
| Affichage cassé (barre du bas sur 2 lignes, menu admin géant) | CSS ancien servi avec un JS récent : mon cache « stale-while-revalidate » sur `/css` et `/js` | **Corrigé** : revalidation à chaque visite + service worker `gestion-v2` |
| Page « Vercel Security Checkpoint » / « WebAssembly » | **Attack Challenge Mode** activé le 16/11 à 12:10 UTC pour 24 h (jusqu'au 17/11 12:10 UTC) | À vérifier dans Vercel > Firewall : désactivé ? (bloque les webhooks de paiement, les visiteurs sans WebAssembly) |
| 15 déploiements en erreur (13 au 16/11) | plus de 12 fonctions (plan gratuit) : un fichier `api/payments.js` (module de paiement d'un autre outil) en trop | Résolu par vos soins |
| Routes absentes de ce code mais appelées en production : `payments` (list, settings, mydocs), `console?a=wa_status` | **Le dépôt contient du code d'un autre outil** (deuxième système de paiement, WhatsApp) | À traiter : envoyer le zip du dépôt GitHub actuel pour fusionner |

## 2. Sécurité
| Contrôle | Résultat |
|---|---|
| Injection SQL | **Aucune** : 100 % des requêtes sont paramétrées (gabarits SQL), aucune concaténation |
| XSS | Aucune : tout le HTML public est échappé (`esc`), l'administration et le tableau de bord construisent le DOM en texte |
| CSRF | Protégé (en-tête `Origin` obligatoire en écriture) ; **« Origin: null » provoquait une erreur 500 → corrigé** (403) |
| Cookies de session | HttpOnly, Secure, SameSite=Strict, durée 8 h |
| Mots de passe | scrypt + comparaison à temps constant + faux hachage pour comptes inconnus ; 10 caractères minimum (équipe) |
| Connexion | verrouillage par compte (5 échecs/15 min) ; **ajouté : limite par compte (10/15 min) même pour un compte inexistant** (plus aucun indice sur l'existence d'un e-mail) ; limite par IP élargie pour les réseaux mobiles partagés |
| Mot de passe oublié | **ajouté : 3 demandes/heure par adresse** (anti-bombardement d'e-mails) |
| Téléversement d'images | contrôle du type réel (signature binaire), taille limitée, SVG refusé, `nosniff` |
| Accès aux données | contrôles de rôle côté serveur (journal, clients, comptes = super administrateur) ; conversations limitées à leurs participants |
| Paiements | montants lus en base, vérification auprès du fournisseur, webhook signé, idempotence, références uniques, numéros chiffrés, ré-authentification |
| Fichiers internes exposés | `*.md`, `*.sql`, `*.sh`, `package.json`, `vercel.json`, `serveur/` étaient téléchargeables publiquement → **redirigés vers l'accueil** |
| En-têtes | CSP stricte, HSTS, `frame-ancestors`, `nosniff`, scripts externes protégés par SRI |
| **À faire : double authentification** | Le compte super administrateur n'a **pas** la 2FA (accès aux numéros de paiement et remboursements) → l'activer dans « Mon profil » |
| **À faire : jeton Green API** | Variable `API_TOKEN_INSTANCE` stockée en non « Sensitive » + jeton visible dans une capture → le régénérer |
| Liens `target="_blank"` sans `rel="noopener"` | Présents dans les pages HTML (risque faible, navigateurs modernes protègent) : à corriger dans `index.html` |

## 3. Bugs et affichage (7 largeurs d'écran : 320 à 1280 px, toutes les pages, client et admin)
- **Corrigé** : liste déroulante de « Mes visites » qui débordait de 670 px sur un écran de 320–390 px.
- **Corrigé** : libellés « Demandes » / « Messages » trop larges dans la barre du bas sur 320–360 px.
- Aucune erreur JavaScript, aucune ressource en échec, aucun débordement horizontal restant (70 pages/largeurs contrôlées + 8 modules d'administration).

## 4. Rapidité (mesures réelles de production)
- API de lecture : **3 à 60 ms** (médiane) depuis le passage de la région des fonctions près de la base (`iad1`) ; les appels de paiement `admin_*` : 1 à 9 ms.
- Connexion : ~200 ms en moyenne (hachage scrypt volontairement lent), 600 ms au pire (démarrage à froid).
- Anormal : `console?a=wa_status` (code d'un autre outil, absent d'ici) : 437 ms en moyenne, jusqu'à 8,5 s.
- Requêtes : session + « dernière activité » en une requête, limite de débit en une requête, index présents (vérifiés sur la vraie base). Doublon d'index sur `rate_hits` (sans gravité).

## 5. Requêtes SQL
Toutes les requêtes ajoutées ont été validées sur la vraie base (EXPLAIN) et utilisent les index existants ; les migrations ont été testées dans des transactions annulées.

## 6. API
Voir `API.md` : inventaire complet, niveaux d'accès, conventions de nommage et anciens noms conservés.

## 7. À faire de votre côté
1. Envoyer le **zip du dépôt GitHub actuel** (pour fusionner `payments`, `wa_status`…).
2. Activer la **double authentification** du super administrateur.
3. Régénérer le **jeton Green API**, mettre les variables en « Sensitive », supprimer les doublons.
4. Vérifier que l'**Attack Challenge Mode** est bien désactivé (Vercel > Firewall).
5. Envoyer les fichiers **en un seul commit**.
