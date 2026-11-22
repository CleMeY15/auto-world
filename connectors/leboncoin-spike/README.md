# leboncoin — essais de faisabilité (TASK-0136 et TASK-0137)

Ce dossier isole le premier essai réel d'acquisition. Il n'active aucun connecteur de production.

## Résultat établi le 22 novembre 2026

- Une requête HTTP ordinaire, identifiée AutoFindexBot, vers l'annonce `3305814470` a reçu **403**, avec une page de vérification JavaScript de **771 octets**. Aucun autre GET de cette série n'a été envoyé.
- Le navigateur cloud de ChatGPT a ouvert **trois fiches réelles**. Les observations dans `fixtures/` proviennent des éléments DOM de ces fiches, après dépliage des critères par le bouton visible.
- Le premier programme autonome a échoué **avant toute navigation** : Chromium ne peut pas créer un socket local nécessaire dans cet environnement (`Operation not permitted`). Aucune requête leboncoin n'a été émise par cet essai local. [Rapport historique TASK-0136](../../docs/validation/TASK-0136.md).
- Le diagnostic TASK-0137 a ensuite démarré Chromium sur GitHub Actions : sa première navigation a reçu **HTTP 403**, zéro extraction, arrêt sans deuxième passage. Le refus est établi pour cette requête et cet environnement ; son corps n'a pas été conservé, donc sa cause précise reste inconnue. [Run et reçu](../../docs/validation/TASK-0137.md#résultat-réel).
- Aucune API de catalogue ou de scraping tierce n'est utilisée par le code. Playwright est une bibliothèque libre de pilotage de navigateur ; les observations cloud sont un moyen de diagnostic externe, distinct du futur runtime.

| Annonce | Prix affiché | Kilométrage | Année modèle (champ) | Immatriculation (champ) | Photos référencées |
| --- | ---: | ---: | ---: | --- | ---: |
| 3305814470 — 911 Carrera S | 146 990 EUR | 23 000 km | 2021 | 09/2021 | 3 |
| 3312238672 — 911 Carrera | 119 900 EUR | 29 800 km | 2020 | 08/2020 | 3 |
| 3308374007 — Macan S | 62 000 EUR | 45 000 km | 2021 | 09/2021 | 3 |

Le titre de la deuxième annonce mentionne 2021 alors que les champs indiquent 2020 / 08/2020. Nous conservons les deux observations ; aucune année n'est corrigée par supposition.

## Ce que font les fichiers

- `capture-dom.mjs` : projection des blocs de détail affichés, sans état JavaScript interne, cookies, profil vendeur ou API cachée.
- `collect-browser.mjs` : un essai autonome sur une URL explicite avec un navigateur Playwright neuf ; sortie privée et résultat d'accès explicite.
- `extract.mjs` : normalisation déterministe de la capture JSON, identité attendue, prix en centimes EUR, kilomètres et preuve par champ.
- `replay.mjs` : rejeu hors réseau.
- `evidence/normalized-sample.json` : trois fiches normalisées par ce parseur à partir des observations authentiques.
- `extract.test.mjs` : contrôles des captures authentiques et cas négatifs ; repris par `tests/leboncoin-spike.test.mjs` dans la CI générale.
- `evidence/http-preflight.json` : compte rendu assaini du GET initial. Le corps de challenge privé n'est pas publié.

Les snapshots sont des **projections JSON du DOM**, transcrites depuis la sortie structurée du navigateur. Ils ne sont ni le HTML original ni une preuve de réponse HTTP 200. Leur empreinte vérifie les octets du JSON enregistré. Seul le digest du préflight HTTP correspond aux octets du corps HTTP.

La projection initiale a été vérifiée contre les éléments affichés du navigateur. Après revue, le helper a été renforcé pour filtrer les variantes masquées et limiter les critères à `main`. Ces fixtures historiques n'ont pas été remplacées par la nouvelle observation cloud séparée de TASK-0137. `core_fields_observed` mesure seulement la présence valide du titre, prix, kilométrage, marque et modèle : ce n'est ni une vérification des déclarations du vendeur ni une preuve d'accès autonome.

## Rejouer l'extraction sans réseau

Depuis la racine du dépôt, avec Node 22.23.2 :

```sh
node connectors/leboncoin-spike/replay.mjs \
  connectors/leboncoin-spike/fixtures/3305814470.json \
  --expected-url https://www.leboncoin.fr/ad/voitures/3305814470 \
  --expected-id 3305814470

node --test tests/leboncoin-spike.test.mjs
```

## Essayer le programme autonome

