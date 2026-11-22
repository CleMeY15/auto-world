# Pilote de développement full Codex

Résultats TASK-0137 Camofox, 22 novembre 2026 : [deux campagnes et observation passive](../../docs/validation/TASK-0137-camofox-pilot.md), sources 668680d4 / 8181d3fc. Données de deux annonces obtenues et relues à environ douze minutes ; arrêt de qualification sur le cadre de la deuxième fiche, aucune campagne complète. 41 puis 61 tests ciblés réussis localement et en natif ; revues de source et d'originaux indépendantes. Reprises conservées : vérification des intervalles de capture, détection des demandes « pas un robot », erreur explicite de snapshot final. Une tentative de commande pnpm locale a été refusée pour versions d'environnement ; linter installé exécuté directement ensuite, sans changement d'exigence. Paramètres de modèle/effort hérités, coûts/tokens/temps humain inconnus ; aucun gain économique ni qualification de production déduit. Les fenêtres réelles et leurs résultats, y compris les observations non tentées, restent dans le compte rendu.

22 novembre 2026 : [pilote de répétabilité Camofox](../../docs/validation/TASK-0137-camofox-pilot.md), suite de TASK-0137 hors cohorte produit. Autorisation utilisateur après un accès ponctuel confirmé ; plan publié dans PR270 et `f3c30d19` avant code. Responsable principal pour le runtime/orchestrateur, exécutant distinct pour les tests, revue indépendante en lecture seule et vérification des seeds antérieurs. Modèle et effort hérités sans changement demandé ; effort exact, coûts, tokens et temps humain non mesurés. Trois annonces, deux passages au plus ; aucun résultat de répétabilité ni économie anticipés. Les résultats source et leurs limites sont consignés dans le compte rendu lié.

