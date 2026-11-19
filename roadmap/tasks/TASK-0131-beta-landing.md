# TASK-0131 — Accueil avant la bêta privée

Responsable produit Codex gpt-6.2-astra / ultra. Demande du propriétaire du 18 novembre 2026. Dépend de TASK-0130 (PR261) pour l’accès privé. Branche empilée, préparée en local sous ADR-0035. L’activation sur le domaine suit le runbook de TASK-0130.

Un visiteur anonyme arrive sur une scène automobile animée à la racine du domaine, lit le délai indicatif et peut se connecter pour auditer le produit. Les accès directs aux annonces, rapports, API et assets produit conservent leur contrôle de session. La date cible fixe du 13 janvier 2027 à midi à Paris correspond à huit semaines de préparation de la bêta privée synthétique : intégration et mise en ligne privée, audit utilisateur, corrections et marge. Disponibilité de vraies sources hors estimation. Aucun déblocage automatisé à l’échéance.

Recette ciblée : mobile/bureau, login et retour profond, réduction du mouvement, clavier, sans JavaScript, échéance et absence de débordement. Revue indépendante de la frontière publique. Retour arrière par revert du lot sans migration.
