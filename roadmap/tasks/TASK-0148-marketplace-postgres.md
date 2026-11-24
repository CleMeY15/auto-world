# TASK-0148 — Essai PostgreSQL de 2 000 annonces

**Demande.** Importer un lot privé de 2 000 annonces Le Parking pour vérifier AutoFindex. Le 24 novembre 2026, le demandeur a déclaré détenir l’accord écrit d’ADS4ALL pour cette opération. Le fichier de l’accord n’a pas été reproduit dans le dépôt.

**Périmètre.** Uniquement le test demandé. Les lignes portent l’identifiant de publication, le lien de provenance, un titre, le prix et sa devise, le kilométrage et son unité, ainsi que l’année. Les offres ne sont pas exposées dans le catalogue public. Le schéma PostgreSQL de test est dédié. Les contenus collectés et l’archive destinée à PostgreSQL restent privés.

**Critères de réussite.** Vérifier séparément l’acquisition réelle, les identifiants uniques, la complétude des champs, la première écriture, le rejeu sans duplication et la relecture après COMMIT. Nommer la base effectivement utilisée. En cas de refus HTTP ou de lot incomplet, documenter le point d’arrêt et le nombre réel validé. Deux contrôles indépendants de la source réelle testent le chemin SQL avec les données historiques ouvertes d’un jeu britannique et des cartes HTML synthétiques.
