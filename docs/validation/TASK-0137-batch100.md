# TASK-0137 — Lot réel borné de 100 annonces

## Résultat actuel — 22 annonces importées, objectif 100 non atteint

Le lot direct a fourni 22 annonces distinctes, toutes complètes avec HTTP 200. Elles sont désormais insérées dans la base privée du projet ; une nouvelle connexion après écriture confirme 22 annonces distinctes. Le [reçu d'import](evidence/TASK-0137-project-import-receipt.json) et les métadonnées techniques de la cible sont publiés avec l'autorisation explicite de l'utilisateur. La reprise destinée à compléter le lot a reçu HTTP 403 dès sa première fiche, donc 0 annonce supplémentaire. Le site offline n'affiche pas encore ces données ; aucune source de production ni collecte récurrente n'est activée. Les sections de plan et leurs états pending ci-dessous sont historiques.

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

## Lot direct :22 annonces conservées ; reprise après correction de minuterie

Run45062255767, source3ccf52ef4e8626724d24518a13eade29e27338d8 :22fiches distinctes ont réponduHTTP200, avec données complètes et aucun signal de contrôle relevé.53candidats ont été découverts. Le programme s'arrête avant la23e ouverture parce que l'attente finit à9999ms au lieu des10000ms requis : dernière capture terminée19:48:05.070UTC, résumé19:48:15.069UTC. Ce n'est pas un refus du site.

ZIP SHA2569239dbdc54c8af5ace24374ca447c6085ec01f2ab2fbbac657e9356d9973850c vérifié ;22 enveloppes authentifiées, identités/normalisation/fichier de candidats rejoués. La base SQLite de préparation est relue à22 annonces distinctes ; le rejeu exact ajoute0 observation.0 annonce insérée dans la base du VPS. Hostinger affiche maintenant une page de connexion ; une session authentifiée reste nécessaire.

### Plan de reprise avant code

Corriger l'attente pour mesurer une échéance complète : si le minuteur se réveille légèrement tôt mais que l'horloge avance, attendre le reliquat, au maximum trois réveils. Si l'horloge n'avance pas ou si le budget/échéance ne peut être établi, conserver l'arrêt. Le seuil10secondes reste inchangé et aucune navigation source n'est répétée pour cette correction.

Figer une nouvelle liste issue du checkpoint vérifié :31URL encore en attente et22URL déjà collectées à exclure. Nouvelle route --route resume-known-details, manifeste distinct avec source/run d'origine, maximum78 ouvertures nouvelles. Les recommandations des pages qualifiées peuvent compléter la file, toujours après déduplication et exclusion du premier lot. Le cumul reste au maximum100fiches et1page catalogue. Ne pas reprendre la page catalogue ni un obstacle source.

Même Camofox, contexte ordinaire de campagne, délais, arrêt réel et stockage chiffré. Tests du réveil à9999ms suivi du reliquat, d'une attente sans progression, de l'exclusion22 et du plafond78. Workflow one-shot sur le parent de ce plan, premier run/tentative. Conserver les identités des deux lots, puis importer les deux dans la même base de préparation et vérifier100 identités si le plafond est atteint. Ne pas attribuer les22 captures anciennes au nouveau run.

Statut :22_REAL_LISTINGS_STAGED / TIMER_CORRECTION_AND_RESUME_PLANNED / PROJECT_DATABASE_ACCESS_MISSING.

### Vérifications avant la reprise réseau

Plan publié dans e710daabf5ca0f074519595eccad7b5f28006cc6 avant implémentation. Revue indépendante des trois fichiers source/manifeste/workflow : aucun blocage ; comparaison exacte des31candidats FIFO et22exclusions au checkpoint authentifié. Les preuves du premier lot restent rattachées à leur ancienne révision.

Validation locale sérialisée :95 tests Node PASS et19 tests Python PASS ; lint et secretlint des quatre fichiers source/tests/workflow PASS. Le scénario de réveil9999ms attend encore2ms avant ouverture (intervalle mesuré10001ms), l'absence de progrès arrête immédiatement et les réveils trop précoces sont bornés à trois. Un scénario synthétique de78 résultats vérifie exclusions, doublons, plafond et statut ; il ne remplace pas le résultat réel attendu.

Statut avant publication du code : RESUME_LOCAL_VALIDATED / REAL_RESUME_PENDING / PROJECT_DATABASE_ACCESS_MISSING.

## Reprise réellement exécutée — refus dès la première fiche

Implémentation `6f13fe64575196260ed2b9864ff47bcb02c7946e`, [run45064032767](https://github.com/CleMeY15/auto-world/actions/runs/45064032767), lot `86749fdfaecbe3ba78d79403a0717522`, plan SHA-256 `18b5fe79e97c38258d155f92cb5c1b24aa9edee95ae9cb363f850369c7d438de`. La première URL est exactement celle en tête du checkpoint authentifié, absente des 22 déjà collectées. Une seule navigation entre 20:02:22.374 et 20:02:24.772 UTC : HTTP 403, `source_refused`, contrôle « DataDome Device Check » couvrant 1920×997 pixels et interceptant les cinq points mesurés. Aucun corps interne de cadre ni cause de décision serveur n'est établi.

Comptes : 31 candidats hérités, 1 fiche tentée, 1 rejetée, 0 complète, 0 stockée. Aucun autre candidat ouvert. Le reçu SQLite du runner est à zéro, son job SUCCESS atteste l'exécution de l'arrêt et la conservation des preuves. Nettoyage : 9 processus suivis, 0 restant, processus principal terminé.

Artifact `14770762350`, 5 487 octets ; ZIP SHA-256 `a8675baa55cae8418bb592ed409b1f7f8d33bd3b4d8574c70069cd6427801e3c`. ZIP, enveloppe authentifiée, identités, DOM, normaliseur et file de reprise vérifiés. Revue indépendante favorable aux comptes et à leur interprétation. Le lot vide n'a pas été ajouté à la base du VPS.

| Exécution | Découverte ouverte | Fiches ouvertes | Annonces complètes |
| --- | ---: | ---: | ---: |
| 45061723405 — catégorie | 1 | 0 | 0 |
| 45062255767 — fiches directes | 0 | 22 | 22 |
| 45064032767 — reprise corrigée | 0 | 1 | 0 |
| Total réellement exécuté | 1 | 23 | 22 |

Les 31 candidats de reprise font partie des 53 candidats du lot direct : ne pas sommer ces compteurs. Le premier arrêt était logiciel ; le refus de reprise survient à la première navigation d'une nouvelle exécution. Ces faits ne prouvent pas une détection provoquée par un nombre précis de requêtes.

## Import dans PostgreSQL et portée du résultat

Le lot valide de 22 annonces a été importé dans la base privée du projet, puis vérifié depuis une nouvelle connexion après COMMIT. Le [reçu publié](evidence/TASK-0137-project-import-receipt.json) reproduit les résultats du contrôle exécuté sur le VPS et conservés dans le dossier de livraison. Le reçu antérieur de préparation SQLite reste une preuve historique distincte.

### Cible et intégrité de l'import

| Élément | Valeur observée |
| --- | --- |
| Serveur | `srv2160688.hstgr.cloud` |
| Checkout | `/home/autoworld/projects/auto-world` |
| Projet Docker existant | `aw-test-435e897c-aa57-4574-8087-cff23603030f` |
| Base / schéma d'essai | `autoworld` / `aw_acquisition_trial` |
| Port PostgreSQL observé | `32782` |
| Rôle utilisé | `aw_migrator` |
| Version PostgreSQL | `17.11 (Debian 17.11-1.pgdg13+2)` |
| Lot importé | `8f67269ce9fbaa10f0f34977722a979e` |
| Run de collecte | `45062255767` |
| Révision du collecteur | `3ccf52ef4e8626724d24518a13eade29e27338d8` |
| Taille du SQL transféré | 366 411 octets |
| SHA-256 du SQL transféré | `f40558b981680a0ec910014696563be11f0c14acf882e443b6866dbda1489fcf` |

Le contrôle est horodaté au 22 novembre 2026 à **21 h 18 min 31,014 s, heure de Paris** (`2026-11-22T20:18:31.014Z` dans le reçu). C'est l'heure de vérification, pas un horodatage établi du COMMIT. La révision du collecteur ne désigne pas le checkout déployé.

Résultat de la relecture : **22 annonces stockées, 22 identifiants distincts, 22 observations distinctes et 22 empreintes des données brutes vérifiées**. Le reçu confirme `transaction_committed`, `fresh_connection_readback` et `project_database_updated` à `true` ; `source_registry_changed` et `site_catalogue_updated` restent à `false`.

La livraison privée contient les données normalisées, une base de préparation, l'import SQL, un aperçu autonome et les preuves de stockage. L'import concerne un espace d'essai ; le site offline n'affiche pas encore ces annonces. Les 61 références de photos sont conservées, sans téléchargement de fichiers image. L'échantillon contient 19 Porsche et 3 Mercedes-Benz, issues de trois fiches connues et de recommandations, sans représentativité revendiquée.

Aucune source de production ni collecte régulière n'est activée. L'accès durable et la couverture du catalogue restent non démontrés ; l'objectif de 100 n'est pas rempli.

### Autorisation de publication et portée de la mise à jour

Le 22 novembre 2026, après demande explicite de publication de ce compte rendu dans PR270, l'utilisateur a répondu : « Oui je t'autorise même avec les détails privées ». Cette autorisation couvre le bilan, le reçu et les métadonnées techniques ci-dessus. Les données d'annonces et les captures restent dans la livraison privée ; aucun secret d'authentification n'est inclus dans le reçu.

Plan documentaire publié dans PR270 avant modification : actualiser les quatre fichiers de suivi et ajouter la copie du reçu JSON, avec vérification de cohérence, des liens, des secrets et du diff, puis revue indépendante en lecture seule. Aucun code de collecte, service, registre ou interface n'est modifié ; aucune nouvelle collecte ni écriture en base n'est exécutée pour cette publication. Le retrait de ce checkpoint peut se faire par revert documentaire ciblé, sans annuler l'import existant.

Vérifications : 95 tests Node et 19 Python réussis localement et dans le job de reprise avec Node22.23.2 ; lint, secrets, YAML et revue indépendante des sources/preuves réussis. Tooling compatibility `45064038075` SUCCESS. La CI générale `45064038051` était encore en cours à la clôture de l'observation ; aucune qualification globale ni fusion n'en est déduite. Les modifications finales sont documentaires, sans relance de collecte.

Statut : **22_REAL_LISTINGS_IMPORTED / HUNDRED_TARGET_NOT_REACHED / REGULAR_ACCESS_UNPROVEN**. TASK-0137 demeure IN_PROGRESS.