Versions présentes lors du diagnostic historique TASK-0136 : Playwright 1.62.1 ambiant, Chromium 156.0.8078.79, Node 22.23.2. Pour TASK-0137, le programme utilise désormais `@playwright/test` 1.64.0 déjà figé dans `apps/web/package.json`, avec son Chromium correspondant et `chromiumSandbox: true`. Installer les dépendances avec `pnpm install --frozen-lockfile`, puis `pnpm --filter @auto-world/web exec playwright install --with-deps chromium` sur une machine compatible. Aucun cookie ni profil du navigateur cloud n'est repris, aucune API de scraping ou de catalogue tierce n'est appelée par ce CLI.

```sh
node connectors/leboncoin-spike/collect-browser.mjs \
  --url https://www.leboncoin.fr/ad/voitures/3305814470 \
  --out .local-data/leboncoin-test-unique
```

Une navigation, aucune relance automatique. Les requêtes image/media sont bloquées : ce profil de chargement diffère du navigateur cloud. Le navigateur peut suivre une redirection HTTP avant sa détection ; l'URL finale et la chaîne sont contrôlées et rapportées. Cela diffère du GET urllib initial qui ne suivait aucune redirection. Un refus ou une vérification reste un échec d'accès, jamais une annonce vide.

Le dossier de sortie doit être nouveau : `attempt.json` décrit le transport ; `snapshot.json` conserve la projection lorsqu'elle existe ; `result.json` conserve sa normalisation. `extracted` exige les champs essentiels observés sans anomalie de normalisation, sinon le résultat reste `partial_capture`. Les résultats cloud ne sont jamais utilisés comme secours automatique dans ce programme. Le diagnostic initial et le nouvel essai runner sont conservés séparément dans leurs comptes rendus.

## Diagnostic autonome répété — TASK-0137

