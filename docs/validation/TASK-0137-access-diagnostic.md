# TASK-0137 — Diagnostic inspectable du refus HTTP 403

## Brief et état avant réalisation

- Demande utilisateur du 22 novembre 2026 : résoudre le refus de notre programme sur GitHub. La nouvelle étape répond à l'absence de corps et d'en-têtes dans la première preuve, sans annoncer une résolution acquise.
- Tâche et PR existantes : [TASK-0137](../../roadmap/tasks/TASK-0137-leboncoin-autonomous.md), [PR270](https://github.com/CleMeY15/auto-world/pull/270), branche `spike/0137-leboncoin-autonomous`, base documentaire `d46642d8f59f238e9f4313d44f6da5a679e1b520`.
- État : PLAN_REVIEWED, publication avant implémentation. Responsable et exécutant du collecteur en contextes Codex distincts ; reviewer indépendant. Modèle annoncé GPT-6 Astra Pro, réglages hérités ; effort/coûts/temps humain non exposés : `unknown`.
- Checkout exclusif : `auto-world-acquisition`, qualité sérialisée. Aucun changement des autres services, du registre source, de l'ordonnanceur ChatGPT ou de l'ancienne preuve.

## Faits et question à trancher

Le [premier run](https://github.com/CleMeY15/auto-world/actions/runs/45024088325) démarre Chromium puis rapporte HTTP 403 sur son appel de navigation, sans extraction. Le code retourne sur ce statut avant de lire la réponse. Le corps de cette requête ne peut plus être récupéré après destruction du runner. Le challenge du préflight urllib et le succès du navigateur cloud sont des observations distinctes.

Le diagnostic doit distinguer une vérification explicite, un refus générique et un motif indisponible. Il ne pourra pas nécessairement identifier la règle serveur (IP, empreinte, session ou autre) ayant provoqué ce refus. Un en-tête CloudFront, seul, ne distingue pas un 403 d'origine et un 403 WAF.

## Plan revu avant le code

1. Ajouter un mode de diagnostic facultatif au collecteur. Conserver URL connue, Playwright 1.64.0, Chromium correspondant, sandbox, contexte neuf, mode headless, requêtes et routage initiaux. Ne pas changer de proxy, user agent, cookies, identité ou API pour obtenir l'accès.
2. Avant navigation, valider une clé publique RSA 3072 bits et son empreinte SHA-256 du SPKI DER : `e0055ec14db6da8090b3a6f0764cb147bbf116bda87cd7d0eb709d8fdaa4d999`. La clé privée reste hors dépôt, hors logs et hors artefacts, dans un dossier privé et un fichier 0600. Clé invalide : arrêt avant requête.
3. Observer passivement les événements CDP `Network.requestWillBeSent`, `responseReceived`, `loadingFinished` et `loadingFailed`. Corréler document principal, frame, requestId, loaderId et URL exacte. Refuser l'attribution d'un corps dès qu'une redirection ou une ambiguïté invalide cette identité. Distinguer le nombre d'appels `goto` du nombre de requêtes document effectivement observées ; empêcher toute nouvelle navigation initiée après le premier document lorsqu'elle passe par notre routage.
4. Lire au maximum une fois `Network.getResponseBody`, sans fallback. Aucun `Response.body()` susceptible de refetch, `route.fetch`, API de requête, recharge ou seconde tentative. Buffers CDP bornés ; limite conservée de 64 Kio décodés, en-têtes sur liste explicite et taille totale bornée. Exclure cookies, authentification et headers arbitraires. Délais intégrés aux limites globales existantes de 30 s / 45 s. Corps indisponible, trop grand ou évincé : état explicite et arrêt.
5. Conserver le contenu privé comme donnée inerte. Le digest identifie les octets décodés obtenus par CDP, pas les octets HTTP sur le réseau. Chiffrer le dossier de réponse avec AES-256-GCM (clé/nonce neufs), clé AES enveloppée RSA-OAEP-SHA256 ; authentifier version, révision, run et identité de capture. Tout échec reste fermé : code fixe et aucun contenu brut de secours.
6. Publier un reçu court sur liste autorisée et une enveloppe chiffrée bornée. L'artefact conserve l'enveloppe. Les outils disponibles ne téléchargent pas les artefacts binaires GitHub : un transport texte chiffré, découpé et vérifié par empreinte, sera nécessaire pour récupérer cette même enveloppe depuis les logs. Aucun corps, header libre, challenge, capture d'écran ou clé privée n'y sera publié en clair.
7. Prévoir un nouveau workflow isolé, lié au commit du présent plan, premier run et première tentative seulement, une invocation de navigation. Garder l'ancien workflow et son échec inchangés. Même catégorie de runner Ubuntu 22.04 et réglages logiciels ; une nouvelle VM ne garantit pas la même machine ni IP sortante. Ce n'est pas un A/B à identité réseau constante.
8. Après exécution, vérifier l'enveloppe et déchiffrer localement. Inspecter le corps comme texte, sans exécuter son JavaScript ni ouvrir ses URL. Conserver le dossier privé et publier seulement une conclusion étayée. Décider ensuite si une correction de notre code est justifiée. Un challenge explicite ou un refus serveur n'est pas contourné.

## Revue du plan et vérifications prévues

Revue indépendante : APPROUVÉ SOUS CONDITIONS, reprises dans les étapes ci-dessus. Le transport texte de l'enveloppe doit vérifier taille, nombre de fragments, ordre et empreinte avant déchiffrement ; les logs ne constituent jamais un secours en clair.

Tests hors réseau : 403 explicite et générique, 200 avec vérification, réponse d'iframe, redirection/réutilisation de requestId, corps indisponible ou trop grand, limite de temps, en-têtes hostiles, clé invalide avant navigation, déchiffrement authentifié et rejet de toute altération, projection publique sans fuite. Aucune nouvelle requête leboncoin depuis les tests. Vérifier lint, secrets, diff et portée YAML ; revue indépendante du code gelé avant le push déclencheur. Les gates généraux restent distincts.

## Acceptation et limites

Le diagnostic réussit si une réponse correctement attribuée est conservée, récupérée et inspectable, ou si une indisponibilité précise est attestée. Cela ne valide pas la collecte : celle-ci exige encore une annonce réellement extraite, une répétition réussie et une exploitation durable. La tâche reste IN_PROGRESS tant que ces critères manquent.

Retour arrière : retirer le nouveau mode et le workflow dédié ; conserver les preuves historiques. Aucun service ni permission de source à restaurer.

## Sources

- [API Response Playwright](https://playwright.dev/docs/api/class-response).
- [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/), et protocole correspondant à la dépendance installée.
- Implémentation locale Playwright 1.64.0 : son getter de corps peut utiliser `Network.loadNetworkResource` comme fallback dans certains cas ; le diagnostic emploie uniquement `Network.getResponseBody`.
- [CloudFront : causes possibles du HTTP 403](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/http-403-permission-denied.html).
- [Runners GitHub : nouvelle VM et adresses](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Exécution

Non encore réalisée. Les résultats, identités de révision/run et limites seront ajoutés après l'essai.
