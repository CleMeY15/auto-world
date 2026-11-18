# Passation courante

Vérifiée le 17 novembre 2026 contre les checkpoints liés ci-dessous ; base initiale de TASK-0125 : `e3e8297cfb68540c3af4703b552e16e19ed39d4a`, puis intégration de main `c38c9c1a0e64f80c2170c00f4e87286e349b60c6`. Responsable de cette vue : propriétaire de la tâche qui la met à jour. **Vue dérivée et datée**, pas un moteur de sélection automatique ni une preuve de réussite du main actuel.

| Voie | État établi et source | Prochaine action |
| --- | --- | --- |
| Produit V1 synthétique | [TASK-0124](tasks/TASK-0124-results-sort.md) acceptée `DONE_FOR_V1_PROTOTYPE`, source `aa447e2427bd295a5b4c6533199ffbf56047b5ba`, main `f554c475b6748fb1b53281985588fab287c811ed`, [checkpoint PR235](https://github.com/CleMeY15/auto-world/pull/235#issuecomment-6745769896). Les anciens statuts pending sont historiques. | Aucun successeur produit sélectionné ici. La navigation entre annonces déjà chargées reste un candidat de la roadmap, à cadrer avant exécution. |
| Processus de développement | [TASK-0125](tasks/TASK-0125-full-codex-workflow.md), mise en place autorisée ; **full Codex** pour tous les rôles. [Preuves et limites](../docs/validation/TASK-0125.md). | Terminer revue et livraison ; ouvrir ensuite la première entrée admissible du [pilote](pilots/FULL_CODEX.md). |
| Développement VPS | [PR240](https://github.com/CleMeY15/auto-world/pull/240) observée ouverte ; son auteur conserve la livraison et les preuves privées. | Ne pas modifier son checkout, ses processus ou ses validations. Disponibilité du VPS ne signifie pas acceptation de cette PR. |
| Infrastructure / qualification | [PR247 final checkpoint](https://github.com/CleMeY15/auto-world/pull/247#issuecomment-6964012598): observation delivery accepted on main `73ad4eddec190f3d6928f41f86c3e33858598683`, five workflows/six jobs and independent reviews pass. Scanner material-retention row closed; [actual C:/NTFS operation](../docs/validation/TASK-0005-nexus-observation.md) remains on f630339b. | Complete the [measured service-material inventory](../docs/validation/TASK-0005-managed-m3-preparation.md), separating historical measurements from surviving bytes and unknowns, then review a bounded capture plan. TASK-0005/0005A stay IN_PROGRESS; 243 blockers unwaived; no new publisher/copy/restore, admission or support activation. |

## Maintenance sécurité du17 novembre2026

Continuation infrastructure du 18 novembre : la livraison documentaire PR249 est
acceptée sur main `7c49d34d` par son
[checkpoint final](https://github.com/CleMeY15/auto-world/pull/249#issuecomment-6966235450),
après reprise qualité tentative 2 ; la tentative 1 annulée reste non acceptée.
Le [prérequis Gosu hors réseau](../docs/validation/TASK-0005-gosu-offline-inputs.md)
est implémenté, les contrôles locaux disponibles passent et les revues de code et
d'architecture sont favorables, après Architect puis Critic sur le plan figé.
La suite navigateur et sa preuve native source/main restent à établir. Il prépare une
décision de représentation, sans achever l'inventaire, la capacité ou la rétention M3.

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
