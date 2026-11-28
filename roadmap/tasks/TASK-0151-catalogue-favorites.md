# TASK-0151 — Favoris du catalogue membre

P1 · acceptée sur main (fixtures) · propriétaire : développement web, revue indépendante produit et confidentialité.

TASK-0151 est acceptée sur fixtures sur main `59755cd2967801ac8e86600044d8252b48a99a52`, arbre identique à la source relue `b5c45ba7`. Les quatre workflows du push (cinq jobs) passent au premier essai, dont 706 parcours navigateur réussis, dix exclusions existantes et dix phases persistantes sur dix. La recette hébergée reste en attente. [Acceptation finale de PR297](https://github.com/CleMeY15/auto-world/pull/297)

## Prêt à réaliser

La feuille de route P1 relie recherche, fiche et favoris, puis prévoit le Garage. Le catalogue et son lecteur sont intégrés sur main (ADR-0037, PR294 à PR296, base 815934c0). Les parcours fictifs de TASK-0124 et TASK-0126 sont déjà intégrés (PR235 et PR256). La tâche dépend de ces contrats de code, la recette en service a son propre statut.

## Parcours et critères

Depuis une recherche filtrée ou une fiche, ajouter ou retirer une annonce avec retour immédiat. Ouvrir Favoris, relire les références par le lecteur courant, ouvrir une fiche et retrouver les critères, le tri et le curseur. Retirer aussi une référence devenue indisponible sans afficher son identifiant. Limiter la collection à 12 références dans l’onglet et la session connectée. Expliquer la durée de conservation. Distinguer chargement, collection vide, lecture partielle, panne transitoire et échec du stockage. Conserver les données illisibles sans les écraser.

## Contrats, validation et reprise

ADR-0037, décision de portée de session ADR-0038, PRODUCT_UX, DESIGN, DoD et runbook du catalogue. Vérifier sur fixtures les frontières anonyme/membre, la rotation de session, la révocation entre deux visites, le stockage défaillant et les retours. Examiner les pixels mobile et bureau dans Chromium et WebKit, le clavier, axe, les cibles de 44 px et les mesures LCP/CLS. Exécuter les gates du dépôt en série. Revenir à la révision précédente du produit, du frontal et de la passerelle ensemble. Aucune migration de base. Revue indépendante et acceptations source/main requises avant clôture.

## Passation

[Validation locale, reprises et captures](../../docs/validation/TASK-0151.md) · [PR297](https://github.com/CleMeY15/auto-world/pull/297). Source et main acceptés sur fixtures. Recette hébergée en attente.
