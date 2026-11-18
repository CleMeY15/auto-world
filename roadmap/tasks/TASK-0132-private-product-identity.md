# TASK-0132 — Identité AutoFind après connexion

Demande du propriétaire, 18 novembre 2026. Responsable produit Codex gpt-6.2-astra / ultra, réalisation en contextes distincts et revue indépendante. Branche `product/autofind-private-product`, fondée sur l’accueil et la connexion de PR262. La révision d’intégration locale `ba7736d9` inclut aussi la navigation de PR256 et les rapports de PR260. La livraison sur main suit celle des branches parentes.

Parcours à présenter : se connecter, lancer une recherche, parcourir les résultats, consulter une annonce puis son rapport et retrouver sa recherche. Les listes, comparaisons, guides et l’aperçu privé doivent également reprendre la marque. Conserver la distinction entre illustration de marque et publication fictive, le choix d’apparence, le nom accessible des commandes, les favoris et la provenance des rapports.

La recette privilégie de vraies captures à 390 et 1440 px, un contrôle de débordement à 320 px et texte agrandi, le focus clavier, le contraste et les états vide, chargement et erreur. Vérifier le système de design et le web avec les contrôles existants, puis le parcours sur Chromium/WebKit. Les données synthétiques et la session existante suivent ADR-0028 et ADR-0035. Retour arrière par revert du changement d’interface, sans migration.
