# TASK-0143 — Validation hors réseau de 500 cartes automobiles synthétiques

24 novembre 2026. Demande : exécuter le test sur un jeu de données autorisé après le signal CAPTCHA reproductible.

## Périmètre
- 500 annonces **fictives**, déterministes, générées localement ; aucun véhicule réellement en vente, pas de coordonnées, pas de collecte externe, pas d'import ni de republication.
- Réutiliser le parseur de la PR #276 avec les règles d'arrêt inchangées. Une campagne simulée de pages de 40 cartes, avec chevauchement, vérifie plafonnement, dédoublonnage et identifiants.
- Vérifier individuellement les 4 champs réellement normalisés, plutôt que la seule présence de mots-clés. Comparer à la vérité terrain des fixtures : titre, prix, millésime et kilométrage. Comptabiliser les erreurs par champ et format, sans substituer une valeur manquante.
- Scénarios de qualité : format usuel, séparateurs Unicode, mensualité, prix uniquement préfixé par « Prix: », titre court, annonce avec prix ou titre manquant, ID répété, et réponse de vérification.
- Ne pas confondre 500 fixtures et 500 annonces live. Les résultats antérieurs sont 271 cartes estimées sur 8 pages exploitables, puis réponse suspecte ; deux diagnostics ont renvoyé 278 caractères identiques contenant « captcha » sans annonce.
- Tous les appels de récupération sont simulés. Bloquer explicitement l'accès réseau Python dans le test. Aucun changement de mécanisme d'accès ou de règle anti-bot, aucune relance de Jina sur le site.
- Produire une synthèse JSON, tests unitaires, PR brouillon, aucune fusion automatique. Si des défauts de lecture sont trouvés, les rapporter distinctement de l'accès Jina.
- Préparer une demande de diagnostic au support Jina sur la réponse anormale ; ne pas envoyer de message ni ouvrir d'issue externe sans autorisation distincte. Ne demander aucun contournement.

## Critères
Les 500 cartes de référence sont toutes testées. Le seuil de réussite du parseur ne peut être établi qu'après comparaison aux données attendues. Vérifier les sorties sans PII et les arrêts simulés sur 403/429, signal CAPTCHA et timeout. Un job CI vert n'implique pas 500 annonces correctes.
