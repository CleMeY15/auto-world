# TASK-0129 — Rapports du véhicule depuis sa fiche

Pilote 4/6, P1, IN_PROGRESS. Le propriétaire a corrigé le périmètre de [PR260](https://github.com/CleMeY15/auto-world/pull/260) le 18 novembre 2026. Responsable web Codex gpt-6.2-astra / ultra, même branche task-0129-histovec-message sur 5d0599cd. Le parent conserve les fichiers de pilotage, la revue, les gates source/main et la fusion.

## Definition of Ready et plan

Depuis une publication de la démo normale, consulter chacun des documents fictifs qui lui ont été explicitement rattachés. Pour une annonce sans document, l’acheteur peut demander un rapport au vendeur via le guide livré par [PR194](https://github.com/CleMeY15/auto-world/pull/194). Sources et règles du contrat local dans [ADR-0034](../../docs/decisions/ADR-0034-synthetic-listing-reports.md). Le [contrat véhicule](../../docs/VEHICLE_INTELLIGENCE.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), la [DoD](../../docs/DEFINITION_OF_DONE.md) et [ADR-0028](../../docs/decisions/ADR-0028-v1-prototype-functional-gate.md) s’appliquent.

1. Fournir des références explicites pour des identités du corpus de la démo locale. Vérifier publication, fournisseur et destination contre le catalogue des documents. Afficher la provenance déclarée, distinguer clairement exemples et absence.
2. Ajouter un composant isolé dans le détail accepté. Ouvrir un document local lisible, puis revenir sur sa fiche. Préserver navigation et historique des lots voisins. Le message HistoVec reste un recours.
3. Montrer tôt le parcours et ses captures mobile/bureau. Tester par le parcours réel plusieurs documents, un document et aucun, changement de publication et destinations incompatibles. Les gates généraux restent en CI.

Risques : rattachement croisé, promesse de rapport sur simple mention d’un fournisseur, fuite d’une référence confidentielle. V1 synthétique hors production ; ni VIN réel, achat, URL tierce, source intégrée, import de PDF ni télémétrie de rapport. Aucune migration ; revert ciblé UI, fixtures et route de document. Checkout et processus de recette privés 0129. Budget inconnu ; revoir l’hypothèse après deux échecs identiques. [Validation](../../docs/validation/TASK-0129.md).
