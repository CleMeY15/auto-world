# AutoScout24 pour AutoFindex

L’offre européenne de recherche est la **SEARCH API GraphQL**. L’éditeur annonce la recherche, le filtrage et la consultation pour des applications. Le site professionnel français propose des intégrations de données sur mesure. Le périmètre France, les droits de stockage et de rediffusion, les quotas, la méthode d’authentification, le schéma et l’URL d’exécution dépendent du contrat. Le contact fourni par AutoScout24 est **searchapi@autoscout24.com**.

[Présentation de SEARCH API](https://www.autoscout24.de/haendlerportal/schnittstelle-search-api/) · [Interfaces professionnelles France](https://www.autoscout24.fr/partner-infoportal/schnittstellen/)

## Contrôles exécutables

```sh
python autoscout_partner.py --dealer-example
python -m unittest test_autoscout_partner
```

Le premier contrôle effectue deux GET sur des ressources documentées de **Listing Creation API**. Il récupère le référentiel de marques et modèles et l’exemple JSON de lecture d’un véhicule. Il assemble le titre depuis les libellés de marque et de modèle et la version renvoyée. Il conserve le prix public dans sa devise d’origine, l’année de première immatriculation, les kilomètres, l’identifiant et l’URL du canal AS24. La fiche d’exemple est inactive et n’alimente aucune base. L’API concessionnaire permet de lire le stock des clients ayant habilité le fournisseur de données.

[Guide officiel des exemples](https://listing-creation.api.autoscout24.com/docs#/examples) · [Données de l’exemple](https://listing-creation.api.autoscout24.com/assets/docs/read-car.json) · [Référentiel de marques](https://listing-creation.api.autoscout24.com/makes)

## Lire une page du marché sous contrat

Utiliser la requête GraphQL nommée, les variables et les chemins de réponse documentés dans l’onboarding fourni par AutoScout24. Les noms de champs suivants décrivent la **configuration locale**. Ils ne prétendent pas décrire le schéma GraphQL du fournisseur.

| Clé du fichier JSON de configuration | Valeur |
|---|---|
| `environment` | `production` ou `sandbox` selon l’environnement explicitement attribué par le partenaire. |
| `endpoint` et `trusted_origin` | URL HTTPS contractuelle de l’API et son origine exacte, fournies séparément. Les redirections sont refusées. |
| `query_file` et `operation_name` | Fichier contenant la requête de lecture du partenaire, relatif au fichier de configuration, et nom de cette opération. |
| `variables` | Objet JSON des variables conformes au schéma, incluant les filtres de marché convenus, notamment le pays vendeur si un essai français est souhaité. |
| `limit_variable_path` | Tableau de clés dans `variables` pointant vers la taille de page existante. Cette clé est remplacée par la limite demandée (1 à 10). |
| `rows_path` | Tableau des clés qui mène de `data` à la liste d’annonces dans la réponse. |
| `field_paths` | Objet avec une entrée pour chaque champ normalisé : `source_id`, `source_url`, `title`, `price`, `currency`, `year`, `mileage_km`. Chaque valeur est un tableau de clés partant de l’annonce. Mapper le prix public comptant et un kilométrage explicitement exprimé en km. |
| `auth_header` | Nom de l’en-tête prévu au contrat. Les modes pris en charge sont `Authorization` (par défaut), `X-API-Key` et `API-Key`. La valeur reste dans le gestionnaire de secrets. |

Injecter `AUTOSCOUT24_SEARCH_AUTHORIZATION` dans l’environnement du processus depuis le gestionnaire de secrets. Pour un contrat OAuth, c’est la valeur complète de l’en-tête fournie par le mécanisme de jetons du partenaire. L’acquisition de jeton n’a pas été validée pour la SEARCH API européenne.

```sh
python autoscout_partner.py --contract /chemin/prive/contrat-autoscout24.json --limit 3
```

Le programme envoie une seule opération nommée de lecture par POST. Il vérifie la limite de la réponse, les champs, les doublons par identifiant et les conflits. L’outil en ligne de commande produit un bilan agrégé. La fonction Python `partner_search` retourne également les lignes normalisées à l’appelant. Un enregistrement incomplet est écarté ; l’absence d’un champ, d’un accès ou d’une annonce n’est jamais substituée par l’exemple documentaire. La pagination, la synchronisation continue et l’écriture PostgreSQL sont hors du périmètre de ce pilote.

Les essais locaux valident le comportement du client sur un contrat simulé et l’exemple constructeur sur l’API de concessionnaires. La réponse de SEARCH API et son schéma doivent encore être validés avec les accès du projet.

L’option `--output /chemin/prive/lot.json` ajoute une sortie JSON locale, créée en mode privé `0600` sans écraser de fichier existant (POSIX). Le document contient la source, le mode, le nombre et les seules lignes acceptées. Le mode `official-dealer-documentation-example` marque explicitement la fiche de démonstration, `partner-sandbox` désigne le bac à sable et `contracted-marketplace-read` identifie la réponse du point d’accès fourni sous contrat. La sortie standard conserve seulement le bilan agrégé.
