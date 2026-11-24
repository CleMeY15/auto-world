# Audit Jina Reader avec REE — AutoFindex (24 novembre 2026)

**État :** inspection des sources publiques effectuée ; exécution REE en GitHub Actions non encore confirmée. Étude uniquement, aucune collecte nouvelle depuis Leboncoin et aucune activation en production.

## Révisions auditées
- Jina OSS : https://github.com/jina-ai/reader/tree/1574bfd380d249c86c82db4dace0d9c8fe17e2b1
- REE : https://github.com/gryszzz/reverse-engineer-everything/tree/ab07274e41fd0ba56c9e6796fdd2fea840d6be00
- Benchmark AutoFindex : https://github.com/CleMeY15/auto-world/actions/runs/45224039881
- Workflow de recherche : ../../.github/workflows/jina-reader-ree-audit.yml

## Cartographie
| Composant | Chemin source | Observation |
|---|---|---|
| API et orchestration | src/api/crawler.ts | Cache puis moteur HTTP et/ou Chromium |
| Récupération HTTP | src/services/curl.ts | Lecture sans JavaScript |
| Navigateur | src/services/puppeteer.ts | Rendu dynamique, DOM, captures |
| Extraction | src/services/jsdom.ts, src/services/markify.ts | HTML vers texte/Markdown |
| Sortie | src/services/snapshot-formatter.ts | Contenu, liens, métadonnées |
| Cache | src/db/bucket-storage.ts | OSS avec stockage objet optionnel |
| Proxy externe | src/services/proxy-provider/index.ts | Dépendance configurée, usage non prouvé |
| Robots | src/services/robots-text.ts | Contrôle présent, son application dépend des options |
| SaaS non publié | architecture.md | Backend MongoDB/billing non répliquable avec OSS seul |

Fait particulièrement important : les requêtes anonymes non internes désactivent dans la classe CrawlerHost l'allocation du proxy géré. Nous ne savons pas quel moteur ni quel cache a effectivement produit les 100 réponses du benchmark.

## Résultat de notre benchmark Jina (23 novembre)
100 appels, 99 HTTP 200, 1 HTTP 503 ; 72 classifications complètes par heuristique (indice de marque/prix/km/année), 5 partielles, 23 sans indices. Latence moyenne 4,93195 s, médiane 4,2995 s. Ni la fraîcheur ni la lecture de l'origine ni la facturation en tokens n'ont été observées. Un HTTP 200 n'établit pas un accès réussi en temps réel à Leboncoin. La catégorie « complète » ne valide pas les champs structurés d'une seule annonce.

## Alternatives proposées pour AutoFindex
1. P0 : alimenter les annonces par des API officielles, flux concessionnaires ou accords autorisés, avec règles d'accès formalisées.
2. P0 : intégrer un Reader interne réutilisant les composants OSS utiles pour les contenus de sources autorisées, et renvoyer des données automobiles structurées plutôt que du Markdown générique.
3. P0 : conserver les payloads bruts, horodatages, hashes, versions et provenance via le Connector SDK et le Source Registry du dépôt.
4. P1 : planifier des mises à jour incrémentales uniquement quand un flux autorisé fournit des signaux fiables de changement.
5. P1 : cache par type de champ, contrôle des erreurs et de la fraîcheur, Jina SaaS en fournisseur secondaire facultatif.
6. P2 : extraction par modèle en dernier recours après vérification des coûts et des licences commerciales (ReaderLM et modèles VLM).

## Charge illustrative
800 000 annonces toutes les quatre heures = 144 millions de lectures par mois de 30 jours, soit environ 55,56 lectures/s pendant chaque cycle. À 2 000 tokens facturés et 0,045 dollar/million : 12 960 $/mois pour 100 % de relectures ; 1 296 $ pour 10 %, en supposant un signal amont exhaustif. Ce ne sont pas des coûts mesurés.

## Critères d'acceptation REE
- Consigner et vérifier les SHAs de Jina et REE.
- Conserver les journaux de REE et ses fichiers evidence.json / summary.json / REE_EVIDENCE_REPORT.md, et lire réellement les preuves.
- Distinguer fonctionnalités du code OSS, infrastructure SaaS privée, hypothèses et résultats expérimentaux.
- Comparer sur un site de test contrôlé : HTML statique, JavaScript, cache, modification du prix fictif et lecture de l'origine vérifiable.
- Aucun test massif ou contournement des restrictions d'accès d'une source tierce.
- N'activer en production qu'une source validée dans le registre sous les statuts official_api, licensed_partner, dealer_feed ou permitted_crawl.

**Limites :** moteur exact et cache du benchmark inconnus ; droit d'exploitation de Leboncoin non démontré ; capacité et coût réels pour 800k annonces non mesurés. Le workflow REE ajouté sur cette branche n'est pas une preuve d'exécution tant que son artefact n'a pas été inspecté.
