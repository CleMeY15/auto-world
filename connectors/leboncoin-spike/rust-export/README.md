# Raccorder les exports Rust à la base AutoFind

Le scraper conserve son mode d’acquisition et écrit ses fichiers `listings_rust_v2_YYYYMMDD_HHMMSS.json`. L’adaptateur consomme ces fichiers terminés sur le même hôte et utilise un service libpq pour écrire dans `autoworld.aw_acquisition_trial`, le schéma du pilote Leboncoin. Cette intégration prolonge les travaux PostgreSQL de la [PR 283](https://github.com/CleMeY15/auto-world/pull/283) et du [pilote Leboncoin](https://github.com/CleMeY15/auto-world/blob/b478e8220f13ce8d40a3748fcb677b847dea6227/connectors/leboncoin-spike/BATCH_IMPORT.md).

### Stockage et lecture

La table `rust_exports` conserve une seule copie des octets de chaque export, son SHA-256, sa date, son échéance et sa projection validée. La vue `rust_export_listings` fournit une ligne par identifiant et les URL des photos dans leur ordre. L’export original conserve aussi les champs natifs, dont le prix déclaré par le scraper. Le texte natif `prix` des exports historiques reste privé. Le lecteur publie le prix d’une offre Rust lorsque le producteur fournit les éléments structurés décrits ci-dessous.

La date par défaut correspond à la dernière écriture du fichier par le producteur. L’option `--exported-at` accepte une heure de fin d’export attestée. Les références photo conservent leurs propres heures d’observation et d’expiration. Un rejeu des mêmes octets conserve la première date enregistrée. L’absence d’une annonce dans un fichier partiel ne produit aucun retrait.

Le [SELECT du catalogue privé](catalog_project.sql) joint la vue existante des observations DOM et les nouveaux exports, applique les règles d’expiration et donne la priorité à la fiche source vérifiée pour le prix et les retraits. Il expose l’origine de la ligne et la signification de la date. Les photos restent hébergées à la source.

### Prix de vente dans les prochains exports

Le champ facultatif `sale_price_evidence` conserve la valeur de vente issue de `searchData.ads` pour l’offre Leboncoin portant le même `list_id`. Le producteur joint par identifiant, écarte les demandes, les contrats de location, les prix ambigus et les devises étrangères. Pour le marché FR il attend un montant entier en euros dans la liste `price` et vérifie `price_cents` lorsque la source le fournit. Il convertit le montant en centimes une seule fois. Si la source fournit des attributs illisibles ou un contrat dont la valeur est inconnue, le producteur omet la preuve de prix. Il l’omet aussi quand seul le texte de la carte donne un montant.

Exemple synthétique pour une ligne dont `source_listing_id` vaut `"11"` et `prix` vaut `"12950"`.

```json
{"schema":"searchData.ads.offer.price/v1","list_id":"11","currency":"EUR","amount_minor":1295000}
```

L’importeur exige l’égalité de l’identifiant et la concordance exacte de la somme en centimes avec les euros entiers de la ligne. Une preuve mal formée rejette l’export. Une archive historique, identifiée par son empreinte, conserve sa projection initiale et peut être rejouée. Aucun recalcul à partir du texte historique ne permettrait de distinguer dans toutes les cartes un prix de vente d’une mensualité ou de chiffres concaténés.

#### Installation des deux composants

1. Préparer le nouvel importeur en copiant ensemble `sync_exports.py`, `project_export.py` et les deux vocabulaires `vehicle_labels.json` et `vehicle_labels_v2.json` depuis la même révision validée dans un répertoire de livraison sur le VPS. Exécuter en mode contrôle fichier `project_export.py` sur un export synthétique avant la bascule. Faire pointer `IMPORT_TOOL` dans le fichier privé `~/.config/autofind-project-export/import.conf` vers le nouveau `sync_exports.py`. L’unité utilisateur relit ce chemin à chaque démarrage.
2. Le [correctif du producteur Rust](producer-sale-price.patch) cible `src/parser.rs` et `src/structured.rs` du scraper existant sur le VPS. Leurs empreintes SHA-256 avant la modification sont respectivement `aa1676849b3d5316c2549665ffada10ddb52404f19c5fd55888da32216ce3a5a` et `70bd051ed151d0a30c7a9789a12e4855efbfcfa2070281df31f79a80496ecd71`. Vérifier les deux empreintes et appliquer le correctif depuis la racine du projet Cargo, une seule fois. Les sources du VPS déjà corrigées peuvent être contrôlées par application inverse à blanc.
3. Compiler depuis ces sources avec le `Cargo.lock` du scraper, exécuter `cargo test --locked --offline` et vérifier le nouvel exécutable de release avec `--replay-page` sur une page synthétique locale contenant un prix de vente et une mensualité. Vérifier que l’invocation habituelle du scraper utilise ce binaire ou reconstruit ces sources. Le producteur et l’importeur peuvent alors traiter les prochains exports selon le cycle habituel d’admission des lots. Une mise en ligne du site Next seule ne met pas à jour ces deux composants.

Pour un retour arrière, rétablir d’abord le producteur précédent. Conserver l’importeur compatible jusqu’au traitement des fichiers déjà produits avec le nouveau champ, puis rétablir l’ancien chemin `IMPORT_TOOL`. Les exports existants et la base sont conservés.

### Caractéristiques des véhicules et modèles

Le producteur peut joindre `vehicle_features_evidence` à une offre. L’enveloppe indique le schéma `searchData.ads.offer.features/v1`, le `list_id` exact et un objet `attributes` non vide. Par exemple, une offre structurée peut fournir `{"fuel":"Diesel","gearbox":"Manuelle","seats":5}`. Les libellés de la carte et les valeurs techniques ambiguës restent exclus de cette preuve. Pour les nouveaux couples marque–modèle, la preuve facultative `vehicle_model_evidence` indique le schéma `searchData.ads.offer.model/v1`, le même `list_id`, la marque `brand` et le modèle `model` contrôlés. Le producteur valide les attributs structurés de l’offre et le vocabulaire v2. L’importeur exige la concordance avec la marque et le modèle de la ligne native. Une offre dépourvue de cette preuve conserve la reconnaissance de modèles du vocabulaire v1. Une archive conserve la version de sa première projection. Pour chaque capture, le producteur retient la première échéance entre l’accord, les données brutes, les données normalisées et les références photo. Il la vérifie de nouveau avant l’écriture de l’export. [Sources du vocabulaire](../../../docs/validation/catalogue-vocabulaire-modeles.md)

1. Valider sur PostgreSQL isolé puis appliquer la [migration 0005](migrations/0005-rust-vehicle-features.up.sql) avec le rôle de migration existant. La colonne facultative `vehicle_features` appartient à la vue de provenance de la fiche et hérite de ses règles de retrait et d’expiration. La vue DOM transmet l’empreinte de l’observation admise. Le lecteur la compare au document normalisé et à la preuve de chaque critère avant de le présenter. Le rôle du site conserve son accès aux seules vues autorisées.
2. Installer ensemble l’importeur, son ordonnanceur et les vocabulaires `vehicle_labels.json` et `vehicle_labels_v2.json`. Vérifier un import et un rejeu sous le même identifiant d’export. Le nouveau lecteur web utilise le vocabulaire v2. Un site plus ancien peut toujours lire la vue additive.
3. Appliquer le [correctif des caractéristiques](producer-vehicle-features.patch) au producteur intégrant déjà le correctif des prix. Vérifier le correctif par `git apply --check` dans une copie de ce producteur. Copier le fichier `vehicle_labels_v2.json` de la révision de l’importeur à côté de `Cargo.toml` pour embarquer exactement le même vocabulaire dans le binaire. Compiler avec son `Cargo.lock` et rejouer une page locale de test avant le prochain lancement normal. Le test `test_producer_catalog.py` utilise `AUTOFIND_TEST_RUST_BIN` (chemin absolu du binaire qualifié) et l’image PostgreSQL isolée de la CI dans `AUTOFIND_TEST_POSTGRES_IMAGE`. Il vérifie le prix et les caractéristiques d’une offre sur sa fiche, sa recherche, son retrait et le refus d’un registre de test limité aux photos. En exploitation, suivre les reçus d’import et le résultat de la recette du catalogue.

Pour restaurer, rétablir le producteur précédent en premier. Conserver l’importeur compatible pour traiter les fichiers en attente et pour contrôler les archives enrichies. Le retour de la vue utilise la [migration de repli](migrations/0005-rust-vehicle-features.down.sql). Elle donne une valeur nulle aux deux colonnes ajoutées et masque les modèles Rust propres au vocabulaire v2. Pour restaurer aussi l’ancien sélecteur de modèles et l’affichage des fiches DOM, restaurer la livraison web et son lecteur v1 avec la transaction du site. Les archives importées et les admissions de lots sont conservées.

### Installation dans le projet existant

Utiliser Python 3.11 ou plus récent et psycopg2. Avec le compte de migration de la base `autoworld`, appliquer [la vue des événements média](migrations/0002-legacy-catalog-media-history.up.sql) une fois, puis [la migration des exports](migrations/0003-native-rust-exports.up.sql). La migration exige la signature de schéma du pilote Leboncoin existant. Elle conserve les tables utilisées par les autres importeurs.

Le service libpq d’import utilise le rôle `af_rust_export_writer` et la destination PostgreSQL locale déjà configurée par l’opérateur. Accorder CONNECT à la base et USAGE au schéma aux deux rôles applicatifs. Les privilèges supplémentaires sont les suivants.

```sql
GRANT SELECT, INSERT ON aw_acquisition_trial.rust_exports TO af_rust_export_writer;
GRANT EXECUTE ON FUNCTION aw_acquisition_trial.purge_rust_exports() TO af_rust_export_writer;
GRANT SELECT (source_id, source_listing_id, original_url, captured_at, normalized_json)
  ON aw_acquisition_trial.latest_listings TO af_rust_export_reader;
GRANT SELECT ON aw_acquisition_trial.catalog_media_history, aw_acquisition_trial.rust_export_listings
  TO af_rust_export_reader;
```

Depuis ce répertoire, avec `PGSERVICEFILE` pointant vers le fichier privé du compte d’import, la commande suivante valide le fichier puis effectue l’écriture transactionnelle. Le résultat JSON distingue `inserted` et `already_imported`.

```sh
python3 project_export.py "$EXPORT" --policy "$POLICY" --service af_rust_export_writer
```

Pour une inspection hors base, utiliser `--inspect` à la place de `--service`. La politique privée doit désigner un crawl FR autorisé et à jour, encadrer les champs et la rétention et prévoir des références photo avec attribution. Les données, pièces contractuelles et identifiants restent sur l’hôte de l’opérateur.

### Import automatique des prochains fichiers

Installer les deux fichiers `autofind-rust-exports.{service,timer}` dans le répertoire systemd de l’utilisateur. Le service lit `~/.config/autofind-project-export/import.conf` (mode 0600). Renseigner les chemins absolus de `IMPORT_TOOL` (le script `sync_exports.py`), `EXPORT_DIRECTORY` (le répertoire de sortie du scraper), `EXPORT_POLICY`, `PGSERVICEFILE` et `EXPORT_STATE` (un répertoire privé de mode 0700), ainsi que `EXPORT_SINCE` avec l’instant UTC du premier fichier à prendre en compte.

```sh
systemctl --user daemon-reload
systemctl --user enable --now autofind-rust-exports.timer
journalctl --user -u autofind-rust-exports.service -n 5
```

Le service traite les nouveaux exports locaux et expire les copies en base à chaque passage. Les reçus locaux servent de cache ; la base confirme l’empreinte avant qu’un fichier soit considéré comme traité. Les erreurs d’un fichier sont comptées et le passage suivant le reprend. Le transport réseau du scraper se lance séparément. L’archivage et la rétention des fichiers sources et des sauvegardes relèvent de leur propriétaire.

Pour suspendre les imports, utiliser `systemctl --user disable --now autofind-rust-exports.timer`, puis `systemctl --user stop autofind-rust-exports.service`. Le retour arrière SQL de la table exige qu’elle soit vide.

### Tests

```sh
AUTOFIND_TEST_POSTGRES_IMAGE="$LOCAL_POSTGRES_IMAGE" python3 -m unittest discover -v
```

Avec une image PostgreSQL déjà présente, les tests démarrent leurs propres instances isolées, utilisent le schéma historique du dépôt et vérifient l’import, le rejeu, les droits de lecture et la purge.

### Filtres du catalogue connecté

La liste accepte `brand` (marque), `priceMin` et `priceMax` (euros entiers), `yearMin` et `yearMax` (millésimes) et `kmMax` (kilomètres). Les bornes sont inclusives. Une valeur vide retire le critère. Le lecteur applique les critères simultanément avec la recherche `q` sur les annonces admises, avant la limite de page. Une annonce au prix inconnu reste consultable tant que la recherche ne fixe pas de borne de prix. La même règle s’applique au kilométrage et à l’année.

Une nouvelle sélection repart de la première page. Le lien vers une fiche et le retour aux résultats conservent les critères et le curseur. Le lecteur PostgreSQL et son fichier SQL se déploient ensemble avec la version web. La réponse de liste fournit aussi les marques du vocabulaire contrôlé pour alimenter le sélecteur.
