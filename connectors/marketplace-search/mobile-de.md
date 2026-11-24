# mobile.de Search API

Le lecteur interroge une page de voitures d’occasion par pays du vendeur. Le service officiel renvoie une réponse XML, dont le lecteur vérifie le prix public brut, la devise, l’année de première immatriculation, le kilométrage, le titre et l’identifiant du lien de fiche. Le périmètre dépend du compte délivré par mobile.de.

| Entrée | Commande |
|---|---|
| Marché partenaire en production | `python mobile_de_search.py --country DE --limit 3` |
| Serveur de test officiel | `python mobile_de_search.py --sandbox --country DE --limit 3` |
| XML d’exemple publié par mobile.de, enregistré en local | `python mobile_de_search.py --xml exemple.xml --documentation-example` |
| Autre XML déjà enregistré, provenance externe au lecteur | `python mobile_de_search.py --xml page-privee.xml` |

Injecter les variables `MOBILE_DE_API_USERNAME` et `MOBILE_DE_API_PASSWORD` depuis un gestionnaire de secrets pour la production. Le bac à sable utilise `MOBILE_DE_SANDBOX_USERNAME` et `MOBILE_DE_SANDBOX_PASSWORD`. Seul le serveur sélectionné reçoit ses identifiants.

Sur les deux collecteurs, l’option **`--output /chemin/prive/lot.json`** écrit les lignes acceptées et leur provenance dans un nouveau fichier JSON de permissions `0600`. Utiliser un répertoire existant en environnement POSIX. Le fichier devient visible uniquement une fois l’écriture terminée. Un fichier ou un lien déjà présent est protégé contre le remplacement. La sortie standard demeure un bilan sans annonces. Le champ `mode` de mobile.de vaut `live_api`, `sandbox_api`, `documentation_xml_example` ou `saved_xml` selon la source. Un XML importé depuis le disque ne prouve pas un accès au catalogue en ligne.

[Documentation de recherche et exemple XML](https://services.mobile.de/docs/search-api.html) · [Accès au programme API](https://services.mobile.de/manual/index.html)
