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

### Réalisation locale avant l'essai

Première proposition complète présentée le 22 novembre 2026 à 13:34:31 UTC. Node 22.23.2 et pnpm 10.15.0 ; aucune navigation réelle locale.

- `node --test tests/leboncoin-spike.test.mjs` : 59/59 PASS, zéro échec/exclusion/retry.
- ESLint ciblé sur le connecteur et son relais : PASS.
- Secretlint : PASS sur 1 683 fichiers du dépôt.
- Diff et syntaxe/portée YAML : PASS.
- Prérevue indépendante : chiffrement, corrélation et transport cohérents. Deux qualifications trop affirmatives ont été corrigées avant le gel final : un mot dans le HTML devient un marqueur heuristique ; `rate_limited` exige HTTP 429. Les 59 tests et le lint ont ensuite été réexécutés avec succès. Cette reprise est conservée, sans prétendre qu'aucun défaut n'a été trouvé.

SHA-256 des fichiers gelés pour la revue finale :

| Fichier | Empreinte |
| --- | --- |
| `leboncoin-access-diagnostic.yml` | `1f2c1bb0274398092be133c38d0b35367d242015a4cfa638ae7dfa935c6cbe51` |
| `access-diagnostic.mjs` | `e2e7b3d55e46534909b89d37f74987ea5b42f7f629754e3ba5bc411cf8a12c6d` |
| `diagnose-access.mjs` | `79c5011a20080aad84469951ff1f9ee3fbc3b203cbfb929cb57d645267a14851` |
| `access-diagnostic.test.mjs` | `ee52c0f4dfdeb30010f7e28d70e77e978644a554ff70dd416e5e59ad91848e97` |
| `collect-browser.mjs` | `2b7d84405b76453c6b2f85b2f19b0f33adc719e9408658274699b871fa1c8004` |
| `autonomous-probe.mjs` | `0e0ccbc5305c0ba0e29a053183b12d41ed554a6c2a2aa7348faa4adbdd49d18e` |

La clé publique du fichier PEM a l'empreinte de fichier `fc1458ad4f2ca6873dd1f8eeb757b891b8f1d680f1c412b80bd8485d84c4fd8f` ; l'empreinte de destinataire utilisée par le protocole est celle du SPKI DER déclarée dans le plan. Ces deux empreintes ne portent pas sur les mêmes octets.

Revue finale indépendante : **APPROUVÉ**, aucun défaut bloquant identifié sur les huit fichiers code/tests/clé/workflow stables. Le reviewer a aussi vérifié le SPKI DER avec OpenSSL. Il n'a pas relancé les tests ni effectué de navigation ; les résultats de l'exécutant et ceux du responsable restent attribués séparément. La récupération réelle devra vérifier fragments, enveloppe, AAD et tag, puis comparer le résumé déchiffré au reçu public.

### Résultat réel

Le [run 45028412874](https://github.com/CleMeY15/auto-world/actions/runs/45028412874), job `137226399493`, a exécuté la révision `dcf3d61625ab08591f1b88e3951829daa3a78ddb` le 22 novembre 2026. Le diagnostic s'étend de 13:37:40.905 à 13:37:42.737 UTC : 1 832 ms pour l'enveloppe de diagnostic, pas une mesure de latence HTTP. Le job est vert parce que le dossier a été conservé ; **aucune annonce n'a été extraite**.

| Observation | Résultat |
| --- | --- |
| Runtime | Node 22.23.2, Playwright 1.64.0, Chromium 156.0.8078.4, sandbox actif |
| Navigation | Un `goto`, un document principal, une iframe observée, aucune redirection observée |
| Réponse principale | HTTP 403, identité CDP `matched`, corps UTF-8 décodé de 771 octets |
| SHA-256 du corps | `60b7cee3d7328e0897b71f7996cd3dc05bea608080304af322e8dd181e106e62` |
| Capture | `2be34e9c82707cae0009d94490c891a1`, à 13:37:42.724 UTC |
| Enveloppe chiffrée | 5 773 octets, SHA-256 `025073cb12e7beb98a000783065ee630cd723f8cd3ebb688ff9bad427a5c350a` |
| Artefact GitHub | `14757045397`, nom `leboncoin-access-diagnostic`, expiration 29 novembre 2026 |

Le responsable a récupéré les trois fragments chiffrés depuis les logs authentifiés du job. Ordre, nombre, encodage, taille et empreinte ont été vérifiés, puis identité AAD, empreinte de destinataire, enveloppe RSA et tag GCM. Le résumé recalculé depuis le dossier déchiffré correspond au reçu public. Les octets de l'artefact ZIP GitHub n'ont pas été téléchargés : ce sont les mêmes octets d'enveloppe annoncés par le reçu qui ont été récupérés depuis les logs.

Inspection privée, sans exécution du texte reçu : le document contient le message « Please enable JS and disable any ad blocker » et charge `https://ct.captcha-delivery.com/c.js`. La [documentation DataDome](https://docs.datadome.co/docs/javascript-tag) attribue cette origine aux pages de réponse de sa protection. Le header `x-cache: Error from cloudfront` ne permet pas à lui seul d'identifier la règle qui a déclenché le refus. La requête emploie l'UA Chromium headless standard.

**Conclusion établie : une page de vérification DataDome remplace l'annonce.** Le déclencheur précis (IP, session, automatisation ou autre) et le résultat final de cette vérification restent inconnus. Les mots du bootstrap ne prouvent pas l'affichage d'un CAPTCHA interactif. Les valeurs opaques de configuration n'ont pas reçu de signification supposée.

Le dossier privé a été conservé dans `autofindex_diagnostic_leboncoin_403.zip` : 16 398 octets, SHA-256 `61e1e724d8a6a0ec8291f8eeb5b2faefbaf44bc1c14b5d3fe4538a820023621f`. Corps, paramètres dynamiques et clé privée ne sont pas publiés dans ce dépôt. Le reviewer indépendant a confirmé le corps et son empreinte sans lire la clé privée.

Deux restrictions de notre programme peuvent interrompre une vérification automatique normale : le blocage des navigations d'iframe vers une autre URL et l'arrêt dès le 403 initial. Elles n'expliquent pas ce 403 initial, reçu avant leurs effets. La [tranche de compatibilité suivante](TASK-0137-normal-flow.md) teste cette hypothèse sans changer d'identité ni interagir avec une demande humaine.
