# TASK-0137 — Observer le parcours automatique normal

## Brief avant implémentation

- État : PLAN_REVIEWED ; publication dans PR270 avant code. Suite de la demande explicite de résolution du 403, même tâche et branche, base `dcf3d61625ab08591f1b88e3951829daa3a78ddb`.
- Fait nouveau : le [diagnostic réel](TASK-0137-access-diagnostic.md#résultat-réel) identifie une page de vérification DataDome. Notre programme retourne immédiatement sur 403 et bloque les iframes d'une autre URL. Ces restrictions peuvent interrompre le parcours automatique, mais n'ont pas causé la réception initiale du 403.
- Responsable principal, exécutant connecteur et reviewer indépendant en contextes Codex distincts ; modèle/réglages hérités, effort et coûts non exposés : `unknown`. Checkout exclusif `auto-world-acquisition`, qualité sérialisée, reviewer en lecture seule.
- But : mesurer le résultat d'un chargement normal borné avec notre code. Pas de succès régulier anticipé, ni de modification du registre source, des services, de l'ancien diagnostic ou du pilote ChatGPT.

## Plan et limites de l'expérience

1. Ajouter une entrée de test isolée et réutiliser les fonctions d'extraction et de chiffrement existantes. Conserver Playwright/Chromium, mode headless, sandbox, UA/viewport par défaut, contexte neuf non persistant et URL d'annonce déjà connue. Autoriser les ressources et iframes nécessaires au rendu de la page et de sa vérification observée, images comprises. Les cookies créés normalement dans ce contexte suivent leur fonctionnement natif ; aucun cookie importé, fabriqué, exporté ou réutilisé.
2. Un seul appel programmatique `goto`. Au plus un retour automatique du site vers l'URL exacte de l'annonce ; aucun second `goto`, `reload`, clic de relance ou changement de destination initié par le programme. Compter les documents réellement observés et arrêter sur une navigation ou redirection inattendue. Le routage ne garantit pas à lui seul l'absence d'un saut HTTP déjà suivi ; ne pas prétendre cette garantie.
3. Budget global 30 secondes, jamais remis à zéro au retour automatique. Observer seulement la vérification automatique. Arrêter sans interaction sur CAPTCHA affiché, demande humaine explicite, refus explicite, 429 ou dépassement de périmètre. Un domaine contenant « captcha » ne suffit pas à qualifier l'écran. Une vérification inachevée à l'échéance reste `verification_timeout`, pas un refus définitif.
4. Conserver les observations initiales et finales séparément. Chaque document principal possède sa propre identité requête/loader, ses heures et son statut ; un éventuel 200 ne remplace pas le 403 initial. Ne pas détourner le tracker mono-document du premier diagnostic. Capturer un état DOM visible borné des frames accessibles, avec l'incertitude lorsqu'une frame est indisponible. Les URL complètes de challenge et le texte reçu restent privés et chiffrés.
5. Une collecte n'est réussie que si le document final est à l'URL exacte, HTTP 200, avec titre visible et champs essentiels valides selon l'extracteur existant, sans anomalie. Un 200 vide, un résultat partiel ou un diagnostic enregistré ne sont pas un succès de collecte. L'extraction est une lecture du DOM ; aucune interaction avec la vérification.
6. Produire un reçu public fermé : identité de révision/run, dates, versions, états, compteurs et empreintes. Le dossier privé borné distingue DOM rendu et réponse HTTP ; ne pas appeler le DOM un corps HTTP. Réutiliser l'enveloppe authentifiée et le transport fragmenté existants, en vérifiant identité et limites. Pas de texte libre, paramètres, cookies ou données d'annonce dans les logs publics.
7. Nouveau workflow isolé, première exécution/première tentative, branche et parent de plan fixés. Même catégorie de runner Ubuntu 22.04 ; une nouvelle VM/IP ne constitue pas un A/B réseau constant. Ancien workflow inchangé. Une exécution réelle seulement après tests ciblés, lint, secrets et revue indépendante du code gelé.
8. Inspecter localement le dossier récupéré. En cas d'accès obtenu, documenter précisément la portée avant toute qualification répétée. En cas de CAPTCHA/refus explicite, ne pas relancer la même méthode ; préparer l'identification du robot et l'accès auprès du site. Aucun formulaire ou message externe envoyé dans cette tranche.

## Revue et vérification

Revue indépendante de cadrage : APPROUVABLE sous les conditions reprises ci-dessus. Tests déterministes hors réseau : 403 → vérification automatique → un retour → extraction ; arrêt sans interaction sur CAPTCHA/refus/429 ; rejet d'un deuxième retour ou d'une destination inattendue ; budget global inchangé ; projection publique sans fuite et enveloppe vérifiable. Aucun test local ne contacte leboncoin.

Commandes ciblées : test Node du relais du connecteur, ESLint des fichiers touchés, Secretlint du dépôt, contrôle YAML et diff. Le code est isolé hors packages déployés ; gates généraux CI séparés, sans les annoncer passés par ces contrôles ciblés.

## Critères et retour arrière

| Résultat observé | Conclusion |
| --- | --- |
| Retour automatique exact, HTTP 200, extraction valide | Une collecte a réussi dans cet essai uniquement |
| CAPTCHA ou refus explicite | Le parcours demande une étape que le programme ne poursuit pas |
| Vérification non terminée à 30 s | Accès non obtenu dans ce budget, cause finale indéterminée |
| HTTP 200 sans champs essentiels valides | Pas de collecte réussie |
| Navigation/identité hors périmètre | Arrêt contrôlé |

TASK-0137 reste IN_PROGRESS tant que la collecte propre répétée n'est pas prouvée. Retour arrière : retirer l'entrée et le workflow dédiés, conserver les résultats historiques. Aucune migration ni ressource de production.

## Sources et exécution

- [DataDome Device Check](https://docs.datadome.co/docs/device-check) : vérification automatique pouvant aboutir à un accès, un CAPTCHA ou un blocage.
- [DataDome response pages](https://docs.datadome.co/docs/response-pages) : les trois états sont distincts.
- [Tag JavaScript et iframes DataDome](https://docs.datadome.co/docs/javascript-tag).

Le plan a été publié dans PR270 sur `61aec6f13794a20fc892d38553e943747ec8131e` avant le code. Le workflow dédié a reçu une revue indépendante favorable de ses gardes, actions épinglées et chemins de publication. À ce premier jalon, le code était en réalisation et aucun résultat en ligne n'était attribué à cette tranche.

Un [dossier préparatoire d'identification du robot](TASK-0137-bot-access.md) est disponible si le parcours normal aboutit à un refus. Il distingue vérification de l'identité par DataDome et décision d'accès du site ; aucune soumission externe n'a été effectuée.

### Réalisation locale et contrôles

Proposition complète et contrôles locaux présentés le 22 novembre 2026 à 14:00 UTC. Trois fichiers isolés ajoutent le tracker et parcours, la supervision CLI et les tests. Le collecteur historique et son diagnostic restent inchangés. Le délai fonctionnel du navigateur reste de 30 secondes ; le parent demande une terminaison à 45 secondes, puis force l'arrêt du groupe possédé après deux secondes supplémentaires si nécessaire.

- Exécutant : `node --test tests/leboncoin-spike.test.mjs`, **74/74 PASS**, zéro échec/exclusion/retry ; ESLint ciblé PASS.
- Responsable : Secretlint **1 689 fichiers PASS** ; portée/gardes YAML et diff PASS.
- Prérevue indépendante : correction d'une possible attribution erronée du corps après redirection réutilisant son identifiant ; contrôle ajouté avant/après lecture et avant chiffrement. Les tests conservent aussi le cas valide d'un retour automatique avec un nouvel identifiant.
- Détection : ajout des demandes explicites « press and hold » sans confondre une attente automatique. Une dernière revue locale a remplacé la vérification de visibilité d'iframe par une vérification tenant compte de l'opacité ; les 74 tests et le lint ont été réexécutés, puis Secretlint repassé sur le gel final. Ces reprises sont conservées, sans présenter le premier jet comme exempt de défaut.

SHA-256 des fichiers gelés :

| Fichier | Empreinte |
| --- | --- |
| `native-flow.mjs` | `dae94a9adb8870b4dd7d404daa176bdb2648acaf6e5643b7e064cc44d0a8d7ba` |
| `probe-native-flow.mjs` | `bc3304a7f2d4ccac8b85401ae794c06e9d9311ce2af0142a066df1e19cea47ac` |
| `native-flow.test.mjs` | `5fd4e84a585b3740f9e559100b27c2306d91be460f7f882a281e51dbbc4fbe28` |
| `leboncoin-native-flow.yml` | `6acc7919225d0b61494511739e07613ef22e7919ab621ceb2a9ae51dfadbb36a` |

Revue finale indépendante : **APPROUVÉ**, aucun défaut bloquant restant sur les cinq fichiers code/tests/workflow vérifiés. Le reviewer a confirmé les corrections sur leurs empreintes finales, sans relancer les contrôles ni effectuer de requête source. À ce jalon avant push, le résultat réel restait à observer ; aucun accès source local ni succès de collecte anticipé, gates CI généraux séparés.

### Résultat réel — refus explicite après chargement de la vérification

Le [run 45030547435](https://github.com/CleMeY15/auto-world/actions/runs/45030547435), job `137232953804`, a exécuté `4a47c3c61ed2dc0605e2b486ad2e06066fe62558`. Installation, 74 tests hors réseau, Chromium, collecte de preuve et publication de l'artefact ont réussi. **Le job vert ne signifie pas une collecte : `collection_success` vaut `false`.**

| Observation | Résultat |
| --- | --- |
| Fenêtre du programme | 22 novembre 2026, 14:02:26.976–14:02:29.167 UTC |
| Versions | Node 22.23.2, Playwright 1.64.0, Chromium 156.0.8078.4, sandbox active |
| Navigation initiale | HTTP 403 ; un seul `goto`, un document principal observé |
| Parcours natif | Une iframe de vérification observée, aucune frame omise/inaccessible dans l'échantillon borné |
| Retour / redirection | Aucun retour vers l'annonce ; aucune redirection observée |
| Garde de navigation | `navigations_blocked: 0` ; ce compteur ne décrit pas toutes les requêtes après fermeture |
| État final | `explicit_refusal` ; extraction non tentée, zéro annonce extraite |

Le responsable a vérifié et déchiffré le dossier de 4 557 octets. L'iframe de `geo.captcha-delivery.com` présente le titre **« You have been blocked »** et le texte **« Access is temporarily restricted »**. La page liste plusieurs raisons possibles ; cette liste ne révèle pas la règle effectivement déclenchée. Aucune demande interactive n'a été poursuivie, aucune nouvelle tentative lancée après ce refus.

Le chargement de la vérification n'est donc plus interrompu par notre ancienne garde d'iframe dans cet essai, mais l'accès à l'annonce n'est pas obtenu. Cela ne permet ni d'attribuer la décision à l'IP seule, ni de conclure à un refus de tous les hébergements.

Preuves conservées :

- Corps initial : 771 octets décodés, SHA-256 `068c0e407e5adad96b740ef151d0069ba10f64d1d3219bbe8aa076600dcab1ff`.
- Enveloppe : 7 305 octets, SHA-256 `75be76c98358942e3176239081c7e36d68c40d5216041f8132d9cd2a7ba363bc` ; quatre fragments récupérés depuis les logs authentifiés.
- Identité AAD, destinataire, fragments, empreintes et tag GCM vérifiés ; projection recalculée depuis le dossier déchiffré identique au reçu public.
- Artefact GitHub `14757562500`, nom `leboncoin-native-flow`, expiration 29 novembre 2026. Son ZIP n'a pas été téléchargé : l'enveloppe a été récupérée et vérifiée par le transport texte documenté.
- Dossier privé des deux essais : `autofindex_diagnostic_leboncoin_complet.zip`, 37 190 octets, quinze membres, SHA-256 `a19efdb67566ad369848ff2af2c38cd84cd9b9d8714d64958729cfe0365f439e`. Corps, adresse réseau, paramètres et références de session restent hors dépôt et hors logs en clair. Aucune clé privée incluse.

Le reviewer indépendant a relu reçu, capture et vérification sans lire la clé ni refaire le déchiffrement. Conclusion **APPROUVÉE** : refus explicite dans ce contexte, absence de collecte, déclencheur précis non établi. Les gates CI généraux restent distincts ; aucune fusion ou acceptation de production.

### Suite opérationnelle

La collecte propre régulière reste non démontrée : TASK-0137 demeure IN_PROGRESS / OWN_ACCESS_BLOCKED. Le [dossier préparé pour AutoFindexBot](TASK-0137-bot-access.md) conserve une piste compatible avec notre propre code : identité de robot vérifiable et décision d'accès par le site. Il manque les coordonnées professionnelles, le domaine et le mécanisme d'identité à déclarer. Aucune soumission ni garantie d'acceptation ; la vérification DataDome et l'autorisation du site sont deux étapes distinctes.
