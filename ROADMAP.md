# ROADMAP MASTER — Auto World Search

## North Star
Construire le moteur de recherche et d'intelligence automobile mondial le plus rapide, complet et utile à la décision : une recherche unique multi-pays/multi-sources, web+iOS+Android, langage naturel, historique véhicule, scoring d'affaires et de confiance, coût rendu/immatriculé en France, alertes et données B2B.

Le produit ne doit pas seulement aider à trouver une annonce. Il doit aider à trouver, comprendre, vérifier, comparer, importer et acheter le bon véhicule.

L'expérience utilisateur doit être un avantage concurrentiel majeur : interface premium, extrêmement fluide, très épurée et simple à comprendre au premier regard, tout en restant complète pour les utilisateurs avancés. La référence est le niveau de clarté, cohérence, finition, fluidité et simplicité associé aux meilleurs produits Apple — sans copier leurs assets, branding ou écrans.

## Strategic Moats — actifs à construire dès le début
1. Vehicle Graph : l'entité véhicule est distincte des annonces et conserve ses observations successives.
2. Vehicle Knowledge Graph : taxonomie versionnée marques/modèles/générations/versions/moteurs/options/codes constructeurs.
3. Historical Market Graph : first_seen/last_seen, prix, kilométrages, vendeurs, pays, réapparitions et changements de source.
4. Provenance Graph : chaque donnée critique possède source, observed_at, méthode et niveau de confiance.
5. Golden Datasets : corpus vérifiés pour normalisation, déduplication, pricing, VIN, specs et IA.
6. Direct Supply Network : API/feeds directs concessionnaires et partenaires afin de réduire progressivement la dépendance aux marketplaces.
7. Market Intelligence : comparables, liquidité, décote, temps de vente, indices pays/modèles et produits B2B.

## Principes non négociables
- Mobile-first, API-first, event-driven lorsque pertinent.
- UI/UX premium first-class ; jamais repoussée au polish final.
- Design system partagé web/mobile avant prolifération des écrans.
- Simplicité apparente + puissance progressive.
- Navigation courte, cohérente et prévisible.
- États loading/skeleton/empty/error/offline/success conçus explicitement.
- Validation visuelle/UX, accessibilité et performance perçue obligatoires avant Done.
- VehicleEntity != Listing : ne jamais modéliser le produit comme une simple table d'annonces.
- Provenance obligatoire pour chaque champ critique.
- Valeurs contradictoires conservées comme observations ; aucune écrasée silencieusement.
- Raw payloads immuables + données canoniques versionnées et rejouables.
- Connecteurs isolés ; une panne source ne casse pas la plateforme.
- Déduplication probabiliste mais explicable.
- IA hors du chemin critique lorsqu'une règle déterministe suffit.
- LLM interdit comme source d'une donnée fiscale, VIN, technique, pollution, prix ou historique non vérifiée.
- Recherche cible <500 ms p95 hors génération IA.
- Aucune source sans statut d'usage documenté.
- Feature flags pour fonctionnalités risquées.
- Internationalisation structurelle dès le schéma : langues, monnaies, km/miles, kW/ch, conduite, fiscalité, normes.

## Vehicle Intelligence Layer
Chaque annonce doit progressivement résoudre vers :
Listing -> VehicleEntity -> Identity/VIN -> Specs -> Emissions -> History -> Provenance -> Trust -> Market Value -> Deal Score -> Registration/Import -> Total Cost.

### VIN & Identity Resolver
- VIN lorsqu'il est légalement/contractuellement disponible ; sinon résolution marque/modèle/génération/version/moteur/année.
- décodage VIN via sources autorisées et données constructeurs/partenaires ;
- contrôle de cohérence VIN vs annonce ;
- conservation du niveau de confiance ;
- jamais inventer un VIN ou une caractéristique absente.

### Vehicle History Gateway
Architecture multi-fournisseurs : Histovec lorsque le parcours et l'éligibilité le permettent, CarVertical ou autres partenaires commerciaux si intégration/affiliation autorisée, bases partenaires/constructeurs et notre propre historique d'observation. Si aucune API/licence ne permet d'afficher les données, l'UI route explicitement l'utilisateur vers le fournisseur au lieu de prétendre posséder le rapport.

