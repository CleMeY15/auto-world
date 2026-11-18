# TASK-0126 — Parcourir les annonces déjà chargées

IN_PROGRESS, P1, prototype synthétique ADR-0028. Responsable et exécutant Codex gpt-6.2-astra / ultra, revue fonctionnelle et visuelle indépendante au même réglage. Branche codex/task-0126-listing-navigation sur origin/main 5d0599cd. Première entrée du pilote. Le tri est accepté par [PR235](https://github.com/CleMeY15/auto-world/pull/235#issuecomment-6745769896), le processus par le corps de [PR243](https://github.com/CleMeY15/auto-world/pull/243). Le registre s'arrête à 0125. Aucun chantier produit concurrent dans les PR ouvertes.

## Parcours et critères

Depuis une carte des résultats, ouvrir une fiche puis parcourir dans les deux sens les publications déjà chargées, dans leur ordre accepté, y compris les pages ajoutées. Afficher la position, respecter les bornes sans boucler ni paginer. Une seule publication ou une arrivée indépendante n'offre aucun voisin. Revenir aux résultats conserve critères, tri, pages et focus sur la carte consultée. Réutiliser le détail autoritaire, les états de chargement, erreur, retry, offline et la protection contre les réponses obsolètes. Préserver les liens directs, favoris et historique du navigateur.

## Plan et contrôles

1. Relier le contexte de parcours à l'entrée depuis les résultats et réutiliser le cycle de lecture du détail et les boutons partagés. Risque local de confusion entre liens autonomes et navigation contextuelle.
2. Vérifier fonctionnellement ordre, bornes, erreurs, clavier, focus et conservation du contexte. Inspecter captures mobile/bureau, texte agrandi, contraste, cibles et budgets existants selon PRODUCT_UX.
3. Figer la révision puis exécuter en série pnpm lint, typecheck, test, build, test:ui, secrets:check et run audit:dependencies. Revue indépendante en lecture seule puis gates qualité et parcours persistant sur source et main. Voir [validation](../../docs/validation/TASK-0126.md).

Checkout et ports Playwright dédiés à l'exécution série. Spécialiste tests limité au nouveau spec, auteur responsable du composant et du dossier. Budget inconnu, réévaluation après deux échecs identiques. Aucun nouveau stockage, backend, endpoint ou contrat. Événement detail_opened existant ; revert du changement UI et de sa couverture pour rollback.
