# Raccorder les exports Rust à la base AutoFind

Le scraper conserve son mode d’acquisition et écrit ses fichiers `listings_rust_v2_YYYYMMDD_HHMMSS.json`. L’adaptateur consomme ces fichiers terminés sur le même hôte et utilise un service libpq pour écrire dans `autoworld.aw_acquisition_trial`, le schéma du pilote Leboncoin. Cette intégration prolonge les travaux PostgreSQL de la [PR 283](https://github.com/CleMeY15/auto-world/pull/283) et du [pilote Leboncoin](../BATCH_IMPORT.md).

### Stockage et lecture

La table `rust_exports` conserve une seule copie des octets de chaque export, son SHA-256, sa date, son échéance et sa projection validée. La vue `rust_export_listings` fournit une ligne par identifiant et les URL des photos dans leur ordre. L’export original conserve aussi les champs natifs, dont le prix déclaré par le scraper. Un prix issu du seul export reste inconnu dans la projection de prix vérifiés.

La date par défaut correspond à la dernière écriture du fichier par le producteur. L’option `--exported-at` accepte une heure de fin d’export attestée. Les références photo conservent leurs propres heures d’observation et d’expiration. Un rejeu des mêmes octets conserve la première date enregistrée. L’absence d’une annonce dans un fichier partiel ne produit aucun retrait.

Le [SELECT du catalogue privé](catalog_project.sql) joint la vue existante des observations DOM et les nouveaux exports, applique les règles d’expiration et donne la priorité à la fiche source vérifiée pour le prix et les retraits. Il expose l’origine de la ligne et la signification de la date. Les photos restent hébergées à la source.

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
