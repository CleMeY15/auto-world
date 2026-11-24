# Lire les pages de résultats de Leboncoin et du Parking

**Mesures du 24 novembre 2026, heure de Paris.** Sur Le Parking, le HTML a livré 26 annonces complètes pour une page. Sur Leboncoin, la recherche officielle a accepté cinq pages de 100 résultats, mais n’a transmis aucune ligne individuelle au traitement. La cible de 500 annonces réelles distinctes et complètes par source reste ouverte.

| Source et mode | Périmètre réellement lu | Identités vérifiables | Titres, prix, années et km réunis |
| --- | --- | ---: | ---: |
| Leboncoin, application officielle de recherche | 5 × 100 résultats annoncés | Indéterminées | 0 ligne transmise |
| Le Parking, HTML de la recherche Renault Clio | 27 apparitions | 26 | 26 |
| Le Parking, Markdown Jina de la même recherche | 27 apparitions | 26 | 3 |
| Leboncoin, rejeu de trois fiches historiques dans une liste reconstruite | 3 cartes | 3 | 3 exactes |
| Leboncoin, référence synthétique du lecteur | 570 apparitions | 500 | 500 exactes |

Les 64 tests ciblés passent en local. Ils couvrent les deux lecteurs du Parking, les régressions du lecteur Leboncoin et le programme qui compte les annonces sur plusieurs pages. [Mesures au format JSON](../../connectors/leboncoin-spike/evidence/marketplace-pages-2026-11-24.json)

Une identité correspond à un identifiant de publication sur la source. Ces mesures ne vérifient ni le VIN, ni la présence du véhicule chez le vendeur. Les documents bruts et les lignes de véhicules du test du jour ne sont pas publiés.

## Leboncoin

Le test de recherche a porté sur les voitures en France entière, sans filtre supplémentaire, triées par date décroissante. Les cinq appels ont utilisé successivement le curseur natif, sans ouverture de fiche. Les réponses ont annoncé respectivement 100, 100, 100, 100 et 100 résultats. Cinq curseurs distincts, cinq indications de page suivante, aucune vérification présentée. Les totaux déclarés étaient 811 043, 811 043, 811 042, 811 041 et 811 042. Le retour exploitable comprenait les compteurs, le curseur et un résumé. Il ne contenait ni tableau d’annonces ni liens ou champs individuels. Impossible de mesurer la déduplication ou de vérifier un prix sur ce retour.

