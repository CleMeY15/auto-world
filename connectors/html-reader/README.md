# Lecteur d’annonces AutoFindex

Le programme lit le document HTML envoyé à un visiteur ou le texte enregistré d’une fiche. Python 3.10+ et sa bibliothèque standard suffisent pour le HTML, le texte et les archives de navigateur. L’import PDF utilise aussi le programme libre pdftotext de Poppler. Le mode réseau général du pilote lit les pages Le Parking. La commande mobile traite les URL individuelles autorisées de mobile.de. Les archives des deux plateformes et les fichiers AutoScout24 se lisent localement. Le programme fonctionne sans clé, abonnement ni service de lecture tiers.

## Une page de résultats, plusieurs véhicules

Depuis la racine du dépôt, lancer les commandes suivantes. Le second fichier en sortie conserve exactement les octets reçus et doit porter un nom disponible.

```sh
cd connectors/html-reader
python3 lecteur.py fetch 'https://www.leparking.fr/voiture-occasion/mercedes-clk-cabriolet-clk-350.html' --kind parking-results --save-html page.html > resultats.json
```

Chaque observation contient l’identifiant et l’URL de la fiche Le Parking, le titre, le prix, la devise, l’année et le kilométrage. Sur une carte de résultats, `origin_domains` conserve les domaines affichés et `origin_platforms` regroupe les éditions nationales d’AutoScout24. Un véhicule peut porter plusieurs étiquettes. Filtrer les neuf fiches du test, ou leurs équivalents sur un autre lot, avec Python seul.

```sh
python3 - <<'PY'
import json
with open("resultats.json", encoding="utf-8") as stream:
    rows = [x["row"] for x in json.load(stream)["observations"]]
for row in rows:
    if {"mobile.de", "AutoScout24"}.intersection(row["origin_platforms"]):
        print(row["source_id"], row["title"], row["price"], row["currency"], row["origin_domains"])
PY
```

