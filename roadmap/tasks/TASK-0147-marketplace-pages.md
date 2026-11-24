# TASK-0147 — Résultats de recherche Leboncoin et Le Parking

24 novembre 2026. Expérimentation isolée, dans la continuité de TASK-0145. Responsable et intégration par Codex, lectures des deux sources et contrôle indépendant du HTML dans des contextes distincts. La collecte régulière reste ouverte.

**Objectif.** Mesurer ce qu’AutoFindex peut obtenir d’une page de résultats et restituer les annonces complètes dont on peut établir l’identité. Une annonce complète réunit sur la même carte un titre, un prix de vente en euros, une année, un kilométrage et un identifiant associé à un lien de la source.

**Critères.** Comptabiliser séparément les résultats annoncés, les identifiants observés, les répétitions, les champs manquants et les conflits. Comparer HTML et Markdown de la même recherche Le Parking. Préserver le comportement agrégé du benchmark Leboncoin. Signaler explicitement l’issue de l’objectif de 500 annonces réelles.

**Validation et limites.** Tests hors réseau sur les cas ambigus et sur la compatibilité ascendante, comparaison indépendante aux cartes HTML et contrôle des recouvrements avec Jina. Les usages en production restent soumis au registre des sources et aux accords applicables. Les lecteurs fonctionnent sur des documents locaux et n’écrivent pas dans le catalogue.

[Mesures, erreurs, reproduction et conditions de passage en exploitation](../../docs/validation/TASK-0147-marketplace-pages.md)
