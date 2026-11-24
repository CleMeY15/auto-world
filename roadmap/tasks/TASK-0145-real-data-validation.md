# TASK-0145 — Validation sur données réelles avec registre des erreurs

24 novembre 2026. Demande : « Go faire un vrai test maintenant et bien documenté les potentiels erreur ou non aboutissement ».

## État de départ
- PR #279, run 45359318416 : 500/500 fixtures fictives exactes, 22 tests unitaires, arrêt sur signal anti-bot conservé.
- Run 45259765450 : 271 cartes estimées en 8 pages exploitables Jina, arrêt à la 9e requête. Deux contrôles (45341128165 et 45341849651) ont rendu le même texte de 278 caractères, contenant « captcha », zéro annonce. Aucun nouveau balayage Jina/Leboncoin.
- Contrôle en direct du 24 novembre via le connecteur officiel Leboncoin : 100 résultats affichés, 811 129 annoncés au total, 491 004 professionnels, 320 125 particuliers. Le résultat machine disponible ne contient que les métriques de recherche et un curseur, pas les champs de chaque voiture. Ne pas comptabiliser ces 100 résultats comme des extractions Jina ou les exporter.

## Test reproductible
- Un téléchargement public via l'API officielle Kaggle du jeu « 100,000 UK Used Car Data set » (Aditya, CC0 selon la fiche, données historiques, pas des annonces actives françaises). Source : https://www.kaggle.com/datasets/adityadesai13/used-car-dataset-ford-and-mercedes ; accès public annoncé par Kaggle : https://www.kaggle.com/product-announcements/485439.
- Maximum 500 lignes sources pour le test, sélection déterministe répartie entre 9 marques. Aucun nom de vendeur, coordonnées, VIN, photo ou URL d'annonce source dans la sortie.
- Reconstruire des cartes de test Markdown à partir des valeurs réelles publiées. Titre reconstruit marque + modèle ; année d'origine ; prix GBP converti en EUR avec un facteur **de test fixe 1,15**, sans prétendre à un prix de marché actuel ; miles convertis en km à 1,609344 ; arrondi entier. ID technique artificiel, non lié à une annonce réelle. URLs de forme attendue par le parseur uniquement en mémoire, jamais interrogées.
- Vérifier la fidélité de chaque champ, les rejets et les éventuelles associations fausses sur cartes adjacentes, 5 formats, dédoublonnage dans des pages de 40 cartes (recouvrement 5).
- Journaliser séparément : accès à la source, code HTTP/timeout, format/schema/ZIP, échantillon, champs invalides, erreur parseur, divergence par champ, IDs absents, doublons, arrêt, critères non évalués. Rapport agrégé et détails d'erreurs par numéro d'échantillon, sans données sources brutes.
- Échec explicite du workflow si téléchargement impossible ou si le seuil de qualité n'est pas atteint. Écrire le rapport même en cas d'échec. Aucune relance après refus. Aucun changement aux règles d'arrêt, aucune demande au site Leboncoin et aucune importation dans PostgreSQL.
- Conclusion séparée : validation de données réelles historiques reformatées ≠ capture directe du Markdown Jina ≠ accès autorisé aux annonces live. Les 100 résultats du connecteur ne s'ajoutent pas aux 500 lignes du benchmark.

## Livrables
Script, rapport JSON en artefact, registre des erreurs et PR brouillon. Dépendance non résolue : obtenir un flux contractuellement autorisé avec les champs exploitables, ou des captures de pages que l'utilisateur est autorisé à fournir. Ne pas transformer le test en contournement de vérification.