Le benchmark Jina antérieur avait trouvé 320 cartes candidates, dont 310 avec quatre champs sur huit pages exploitables, pour 271 distinctes estimées par lien ou empreinte. La neuvième requête avait arrêté le test. Lors du diagnostic ultérieur, la réponse HTTP 200 contenait 278 caractères et une occurrence de « captcha », zéro lien de véhicule et aucun formulaire ni iframe. Le corps de l’incident initial n’a pas été conservé. Le mécanisme exact reste inconnu. Aucun nouvel essai Jina Leboncoin dans la présente campagne. [Exécution des pages de résultats](https://github.com/CleMeY15/auto-world/actions/runs/45259765450) · [Diagnostic de la page 9](https://github.com/CleMeY15/auto-world/actions/runs/45341849651)

Le lecteur produit des lignes lorsqu’un identifiant Leboncoin apparaît dans le lien du titre et que les champs appartiennent à la même carte. Un titre sans lien entre deux cartes pouvait faire attribuer le prix de la suivante à la précédente. Le correctif écarte ce cas et les montants ambigus. Le mode historique de comptage reste disponible. Le rejeu des trois observations authentiques a utilisé des valeurs de fiches du 22 novembre et un balisage de liste reconstruit. Les anciennes sorties Jina examinées conservent des compteurs et des empreintes. Elles ne permettent pas de rejouer la liste originale. [Observations enregistrées](../../connectors/leboncoin-spike/evidence/normalized-sample.json)

L’article 10.2 des conditions de Leboncoin exige son autorisation expresse et préalable pour la récupération ou l’indexation par robot. L’application officielle permet la recherche conversationnelle. La multidiffusion professionnelle publiée par Leboncoin sert aux professionnels qui envoient leur stock sur la plateforme. Aucun flux de lecture du catalogue global concédé à AutoFindex n’a été établi. Un accès de lecture couvrant les champs et leur usage serait nécessaire pour qualifier la collecte autonome demandée. [Conditions](https://www.leboncoin.fr/dc/cgu) · [Diffusion automobile](https://leboncoinsolutionspro.fr/automobile/solutions-de-diffusion-dannonces/)

## Le Parking

Deux consultations de la même URL, l’une en HTML ordinaire, l’autre par Jina Reader. Aucune fiche, redirection d’annonce ni page suivante ouverte. Le complément de contrôle visuel public a servi à vérifier la disposition du prix demandé, de l’ancien prix et des mensualités. Les deux documents ont été contrôlés séparément. [Page Renault Clio](https://www.leparking.fr/voiture-occasion/renault-clio.html)

| Mesure | HTML direct | Markdown Jina |
| --- | ---: | ---: |
| Statut HTTP | 200 | 200 |
| Taille du corps en octets | 478 416 | 30 382 |
| Cartes / identifiants distincts | 27 / 26 | 27 / 26 |
| Identifiants avec titre, année et kilométrage | 26 | 26 |
| Identifiants avec prix de vente | 26 | 3 |
| Liens de fiche directs / liens de redirection Le Parking retenus | 26 / 0 | 15 / 11 |
| Conflits de champs dans un même document | 0 | 0 |

Un contrôle indépendant des blocs HTML avec XPath a retrouvé à l’identique titre, prix, année et kilomètres des 26 lignes. Les deux réponses ont 25 identifiants en commun. La carte sponsorisée a changé entre les lectures. Pour ces 25 identifiants, les années et les kilométrages coïncident dans 25 cas sur 25. Les trois prix lisibles dans Jina coïncident tous avec le HTML. Les abonnements en pied de page et les montants de financement ont été exclus. Une des 26 cartes Jina donne son libellé seulement dans le texte alternatif de l’image liée.

Les prix manquant dans le Markdown n’ont pas été complétés à partir de l’autre lecture. Les deux résultats correspondent chacun à leur document. Cette seule recherche ne mesure ni la fraîcheur du catalogue complet ni la stabilité de sa pagination. La réponse Markdown ne fournissait pas d’URL suivante exploitable. La lecture du fichier robots.txt a répondu HTTP 403. L’ouverture de l’URL Jina imbriquée dans le lecteur web a d’abord signalé une URL inaccessible. Une requête HTTP normale à l’adresse documentée de Jina a ensuite renvoyé le texte dont l’empreinte figure ci-dessous. Le Parking présente une offre professionnelle et un formulaire de demande de test. Aucun accès d’export d’annonces réutilisable par AutoFindex n’a été établi avec cette expérimentation. [Le Parking Data](https://pro.leparking.fr/) · [Jina Reader](https://jina.ai/reader/)

| Corps | SHA-256 |
| --- | --- |
| HTML | `31d045359bad01af0097ff3556b4be153ea6a43f0646eeba2644b096c637e573` |
| Jina Markdown | `ee9085b9b7ce0f0ed9f369211c2828a88465bd089fb9d8856a7205bec186aee4` |

## Reproduire le traitement sur des pages enregistrées

Depuis la racine du dépôt, avec Python 3.12 et sa bibliothèque standard, utiliser des documents locaux dont la réutilisation est permise. Chaque commande indique les identifiants distincts, les observations répétées et les champs manquants. Avec `--rows`, la sortie comprend aussi les lignes complètes.

```sh
cd connectors/leboncoin-spike
python marketplace_pages.py leparking-html recherche.html --rows
python marketplace_pages.py leparking-md recherche-jina.md
python marketplace_pages.py leboncoin-md liste-01.md liste-02.md --target 500
python -m unittest -q jina_list_benchmark_test leboncoin_saved_rows_test test_leparking_html test_leparking_page test_marketplace_pages
```

Pour Leboncoin, le champ `distinct_identified` concerne les seules cartes acceptées avec identifiant vérifié. Les candidats rejetés sont ventilés par motif, et le nombre d’identifiants distincts parmi les cartes partielles reste inconnu.

Un code de sortie 1 indique que la cible demandée n’est pas atteinte. Un code 2 signale entre autres un fichier illisible, un document non reconnu ou un obstacle à la vérification. Les conflits pour un même identifiant sont exclus du total complet. Des observations partielles complémentaires ne sont jamais assemblées pour former une ligne complète. Un même véhicule publié plusieurs fois sous des identifiants différents peut compter plusieurs fois. Aucun stockage, déploiement ou rafraîchissement périodique n’est activé.
