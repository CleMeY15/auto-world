# Pilote de développement full Codex

Statut : **préparé, 0 tâche produit inscrite**. Mise en place : [TASK-0125](../tasks/TASK-0125-full-codex-workflow.md). Coordination, réalisation, recherche et revue exclusivement Codex. Pilote manuel, sans nouveau fournisseur ni orchestration en arrière-plan.

## Entrée et déroulement

Après livraison de la mise en place, inscrire avant exécution les six prochaines tâches produit admissibles selon ROADMAP : type, risque, périmètre, propriétaire, dépendances acceptées et validation. Conserver priorité et dépendances ; pas de sélection des seuls succès. Garder échecs, abandons et blocages sans remplacement silencieux. TASK-0125 est une tâche de processus, pas une feature de cette cohorte ; son coût initial entre dans le bilan.

Comparer des tâches de nature comparable, séparer UI et frontières sensibles. Stabiliser modèles/efforts Codex, consigner les changements nécessaires. Les six tâches ne sont pas autorisées d'avance : chacune satisfait sa DoR. Bilan intermédiaire après trois entrées pour corriger la collecte ; bilan final après six entrées et fenêtre de qualité applicable. Ne pas paralléliser des tâches dépendantes pour accélérer l'échantillon.

| Entrée | Tâche / type / risque | Inscription / propriétaire | Validation / issue |
| --- | --- | --- | --- |
| 1 | Non sélectionnée | Non ouverte | Non exécutée |
| 2 | Non sélectionnée | Non ouverte | Non exécutée |
| 3 | Non sélectionnée | Non ouverte | Non exécutée |
| 4 | Non sélectionnée | Non ouverte | Non exécutée |
| 5 | Non sélectionnée | Non ouverte | Non exécutée |
| 6 | Non sélectionnée | Non ouverte | Non exécutée |

## Mesures et décision

Données détaillées dans chaque [validation](../../docs/validation/TEMPLATE.md), pas un deuxième journal. Mesurer délai jusqu'à acceptation, corrections après première présentation, défauts avant/après celle-ci, critères démontrés, temps humain et coût total observable. Des durées de contrôles individuels ne constituent pas un délai de livraison. Un RED attendu n'est pas un rejet de première présentation.

Le taux de première présentation acceptable porte sur les propositions complètes examinées indépendamment, sans correction requise. Rapporter aussi les entrées bloquées/abandonnées/non présentées. Examiner les défauts sept jours après acceptation ; une fenêtre non échue ou non suivie reste `incomplete`/`unknown`, pas « zéro défaut ».

Coût total : agents + CI + temps humain, avec source/unité ; inclure cadrage, orchestration, revue, collecte et mise en place. Séparer initial/récurrent et abonnements. Sans tarif effectif, rapporter les tokens/durées/quotas disponibles sans fabriquer d'euros. Sans données comparables : **économie non établie**.

Tolérances initiales : aucune suppression de gate, aucune acceptation sur preuve absente/mauvaise révision, aucun défaut bloquant introduit par le processus. Pas de succès économique si le coût total observé augmente. Ne pas conserver un gain de vitesse dégradant coût, reprises ou qualité au-delà de l'incertitude documentée ; sans incertitude quantifiée, aucune tolérance numérique présumée. Tout autre arbitrage est explicite avant de modifier le protocole. Évaluer les indicateurs ensemble : conserver si un bénéfice observable respecte ces limites, sinon simplifier ou poursuivre la mesure.

Une petite cohorte ne prouve ni causalité ni supériorité d'un modèle. Si l'historique est insuffisant, collecter une référence prospective full Codex avec réglages stables ; comparer un changement suivant à périmètre comparable. Ne pas attribuer rétroactivement les anciens runs à cette organisation.

## Référence historique partielle

