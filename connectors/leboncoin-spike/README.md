# leboncoin — spike de faisabilité (TASK-0136)

Ce dossier isole le premier essai réel d'acquisition. Il n'active aucun connecteur de production.

## Résultat établi le 22 novembre 2026

- Une requête HTTP ordinaire, identifiée AutoFindexBot, vers l'annonce `3305814470` a reçu **403**, avec une page de vérification JavaScript de **771 octets**. Aucun autre GET de cette série n'a été envoyé.
- Le navigateur cloud de ChatGPT a ouvert **trois fiches réelles**. Les observations dans `fixtures/` proviennent des éléments DOM de ces fiches, après dépliage des critères par le bouton visible.
- Le programme autonome a échoué **avant toute navigation** : Chromium ne peut pas créer un socket local nécessaire dans cet environnement (`Operation not permitted`). Aucune requête leboncoin n'a été émise par ce programme. L'accès autonome reste donc **non conclu**, distinct du refus HTTP et de l'accès cloud. [Rapport](../../docs/validation/TASK-0136.md).
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

La projection initiale a été vérifiée contre les éléments affichés du navigateur. Après revue, le helper a été renforcé pour filtrer les variantes masquées et limiter les critères à `main` ; ce correctif est testé hors réseau, sans nouvelle collecte cloud. `core_fields_observed` mesure seulement la présence valide du titre, prix, kilométrage, marque et modèle : ce n'est ni une vérification des déclarations du vendeur ni une preuve d'accès autonome.

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

Playwright et Chromium doivent être déjà installés dans l'environnement d'essai. Versions présentes lors du diagnostic : Playwright 1.62.1, Chromium 156.0.8078.79, Node 22.23.2. Ce spike ne modifie pas les dépendances de production. Il ne réutilise aucun cookie ni profil du navigateur cloud. L'import de `playwright` doit être résolu dans cet environnement ; aucun service ChatGPT n'est appelé par ce CLI.

```sh
AUTO_FINDEX_CHROMIUM_PATH=/usr/bin/chromium \
node connectors/leboncoin-spike/collect-browser.mjs \
  --url https://www.leboncoin.fr/ad/voitures/3305814470 \
  --out .local-data/leboncoin-test-unique
```

Une navigation, aucune relance automatique. Les requêtes image/media sont bloquées : ce profil de chargement diffère du navigateur cloud. Le navigateur peut suivre une redirection HTTP avant sa détection ; l'URL finale et la chaîne sont contrôlées et rapportées. Cela diffère du GET urllib initial qui ne suivait aucune redirection. Un refus ou une vérification reste un échec d'accès, jamais une annonce vide.

Le dossier de sortie doit être nouveau : `attempt.json` décrit le transport ; `snapshot.json` conserve la projection lorsqu'elle existe ; `result.json` conserve sa normalisation. `extracted` exige les champs essentiels observés sans anomalie de normalisation, sinon le résultat reste `partial_capture`. Les résultats cloud ne sont jamais utilisés comme secours automatique. Le collecteur final n'a pas été réexécuté après les ajustements de capture, diagnostic et normalisation : le compte rendu initial est conservé tel quel.

## Limites de ce premier essai

Trois fiches d'une même marque, choisies via des URL trouvées dans un moteur de recherche : échantillon de commodité, pas mesure représentative du catalogue. Les résultats du moteur n'alimentent pas les captures et ne sont pas comptés comme succès du connecteur.

Les trois images affichées sur chaque fiche ont des URL exploitables. Les galeries indiquaient respectivement 5, 6 et 16 photos : **la galerie entière n'est pas extraite**, et les fichiers images ne sont pas copiés. VIN et plaque ne sont pas recherchés par OCR ni par rapprochement externe ; l'absence d'observation dans ce périmètre ne prouve pas leur absence de l'annonce.

Pas de découverte automatique du catalogue, pagination, suivi à plusieurs dates, détection effective d'une modification, mesure de débit, disponibilité dans la durée, base/API de production ou redistribution publique. Le programme cloud a réutilisé son contexte existant ; son état d'authentification n'a pas été déterminé. La session du collecteur autonome est neuve.

La conclusion d'un refus concerne la méthode et l'environnement testés. Elle ne prouve ni l'impossibilité universelle d'acquérir une annonce ni la viabilité à grande échelle du projet.
