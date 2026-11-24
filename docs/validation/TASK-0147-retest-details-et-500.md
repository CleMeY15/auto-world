# Retest des fiches Leboncoin et de la pagination Le Parking

24 novembre 2026, heure de Paris. **Trois fiches Leboncoin ont été ouvertes directement dans Chrome.** Sur Le Parking, la navigation réelle a atteint la page 21. Le contrôle de 500 identifiants et de leurs champs a abouti sur un jeu synthétique. Un lot de 500 annonces réelles distinctes du Parking reste à valider.

## Trois fiches individuelles Leboncoin

Les trois URL provenaient des observations archivées du 22 novembre. Chaque navigation visait une fiche individuelle. Aucun résultat de liste n’a été utilisé pour reconstruire les fiches. Le lecteur web et le navigateur ont donné les champs ci-dessous. Le test navigateur n’a présenté aucun CAPTCHA. Le code HTTP d’origine, la disponibilité commerciale chez le vendeur et le comportement d’un collecteur autonome à grande échelle restent inconnus. Jina n’a pas été sollicité lors de ce retest des fiches.

| Identifiant et fiche | Prix affiché | Année modèle | Kilométrage | Énergie | Transmission |
| --- | ---: | ---: | ---: | --- | --- |
| [3305814470 — 911 Carrera S](https://www.leboncoin.fr/ad/voitures/3305814470) | 146 990 € | 2021 | 23 000 km | Essence | Manuelle |
| [3312238672 — 911 Carrera](https://www.leboncoin.fr/ad/voitures/3312238672) | 119 900 € | 2020 | 29 800 km | Essence | Automatique |
| [3308374007 — Macan S](https://www.leboncoin.fr/ad/voitures/3308374007) | 58 000 € | 2021 | 45 000 km | Essence | Automatique |

Le prix visible du Macan est passé de 62 000 € dans l’observation enregistrée le 22 novembre à 58 000 € dans le navigateur le 24 novembre. Une représentation web plus ancienne renvoyait encore 62 000 €. L’écart entre les deux observations est de 4 000 €, soit 6,45 % du premier prix. La date que la fiche affiche est le 23 novembre. L’instant exact de la modification du prix n’est pas établi. [Observations archivées](../../connectors/leboncoin-spike/evidence/normalized-sample.json)

Pour la Carrera, le titre annonce 2021. Les champs dédiés indiquent 2020 et une première mise en circulation en août 2020. Pour la Carrera S, le vendeur indique « CT OK » dans le titre tandis que le critère de validité indique « Non ». Le mode de revue du lecteur conserve la valeur structurée et émet un avertissement lorsque les deux éléments se contredisent. Ces avertissements demandent une vérification de la déclaration par l’utilisateur. Le programme n’attribue aucun millésime ou contrôle technique par déduction.

## Le Parking en conditions réelles

Le navigateur a atteint successivement les pages 1, 2, 6, 9, 12, 15, 18 et 21 de la recherche Renault Clio par les commandes visibles. Le lien « Suivant » a fait apparaître « Précédent » sur la deuxième page. Sur la page 21, la pagination affichait 19 à 24 et sélectionnait 21. Une carte de Renault Clio 1.6 affichait 2 200 €, 2005 et 293 000 km. L’adresse publique de la recherche restait identique. [Recherche testée](https://www.leparking.fr/voiture-occasion/renault-clio.html)

Deux incidents illustrent pourquoi une activation doit être confirmée sur la page. La référence au premier bouton est devenue caduque pendant le chargement. Plus tard, un clic vers la page 6 a laissé la page 2 sélectionnée. La commande native une fois prête a permis de poursuivre. L’indicateur de page active et le contenu changé ont servi de vérification. Aucun CAPTCHA n’a été présenté. La consultation de pages éloignées ne fournit aucune mesure du nombre d’identifiants distincts sur les pages intermédiaires.

Le lecteur modifié a également rejoué le HTML authentique de la première campagne. Les 27 cartes ont donné 26 identifiants et 26 lignes complètes. Le texte produit par Jina sur la même recherche conservait seulement 3 prix sur 26 identifiants. Les pages intermédiaires de cette navigation n’ont pas été collectées. Il n’existe dans ce retest ni export de 500 lignes réelles ni reçu d’import en base. [Résultats et empreintes de la première campagne](TASK-0147-marketplace-pages.md)

Les conditions publiées pour la version européenne du Parking prévoient une autorisation préalable de l’éditeur pour la récupération automatisée. La consultation des mentions françaises a renvoyé 403 au lecteur utilisé. La documentation des API est proposée sur demande et la page professionnelle française propose un essai. Aucun droit d’extraction d’un lot réel n’a été établi pour AutoFindex. Un export d’essai autorisé comprenant 500 identifiants distincts, leur URL, le titre, le prix demandé, l’année et le kilométrage permettrait de qualifier le traitement sur un tel lot. [Conditions européennes de l’éditeur](https://www.theparking.eu/legal.html) · [Le Parking Data](https://pro.leparking.fr/)

## Contrôle hors ligne de 500 identifiants

Le test lance le programme en ligne de commande sur 20 pages HTML construites dans un dossier temporaire. Les 520 apparitions contiennent 500 identifiants de test et 20 répétitions, dont une à l’intérieur d’une page et 19 entre pages. La vérification compare toutes les lignes retournées à la référence, champ par champ.

| Cas | Identifiants distincts | Complets | Prix manquant | Conflit de prix | Résultat pour la cible 500 |
| --- | ---: | ---: | ---: | ---: | --- |
| Valeurs cohérentes | 500 | 500 | 0 | 0 | Acceptée |
| Prix absent, mensualité seule, deux prix différents pour le même identifiant | 500 | 497 | 2 | 1 | Refusée |

Chaque page indique désormais le nombre de nouveaux identifiants et le nombre déjà vus sur les pages précédentes. Relire le même fichier fait apparaître zéro nouvel identifiant. Le lecteur distingue une recherche véritablement vide d’un document méconnaissable. Seul le message visible de la zone de résultats est retenu pour conclure à une recherche vide. Un script, un élément masqué ou un pied de page ne suffit pas.

## Commandes de validation

Depuis `connectors/leboncoin-spike`, exécuter la suite Python et les tests Node. Les tests sont hors réseau.

```sh
python -m unittest -q jina_list_benchmark_test leboncoin_saved_rows_test test_leparking_page test_leparking_html test_marketplace_pages
node --test extract.test.mjs detail-review.test.mjs
node replay.mjs fixtures/3312238672.json --expected-url https://www.leboncoin.fr/ad/voitures/3312238672 --expected-id 3312238672 --review
```

Les suites ciblées comprennent 68 tests Python et 25 tests Node. Les deux cas à 500 passent par le véritable point d’entrée `marketplace_pages.py leparking-html --target 500 --rows`. La commande de rejeu Leboncoin s’applique à une observation locale de fiche déjà conservée. Les consultations dans le navigateur et les tests logiciels ont des provenances distinctes.
