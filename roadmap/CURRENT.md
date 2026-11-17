# Passation courante

Vérifiée le 17 novembre 2026 contre les checkpoints liés ci-dessous ; base initiale de TASK-0125 : `e3e8297cfb68540c3af4703b552e16e19ed39d4a`, puis intégration de main `c38c9c1a0e64f80c2170c00f4e87286e349b60c6`. Responsable de cette vue : propriétaire de la tâche qui la met à jour. **Vue dérivée et datée**, pas un moteur de sélection automatique ni une preuve de réussite du main actuel.

| Voie | État établi et source | Prochaine action |
| --- | --- | --- |
| Produit V1 synthétique | [TASK-0124](tasks/TASK-0124-results-sort.md) acceptée `DONE_FOR_V1_PROTOTYPE`, source `aa447e2427bd295a5b4c6533199ffbf56047b5ba`, main `f554c475b6748fb1b53281985588fab287c811ed`, [checkpoint PR235](https://github.com/CleMeY15/auto-world/pull/235#issuecomment-6745769896). Les anciens statuts pending sont historiques. | Aucun successeur produit sélectionné ici. La navigation entre annonces déjà chargées reste un candidat de la roadmap, à cadrer avant exécution. |
| Processus de développement | [TASK-0125](tasks/TASK-0125-full-codex-workflow.md), mise en place autorisée ; **full Codex** pour tous les rôles. [Preuves et limites](../docs/validation/TASK-0125.md). | Terminer revue et livraison ; ouvrir ensuite la première entrée admissible du [pilote](pilots/FULL_CODEX.md). |
| Développement VPS | [PR240](https://github.com/CleMeY15/auto-world/pull/240) observée ouverte ; son auteur conserve la livraison et les preuves privées. | Ne pas modifier son checkout, ses processus ou ses validations. Disponibilité du VPS ne signifie pas acceptation de cette PR. |
| Infrastructure / qualification | [PR242](https://github.com/CleMeY15/auto-world/pull/242) fusionnée sur `5ecdee7b32bac22429f6a3fb8ce86b13accaa1da`, puis [PR244](https://github.com/CleMeY15/auto-world/pull/244) sur `c38c9c1a0e64f80c2170c00f4e87286e349b60c6`. Le correctif Next16.4.5 est intégré ; audit local de TASK-0125 sans vulnérabilité connue. Qualification TASK-0005 distincte, pas de PASS inféré de ces fusions. | Nouvelle CI de PR243 après intégration ; le propriétaire infra conserve ses opérations/preuves. Ne pas déclencher ses scanners. Conserver [ADR-0028](../docs/decisions/ADR-0028-v1-prototype-functional-gate.md). |

## Reprendre le travail

1. Lire `AGENTS.md`, `ROADMAP.md`, cette vue, la tâche, les contrats utiles et le [mode opératoire](../docs/DEVELOPMENT_WORKFLOW.md).
2. Vérifier branche, révision, état Git et propriétaire des ressources. Reconsulter les PR/checkpoints concernés avant de dépendre de leur état ; la date de cette vue n'assure pas sa fraîcheur.
3. En cas de contradiction, lire la décision finale et ses preuves. Si elles manquent, écrire « non établi » et résoudre la dépendance ; ne pas choisir le premier ou le dernier mot DONE d'un historique.
4. Mettre cette vue à jour après un changement vérifié, un transfert ou une livraison. Conserver les historiques dans les validations et le registre de livraison.

La tâche/DoD définit ce qui est exigé ; le checkpoint accepté prouve ce qui est livré. Cette vue ne peut déroger à aucun des deux. Prototype isolé, données fictives ; aucune admission d'image, collecte réelle, production ou publication publique.
