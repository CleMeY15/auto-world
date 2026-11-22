# TASK-0137 — Lot réel borné de 100 annonces

## Plan avant implémentation — 22 novembre 2026

Demande explicite : extraire environ cent annonces leboncoin et les mettre dans la base du projet. Le test reste privé, ponctuel et limité. Il prolonge TASK-0137 sans réécrire les essais précédents. Base : 9a4313ffd04c7032deab3e158cdeac1e2a3d618d ; PR270 et branche spike/0137-leboncoin-autonomous.

Propriétaire/exécutant : coordinateur Codex (GPT-6 Astra Pro annoncé ; effort exact non exposé). Spécialistes Codex pour projection DOM et stockage ; revue indépendante distincte. Checkout partagé avec propriété de fichiers, commandes qualité sérialisées. Aucun changement de fournisseur/modèle demandé.

## État vérifié et dépendances

Camofox épinglé et normalisateur existant ont lu deux fiches avec HTTP200 dans deux campagnes. La présence d'un iframe avait provoqué un arrêt logiciel avant normalisation, malgré des données complètes. La nouvelle voie relève sa géométrie/occlusion et distingue données observées, signal de contrôle et refus réel ; les reçus historiques restent intacts.

La page de départ officielle https://www.leboncoin.fr/c/voitures est référencée par une recherche publique du 22 novembre. Les autres URL seront issues de liens DOM effectivement observés. Aucun identifiant d'annonce ni page de pagination inventé.

Audit du dépôt et de la session : aucun accès PostgreSQL/VPS exploitable. La base autoworld et le schéma aw_connector existent dans le prototype ; le site privé documenté utilise encore le backend offline. La base SQLite d'authentification n'est pas le catalogue. Aucun import réel dans le site n'est annoncé avant connexion, transaction et relecture vérifiées.

## Plan

1. Ajouter une voie batch séparée : maximum cinq pages de découverte et cent ouvertures de fiches distinctes ; liens sur la même origine et catégorie, pagination observée seulement. Les recommandations DOM des fiches peuvent compléter la file ; biais d'échantillonnage consigné.
2. Runtime Camofox1.19.0 / Firefox152.0.4-beta.30 figé, un contexte de navigation temporaire pour le lot, onglets fermés après lecture. Dix secondes mesurées entre navigations, 90secondes/page, zéro retry, délai total45minutes. Conserver au fil de l'eau.
3. Arrêter sur HTTP403/429, refus ou demande humaine explicite, contrôle masquant réellement la page, erreur d'environnement/nettoyage ou incohérence de preuve. Un simple iframe sans obstruction n'efface pas des données disponibles. Aucune interaction CAPTCHA, proxy, import de cookies ou manipulation de protection.
4. Normaliser séparément chaque DOM avec identité source, URL exacte, date et empreinte. Compter découvert/tenté/complet/partiel séparément. Garder prix, km, année structurée, marque/modèle, critères, localisation et références photo ; aucun VIN supposé, aucune photo prétendue téléchargée.
5. Conserver les captures originales et données normalisées privées dans une base SQLite de préparation, et produire un import PostgreSQL transactionnel/idempotent vers le schéma isolé aw_acquisition_trial. Aucun déguisement en source synthétique, mutation de registre ou modification du catalogue public. Les lignes du serveur et les lignes de préparation sont comptées séparément.
6. Exécuter le lot via un workflow GitHub one-shot gardé par branche, parent du plan et première tentative/run ; job360minutes, budgets fonctionnels ci-dessus. Preuves chiffrées, sorties publiques limitées aux compteurs/états/empreintes. Aucun secret serveur ni raw dans les logs publics. Pas de cron.
7. Vérifier les preuves récupérées, dédupliquer par source/identifiant, contrôler le stockage et le rejeu. Si une connexion réelle devient disponible, exécuter l'import déjà autorisé et vérifier les comptes ; sinon livrer le lot conservé et l'import prêt en indiquant le blocage précis.

## Acceptation / vérification

- Tests hors réseau : liens/URL/limites, file dédupliquée, espacement réel, arrêt sans relance et préservation des résultats précédents, distinction signal/obstruction/données, redaction des résumés.
- Stockage : vraie base SQLite relue, intégrité, comptes d'annonces uniques, raws séparés, rejeu sans doublon, SQL échappé et transactionnel ; aucune suppression d'annonce.
- Régression du pilote existant, lint, secrets et YAML ; revue indépendante avant exécution réseau. Code source/module JS sans build produit ni changement UI ; pas de gate UI fictif.
- Après exécution : run/source/identités/empreintes authentifiées, nombres exacts et limites. Une base éphémère CI ou SQLite exportée ne vaut pas insertion dans la base du site.