### Specs & Emissions Resolver
Résoudre avec provenance : puissance kW/ch, cylindrée, énergie, transmission, masse, norme Euro, CO2 WLTP/NEDC selon contexte, consommation, autonomie électrique, puissance fiscale lorsque connue/calculable, caractéristiques utiles à l'immatriculation/import. Priorité aux sources officielles/licenciées et au VIN ; fallback modèle/version avec confiance affichée.

### French Registration Engine
Moteur versionné par date et règles officielles permettant d'estimer le coût d'immatriculation français avec le minimum de saisie utilisateur. Les paramètres régionaux, énergie, puissance fiscale, âge/date de première immatriculation, émissions, exonérations/réductions et taxes applicables sont des règles versionnées avec source et effective_from/effective_to. Le calcul doit distinguer véhicule déjà immatriculé en France, import UE/EEE et import hors UE. Les estimations doivent exposer hypothèses et incertitude.

### Landed Cost / Total Acquisition Cost
Pour les imports : prix converti, transport/logistique, assurance transport si applicable, droits/taxes applicables selon origine et preuve d'origine, TVA lorsque applicable, homologation/RTI/COC selon cas, fiscalité environnementale applicable, immatriculation et autres frais documentés. Chaque poste est séparé, versionné et explicable. Ne jamais afficher un faux total précis lorsqu'une donnée obligatoire manque.

### Trust Score
Score distinct du Deal Score : incohérences VIN/specs/km/prix, photos réutilisées, anomalies historiques, contradictions entre sources, vendeur/source, données manquantes. Le score doit être explicable et ne jamais présenter une suspicion algorithmique comme un fait établi.

### Deal Score & Pricing
Valeur marché + intervalle de confiance + comparables + impact km/âge/options/pays + liquidité + historique de prix. Aucun score si la confiance minimale n'est pas atteinte.

### Computer Vision
Détection assistée depuis photos : couleur, carrosserie, jantes, certains équipements visibles, doublons via perceptual hash et anomalies évidentes. Les inférences CV sont marquées comme telles et ne remplacent pas une donnée certifiée.

## AI Buying Agent
L'IA devient un agent d'aide à l'achat outillé : comprendre une recherche naturelle, appeler Search/Compare/History/Pricing/Registration/Import/SaveSearch, expliquer les résultats et surveiller une recherche. Les outils déterministes et bases restent autoritaires. Toute affirmation importante doit être traçable vers les données.

## Expérience produit cible
- Search : langage naturel + filtres progressifs.
- Explore : filtres experts, carte et zones géographiques/rayons.
- Deals : opportunités fondées sur Pricing + confiance.
- Vehicle Detail : photos d'abord, informations décisionnelles ensuite.
- Verify : historique externe/interne, VIN, provenance et Trust Score.
- France Cost : carte grise et coût rendu/immatriculé.
- Compare : 3-5 véhicules, différences automatiquement mises en évidence + explication IA.
- Watch : alertes nouvelles annonces, baisse de prix, deal détecté.
- Garage : favoris, comparaisons, recherches sauvegardées.
- Share : liens propres vers véhicule/comparaison/recherche pour acquisition organique.

## Platform capabilities supplémentaires
- Search géographique mondiale : rayon, pays inclus/exclus, distance vendeur et transport estimé.
- Source Registry opérationnel avec health score, volume, droits, fraîcheur, couverture, erreurs et coût.
- Internal Ops Console pour inspecter ingestion, mapping, dedup, provenance, anomalies, pricing et incidents.
- Feedback loop utilisateur : signaler mauvaise version, doublon, option ou information ; corrections auditables vers golden datasets.
- Event model : listing.created/updated/removed, price.changed, mileage.changed, vehicle.matched, history.updated, deal.detected, trust.changed.
- Market indices : prix, décote, liquidité, jours en stock, pays les moins chers, évolution temporelle.

## Stack de référence
Web: Next.js + TypeScript. Mobile: React Native/Expo. Backend: TypeScript/Fastify ou NestJS; Python pour ML/data si utile. PostgreSQL, OpenSearch, Redis, S3-compatible, queues/events, Terraform, GitHub Actions, OpenTelemetry.