Le [plan](../../roadmap/tasks/TASK-0137-leboncoin-autonomous.md) est publié dans [PR270](https://github.com/CleMeY15/auto-world/pull/270). `autonomous-probe.mjs` ouvre l'unique annonce connue `3305814470`, puis effectue au maximum deux autres observations automatiques, chacune au moins cinq minutes après la fin de la précédente. Il s'arrête au premier échec, refus, challenge ou résultat incomplet. Ce n'est ni un balayage du catalogue ni un cron permanent.

```sh
node connectors/leboncoin-spike/autonomous-probe.mjs --out .local-data/leboncoin-probe-unique
```

Le parent du dossier `--out` doit déjà exister ; le dossier final doit être nouveau. Dans un clone neuf, créer d'abord `.local-data` avec `mkdir -m 700 .local-data`.

Le dossier privé conserve les captures de cette exécution. `receipt.json` publie uniquement une projection autorisée : statuts, heures, champs numériques automobiles, compteurs et empreintes. Aucun titre, texte libre, contact, VIN/plaque, photo ou corps de challenge n'est publié. Les lignes `AUTO_FINDEX_RECEIPT` des logs contiennent ce même reçu assaini. Dans GitHub Actions, seul ce fichier est conservé sept jours ; les projections privées disparaissent avec le runner et leur empreinte n'est pas un substitut à leur conservation durable.

Le workflow est limité au premier push d'implémentation sur la branche dédiée, au parent du plan et à une seule tentative. Il utilise Ubuntu 22.04 et ne modifie aucune protection système. Les tests généraux du dépôt n'effectuent aucune navigation réelle. Résultat de l'expérience : consulter le [compte rendu TASK-0137](../../docs/validation/TASK-0137.md), qui distingue préparation, accès, répétition et exploitation durable.

Un pilote horaire ChatGPT préexistant utilise séparément la recherche native pour découvrir des identifiants, puis le navigateur cloud pour observer les fiches et conserver une petite archive privée. Son lot initial comprend trois annonces et trois photos copiées ; la première exécution programmée reste à vérifier. Il ne s'exécute pas dans ce code et n'alimente pas la base de production. Cette dépendance externe ne qualifie pas le moteur propre demandé pour AutoFindex.

## Diagnostic inspectable du refus — une seule invocation

Le [plan revu](../../docs/validation/TASK-0137-access-diagnostic.md) ajoute un mode facultatif au même collecteur. Il conserve l'URL connue, Playwright 1.64.0, Chromium sandboxé, le contexte neuf, le mode headless et le routage initial. Le workflow dédié appelle :

```sh
node connectors/leboncoin-spike/diagnose-access.mjs --out "$RUNNER_TEMP/autofindex-leboncoin-access-diagnostic"
```

Le dossier doit être nouveau. La clé publique RSA 3072 bits et l'identité GitHub sont validées avant le démarrage du navigateur. Le programme appelle le collecteur une seule fois, sans relance. Le collecteur conserve sa limite globale de 30 secondes ; le parent arrête son groupe de processus après 45 secondes. Le mode de diagnostic s'arrête à l'observation du document et ne déplie pas les critères d'une éventuelle annonce.

La capture utilise uniquement les événements CDP et au maximum un `Network.getResponseBody`, sans relecture réseau. Le document doit correspondre à la frame principale, au requestId, au loaderId et à l'URL attendue. Une redirection, une réutilisation d'identité ou un second document principal invalide son attribution. Les navigations supplémentaires initiées sont bloquées lorsqu'elles passent par le routage ; les redirections que le navigateur suit automatiquement restent observées et invalidantes. `goto_calls`, les événements document observés et les navigations admises/bloquées sont des compteurs distincts : aucun n'est présenté comme une preuve isolée du nombre exact de requêtes HTTP sur le réseau.

Les tampons CDP sont limités à 64 Kio par ressource et 128 Kio pour la session. Le corps conservé est limité à 64 Kio ; une indisponibilité, une éviction, une ambiguïté ou un dépassement reste explicite. `cdp_body_sha256` identifie les octets fournis par CDP, éventuellement issus d'un texte réencodé en UTF-8. Il ne représente pas les octets HTTP compressés sur le réseau. Aucun screenshot ni profil/cookie de navigateur n'est exporté.

### Sorties et récupération

| Fichier | Contenu et destination |
| --- | --- |
| `public-diagnostic.json` | Reçu assaini : statuts, signes techniques, compteurs, heures, versions, tailles et empreintes. Publiable. |
| `sealed-response.json` | Enveloppe chiffrée contenant le document attribué, les en-têtes sélectionnés et le corps CDP. Publiable sous cette forme chiffrée seulement. |
| `attempt-1/attempt.json` | Rapport privé du collecteur ; aucun upload de ce dossier. |
| `attempt-1/access-response.private.json` | Capture inerte privée, créée avec permissions 0600, dans un dossier 0700. Elle peut contenir des jetons et URL du corps reçu. |
| `attempt-1/access-summary.json` et `attempt-1/sealed-response.json` | Résumé et enveloppe originaux, vérifiés par le parent avant publication des deux fichiers autorisés. |

Les champs de `sealed-response.json` sont `schema_version`, `algorithm`, `key_fingerprint_sha256`, `aad_base64`, `wrapped_key_base64`, `nonce_base64`, `tag_base64` et `ciphertext_base64`. Le chiffrement est RSA-OAEP-SHA256 pour envelopper une nouvelle clé AES-256-GCM, avec nonce de 12 octets et tag de 16 octets. Le décodage de `aad_base64` donne les octets exacts à fournir à GCM : version, révision Git, run, tentative, identifiant de capture et empreinte de l'URL attendue. Leur contenu doit également correspondre au reçu et au run attendu. Seule la clé publique épinglée est présente dans le dépôt.

Les logs `AUTO_FINDEX_ACCESS_DIAGNOSTIC` contiennent le reçu assaini. Les lignes `AUTO_FINDEX_SEALED` transportent les octets de la même enveloppe chiffrée en fragments de moins de 4 Kio. `decodeSealedFragments(lines)`, exporté par `access-diagnostic.mjs`, vérifie ordre, nombre, taille totale et SHA-256 avant de rendre les octets exacts de `sealed-response.json`. Il rejette les fragments manquants, inversés ou modifiés. Aucun texte brut n'est utilisé comme solution de secours. Le déchiffrement se fait séparément avec la clé privée conservée hors dépôt, puis le corps est inspecté comme donnée, sans exécuter ses scripts ni ouvrir ses URL.

Le code de sortie 0 signifie qu'un diagnostic vérifié et chiffré est enregistré, y compris une réponse HTTP 403 ou une indisponibilité documentée. Le code 2 signifie que ce dossier de diagnostic n'a pas pu être produit. **Aucun de ces états ne qualifie l'accès durable aux annonces.** Les signes de JavaScript requis, vérification humaine, refus générique ou limitation de débit sont des observations de contenu, pas une attribution certaine à une règle serveur. `verification_markers_observed` est un indice textuel heuristique : le mot « captcha » peut aussi apparaître dans un script d'une page ordinaire. Seule l'inspection de la réponse déchiffrée permettra de qualifier un éventuel challenge explicite. Le premier reçu historique reste inchangé ; les résultats de ce nouvel essai seront consignés séparément.

## Parcours automatique normal — essai isolé

Le [plan](../../docs/validation/TASK-0137-normal-flow.md) ajoute `probe-native-flow.mjs`, avec `native-flow.mjs` et ses tests hors réseau. Les anciens collecteurs et diagnostics restent distincts. Entrée prévue pour le workflow dédié :

```sh
node connectors/leboncoin-spike/probe-native-flow.mjs --out "$RUNNER_TEMP/autofindex-leboncoin-native-flow"
```

Le programme conserve Chromium/Playwright, UA/viewport par défaut, mode headless, sandbox et contexte neuf. Il laisse se charger les ressources HTTP(S), images et iframes normales. Les cookies créés par la navigation restent natifs au contexte : aucun import, fabrication, lecture ou export de cookie. Une invocation `goto`, puis au plus un retour automatique exact après le 403 initial ; aucun `reload`, second `goto`, clic ou résolution de vérification n'est émis par le programme. Navigation inattendue, redirection, popup, 429 pertinent, refus explicite ou demande humaine visible arrêtent le parcours. Un domaine contenant « captcha » ou une simple attente de vérification ne suffit pas à conclure à un CAPTCHA interactif.

Le budget global reste 30 secondes depuis le début du collecteur, sans remise à zéro au retour. Le parent déclenche la terminaison du groupe enfant à 45 secondes, puis dispose de deux secondes supplémentaires avant la destruction forcée si nécessaire. Un parcours inachevé à l'échéance reste `verification_timeout` ; cela ne prouve pas un refus définitif.

La preuve privée conserve séparément les identités CDP, heures et statuts du document initial et de l'éventuel retour. Une lecture passive facultative du corps initial conserve au maximum 8 Kio, sans fallback et avec garde d'attribution avant/après lecture et avant chiffrement. Le DOM final reste un échantillon rendu, jamais un corps HTTP. Jusqu'à quatre frames visibles sont conservées, au maximum 4 Kio sérialisés chacune ; les frames omises ou inaccessibles rendent la couverture explicitement incomplète. « Aucun CAPTCHA observé » ne certifie pas son absence. Une couverture incomplète ne qualifie pas une collecte réussie.

L'extraction réutilise le parseur existant, sans déplier de critères : HTTP 200 final à l'URL exacte, titre visible, prix/kilométrage/marque/modèle valides, aucune anomalie et identité de document stable jusqu'à la fermeture du navigateur. Le snapshot est plafonné à 64 Kio, la normalisation à 32 Kio et le dossier complet à **128 Kio de JSON réellement sérialisé**, échappements inclus. Un dépassement devient `evidence_limit`, sans succès de collecte.

Les deux sorties publiables sont `public-native-flow.json` et `sealed-native-flow.json`. Le reçu contient `collection_success` séparément de `evidence_status`, ainsi que `initial_status`, `return_status`, les compteurs, dates et empreintes. Le dossier `attempt-1/` reste privé, notamment `native-flow.private.json`. Les logs `AUTO_FINDEX_NATIVE_FLOW` contiennent le reçu fermé ; les fragments `AUTO_FINDEX_SEALED` transportent exactement l'enveloppe chiffrée, selon le même protocole vérifié précédemment. L'AAD utilise `nativeFlowIdentity(env, capture_id)` avec la version `leboncoin-native-flow-capture/v1`.

Un job vert signifie que la preuve chiffrée a été conservée. Seul `collection_success: true` établit une extraction dans cet essai ; ni répétition réussie ni couverture du catalogue n'en découlent.

## Limites de ce premier essai

Trois fiches d'une même marque, choisies via des URL trouvées dans un moteur de recherche : échantillon de commodité, pas mesure représentative du catalogue. Les résultats du moteur n'alimentent pas les captures et ne sont pas comptés comme succès du connecteur.

Dans les fixtures historiques du dépôt, les trois images affichées sur chaque fiche ont des URL exploitables. Les galeries indiquaient respectivement 5, 6 et 16 photos : **la galerie entière n'est pas extraite**, et les fichiers images ne sont pas copiés par ce collecteur. Le pilote ChatGPT conserve séparément ses trois photos. VIN et plaque ne sont pas recherchés par OCR ni par rapprochement externe ; l'absence d'observation dans ce périmètre ne prouve pas leur absence de l'annonce.

Pour notre collecteur et ses preuves, pas de découverte automatique du catalogue, pagination, suivi réussi à plusieurs dates, détection effective d'une modification, mesure de débit, disponibilité dans la durée, base/API de production ou redistribution publique. Le navigateur cloud a réutilisé son contexte existant ; son état d'authentification n'a pas été déterminé. La session du collecteur autonome est neuve.

La conclusion d'un refus concerne la méthode et l'environnement testés. Elle ne prouve ni l'impossibilité universelle d'acquérir une annonce ni la viabilité à grande échelle du projet.
