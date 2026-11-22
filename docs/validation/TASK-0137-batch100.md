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

Statut : PLAN_READY / IMPLEMENTATION_PENDING / PROJECT_DATABASE_ACCESS_MISSING.
