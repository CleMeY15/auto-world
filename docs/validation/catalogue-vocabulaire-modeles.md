# Modèles proposés dans la recherche du catalogue privé

Le vocabulaire v2 complète les 24 entrées de marque dont le sélecteur de modèle était vide. Il propose notamment Sandero pour Dacia, Model 3 pour Tesla et Classe A pour Mercedes. La présence d’un libellé dans le sélecteur atteste qu’il appartient au vocabulaire. Le nombre de véhicules correspondants dépend des annonces admises et de leur modèle effectivement reconnu. [Vocabulaire v2](../../connectors/leboncoin-spike/rust-export/vehicle_labels_v2.json)

| Contrôle du 27 novembre 2026 | v1 | v2 |
| --- | ---: | ---: |
| Entrées de marque | 35 | 35 |
| Marques proposant au moins un modèle | 11 | 35 |
| Couples marque et modèle | 318 | 523 |
| Plus grand nombre de modèles pour une marque | 37 | 37 |

Les 11 listes préexistantes sont reprises à l’identique, ordre compris. Les 205 nouveaux couples se répartissent entre les 24 entrées auparavant vides. Les clés historiques `Mercedes` et `Mercedes-Benz` désignent le même constructeur et accueillent chacune la même sélection. Les comparaisons de contrôle ont vérifié l’unicité des marques et des modèles par marque en ignorant la casse. Les libellés ont de 1 à 50 caractères, parmi les lettres, les chiffres, l’espace et les signes `.&!+-`. Chaque marque reste sous la limite de 256 modèles. [Vocabulaire v1](../../connectors/leboncoin-spike/rust-export/vehicle_labels.json)

## Appellations vérifiées

L’ADEME diffuse sous licence ouverte des données sur les voitures commercialisées en France, issues de l’homologation. Pour 171 des 205 nouveaux couples, une lecture des deux fichiers ci-dessous a retrouvé le modèle pour la marque correspondante, par égalité après normalisation de la casse et des espaces de bord. [Origine et contenu des données Car Labelling](https://carlabelling.ademe.fr/index/faq)

| Source ADEME consultée le 27 novembre 2026 | Fichier vérifié | Rapprochement |
| --- | --- | --- |
| [Car Labelling](https://data.ademe.fr/datasets/ademe-car-labelling) | [CSV](https://data.ademe.fr/data-fair/api/v1/datasets/ademe-car-labelling/raw), 3 604 lignes de données, SHA-256 `3e1c25363bebcd910327f617a392fb1bceb9f7a027317a03114d93de70136a0b` | Colonnes `Marque` et `Modèle`. Chez DS, `Libellé modèle` contient le nom commercial complet, par exemple DS 7 Crossback. |
| [Véhicules commercialisés en France, édition de mars 2015](https://www.data.gouv.fr/datasets/emissions-de-co2-et-de-polluants-des-vehicules-commercialises-en-france) | [Archive ZIP](https://static.data.gouv.fr/resources/emissions-de-co2-et-de-polluants-des-vehicules-commercialises-en-france/20151015-121340/fic_etiq_edition_40-mars-2015.zip), 20 880 lignes de données dans le CSV, SHA-256 du ZIP `ffd87cbcb91392e4892bb514414234bfe4ddd83c52302e12f3434110ddcd315f` | Couples `lib_mrq_doss` et `lib_mod_doss`, ou `mrq_utac` et `mod_utac`. Dans les dossiers du groupe Jaguar Land Rover, `mrq_utac` distingue les deux marques, y compris pour XF Sportbrake. |

Le rapprochement associe les graphies ADEME `SKODA` à Škoda et `MERCEDES` ou `MERCEDES BENZ` aux deux clés historiques du constructeur. Chaque rapprochement ADEME conserve le lien entre la colonne de modèle et sa marque dans une même ligne.

Les 34 autres couples sont attestés par les constructeurs. Le tableau compte chaque clé du catalogue pour Mercedes.

| Marque | Modèles supplémentaires vérifiés | Source primaire |
| --- | --- | --- |
| DS | DS 3, DS 7 | [Gamme DS Automobiles](https://www.dsautomobiles.fr/) |
| Jaguar | E-Pace, F-Pace, I-Pace, XE | [Tableaux Jaguar « Model Name »](https://www.jaguar.fr/content/dam/jdx/pdfs/fr/Tyre_Efficiency_Regulation_EU_2020_740.pdf) |
| Mercedes et Mercedes-Benz | CLA, EQA, EQB, EQE, EQS, GLA, GLB, GLC, GLE, GLS | [Gamme officielle Mercedes-Benz France](https://media.mercedes-benz.fr/cars-produits/) et [SUV, dont EQB](https://www.mercedes-benz.fr/passengercars/models/suv.html) |
| Mini | Aceman, Cooper, Cooper Electric | [Gamme et classes énergétiques MINI](https://www.mini.fr/fr_FR/home/range/classes-energetiques-mini.html) |
| Seat | Arona, Ateca, Tarraco | [Gamme SUV de SEAT](https://www.seat.fr/voitures-seat/suv) |
| Tesla | Model X, Model Y | [Model X](https://www.tesla.com/fr_fr/modelx) et [Model Y](https://www.tesla.com/fr_fr/modely) |

L’empreinte SHA-256 du fichier v1 utilisé pour la vérification est `14c77cc274c9ea0f6ab8100402ae3eafa5ec734a5e64d720e76d08bfae526d7c`. Celle de la v2 est `dcc74a38845504ba30a9b8253cf3182016993962f0eac60ad5ad50104383ad58`.