Le lecteur des cartes reprend celui du pilote AutoFindex [#282](https://github.com/CleMeY15/auto-world/pull/282). Il associe les chiffres et étiquettes à leur carte et exige une URL individuelle observée. Le journal dénombre séparément les données manquantes, les identifiants ambigus, les répétitions, les conflits et les liens de suivi sans URL individuelle. `parking_results.merge_results` peut consolider plusieurs pages de résultats archivées et écarte les identifiants dont les observations se contredisent.

## Fiches individuelles et lots de fichiers

```sh
python3 lecteur.py file fiche.html --url "$URL_DE_L_ANNONCE" > fiche.json
python3 lecteur.py file fiche.txt --url "$URL_DE_L_ANNONCE" --format text > texte.json
python3 lecteur.py file page.html --kind parking-results > relecture.json
python3 lecteur.py batch sources.json > lot.json
```

Remplacer la variable par l’URL individuelle du document. Pour mobile.de et AutoScout24, un HTML avec URL canonique peut également être lu sans `--url`. Le manifeste est un tableau JSON. Chaque entrée comprend `file` (chemin relatif sous le dossier du manifeste), `source_url`, et éventuellement `format`, `kind`, `provenance`. Exemple synthétique de manifeste pour des fichiers locaux.

```json
[
  {"file":"mobile.html","source_url":"https://suchen.mobile.de/fahrzeuge/details.html?id=100","provenance":"synthetic"},
  {"file":"resultats.html","kind":"parking-results","provenance":"archived"}
]
```

`direct-origin` est attribué par la commande de téléchargement au site qui a fourni le document. `archived`, `indexed`, `indirect` et `synthetic` décrivent les fichiers locaux. Chaque observation conserve l’empreinte SHA-256 des octets analysés. Le code de sortie est 0 si les documents ont été traités, 2 si un document a échoué. Si une carte individuelle est incomplète, les autres cartes restent exploitables et le compteur `incomplete` le signale. Une page de détail qui demande une vérification, comporte plusieurs identités contradictoires ou manque de champs génère une erreur.

Pour les fiches natives, les contrôles sur les prix et le kilométrage distinguent le prix affiché des mensualités de financement et les kilomètres des miles. L’année correspond au champ lu sur la fiche. Les quatre copies natives du test affichaient une date d’immatriculation. La fiche individuelle Le Parking utilisait une année de fabrication et les cartes de résultats une année affichée.

## Alimenter PostgreSQL depuis mobile.de

Une URL individuelle fournie dans le périmètre autorisé peut être testée avec le lecteur HTML identifié AutoFindex. Utiliser l’URL originale complète autorisée, reçue avec ses paramètres. Le format pris en charge dans ce pilote est la page de détail HTTPS sur suchen.mobile.de avec les paramètres id (numérique) et vip=1. Le lecteur conserve l’URL demandée dans son reçu. L’URL canonique et l’identifiant natif sont relus dans le HTML et comparés à l’annonce demandée.

```sh
python3 lecteur.py mobile "$URL_ANNONCE_AUTORISEE" --database autoworld
```

La connexion à PostgreSQL s’effectue sur la machine du projet ou son socket local. Pour la destination explicite `autoworld`, le pilote écrit les observations directes de mobile.de dans `aw_html_trial.observations`. Les documents archivés et synthétiques disposent de bases d’essai séparées.

Pour un lot, fournir un fichier UTF-8 avec une URL autorisée par ligne. L’intervalle en secondes vient de l’accord avec l’éditeur. Le programme compte les URL fournies et distinctes, les observations confirmées, les pages disparues et les fiches en attente.

```sh
python3 mobile_batch.py urls.txt --state suivi.sqlite --database autoworld --interval-seconds "$INTERVALLE_CONVENU"
```

Le fichier SQLite est local au processus de collecte. Il lie le lot au contenu exact du manifeste et à sa destination. Un seul processus peut traiter cet état à la fois. Après la validation du HTML, le programme conserve l’observation jusqu’au commit et à la relecture dans PostgreSQL. En cas de panne de base, la reprise utilise les données déjà validées. Un 404 ou 410 sur la fiche est enregistré comme indisponibilité. Un refus d’accès, une limitation de débit ou un écran de vérification arrête l’ensemble du lot. Un lancement ordinaire retrouve cet arrêt sans nouvelle requête. Les options de reprise après rétablissement sont décrites dans `mobile_batch.py --help`.

Un manifeste terminé mesure uniquement la couverture de ses propres URL. Pour suivre tout le stock actif, il faut une source d’inventaire complète et à jour que mobile.de a ouverte au lecteur. Les règles publiques observées lors de l’essai permettaient un format de fiche et restreignaient les chemins usuels des listes. Le pilote ne génère pas d’identifiants et ne découvre pas les annonces par numérotation.

## Importer des documents mobile.de déjà enregistrés

Une impression PDF qui conserve une couche texte, le numéro d’annonce, le lien de la fiche et ses caractéristiques peut être importée en une commande. L’adresse, le titre, le prix affiché, la devise, l’année d’immatriculation et le kilométrage sont lus dans le document. Les URL imprimées peuvent se poursuivre sur la ligne suivante. Le lecteur conserve l’empreinte du PDF et classe le résultat comme archivé. Une capture d’écran ou un PDF composé uniquement d’images génère une erreur explicite.

```sh
python3 lecteur.py file annonce.pdf > observation.json
python3 reader_pg.py observation.json --database autofindex_trial_mes_annonces
```

Le PDF requiert `pdftotext` dans le PATH. Sous Debian ou Ubuntu, ce binaire fait partie de `poppler-utils`. Les PDF sont traités hors ligne, sans suivre les hyperliens. La limite est de 16 Mo pour le fichier et de 2 Mo de texte extrait. Un fichier contenant plusieurs en-têtes d’annonces est rejeté.

Le même point d’entrée accepte `.webarchive` de Safari et `.mhtml` ou `.mht`. Il traite uniquement la ressource HTML principale, contrôle la cohérence de l’URL et de l’identifiant et conserve les empreintes de l’archive et du HTML. Les éléments incorporés et les cadres secondaires ne peuvent pas fournir une autre annonce. Les documents expurgés qui ne contiennent plus les champs essentiels peuvent échouer. Le manifeste par lots accepte chacun de ces formats par extension.

```sh
python3 lecteur.py file annonce.webarchive
python3 lecteur.py file annonce.mhtml
```

## Essai PostgreSQL

Le programme de lecture fonctionne seul. Pour persister les observations, installer le client libre `psql` et utiliser une base PostgreSQL locale d’essai avec le droit d’y créer un schéma. Exemple pour une nouvelle base.

```sh
createdb autofindex_trial_mes_annonces
python3 reader_pg.py resultats.json --database autofindex_trial_mes_annonces
```

Le reçu indique combien de lignes ont été ajoutées, retrouvées et vérifiées via une nouvelle connexion. Un second import du même document conserve les lignes existantes. Un nouveau document peut produire une nouvelle observation du même véhicule. Un contenu différent pour la même clé entraîne l’annulation de la transaction. Le pilote conserve les montants en EUR, CHF, GBP ou USD dans leur devise d’origine. Il accepte jusqu’à 2 000 observations par import. Un rapport qui contient des erreurs de documents est rejeté avant écriture.

## Test et exploitation du pilote

```sh
python3 -m unittest discover -v
python3 check_postgres.py autofindex_trial_mes_annonces
```

Le deuxième contrôle ajoute une observation explicitement synthétique à la base d’essai choisie. Le premier s’exécute entièrement hors ligne. Le client réseau borné consulte les règles du domaine, utilise HTTPS et consigne les refus, redirections, types inattendus et écrans de vérification. La commande de démonstration lit une URL à la fois. Pour une autre source déjà approuvée, la commande `own_fetch.py --help` décrit la configuration des hôtes et chemins. Un nouvel hôte nécessite aussi un parseur adapté à son document. Les étiquettes de republication ne donnent ni l’identifiant natif, ni l’URL native, ni la disponibilité actuelle du véhicule.

[Résultats et erreurs observés le 24 novembre 2026](../../docs/validation/TASK-0150-lecteur-html.md)
