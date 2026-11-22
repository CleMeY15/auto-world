# Import privé du lot leboncoin

`batch-store.py` prépare les annonces effectivement extraites dans une vraie base SQLite et produit l'import PostgreSQL correspondant. **Il ne se connecte jamais au VPS ou à la base du site.** Le catalogue privé actuel utilise encore son backend offline ; cette base de préparation ne change pas son contenu.

## Préparation locale

Python 3 et Node du projet sont requis, sans paquet Python supplémentaire. Depuis la racine du checkout :

```sh
python3 connectors/leboncoin-spike/batch-store.py --bundle /chemin/prive/bundle.json --out-dir /chemin/prive/lot
```

Le bundle privé `leboncoin-batch-bundle/v1` contient les identifiants de lot/source/run/plan, la date, les compteurs fermés et au plus cent annonces distinctes. Son compteur `summary.stored` vaut **0 avant l'import**. Chaque entrée porte `observation`, **`observation_json` exact**, `normalized` et `capture_sha256`. Ce dernier est le lien vers la capture vérifiée par le collecteur ; l'importeur ne possède pas la capture complète et ne prétend pas la revérifier.

Le SHA-256 et la taille du JSON DOM UTF-8 exact doivent correspondre à `normalized.observation_sha256` et `normalized.observation_bytes`. L'objet DOM doit correspondre au JSON ; URL, identifiant et dates doivent correspondre. L'importeur rejoue le normaliseur JS existant hors réseau et exige le même résultat, un cœur complet, l'année modèle observée et aucune anomalie. Il ne réinterprète pas les champs dans un second parseur. Les captures partielles ou refusées restent dans les preuves privées du collecteur ; elles ne deviennent pas des annonces complètes dans cette base.

Le répertoire est privé (0700), ses fichiers 0600 :

- `trial.sqlite3` : lots, JSON DOM brut séparé, observations normalisées et historique. La vue `latest_listings` expose la dernière observation de chaque annonce.
- `normalized.jsonl` : observations normalisées du lot courant, une par ligne.
- `import.sql` : import PostgreSQL transactionnel du même lot.
- `import-receipt.json` : compteurs réellement relus dans SQLite, contrôle d'intégrité, nombre d'observations ajoutées et indicateur `project_database_updated:false`.

Rejouer exactement le même lot n'ajoute aucune observation. Réutiliser un identifiant de lot avec un contenu différent échoue ; un nouveau lot peut ajouter une observation plus récente d'une annonce existante sans dupliquer cette annonce. Aucun retrait ou effacement n'est inféré. Les prix sont en unités mineures exactes ; l'année modèle ne devient pas une date de première immatriculation. Les photos restent des **références non téléchargées**.

Ces fichiers contiennent les données réelles : ne pas les ajouter à Git ni aux logs publics. Les conserver dans un emplacement privé durable et vérifier les empreintes après transfert. Une copie scratch ou un artefact GitHub temporaire seul ne constitue pas une sauvegarde durable.

## Import dans le PostgreSQL du projet

Une fois la connexion existante disponible, utiliser un rôle autorisé à créer le schéma d'essai, par le canal de connexion déjà configuré. Ne pas inscrire de mot de passe dans la commande, Git ou le chat :

```sh
psql --no-psqlrc --dbname=autoworld --file=/chemin/prive/lot/import.sql
```

Le script vérifie `current_database() = 'autoworld'`, utilise uniquement le schéma fixe **`aw_acquisition_trial`**, refuse une collision de lot ou de contenu et annule toute la transaction en cas d'erreur. Les valeurs externes sont encodées en hexadécimal et redeviennent des données dans PostgreSQL. Les tables `aw_connector`, la recherche synthétique et la base d'authentification restent hors de cette composition. Aucun statut `permitted_crawl` ni registre de source n'est fabriqué.

Après `COMMIT`, la dernière requête retourne le nom de base, le schéma, le nombre d'annonces du lot, le nombre total d'observations et le nombre d'annonces distinctes. **Ce résultat prouve l'import dans la connexion utilisée, pas à lui seul l'identité du serveur du projet.** Vérifier séparément la cible de connexion et conserver ce reçu avec les preuves avant d'annoncer la mise à jour de la base du site. Une exécution dans PostgreSQL éphémère sert seulement à tester l'importeur.

Retour arrière : arrêter l'usage de ce lot et conserver son historique. Aucun DROP/DELETE ni modification du catalogue existant n'est fourni.

## Vérification hors réseau

```sh
python3 connectors/leboncoin-spike/batch-store.test.py
```

Les tests utilisent exclusivement des annonces fabriquées. Ils vérifient SQLite, le rejeu, l'historique, les collisions, le rollback, l'identité, les empreintes, les compteurs, les permissions et l'encodage SQL. Ils ne remplacent pas une exécution réelle de l'import PostgreSQL ni une relecture de la base du projet.