Budget maximum :105ouvertures,45minutes de collecte plus installation/validation. Coût financier non mesuré. Réévaluation au premier échec matériel. Retrait par revert ciblé du code/workflow ; aucun effacement de données existantes. Le schéma d'essai n'est créé sur le VPS que lorsque l'accès permet une écriture vérifiable.

## Implémentation et contrôle local avant le premier run

Plan publié dans PR270 puis commit083c44021a2b6d645a86aa55b50d85bc08c422e7 avant code. Voie batch séparée, deux modules de lecture/orchestration et runtime temporaire, stockage Python/SQLite avec rejeu du normaliseur Node existant. Les anciens collecteurs sont inchangés. L'import PostgreSQL est généré, pas exécuté sur le serveur.

Validation locale Node24.22.3 (version native Node22.23.2 à vérifier dans le job) :89 tests Node PASS, dont28 pour la voie batch et61 régressions historiques ;19 tests Python PASS. Lint initial : quatre noms de globals non déclarés, corrigés par import/qualification explicite ; lint final PASS. Secretlint des dix fichiers concernés PASS. YAML, SHA40 des actions et timeout360 vérifiés. Aucun build/interface produit modifié.

La revue indépendante a fait corriger le seuil de conservation (seuls résultats listing_observed), le compteur stored initialement fixé à zéro et les rejets avant extraction. Le test métier conserve une fiche authentique après le refus403 suivant et vérifie complete1/attempted2/rejected1. Le schéma de préparation teste aussi100 identités distinctes avec données de test ; ce n'est pas une collecte réelle.

Limites : géométrie/hit-test sont des observations locales et ne prouvent pas l'absence absolue d'occlusion, notamment pointer-events:none ; corps internes des iframes et ensemble des sous-requêtes non capturés. Les références photo ne sont pas des fichiers image. SQLite prouve uniquement le stockage de préparation. Le SQL PostgreSQL attend une exécution vérifiée sur la connexion réelle.

Statut avant réseau : LOCAL_VALIDATED / REAL_BATCH_PENDING / PROJECT_DATABASE_ACCESS_MISSING.

## Premier lot : découverte interrompue ; adaptation à partir des fiches directes

Run45061723405, source50341458f681dd7b3562418ce8e75f709124e0f3 : la page catégorie répondHTTP200, mais le cadre de vérification couvre1920×978 pixels (100%du viewport) et intercepte les cinq points contrôlés. Le lot s'arrête avant toute fiche :1page de découverte,0fiches,0annonce extraite ou stockée. Le reçu SQLite0 et le jobSUCCESS attestent l'exécution, pas un import d'annonces. ZIP SHA256ca91f2e15cc190d72864a8469157e3edeaf5bccc21317615bfee646e9c381c14, identité et déchiffrement authentifié vérifiés. Les corps internes des cadres restent inconnus.

### Plan complémentaire avant code

Distinguer maintenant l'accès au catalogue de l'accès aux fiches directes, dont des lectures ponctuelles avaient réussi. Le nouveau lot part des trois URL déjà observées (3305814470,3312238672,3308374007) et complète sa file uniquement avec les liens automobiles rendus dans ces fiches/recommandations. Il n'ouvre pas la page catégorie bloquée et n'utilise pas ses liens capturés. Les cent annonces éventuelles forment un échantillon de recommandations, sans représentativité revendiquée.

Voie explicite --route known-details, manifeste distinct ; comportement et empreinte du plan catégorie inchangés. Zéro page de recherche,100ouvertures de fiches maximum, dix secondes entre navigations, mêmes délais, contrôles, conservation chiffrée et arrêt sur refus/demande humaine/obstruction. Même configuration Camofox, aucun changement d'identité configuré, proxy, cookie importé ou interaction de contrôle. Un nouveau contexte de campagne isolé est celui du workflow ordinaire.

Un workflow dédié one-shot utilisera le parent de ce plan et sa première exécution/tentative. Budget cumulé maximum101ouvertures pour les deux routes, inférieur aux105 initialement prévues. Tests de départ par trois IDs connus, déduplication et absence d'ouverture catégorie ; régressions existantes, lint/secrets et revue indépendante. Aucune nouvelle prétention de connexion à la base du projet.

Statut : CATEGORY_DISCOVERY_OBSTRUCTED / KNOWN_DETAIL_BATCH_PLANNED / PROJECT_DATABASE_ACCESS_MISSING.
