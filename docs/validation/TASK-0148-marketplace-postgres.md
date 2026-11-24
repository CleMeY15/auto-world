# Le Parking · Import de 2 000 annonces dans PostgreSQL

Le 24 novembre 2026, AutoFindex a chargé **2 000 annonces réelles et distinctes** du Parking dans la base PostgreSQL du projet `autoworld`, table `aw_marketplace_trial.listings`. Après validation de la transaction, une nouvelle connexion a relu les neuf champs de chaque ligne. Le second passage du même lot a ajouté **zéro ligne**.

## Acquisition

Les recherches ont porté sur des marques et modèles, à partir des pages publiques et de leurs filtres. La lecture du HTML des résultats a fourni les attributs des véhicules en lot. Les réponses des pages de résultats couvrent la période de 14 h 35 à 14 h 48, heure de Paris. Le lecteur n'a ouvert aucune fiche individuelle et n'a pas appelé Jina au cours de cet essai. Les données correspondent aux prix affichés en euros et aux kilométrages affichés en kilomètres.

| Mesure | Nombre |
|---|---:|
| Pages de recherche consultées | 91 |
| Réponses de recherche exploitables | 91 |
| Apparitions de cartes d’annonces | 2 432 |
| Cartes sans identifiant exploitable ou avec identité ambiguë | 28 |
| Observations répétées d’un identifiant | 361 |
| Identifiants distincts repérés | 2 043 |
| Identifiants avec champs incomplets | 22 |
| Identifiants exclus pour valeurs contradictoires | 0 |
| Annonces distinctes complètes disponibles sur les pages lues | 2 021 |
| Annonces conservées dans le lot demandé | 2 000 |

Le journal compte 91 requêtes HTTP de recherche, y compris la première page du pilote, vérifiée et réutilisée. En moyenne, une requête de recherche a fourni 22,0 annonces conservées dans PostgreSQL.

Le collecteur a pris les premières annonces complètes dans l’ordre des pages et des cartes. Un identifiant doit porter un titre, un prix, une année et un kilométrage sur une même carte. Un lien canonique peut se trouver ailleurs sur la même page de résultats et doit alors porter le même identifiant. La dernière page peut contenir davantage d’annonces éligibles que le nombre nécessaire pour atteindre le plafond.

## Contrôle de la source et de l’écriture

Un deuxième lecteur HTML, fondé sur XPath, a revérifié les valeurs affichées et leur association à l’identifiant. Pour 1 555 annonces, le lien conservé figure sur la carte qui fournit les valeurs. Pour les 445 autres, un lien du même identifiant figure sur la même page. Le lot compte 1 997 liens vers une fiche Le Parking et 3 liens de redirection Le Parking. Les colonnes de la table sont la provenance du lot (`authorized-export`), la source (`leparking`), l’identifiant, le lien source, le titre, le prix, la devise, l’année, le kilométrage et l’unité de distance.

| Vérification dans la base du projet | Résultat |
|---|---:|
| Lignes insérées au premier passage | 2 000 |
| Lignes relues après le premier COMMIT | 2 000 |
| Lignes ajoutées au second passage | 0 |
| Lignes déjà présentes et identiques au second passage | 2 000 |
| Identifiants distincts relus dans le lot | 2 000 |

Ces contrôles ont été exécutés sur le serveur PostgreSQL 17.11 du projet. Les neuf champs normalisés produisent la même empreinte SHA-256 avant import et après relecture de la base du projet. Un second calcul a comparé un export CSV de cinq colonnes (identifiant, titre, année, prix et kilométrage) aux valeurs vérifiées dans le HTML. La sauvegarde privée du lot a également été restaurée dans une base PostgreSQL de contrôle, puis relue.

| Empreinte SHA-256 | Valeur |
|---|---|
| Neuf champs normalisés | `a385888b8f4fd8b4842bb6db090f9c3e56cc9f4c8c6560b9e6bf40e3663fd122` |
| Cinq colonnes CSV contrôlées indépendamment | `cfbb87376d8abea95d10539c050da3c206eb057df9f5181299c00040183566e7` |

## Incidents et portée

Deux pages d’annuaire consultées pendant le repérage avaient répondu HTTP 403. Les recherches de véhicules ont donné 91 réponses finales HTTP 200. Le journal de ces recherches permet de distinguer un refus d’accès d’une carte incomplète. Sur les identifiants incomplets, 17 étaient sans prix et 5 sans kilométrage. Pour 4 identifiants, l’année manquait. Ces motifs peuvent se recouper. Un prix ou kilométrage absent reste absent, et une valeur contradictoire exclut l’identifiant du lot.

L’unité de dédoublonnage est la publication Le Parking. Un véhicule diffusé sous plusieurs identifiants peut donc apparaître plusieurs fois. La sélection par marques et modèles sert à tester l’ingestion et ne mesure pas la composition du marché. Les cartes du lot affichent 14 pays, dont 1 811 annonces avec le repère France. Les annonces constituent une photographie des résultats consultés. Leur disponibilité ultérieure chez le vendeur et la synchronisation des modifications de prix ne font pas partie des vérifications.

## Reproduction du contrôle hors ligne

La commande suivante prend le dossier privé produit par le collecteur, plus le reçu de la première page si elle provient du pilote. Elle requiert Python et `lxml` et s’exécute depuis `connectors/leboncoin-spike`. Elle relit les réponses HTML archivées et calcule l’empreinte CSV sans effectuer de requête réseau.

```sh
python verify_saved_parking_xpath.py --run "$DOSSIER_COLLECTE" --expected 2000 --seed-receipt "$RECU_PILOTE"
```

## Relecture dans PostgreSQL

```sql
SELECT count(*) AS annonces, count(DISTINCT source_id) AS identifiants_distincts
FROM aw_marketplace_trial.listings
WHERE source = 'leparking' AND provenance = 'authorized-export';
```

Les deux compteurs doivent indiquer 2 000 pour ce lot. Les 22 annonces Leboncoin déjà présentes dans l'autre schéma de test ont été recomptées à l'issue de l'import. Le projet conserve les offres Le Parking dans le schéma de test dédié. Le rapport public et les reçus ci-dessous contiennent uniquement des mesures agrégées.

[Reçu agrégé](TASK-0148-leparking-2000.json) · [Demande du projet](../../roadmap/tasks/TASK-0148-marketplace-postgres.md)
