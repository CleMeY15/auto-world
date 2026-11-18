# TASK-0129 — Message au vendeur pour HistoVec

Pilote 4/6, P1, IN_PROGRESS. Responsable et exécutant web Codex gpt-6.2-astra / ultra. Branche task-0129-histovec-message, base main 5d0599cdeb3589b0c2ab0e42778769c9ad771b32. Le propriétaire a autorisé cette voie produit indépendante. Le parent gère les registres communs et la livraison séquentielle.

## Definition of Ready et plan

Le guide livré par [PR194](https://github.com/CleMeY15/auto-world/pull/194) fournit la route, les textes qualifiés, les liens et le dépliable natif. Contrats [ADR-0025](../../docs/decisions/ADR-0025-official-history-guide.md), [ADR-0028](../../docs/decisions/ADR-0028-v1-prototype-functional-gate.md), [UX](../../docs/PRODUCT_UX.md) et [DoD](../../docs/DEFINITION_OF_DONE.md). Risque local de confusion entre une demande au vendeur et une action du site ; un simple paragraphe de texte évite cette ambiguïté.

1. Ajouter un exemple bref en français dans un dépliable natif fermé au premier affichage. L’acheteur ouvre le dépliable, sélectionne le message manuellement et peut le refermer.
2. Réutiliser le style et les cibles tactiles du guide. Conserver le parcours d’aide, les qualifications et les destinations officielles. Vérifier clavier, focus, sélection, hors ligne après chargement, sans JS, stockage refusé, absence de trafic et de collecte. Contenu statique sans états réseau ou données partielles propres.
3. Vérifier Chromium/WebKit, captures clair/sombre 320–1440 px, texte 200 %, axe et budgets du guide. Lancer en série lint, types, tests, build, UI, secrets, audit. Faire relire le diff et les pixels par un contexte Codex gpt-6.2-astra / ultra distinct. Livraison source puis main par le parent.

Le périmètre comprend la route, ses tests, cette fiche et la [validation](../../docs/validation/TASK-0129.md). Checkout propre, sorties locales et réseau loopback privés à 0129. Budget inconnu ; après deux échecs identiques changer d’hypothèse. Aucune permission, instrumentation, dépendance ou migration à ajouter. Rollback par revert ciblé du lot.

Première proposition présentée le 18 novembre 2026 à 15:43:40 UTC, 20 scénarios HistoVec réussis. Qualification et livraison documentées par la validation et le checkpoint de PR.
