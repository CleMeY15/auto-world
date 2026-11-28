# TASK-0151 — Favoris du catalogue membre

P1 · en réalisation · propriétaire : développement web, revue indépendante produit et confidentialité.

## Prêt à réaliser

La feuille de route P1 relie recherche, fiche et favoris, puis prévoit le Garage. Le catalogue et son lecteur sont intégrés sur main (ADR-0037, PR294 à PR296, base 815934c0). Les parcours fictifs de TASK-0124 et TASK-0126 sont déjà intégrés (PR235 et PR256). La tâche dépend de ces contrats de code, la recette en service a son propre statut.

## Parcours et critères

Depuis une recherche filtrée ou une fiche, ajouter ou retirer une annonce avec retour immédiat. Ouvrir Favoris, relire les références par le lecteur courant, ouvrir une fiche et retrouver les critères, le tri et le curseur. Retirer aussi une référence devenue indisponible sans afficher son identifiant. Limiter la collection à 12 références dans l’onglet et la session connectée. Expliquer la durée de conservation. Distinguer chargement, collection vide, lecture partielle, panne transitoire et échec du stockage. Conserver les données illisibles sans les écraser.

## Contrats, validation et reprise

ADR-0037, décision de portée de session ADR-0038, PRODUCT_UX, DESIGN, DoD et runbook du catalogue. Vérifier sur fixtures les frontières anonyme/membre, la rotation de session, la révocation entre deux visites, le stockage défaillant et les retours. Examiner les pixels mobile et bureau dans Chromium et WebKit, le clavier, axe, les cibles de 44 px et les mesures LCP/CLS. Exécuter les gates du dépôt en série. Revenir à la révision précédente du produit, du frontal et de la passerelle ensemble. Aucune migration de base. Revue indépendante et acceptations source/main requises avant clôture.
