# TASK-0152 — Revenir à la page précédente du catalogue membre

## Brief avant réalisation

P1, en réalisation. Base intégrée 59755cd2, branche t3/member-search-previous-page. Dépendance acceptée sur fixtures dans le [checkpoint final de PR297](https://github.com/CleMeY15/auto-world/pull/297). La recette hébergée suit une voie distincte. Exécutant web Codex gpt-6.2-astra / ultra dans son checkout isolé. Le coordinateur porte la revue indépendante et la livraison. Budget inconnu, réévaluation après deux échecs identiques.

Depuis les résultats, avancer deux fois, ouvrir une fiche, revenir aux résultats puis reculer jusqu’au départ avec les mêmes critères, ordre et taille de page. Les contrôles HTML restent utilisables au clavier. Une page vide après déplacement conserve les issues connues. Un lien direct ancien offre le retour au début. La recherche, le tri et les filtres repartent au début. Conserver les états de chargement, d’indisponibilité et de reprise du catalogue.

## Contrat web et plan

1. Étendre uniquement les URL web du catalogue (liste, fiche et favoris). Le paramètre facultatif `trail` contient les huit derniers points de départ suivis au maximum, du plus ancien au plus récent, séparés par des virgules. `first` désigne le début et ne peut figurer qu’en tête. Les autres entrées respectent le format de curseur du tri existant. Rejeter les listes invalides ou répétées. Le premier lien reste disponible au-delà de la profondeur retenue.
2. Construire les destinations sous /catalogue à partir de la fenêtre validée, sans URL imbriquée, données de fiche ou écriture dans le navigateur. Seul le curseur actif atteint le lecteur [ADR-0037](../../docs/decisions/ADR-0037-private-postgres-catalog.md). Conserver les protections de session [ADR-0038](../../docs/decisions/ADR-0038-private-catalogue-favorites.md).
3. Tester la borne, les entrées hostiles et les anciens liens en unité, puis les parcours 1→2→3→2→1, fiche, changement de critères, page vide et contrôles natifs sur fixtures. Examiner les captures 390 et 1280 px, axe, focus, CLS et LCP. Exécuter en série les contrôles du dépôt et le build privé avec sa matrice navigateur.
4. Consigner les résultats et limites pour le coordinateur. Retour arrière par restauration de la version web précédente, sans migration. Les anciens liens avec trail peuvent être rouverts en supprimant ce paramètre.
