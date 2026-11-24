# mobile.de et AutoScout24 dans AutoFindex

Essai du 24 novembre 2026. La base privée du projet contient 317 annonces Le Parking dont les cartes citent mobile.de ou AutoScout24. Les listes de résultats des deux API professionnelles restent à tester avec des accès de recherche délivrés au projet.

## Mesures sur la base du projet

Sur les 91 pages HTML de l’essai Le Parking précédent, le lecteur vérifie l’empreinte de chaque page, le lot importé et le libellé de plateforme effectivement affiché. Il exige le même identifiant Le Parking sur le lien du libellé et le titre de la carte, ainsi que le même titre, prix en euros, kilométrage et année que la ligne conservée. Il traite chaque carte délimitée séparément, y compris lorsque le HTML comporte des cartes imbriquées.

| Vérification dans `autoworld.aw_marketplace_trial.listings` | Résultat |
|---|---:|
| Lot Le Parking d’origine | 2 000 |
| Annonces dont la carte cite mobile.de | 12 |
| Annonces dont la carte cite AutoScout24, toutes éditions observées | 308 |
| Dont mentions d’autoscout24.fr | 246 |
| Annonces dont la carte cite les deux plateformes | 3 |
| Annonces distinctes dans l’union | 317 |
| Identifiants du rapprochement absents de la table | 0 |

L’attribution n’ajoute aucune annonce et ne donne aucun identifiant natif des deux plateformes. Plusieurs éditions nationales peuvent être affichées pour une seule annonce AutoScout24. Les 317 identifiants restent ceux du Parking. Les compteurs ont été vérifiés sur le PostgreSQL privé du projet dans une transaction en lecture seule. La requête privée livrée au demandeur rend les compteurs, puis les 317 lignes avec le titre, le prix, l’année, le kilométrage, le lien Le Parking et les plateformes affichées. La sortie détaillée a été testée sur la restauration du même lot.

Deux fiches publiques Le Parking de cet échantillon, une par plateforme, ont aussi répondu HTTP 200. Les balises de lien ne donnaient pas de lien individuel natif vers la plateforme nommée. Les liens de redirection du Parking n’ont pas été suivis.

[Reçu chiffré de cet essai](TASK-0149-marketplace-search.json) · [Essai Le Parking d’origine](TASK-0148-marketplace-postgres.md) · [Lecteur des mentions de plateforme](../../connectors/leboncoin-spike/parking_origin_labels.py)

## Accès direct aux éditeurs

| Contrôle | Résultat observé |
|---|---|
| mobile.de, recherche réelle limitée à une voiture d’occasion allemande | HTTP 401 avec demande d’authentification Basic. Aucune annonce reçue. |
| mobile.de, référentiel des marques automobiles | HTTP 200, 187 marques renvoyées. |
| mobile.de, exemple XML officiel de recherche | Une annonce d’exemple lue. Le champ `modelDescription` donne le titre, `consumerPriceGross` le prix consommateur. L’identifiant doit correspondre au lien individuel. |
| AutoScout24, produit européen SEARCH API | L’éditeur décrit une API GraphQL de recherche, filtrage et consultation. L’URL d’exécution, l’opération, la couverture et les accès attribués au projet restent à fournir. Aucun appel au stock de cette API. |
| AutoScout24, ressources documentaires de la Listing Creation API concessionnaire | HTTP 200 sur le référentiel et sur une fiche d’exemple inactive. Prix, année, kilomètres et identifiant/lien ont été vérifiés, le titre reconstitué à partir du référentiel. L’endpoint clients a répondu HTTP 401 sans authentification. |

En complément, un contrôle ponctuel de fiches individuelles indexées a retrouvé deux annonces complètes par plateforme. Les fiches consultées dans l’index ne sont pas des réponses du connecteur. Deux liens candidats AutoScout24 ont été exclus, l’un menait à une liste et l’autre répondait HTTP 410 dans le lecteur. L’URL d’une ancienne annonce peut donc rester indexée après le retrait de sa fiche.

[mobile.de Search API](https://services.mobile.de/docs/search-api.html) · [Types de comptes mobile.de](https://services.mobile.de/manual/index.html) · [AutoScout24 SEARCH API](https://www.autoscout24.de/haendlerportal/schnittstelle-search-api/) · [Intégrations professionnelles AutoScout24 France](https://www.autoscout24.fr/partner-infoportal/schnittstellen/) · [Exemple concessionnaire](https://listing-creation.api.autoscout24.com/docs#/examples)

## Exécuter les lecteurs

Les utilitaires se trouvent dans `connectors/marketplace-search`. Leurs modes de recherche directe effectuent un appel borné de lecture. Le lot Le Parking, les données d’exemple et les résultats de recherche en production ont des provenances distinctes.

- Pour **mobile.de** dans la sandbox, fournir les secrets `MOBILE_DE_SANDBOX_USERNAME` et `MOBILE_DE_SANDBOX_PASSWORD`. En production, utiliser `MOBILE_DE_API_USERNAME` et `MOBILE_DE_API_PASSWORD`. L’accès API doit inclure la recherche sur le stock prévu. Un compte concessionnaire ordinaire donne accès à son propre stock.
- Pour **AutoScout24**, utiliser l’URL, la requête GraphQL nommée, les chemins de données et le mode d’authentification transmis par l’éditeur. Les paramètres de configuration sont expliqués dans le [guide de l’adaptateur](../../connectors/marketplace-search/autoscout-partner.md). Le secret se configure dans `AUTOSCOUT24_SEARCH_AUTHORIZATION`.

```sh
cd connectors/marketplace-search
python -m unittest discover -v
python mobile_de_search.py --sandbox --country DE --limit 3
python autoscout_partner.py --contract /chemin/prive/contrat.json --limit 3
```

L’option `--output` crée, sur demande, un nouveau fichier JSON privé des lignes acceptées. Les identifiants de connexion restent dans l’environnement. Les outils n’écrivent pas dans le catalogue public.

## Activer un premier essai natif

**mobile.de.** Le support indique **service@team.mobile.de** pour un compte de test. Préciser que le projet recherche un compte API avec Search API activée, la recherche multi-vendeurs en Allemagne et un test privé d’abord limité à trois annonces. Obtenir le périmètre autorisé, les quotas et les conditions de conservation avant l’import régulier. [Accès à la sandbox](https://services.sandbox.mobile.de/docs/seller-api.html)

**AutoScout24.** Le contact SEARCH API est **searchapi@autoscout24.com**. Demander un accès de lecture sur le marché français, un environnement d’essai s’il est proposé, le schéma GraphQL, une requête d’exemple de recherche et le mode d’authentification. Préciser le besoin des identifiants et liens individuels, prix, devises, premières immatriculations et kilométrages ainsi que l’usage prévu dans AutoFindex. [Contact SEARCH API](https://www.autoscout24.de/haendlerportal/schnittstelle-search-api/)
