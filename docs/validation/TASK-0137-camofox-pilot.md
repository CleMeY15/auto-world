# TASK-0137 — Pilote Camofox sur trois annonces

## Pilote de répétabilité Camofox — plan du 22 novembre 2026

Autorisation utilisateur : « Vas-y on fait ça », après proposition d'un petit pilote multi-annonces et répété. Propriétaire : coordinateur Codex ; implémentation, tests ciblés délégués et revue indépendante en contextes distincts, modèle/effort hérités sans changement demandé (effort exact non exposé). Périmètre TASK-0137, branche existante ; point de départ ff7b9558ba5f0e672619ee77cad2ac7086e42903.

- Figer les trois annonces déjà observées : 3305814470, 3312238672, 3308374007. Deux passages séquentiels, au maximum six ouvertures, 30 secondes entre observations et au moins cinq minutes entre la fin du premier passage et le début du second.
- Réutiliser Camofox 1.19.0 / Firefox 152.0.4-beta.30 au commit amont figé, Ubuntu 22.04 / Node 22.23.2. Une instance temporaire neuve par observation, configuration amont, aucun proxy, cookie importé, interaction CAPTCHA ni retry.
- Paramétrer la cible du lecteur existant sans modifier son comportement par défaut. Chaque identité chiffrée doit lier cible, passage, ordinal, manifeste, révision et run. Une enveloppe par observation ; fragments regroupés par SHA.
- Qualifier l'extraction avec URL exacte, statuts REST/navigation séparés, titre/prix uniques et normalisation déterministe des champs centraux. La troncature du snapshot général reste une limite explicite ; elle ne remplace pas l'examen du DOM structuré. Le reçu historique du premier test reste inchangé.
- Arrêter au premier résultat inexploitable, refus/vérification, erreur d'environnement ou nettoyage non établi ; conserver les tentatives manquantes comme non exécutées. Aucune déduction de retrait depuis un échec.
- Produire un bilan prévu/tenté/extrait, les heures et intervalles mesurés, trois paires possibles et les changements de champs. Une réussite complète prouve uniquement cette fenêtre et ces trois annonces.
- Workflow isolé à déclenchement unique, parent de plan fixé, premier run/première tentative, job 360 minutes avec délais fonctionnels bornés. Aucun horaire durable, registre source, service produit, base ou V1 modifié.
- Tests hors réseau sur identité multi-cible, faux succès, troncature, arrêt global, espacement réel, comparaison des valeurs, fragments et nettoyage ; lint, secrets, syntaxe et revue indépendante avant essai. Vérification des preuves originales après run.
- Ressources : six ouvertures au plus, environ sept minutes de pauses au total, plus installation et délais de navigation. Coût financier non mesuré. Réévaluation au premier échec. Retrait par revert ciblé ; conserver les preuves.

Prérevue indépendante favorable sur ce protocole. Implémentation et essai à venir ; aucun résultat de répétabilité anticipé.

## Implémentation et validation locale

Le plan documentaire est publié dans `f3c30d19afedcd796804e84b2a63bc4c93175cb5`. Le lecteur historique garde sa cible et son comportement par défaut ; un export paramétrable permet trois cibles fixes. Le pilote ajoute les identités par passage/ordinal/manifeste, un verdict de normalisation distinct du snapshot général, un bilan fermé et une preuve chiffrée séparée par observation. Les fichiers de profils et cookies ne sont pas dans les artefacts.

- `node --test connectors/leboncoin-spike/probe-camofox.test.mjs connectors/leboncoin-spike/pilot-camofox.test.mjs` : **41 PASS**, zéro échec/exclusion/retry, Node 24.22.3 local ; nouvelle exécution Node 22.23.2 prévue dans le job natif.
- `pnpm exec eslint ...` : lancement refusé avant lint, versions locales pnpm 11.25.0 / Node 24.22.3 différentes des versions prescrites. Aucun seuil ni exigence modifié.
- `node node_modules/eslint/bin/eslint.js connectors/leboncoin-spike/probe-camofox.mjs connectors/leboncoin-spike/pilot-camofox.mjs connectors/leboncoin-spike/pilot-camofox.test.mjs --max-warnings=0` : **PASS**, linter installé du dépôt exécuté directement.
- `node scripts/check-secrets.mjs` : **PASS**, 1 698 fichiers.
- Syntaxe YAML, garde du parent de plan, absence de schedule durable, disponibilité de la clé de déchiffrement et `git diff --check` : **PASS**.
- Aucun package TypeScript, application ou schéma de production changé ; les gates généraux GitHub restent distincts de ces contrôles ciblés.

