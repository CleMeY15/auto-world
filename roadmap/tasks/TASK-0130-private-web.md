# TASK-0130 — Accès web privé à la démo synthétique

IN_PROGRESS, voie VPS privée hors cohorte produit. Base 895f412dfdfa4a9e36cd4ecfdc8471ccfaf21ab2, branche prep/private-web-access. Propriétaire et exécution Codex gpt-6.2-astra ultra, revue indépendante en lecture seule. Budget inconnu, réévaluation après deux échecs identiques.

## Parcours et plan

1. Délimiter le démonstrateur, les prérequis et la décision d'exposition au regard d’ADR-0028 et du runbook VPS (PR 240). Les rapports de PR 0129 ont leur propre propriétaire et leur propre livraison.
2. Authentification Django, sessions SQLite, TLS et proxy nginx devant un build Next dédié. Connexion française depuis un lien, retour local, écran de déconnexion, retrait par l'administrateur. Tester refus, expiration/révocation, CSRF, absence de cache et de confiance dans les en-têtes du client.
3. Essai local sur sockets et ports éphémères, navigateurs mobile/bureau, revue de la frontière, contrôles de livraison. Parent responsable du staging root, du feu vert et du contrôle externe IPv4/IPv6. Pas de fusion dans ce lot.

Ressources réservées au lot : infra/private-web, documents TASK-0130 et décision d’accès, processus de test temporaires. Les services 3129, 3111/3211, 3100/3210 et les volumes/restaurations restent sous leurs propriétaires. Les gates UX et qualité de la DoD s'appliquent. Voir le [registre de validation](../../docs/validation/TASK-0130.md).
