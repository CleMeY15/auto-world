# AutoFindex Reader — API de lecture et de recherche

Un service HTTP local convertit une page ou un document, permet de l'indexer explicitement et offre deux modes de recherche. Le service principal utilise Python, Pandoc, Poppler et SQLite FTS5. Il fonctionne sans compte Jina et sans clé d'API payante. Ce prototype étend le [lecteur automobile](../README.md) de la PR #275 dans un processus séparé. L'index appartient à cette instance. Les écritures dans l'index ne créent aucune annonce dans le PostgreSQL d'AutoFindex.

## Démarrage et premier essai

Depuis la racine d'AutoFindex, sur Linux avec Docker Compose v2 installé :

```sh
cd experiments/reader-poc/document-api
docker compose up -d --build reader
curl --fail-with-body http://127.0.0.1:8788/health
```

Indexer une fiche synthétique, puis la retrouver :

```sh
curl --fail-with-body http://127.0.0.1:8788/v1/index \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://stock.example/911","html":"<html><head><title>Porsche 911 Carrera</title></head><body><main><h1>Porsche 911 Carrera</h1><p>2022 · 35 000 km · 119 900 €</p></main></body></html>"}'

curl --fail-with-body -G http://127.0.0.1:8788/v1/search \
  --data-urlencode 'q=Porsche Carrera'
```

La recherche renvoie un tableau de résultats dans `data`. Soumettre de nouveau le document avec son URL exacte met à jour la fiche. Sans URL, le lecteur utilise une URN calculée à partir du SHA-256 des octets. Deux versions différentes soumises sans URL auront donc deux identifiants. `docker compose down` arrête le service et garde le volume `reader-data`.

## Contrat HTTP

| Requête | Comportement |
| --- | --- |
| `POST /` ou `POST /v1/read` | JSON avec `html`, `text` ou `url`. Pour le HTML et le texte fournis, `url` est facultatif et sert à attribuer le document. Avec une URL seule, le lecteur tente un GET HTTPS selon la configuration du serveur. Accepte aussi un corps brut avec son type MIME, un formulaire URL-encodé ou un fichier multipart. |
| `GET /https://domaine/chemin?x=1` | Raccourci de lecture d'une URL HTTPS. Les paramètres appartiennent à la cible. `GET /v1/read?url=…` accepte aussi une URL encodée comme paramètre. |
| `POST /v1/index` | Convertit et indexe le document complet ou remplace celui de la même URL exacte. Les appels de simple lecture laissent l'index intact. |
| `GET /v1/search?q=…&limit=5&offset=0` | Recherche dans le corpus de l'instance. Résultats classés, extraits textuels et pagination. Recherche sans distinction d'accents, jusqu'à 100 résultats par requête. |
| `GET /s/termes%20de%20recherche` ou `GET /v1/search/web?q=…` | Interroge l'instance SearXNG de l'opérateur. Renvoie jusqu'à cinq résultats. Le lecteur essaie de lire chacun selon les domaines configurés. Avec `read=0`, renvoie uniquement les extraits du moteur. |
| `POST /v1/render` | Rendu Chromium facultatif d'un HTML fourni dans le corps. `format` accepte `markdown`, `text`, `html` et `screenshot`. `selector` attend un élément du DOM. Le format screenshot renvoie un PNG. |
| `GET /health` | État HTTP, type d'index et présence de la configuration de recherche web. |

`Accept: application/json` renvoie les données de lecture sous `data` avec `title`, `description`, `url`, `content`, `mimeType` et `sha256`. Les lectures ordinaires indiquent aussi `cacheHit`. Par défaut le rendu texte des routes de lecture contient le titre, l'URL source et le corps. Un client peut choisir `X-Respond-With: markdown`, `text` ou `html` et un sélecteur simple via `X-Target-Selector` (une balise, un identifiant ou une classe, premier élément correspondant). Le mode de lecture par défaut privilégie le premier `main` ou `article`. Le mode Markdown traite le corps entier. Le HTML renvoyé passe par un nettoyage et est transporté en JSON ou en texte.

Un domaine doit être ajouté explicitement par l'opérateur avant lecture distante. Par exemple, dans un environnement autorisé pour la documentation de démonstration :

```sh
READER_ALLOWED_HOSTS=example.com docker compose up -d reader
curl --fail-with-body -H 'Accept: application/json' \
  'http://127.0.0.1:8788/https://example.com/'
```

