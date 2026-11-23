# TASK-0140 — Test Jina sur les pages de résultats plutôt que sur les fiches individuelles

23 novembre 2026 — Demande : obtenir jusqu'à 500 annonces automobiles avec beaucoup moins de requêtes, en lisant d'abord les résultats de recherche Leboncoin.

## Baseline
Run Jina 500 URL (45242287040) : **196 appels, 195 HTTP 200, 131 pages à 4 indices, 7 partielles, 57 sans indices, 1 TimeoutError à 35s**, arrêt normal par règle de sécurité. Pas de refus explicite 403/429 ; 500 non atteintes. Les quatre indices ne prouvent pas la qualité de l'annonce principale.

## Hypothèse
Le résultat public `https://www.leboncoin.fr/recherche?category=2&page=N` présente de nombreuses cartes, chacune contenant titre, prix, millésime et kilométrage. Lecteur Jina Reader `r.jina.ai` (sans clé) sur **la page de résultats**, et non sur chaque annonce. Si des URL individuelles sont bien présentes, les distinguer des empreintes heuristiques sans liens.

## Essai borné
- Une seule campagne, **500 cartes distinctes maximum**, par empreinte (titre, prix, année, kilométrage) ou ID public si lien sans ambiguïté ; **pas** 500 fiches détaillées.
- Au plus 40 pages de recherches publiques, même catégorie `category=2` paginée `page=1...40`, délai **12 s minimum** entre appels Jina, concurrence 1, délai de travail de 60 minutes.
- Lecture non connectée, pas de cookie/token personnel, proxy rotatif, captcha, changement d'identité ou contournement. Interruption immédiate sur 403/429, contrôle bloquant, anomalie technique majeure, pages répétées ou absence répétée de cartes.
- Les erreurs 5xx sont comptées ; interruption au plus tard après trois erreurs totales ; pas de réessai d'un échec. Le timeout est classé distinctement des refus.
- Mesurer le nombre de requêtes, codes de statut, pages avec cartes, nombre de cartes brutes, distinctes, doublons, complétude des 4 champs par **carte** (jamais à partir de la page entière), nombre de liens URL exploitables, nouveautés par page, durée, arrêt et avertissements de biais.
- À défaut d'ID/lien fiable, le compteur `distinct_cards` est un **estimateur par empreinte**, pas des annonces vérifiées : signaler la limite.
- Sauvegarder uniquement le rapport JSON des agrégats avec empreintes sans texte/coordonnées/images/prix individuels. Pas d'import dans AutoFindex ou PostgreSQL, pas de republication, `source_access_approved=false`.
- Workflow GitHub Actions de type one-shot sur commit de workflow, secrets non transmis, droits GitHub contents:read ; PR brouillon, pas de fusion.

## Verdict attendu
Confirmer ou infirmer que les pages de résultats permettent 500 cartes distinctes avec **beaucoup moins que 500 appels** et si elles incluent les URL d'annonces. Le succès du job CI ne vaut pas réussite de la lecture. Fin automatique après une exécution.