## Direction UI/UX
Le produit doit paraître simple même lorsqu'il orchestre des millions d'annonces et des dizaines de filtres. Grandes surfaces respirantes, hiérarchie typographique nette, animations utiles et courtes, cartes lisibles en <2 secondes, photos mises en valeur, conventions natives iOS/Android, dark mode, aucune UI d'administration brute exposée au client. Contrat : `docs/PRODUCT_UX.md`.

## Macro-phases
### P0 — Fondation
Architecture, repo/CI, contrats, VehicleEntity/Listing/Observation, provenance, taxonomie v1, Source Registry, event vocabulary, threat model, UX/design foundation, règles de versioning fiscal.
### P1 — Vertical Slice
1-3 sources autorisées : ingestion -> raw -> normalisation -> VehicleEntity -> provenance -> index -> API -> UI premium -> favoris. Historique d'observation dès ce stade.
### P2 — MVP France/Allemagne/Corée
10-20 sources, web+app, comptes, alertes, dedup v1, historique prix, recherche IA v1, VIN/specs v1, emissions v1, registration France v1 et routing historique externe.
### P3 — Product Market Fit
Pricing/Deal Score, Trust Score, import/landed cost, compare, recommandations, computer vision ciblée, premium, analytics, UX optimization.
### P4 — Europe + Asie
50-100+ sources, millions d'annonces, dealer feeds, B2B alpha, Vehicle Graph enrichi, multi-fournisseurs history/specs.
### P5 — Global Platform
20M+ annonces uniques potentielles, API B2B, market indices/data products, internationalisation mondiale et réseau direct de fournisseurs.

## Workstreams
A Product/UX & Design System; B Data Acquisition/Connectors; C Vehicle Knowledge Graph & Canonical Data; D Search/Geo; E Dedup/Vehicle Graph; F AI/NLP/CV; G Pricing/Deal Score/Market Intelligence; H VIN/History/Trust; I Specs/Emissions; J French Registration & Import/Landed Cost; K Accounts/Alerts/Share; L Dealer/B2B; M Platform/DevOps/SRE/Ops Console; N Security/Privacy/Legal; O Analytics/Growth/Feedback/Evals.

## Dépendances structurantes
- AI Search dépend de taxonomy + Search API déterministe.
- Vehicle History dépend de contrats fournisseurs + identity resolver.
- Registration dépend de specs/emissions + règles officielles versionnées + localisation utilisateur.
- Import Cost dépend de provenance/origine + règles versionnées ; ne jamais confondre pays de vente et origine douanière.
- Trust dépend de provenance + identity + historique ; Deal Score reste séparé.
- Deal Score dépend de history + comparables + quality gates.
- Alerts dépend d'événements idempotents + requêtes canoniques sauvegardées.
- Computer Vision ne devient source autoritaire que pour des champs explicitement permis et avec confiance.
- Global rollout dépend du Source Registry + i18n + unités + monnaies + taxes.

## Quality Gates spécifiques
- Golden dataset de référence avant dédup probabiliste/IA/pricing en production.
- Toute règle fiscale : source officielle, date d'effet, tests de cas limites, version et audit trail.
- Toute donnée VIN/history/specs : licence/statut d'usage + provenance + confidence.
- Toute estimation import : détail par poste + hypothèses + date des règles.
- Toute feature utilisateur : revue UX/visuelle + accessibility + performance.
- Toute suspicion Trust : formulation non diffamatoire, explicable et contestable/corrigeable.

## Stop conditions
Stopper une intégration si droits incertains, usage interdit, instabilité chronique, coût injustifié ou qualité dangereuse. Ne jamais livrer : filtres LLM non validés, scraper monolithique, UI couplée aux sources, règle fiscale non versionnée, donnée VIN/spec/pollution inventée, rapport historique présenté comme vérifié sans source, ranking sponsorisé invisible, Deal/Trust Score non explicable ou UI brute considérée temporaire.

## Exécution
La source de vérité opérationnelle est `roadmap/`. Codex lit `AGENTS.md`, puis cette roadmap, puis l'epic actif, et exécute uniquement la première tâche READY dont les dépendances sont satisfaites. Les Strategic Moats doivent influencer les décisions d'architecture même lorsqu'une fonctionnalité correspondante n'est livrée que dans une phase ultérieure.