Prérevue et revue finale indépendantes favorables. Défaut trouvé avant présentation et corrigé : contrôler également les intervalles entre horodatages des captures, pas seulement les attentes du programme. Le cas contradictoire est couvert par un test. Les captures synthétiques des tests ne servent pas de preuve d'accès réel.

Empreintes source gelées avant exécution : probe `868a5b0c8a87612d558af6e0abced678e42ee2fad829b1d52b5d1574518e45bf`, pilote `0893a5f0678aa69c6ceaaa3b02eef9cdf462f8d5331b7d06ec72b37d703f1df8`, tests `ecfefde56c927a86bcbccaa73157545ee698516382b4d8026da13fd1eefdb35f`, workflow `f93486cba3e4e03ccdc16b5aa6d5eff652b83160d720d699b176866973e63c7f`.

Les comparaisons portent sur les huit champs normalisés title, brand, model, model_year, price, mileage, issuance_date et vin ; elles ne portent pas sur toute la page. Les valeurs et la normalisation sont reconstructibles depuis le DOM chiffré et la source figée ; seuls leurs hashes sont dans le bilan public. Le statut HTTP est celui du goto initial rapporté par Camofox, pas un statut final corrélé. Corps HTTP et couverture complète des iframes restent non établis. Les photos sont des références, pas des fichiers téléchargés.

## Résultats réels

