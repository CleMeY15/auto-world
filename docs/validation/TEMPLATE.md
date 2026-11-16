# Validation TASK-XXXX — Résultat et limites

Modèle pour `docs/validation/TASK-XXXX.md`. Les artefacts bruts restent à leur emplacement prévu ; aucun secret, token ou donnée privée copié. Une cellule inconnue porte `unknown`, jamais un zéro supposé.

## Identité et périmètre

- Tâche / responsable / branche / base : à renseigner.
- Révision source, tree, état sale avant/après les contrôles : à relever.
- Environnement et versions pertinentes : à relever.
- Rôles Codex, modèles et efforts observés : à relever.
- Portée : local / source PR / main, distinctement. Aucune conclusion ne dépasse sa preuve.

## Matrice de preuve

| Critère / gate | Commande ou inspection | Source / environnement | Résultat et artefact |
| --- | --- | --- | --- |
| À renseigner | Commande exacte ou inspecteur | Révision liée | PASS / FAIL / non exécuté / non applicable justifié |

Par run : début/fin, code de sortie, nombres de tests, échecs, exclusions, retries et caches lorsqu'ils existent. Distinguer interruption, RED volontaire et échec inattendu. Lier captures et revue réelle pour l'UI. Ne pas afficher une preuve d'une autre révision comme courante sans justification vérifiable et revue permise par le contrat.

## Première présentation et reprises

- Première proposition complète : heure et source avant la première revue, preuves des critères de réalisation locaux ; revue/gates de livraison attendus séparément, ou `not_yet_presented`. Une revue anticipée d'un travail incomplet reste étiquetée comme telle.
- Défauts avant présentation : cause et réparation, sans les masquer dans la mesure.
- Revue indépendante : contexte Codex, source, verdict, constatations et limites.
- Cycles correctifs après présentation : cause (cadrage/code/test/environnement/preuve/demande), contrôles refaits et résultat.
- Suggestions facultatives : séparées des obligations et du périmètre accepté.

## Mesures du pilote

- Début réel, première présentation, acceptation : heures ou `unknown` ; active/attente/blocage séparés si observés.
- Consommation et coût variable agent/CI, temps humain : observés ou `unknown`, avec source et unité.
- Préparation/orchestration/revue/mesure : incluses ; coût initial, récurrent et abonnement séparés.
- Défauts après acceptation : observation sept jours, gravité et parcours ; fin de fenêtre ou `incomplete`. Pas d'automatisation programmée sans demande.

## Livraison, limites et retour arrière

- PR, source finale, contrôles source, main et contrôles main requis : liens exacts, aucun succès anticipé.
- Critères non prouvés, blocages, exclusions et données manquantes : explicites.
- Décision d'acceptation : checkpoint final ; tâche et vue courante actualisées après preuves.
- Retour arrière et effets opérationnels : lien vers contrat, conservation des données/preuves.