22 novembre 2026 : [TASK-0136, essai réel leboncoin](../tasks/TASK-0136-leboncoin-feasibility.md), priorité utilisateur avant la suite du produit, hors cohorte des six tâches. Plan en [PR269](https://github.com/CleMeY15/auto-world/pull/269) avant implémentation ; root pilote et observe, spécialistes extraction/runtime, revue indépendante en lecture seule. Préflight exploratoire antérieur au plan : GET 403, navigateur cloud lisible. Coût, tokens, temps humain et heure de début exacte unknown. Aucune économie revendiquée. [Validation](../../docs/validation/TASK-0136.md) distincte de la production.

22 novembre 2026 : [TASK-0135, collecte propre à AutoFindex](../tasks/TASK-0135-owned-acquisition.md), voie d'acquisition distincte des six entrées historiques de la cohorte. Implémentation répartie entre root, extraction et tests réseau ; revue architecture/code indépendante en lecture seule. [Résultats et limites](../../docs/validation/TASK-0135.md). Modèle/effort exact, coût/tokens/temps humain inconnus dans cette session ; aucune économie revendiquée. Les six entrées et leurs historiques restent inchangés.

Statut : **en cours, 6 tâches produit inscrites**. Mise en place : [TASK-0125](../tasks/TASK-0125-full-codex-workflow.md). Coordination, réalisation, recherche et revue exclusivement Codex. Pilote manuel, sans nouveau fournisseur ni orchestration en arrière-plan.

## Entrée et déroulement

Après livraison de la mise en place, inscrire avant exécution les six prochaines tâches produit admissibles selon ROADMAP : type, risque, périmètre, propriétaire, dépendances acceptées et validation. Conserver priorité et dépendances ; pas de sélection des seuls succès. Garder échecs, abandons et blocages sans remplacement silencieux. TASK-0125 est une tâche de processus, pas une feature de cette cohorte ; son coût initial entre dans le bilan.

Comparer des tâches de nature comparable, séparer UI et frontières sensibles. Stabiliser modèles/efforts Codex, consigner les changements nécessaires. Les six tâches ne sont pas autorisées d'avance : chacune satisfait sa DoR. Bilan intermédiaire après trois entrées pour corriger la collecte ; bilan final après six entrées et fenêtre de qualité applicable. Ne pas paralléliser des tâches dépendantes pour accélérer l'échantillon.

| Entrée | Tâche / type / risque | Inscription / propriétaire | Validation / issue |
| --- | --- | --- | --- |
| 1 | [TASK-0126](../tasks/TASK-0126-loaded-listing-navigation.md), parcours UI, risque local | 18 novembre, propriétaire produit Codex gpt-6.2-astra / ultra | [Validation en cours](../../docs/validation/TASK-0126.md) |
| 2 | TASK-0127 · Accès à la recherche depuis l’accueil | 18 novembre, responsable propre au lot | [PR259](https://github.com/CleMeY15/auto-world/pull/259), livraison en cours |
| 3 | TASK-0128 · Lecture progressive des historiques | 18 novembre, responsable propre au lot | [PR258](https://github.com/CleMeY15/auto-world/pull/258), livraison en cours |
| 4 | TASK-0129 · Rapports liés au véhicule de l’annonce | 18 novembre, responsable propre au lot | [PR260](https://github.com/CleMeY15/auto-world/pull/260), livraison en cours |
| 5 | [TASK-0131 · Accueil AutoFind](../tasks/TASK-0131-beta-landing.md) | 18 novembre, propriétaire produit. Entrée rapprochée lors de TASK-0132, mesures initiales inconnues | [PR262](https://github.com/CleMeY15/auto-world/pull/262), validation source |
| 6 | [TASK-0132 · Identité du produit connecté](../tasks/TASK-0132-private-product-identity.md) | 18 novembre, propriétaire produit Codex gpt-6.2-astra / ultra | [Recette](../../docs/validation/TASK-0132.md), en cours |

Direction du propriétaire, 18 novembre 2026 : jusqu’à quatre lots produit indépendants en parallèle avec arbres dédiés, fusions séquentielles et vérification du main. Présenter tôt le rendu mobile/bureau et le parcours à essayer. Privilégier les tests locaux ciblés ; la CI porte la suite exhaustive. Le risque de régression guide les vérifications supplémentaires, notamment à texte agrandi. Choisir le modèle Codex et l’effort par intervention et consigner les escalades. La voie produit reste limitée au prototype synthétique ADR-0028.

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

18 November infrastructure observation. The [AWS CLI diagnostic](../../docs/validation/TASK-0005-aws-cli-2.41.md) uses Codex gpt-6.2-astra / ultra for implementation, ordered plan reviews and delivery. The implementation worktrees are isolated. This infrastructure increment is outside the product cohort. Cost and active human time are unknown.

22 novembre 2026 : [TASK-0137](../tasks/TASK-0137-leboncoin-autonomous.md), hors cohorte UI, répond à la demande explicite de collecte autonome régulière. Plan publié dans [PR270](https://github.com/CleMeY15/auto-world/pull/270) avant implémentation. Responsable principal, exécutant du programme et reviewer en contextes Codex distincts ; paramètres hérités, effort/coût/temps humain non exposés (`unknown`). Tests ciblés et revues indépendantes réussis ; le runner Linux démarre Chromium mais reçoit HTTP 403 sur son unique navigation, zéro extraction. Les blocages de connexion VPS et les preuves négatives sont conservés dans le compte rendu. La lecture cloud réussie et le pilote horaire ChatGPT préexistant sont des observations distinctes, pas une qualification de notre worker. Aucun gain ni succès de collecte propre régulière revendiqué.

Suite TASK-0137, 22 novembre : l'utilisateur demande de résoudre le refus. Le [plan de diagnostic inspectable](../../docs/validation/TASK-0137-access-diagnostic.md), publié sur `915dea86` avant code, conserve une réponse privée chiffrée depuis une seule invocation. 59 tests et lint réussis ; deux qualifications textuelles trop affirmatives ont été corrigées après prérevue, puis contrôlées de nouveau. Même répartition Codex, modèles/réglages hérités et coûts unknown. Cette mesure ne remplace pas la validation d'accès et de répétition ; aucun gain ou résultat en ligne anticipé.

Le diagnostic réel `45028412874`, source `dcf3d616`, a conservé et permis de vérifier une réponse HTTP 403 de 771 octets : page de vérification DataDome. Zéro annonce extraite. La [tranche de compatibilité](../../docs/validation/TASK-0137-normal-flow.md) teste maintenant si nos restrictions interrompent une vérification automatique normale. Plan soumis avant code, mêmes rôles Codex et réglages hérités ; coûts/temps humain unknown, aucun gain ni accès régulier revendiqué.

Tranche native, plan `61aec6f` publié avant réalisation : proposition locale présentée à 14:00 UTC, 74 tests et lint PASS, Secretlint 1 689 fichiers PASS. Prérevue : attribution du corps initial et formulation de demande humaine corrigées ; visibilité d'iframe affinée ensuite, contrôles ciblés repris. Modèles/réglages hérités, rôles distincts, coûts et gains unknown. Résultat source et collecte répétée encore non établis à ce jalon.

Résultat natif : run `45030547435`, source `4a47c3c6`, HTTP 403 puis refus explicite affiché par l'iframe de vérification, aucun retour et zéro annonce. Le dossier privé a été déchiffré/vérifié ; conclusion relue indépendamment. Le job vert qualifie la conservation de preuve uniquement. Motif précis et collecte propre régulière restent non établis ; aucun nouveau retry, gain ou succès anticipé, aucune soumission externe effectuée.