[Run initial 45050640500](https://github.com/CleMeY15/auto-world/actions/runs/45050640500), source `668680d4b08fe6acd68341ced8b82f4f2979c801`, le 22 novembre 2026 de 17:40:28 à 17:41:09 UTC : **deux observations tentées sur six prévues, une qualifiée, arrêt verification_present, quatre non tentées, aucune seconde passe**. Les deux goto initiaux reçoivent HTTP 200 ; intervalle mesuré 30 031 ms. Les deux nettoyages établissent neuf processus suivis, zéro restant.

Le premier DOM contient Porsche 911 Carrera S, année modèle 2021, 23 000 km, 146 990 EUR. Le deuxième contient Porsche 911 Carrera, année modèle 2020, 29 800 km, 119 900 EUR ; son titre mentionne 2021, divergence déjà présente dans la fixture historique. Chaque DOM contient huit critères et trois références de photos, et son rejeu hors réseau donne listing/core true/issues[]. Le reçu de la deuxième observation reste verification_present et core_fields_observed=false parce que la qualification s'arrête avant normalisation, pas parce que les champs seraient absents.

Une iframe visible intitulée « Verification system » pointe vers le chemin /interstitial/ de geo.captcha-delivery.com dans la deuxième capture. Son contenu interne n'est pas capturé. Aucun refus ou demande humaine n'est observé dans la page mère ; cela n'exclut pas leur présence dans l'iframe. Hypothèse transitoire non établie.

25 fragments reconstituent deux enveloppes : identités, SHA, tailles, AAD, déchiffrement GCM et empreintes DOM vérifiés par le coordinateur ; rejeu pur et preuves relus indépendamment sans nouvelle navigation ni lecture de clé par le reviewer. Le [bilan original](leboncoin-camofox-pilot-20261122/initial-summary.json) est conservé sans réécriture. Artefact GitHub 14765950206, 45 145 octets, rétention jusqu'au 29 novembre ; bytes de capture vérifiés depuis les fragments chiffrés des logs, pas depuis un ZIP local.

Les 41 tests passent aussi dans le job Node 22.23.2 ; job SUCCESS signifie exécution/stockage des preuves, pas répétabilité réussie. Le pilote horaire ChatGPT antérieur a été relu comme désactivé et reste distinct.

## Protocole complémentaire — plan avant code

Hypothèse à distinguer, non acquise : l'iframe pourrait encore être dans une phase transitoire normale de chargement. Son contenu interne n'a pas été capturé ; l'absence de texte de refus dans la page mère n'en établit pas l'absence dans l'iframe.

Nouvelle campagne séparée, même manifeste de trois annonces et deux passages au maximum, mêmes délais de 30 s / 5 min et même configuration. Une observation passive supplémentaire est autorisée uniquement après HTTP 200, correspondance des URL, noyau DOM normalisé valide, iframe interstitial exacte et absence de refus ou demande humaine explicite observés. Dans ce seul cas, attendre une fois cinq secondes mesurées sur l'onglet déjà ouvert, puis relire snapshot et DOM. Aucun clic, reload, nouvelle navigation, réponse CAPTCHA, proxy ou import de session. Si le cadre reste présent, si une vérification/refus apparaît ou si la relecture est incomplète, arrêter.

Conserver les états initial et final dans la même capture chiffrée avec leurs empreintes et durées ; qualifier uniquement l'état final et garder toutes les limites de couverture. Ajouter des tests hors réseau sur l'éligibilité stricte, l'unique attente, la même cible/onglet, le refus persistant, l'échec de relecture et les preuves des deux états. Revue indépendante avant exécution. Le workflow visera un nouveau parent de plan fixé et seulement son deuxième run, première tentative. Budget complémentaire : six ouvertures au plus ; aucune collecte permanente ni activation de base/source.

La revue indépendante considère cette attente passive comme une expérience discriminante raisonnable. L'hypothèse n'est pas présentée comme une correction prouvée.


Le plan complémentaire est publié dans `ae541d7dfcae9422eb1017bc5a61137066f187be`. Le manifeste est versionné v2. Le délai passif unique conserve le signal du budget global de 90 s ; il ne crée ni nouvelle navigation ni nouveau budget. Les états initial et final ainsi que les durées sont conservés. Le lecteur historique garde son défaut sans attente ; le pilote demande explicitement cinq secondes.

### Validation locale du protocole complémentaire

- **61 tests PASS**, zéro échec/exclusion/retry : les deux fichiers historiques du pilote plus `probe-camofox-settling.test.mjs` (20 tests dédiés).
- Lint direct avec le linter installé du dépôt : PASS ; recherche de secrets ciblée sur les quatre fichiers changés : PASS ; YAML, garde parent/run 2/tentative 1 et diff : PASS.
- Deux défauts de préparation corrigés avant présentation : demandes humaines « pas un robot » reconnues explicitement, erreur explicite si la seconde lecture de snapshot échoue. Tests également sur transition vers un CAPTCHA, URL finale différente, signal d'annulation et horodatage trop court.
- Empreintes gelées : probe `4bd112b0c78fd464121fb4eee5bb581a9dc6b981e78cd9b272898061efb4ab25`, pilote `2a9b4902360b8ccac1e72a7add27ae0a980895219d680a4cc7ae2fbe8b9e8290`, tests dédiés `b42f59347a77d1ee526c89342c4d49574c1fc3ec2e2e03b66934efdbd087ac55`, workflow `9560ed7cdd9065ae68f69f678e20a9661064b2299718a60e31327745f291c905`.

Prérevue et revue finale indépendantes favorables sur les quatre empreintes gelées ; 20 tests dédiés relus. Proposition locale complète validée le 22 novembre 2026 à 17:50 UTC. Nouveau résultat natif à venir. Aucun succès anticipé ni activation de source/base. La documentation officielle [Device Check](https://docs.datadome.co/docs/device-check) décrit une vérification qui peut s'exécuter sans intervention ; le [JavaScript Tag](https://docs.datadome.co/docs/javascript-tag) peut afficher une réponse après une requête XHR/fetch, même si le document principal est chargé. Ces documents justifient la distinction entre contenu observé et résultat du contrôle ; ils ne prouvent pas la nature ni l'issue de notre iframe particulière.
