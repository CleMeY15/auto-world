# TASK-0127 — Accès à la recherche depuis l’accueil

## Definition of Ready · 18 novembre 2026

LOCAL_VALIDATED / DELIVERY_PENDING · parcours produit V1, pilote 2/6. L’utilisateur autorise ce lot indépendant de PR256 sur main 5d0599cdeb3589b0c2ab0e42778769c9ad771b32. La recherche synthétique et la prévisualisation sont présentes sur cette base ([contrat web](../../apps/web/README.md), [checkpoint produit](https://github.com/CleMeY15/auto-world/pull/235#issuecomment-6745769896)). Le parent possède sélection globale, fichiers communs, fusion et vérification main.

Responsable et exécutant du lot : Codex gpt-6.2-astra / ultra, branche product/task-0127-home-search, checkout T3 réservé. Revue fonctionnelle et visuelle par Codex distinct de même modèle/effort. Risque local : publier le mauvais lien si le mode est lu au build, déclencher une recherche avant l’action ou repousser l’exemple hors du petit écran. Réutiliser le résolveur serveur de /demo, le style et la navigation natifs. Aucun changement au contrôleur, aux guides, aux services ou au stockage.

| Parcours / critère | Contrôle |
| --- | --- |
| Depuis /, ouvrir /demo par un lien explicite en mode actif | Même build démarré dans les deux modes, navigation clavier et destination réelle |
| Mode désactivé : accueil et guides utilisables, aucun accès proposé | HTML réel des deux instances, liens et divulgation, prévisualisation interactive |
| Action visible et stable sans accès réseau anticipé à la démo | Pixels téléphone/bureau, petit écran, texte agrandi, axe, test des requêtes, budgets mobiles existants |

Plan : figer le brief puis poser le lien et les régressions, inspecter les premiers pixels, figer la source puis exécuter les gates et soumettre les originaux en revue. [Validation](../../docs/validation/TASK-0127.md). [DoD](../../docs/DEFINITION_OF_DONE.md), [UX](../../docs/PRODUCT_UX.md), [ADR-0028](../../docs/decisions/ADR-0028-v1-prototype-functional-gate.md). Ressources propres, loopback privé 3107/3110/3210, un gate à la fois. Budget inconnu, changer d’hypothèse après deux échecs identiques. Rollback par revert ciblé. Aucune migration ou collecte. Les états de chargement, panne API et résultats restent sous la responsabilité de /demo après navigation.
