# Passation courante

18 November 2026. [AWS CLI 2.41.0 diagnostic qualification](../docs/validation/TASK-0005-aws-cli-2.41.md) is in progress on the accepted PR252 documentation base. PR251 measured 159 upstream blocking occurrences, including 49 in AWS CLI 2.38.5. TASK-0005/0005A remain IN_PROGRESS.

Vérifiée le 17 novembre 2026 contre les checkpoints liés ci-dessous ; base initiale de TASK-0125 : `e3e8297cfb68540c3af4703b552e16e19ed39d4a`, puis intégration de main `c38c9c1a0e64f80c2170c00f4e87286e349b60c6`. Responsable de cette vue : propriétaire de la tâche qui la met à jour. **Vue dérivée et datée**, pas un moteur de sélection automatique ni une preuve de réussite du main actuel.

| Voie | État établi et source | Prochaine action |
| --- | --- | --- |
| Produit V1 synthétique | [TASK-0124](tasks/TASK-0124-results-sort.md) acceptée `DONE_FOR_V1_PROTOTYPE`, source `aa447e2427bd295a5b4c6533199ffbf56047b5ba`, main `f554c475b6748fb1b53281985588fab287c811ed`, [checkpoint PR235](https://github.com/CleMeY15/auto-world/pull/235#issuecomment-6745769896). Les anciens statuts pending sont historiques. | [TASK-0126](tasks/TASK-0126-loaded-listing-navigation.md), navigation dans les annonces déjà chargées, est en validation dans son arbre produit. |
| Processus de développement | [TASK-0125](tasks/TASK-0125-full-codex-workflow.md), mise en place autorisée ; **full Codex** pour tous les rôles. [Preuves et limites](../docs/validation/TASK-0125.md). | ACCEPTED_ON_MAIN selon le [corps de PR243](https://github.com/CleMeY15/auto-world/pull/243). Première entrée du [pilote](pilots/FULL_CODEX.md) ouverte pour TASK-0126. |
| Développement VPS | [PR240](https://github.com/CleMeY15/auto-world/pull/240) observée ouverte ; son auteur conserve la livraison et les preuves privées. | Ne pas modifier son checkout, ses processus ou ses validations. Disponibilité du VPS ne signifie pas acceptation de cette PR. |
| Infrastructure / qualification | [PR252 documentary MAIN_ACCEPTED](https://github.com/CleMeY15/auto-world/pull/252) on `9bbf4d23`. TASK-0005/0005A IN_PROGRESS; PR251 raw FAILED with 159 unwaived blockers. | [Bounded PostgreSQL/Gosu implementation and local tests](../docs/validation/TASK-0005-postgres-gosu-material-capture.md#implementation-and-local-verification) ready for independent source review. Parent coordinates original source/main evidence and protected delivery. AWS/upstream work has a separate owner. |

## Maintenance sécurité du17 novembre2026

Continuation infrastructure du 18 novembre : la livraison documentaire PR249 est
acceptée sur main `7c49d34d` par son
[checkpoint final](https://github.com/CleMeY15/auto-world/pull/249#issuecomment-6966235450),
après reprise qualité tentative 2 ; la tentative 1 annulée reste non acceptée.
Le [prérequis Gosu hors réseau](../docs/validation/TASK-0005-gosu-offline-inputs.md)
est désormais MAIN_ACCEPTED par PR250 sur0c2b3d6c, avec preuve native du
premier runtime non caché ; les pending antérieurs sont historiques.
Le plan suivant a reçu Architect WATCH sur révision0 puis Critic APPROVE sur
révision1 ; la livraison documentaire et les preuves natives restent distinctes.
PR251 a fusionné sur `f6fcd6ef` le 18 novembre à 08:28 UTC. Son audit
source sur `d8e92987` compte 159 blocages. Les 243 blocages historiques
concernent le main de PR250, `0c2b3d6c`. La livraison de PR252 attend
l’acceptation des preuves du main de PR251 par le responsable upstream.
Les entrées upstream plus bas décrivent les étapes antérieures à la fusion.


La [correction Picomatch](../docs/validation/picomatch-security-2026-11-17.md)
est acceptée sur main `32f5253c646cc1b77be6bdb090792079fcd22782`, livré par
[PR248](https://github.com/CleMeY15/auto-world/pull/248) : sept workflows
source puis sept workflows main réussis et preuves originales approuvées,
sans réduction du seuil d'audit. Cette maintenance reste hors cohorte produit.
[PR247](https://github.com/CleMeY15/auto-world/pull/247) intègre ce main pour
livrer les observations NexusLite ; ses cinq workflows source puis main et
leurs preuves originales sont désormais acceptés sur main `73ad4edd`.
Voir le [checkpoint final](../docs/validation/TASK-0005-nexus-observation.md#accepted-observation-delivery).
TASK-0005/0005A restent IN_PROGRESS ; aucune nouvelle opération Nexus/publisher,
admission ou activation du support n'est autorisée par cette livraison.

## Reprendre le travail

1. Lire `AGENTS.md`, `ROADMAP.md`, cette vue, la tâche, les contrats utiles et le [mode opératoire](../docs/DEVELOPMENT_WORKFLOW.md).
2. Vérifier branche, révision, état Git et propriétaire des ressources. Reconsulter les PR/checkpoints concernés avant de dépendre de leur état ; la date de cette vue n'assure pas sa fraîcheur.
3. En cas de contradiction, lire la décision finale et ses preuves. Si elles manquent, écrire « non établi » et résoudre la dépendance ; ne pas choisir le premier ou le dernier mot DONE d'un historique.
4. Mettre cette vue à jour après un changement vérifié, un transfert ou une livraison. Conserver les historiques dans les validations et le registre de livraison.

La tâche/DoD définit ce qui est exigé ; le checkpoint accepté prouve ce qui est livré. Cette vue ne peut déroger à aucun des deux. Prototype isolé, données fictives ; aucune admission d'image, collecte réelle, production ou publication publique.

## Voie upstream indépendante, 18 novembre 2026

À la demande explicite de l'utilisateur, [le lot OpenSearch3.9 reconstruit](../docs/validation/TASK-0005-upstream-20261118.md)
prépare une remédiation distincte de PR250 et de la rétention M3. PR250 est
fusionnée sur0c2b3d6c, intégrée dans cette branche ; ses gates main restent la
responsabilité du parent. Matrice originale243 conservée, revues séquentielles
Architect/Critic et comparaison JDK arrêtée réussies. Scans/CI du nouveau sujet,
revues originales et livraison restent requis ; aucune fusion concurrente de
main pendant l'acceptation parent, aucun TASK DONE/admission/support déduit.

## Checkpoint source upstream — 18 novembre 2026

[PR251](https://github.com/CleMeY15/auto-world/pull/251), implémentationadba7380,
possède les revues source/qualité/raw/managed indépendantes. Le nouveau sujet
OpenSearch corrige84occurrences RPM avec inventaires complets et mêmes bases ;
raw reste FAILED159, anciens243 historiques inchangés. Managed valide ses dix
phases et quatre cas runtime diagnostiques ; aucune admission/support/M3 déduite.
[Preuves et limites](../docs/validation/TASK-0005-upstream-20261118.md).
PR250 est MAIN_ACCEPTED sur0c2b3d6c ; le parent conserve le dossier M3.
Prochaine action de cette voie : livrer la documentation sans changement de
source exécutée, revue d'équivalence et gate qualité, fusion normale PR251,
puis workflows et revue du main exact. TASK-0005/A restent IN_PROGRESS.

## Préparation du site privé — 18 novembre 2026

[TASK-0130](tasks/TASK-0130-private-web.md) prépare le frontal nominatif d’autofind.tech sur une branche dédiée. [Preuves et limites](../docs/validation/TASK-0130.md). Le parent conserve la décision de livraison, le staging root, le certificat et les essais externes. PR240, PR260 et le runtime 3129 gardent leurs propriétaires.

Voie produit du 18 novembre, branche dédiée. [TASK-0132](tasks/TASK-0132-private-product-identity.md) applique la marque AutoFind aux écrans connectés. [Recette et aperçus](../docs/validation/TASK-0132.md) sur les branches intégrées. La [PR263](https://github.com/CleMeY15/auto-world/pull/263) attend la livraison coordonnée de ses dépendances.

Audit de l’accueil public : [TASK-0133, déblocages produit sur la frise](tasks/TASK-0133-frise-accueil.md), en validation. [Aperçus mobile et bureau](../docs/validation/TASK-0133.md).