Le serveur vérifie `robots.txt` et les adresses DNS publiques, puis vérifie le certificat TLS du domaine. Les redirections s'arrêtent à la première réponse. Un refus HTTP ou une demande de vérification reconnue donne une erreur. Le cache HTTP en mémoire dure au plus 5 minutes et respecte les consignes de cache de l'origine. `X-No-Cache: true` exige une lecture fraîche. L'ajout d'un domaine est une configuration de ce prototype. L'activation d'une source dans le produit dépend du Source Registry.

## Documents et rendu

```sh
curl --fail-with-body http://127.0.0.1:8788/ \
  -H 'Accept: application/json' -F 'file=@fiche.pdf'

docker compose --profile render up -d --build reader renderer
curl --fail-with-body http://127.0.0.1:8788/v1/render \
  -H 'Content-Type: application/json' \
  -d '{"html":"<main id=fiche></main><script>document.querySelector(\"main\").textContent=\"Porsche 911\"</script>","selector":"#fiche","format":"screenshot"}' \
  -o fiche.png
```

Le lecteur extrait le texte des PDF comportant une couche texte, des documents Word DOCX, des classeurs XLSX et des présentations PPTX. Pour Excel, les données et valeurs de formule déjà enregistrées sont lues dans l'ordre des feuilles. Pour PowerPoint, le texte suit l'ordre des diapositives. Les contenus fournis sont limités à 2 Mio. Le moteur Chromium reçoit jusqu'à 512 Kio de HTML et communique via un socket Unix, dans un conteneur avec réseau désactivé. Il peut exécuter les scripts inclus dans le document. Une application qui doit télécharger ses scripts ou ses données en ligne ne peut pas se charger entièrement de cette façon. Le fonctionnement du profil exige un hôte Linux compatible avec le sandbox Chromium.

## Recherche web

```sh
export SEARXNG_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export READER_SEARXNG_URL=http://searxng:8080
export READER_ALLOWED_HOSTS=fr.wikipedia.org
docker compose --profile web up -d --build reader searxng
curl --fail-with-body -G http://127.0.0.1:8788/v1/search/web \
  --data-urlencode 'q=Porsche 911' --data 'read=0'
```

La configuration livrée interroge la recherche plein texte de **Wikipédia en français** via son API publique MediaWiki. La couverture dépend des moteurs que l'opérateur configure dans `searxng-settings.yml`. Le résultat comporte `title`, `url`, `description` et `readStatus`. Une lecture réussie ajoute `content`. Un statut `snippet_only` indique que le client a demandé les extraits, ou qu'aucune lecture complète n'a été demandée. Une erreur de lecture est attribuée à son résultat. Une indisponibilité du moteur renvoie une erreur HTTP au lieu d'une liste vide. SearXNG reçoit la requête de recherche et la transmet au moteur configuré.

## Périmètre vérifiable

Le dépôt public de Jina expose plusieurs points d'entrée. Craft Anything CLI 0.6.1 en a examiné trois dans huit fichiers épinglés à `1574bfd380d249c86c82db4dace0d9c8fe17e2b1`. Le [relevé reproductible](craft-anything-evidence.json) fournit les commandes, les identifiants d'observation, les fichiers et leurs empreintes. [Code public de Jina Reader](https://github.com/jina-ai/reader/tree/1574bfd380d249c86c82db4dace0d9c8fe17e2b1) · [Craft Anything](https://github.com/storytold/craft-anything/releases/tag/v0.6.1).

Cette version partage une partie du contrat HTTP de Jina. Les algorithmes de sélection du texte, les extraits web et les métadonnées diffèrent. La facturation, les services privés, les descriptions d'images par modèle de vision, l'OCR et le service public de recherche mondiale restent hors de ce prototype. La comparaison Docker utilise l'image officielle Jina, épinglée par digest, dans le profil `reference` isolé. Le service maison démarre et fonctionne indépendamment de cette image.

## Exécution et validation sans Docker

Sur Linux, installer Python 3.12, SQLite compilé avec FTS5, Pandoc, Poppler (`pdftotext`) et util-linux (`prlimit`).

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest discover -v
uvicorn app:app --host 127.0.0.1 --port 8788 --limit-concurrency 16 --no-access-log --no-proxy-headers
```

Le [script Docker](test_containers.sh) valide les profils individuellement avec des données synthétiques. Chaque invocation utilise son propre projet Compose et ses volumes temporaires. Les vérifications portent sur la conversion, le transport, la persistance, les formats d'erreur et les profils multimoteurs. Le débit sur un parc d'annonces réelles reste à mesurer.