| Tâche | Reprises documentées, déjà corrigées | Source |
| --- | --- | --- |
| TASK-0121 | Prérequis build/import, curseur invalide et preuves dupliquées ; présentation mobile retravaillée | [Validation](../../docs/validation/TASK-0121.md) |
| TASK-0122 | Ordre canonique de fixture, attentes de texte périmées | [Validation](../../docs/validation/TASK-0122.md) |
| TASK-0123 | Clone modifié pendant contrôles, défaut visuel à texte agrandi | [Validation](../../docs/validation/TASK-0123.md) |
| TASK-0124 | Libellé tronqué puis régression du budget des dates en comparaison | [Validation](../../docs/validation/TASK-0124.md) |

Coût, tokens, temps humain, délai global, première présentation et suivi systématique à sept jours : **unknown**. Cette référence justifie des recettes et contrôles précoces, pas un taux d'économies.

## Amélioration et arrêt

Une reprise récurrente améliore une recette, fixture, composant ou régression utile. N'automatiser collecte, caches ou routage de modèles que si un coût répété est mesuré et une tâche distincte peut prouver le bénéfice. Aucun changement de fournisseur prévu. Pour arrêter : conserver entrées/preuves, noter la raison et reprendre les contrats/commandes existants ; aucun effacement des échecs.

Maintenance du17 novembre2026 : [correction Picomatch](../../docs/validation/picomatch-security-2026-11-17.md)
hors cohorte des six tâches produit ; Codex gpt-6-astra/ultra, un spécialiste
implémentant distinct, revue finale indépendante encore requise. Coûts et gains
non mesurés ; aucune entrée produit consommée.

Infrastructure du 17 novembre 2026 : [PR247 acceptée](https://github.com/CleMeY15/auto-world/pull/247#issuecomment-6964012598), puis
[réconciliation documentaire et mesures M3](../../docs/validation/TASK-0005-retention-checkpoint.md),
hors cohorte produit. Coordinateur, recherche et revues en contextes Codex
gpt-6-astra/ultra distincts ; coûts, tokens et gains unknown. Aucune entrée produit
consommée, aucun nouveau résultat opérationnel ni suivi à sept jours revendiqué.

Infrastructure du18novembre2026 : [remédiation upstream indépendante](../../docs/validation/TASK-0005-upstream-20261118.md),
hors cohorte produit. Responsable, deux recherches et revues Architect/Critic en
contextes Codex gpt-6-astra/ultra hérités ; coût/tokens/gains unknown. V1 de plan
rejetée pour contrôle JDK manquant, V2 approuvée ; premier préflight arrêté sur
identité locale Docker29, second corrigé avec preuve JDK identique. Aucun gain ni
acceptation finale revendiqué, aucune entrée produit consommée.

Suite de la voie upstream18novembre : sourceadba7380 et originaux raw/qualité/
managed approuvés par contextes indépendants,84occurrences RPM corrigées sur le
nouveau sujet,159restantes. Les reprises locales umask/tmpfs/chemin de socket
sont conservées ; préparation environnement seulement, assertions inchangées.
La documentation finale et le main restent à livrer. Modèle/effort inchangés,
coûts/tokens/gains unknown, hors cohorte produit.

Infrastructure preparation,18 November2026: [PostgreSQL/Gosu dossier](../../docs/validation/TASK-0005-postgres-gosu-material-capture.md),
outside product cohort; unique author Codex gpt-6-astra/ultra, inherited settings
recorded before work. Architect WATCH on revision0; parent clarified N1–N3
in revision1, then distinct Critic APPROVE on that exact plan. Parent revision2
clarifies C1 (existing trace repetitions/interleavings) and delivery state only.
Each verdict keeps its exact scope; source/main documentary acceptance pending.
Costs/tokens/human time unknown, no measured savings or product entry consumed.

18 November, PostgreSQL/Gosu capture implementation after PR252 documentary
acceptance: sole Codex gpt-6.2-astra / ultra implementer; [scope, checks and
handoff](../../docs/validation/TASK-0005-postgres-gosu-material-capture.md#implementation-brief--18-november-2026).
Infrastructure maintenance outside product cohort; independent delivery review
pending, cost/tokens/human effort unknown.
