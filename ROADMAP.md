# ROADMAP MASTER — Auto World Search

## North Star
Construire le moteur de recherche automobile mondial le plus rapide, complet et intelligent : une recherche unique multi-pays/multi-sources, web+iOS+Android, langage naturel, scoring d'affaires, historique des prix, coût rendu France, alertes et données B2B.

L'expérience utilisateur doit être un avantage concurrentiel majeur : interface premium, extrêmement fluide, très épurée et simple à comprendre au premier regard, tout en restant complète pour les utilisateurs avancés. La référence est le niveau de clarté, de cohérence, de finition, de fluidité et de simplicité associé aux meilleurs produits Apple — sans copier leurs assets, leur branding ou leurs écrans.

## Principes non négociables
- Mobile-first, API-first.
- UI/UX premium first-class : jamais repoussée en simple "polish" de fin de projet.
- Design system partagé web/mobile avant prolifération des écrans.
- Simplicité apparente + puissance progressive : fonctionnalités avancées révélées au bon moment, pas empilées à l'écran.
- Navigation courte, cohérente et prévisible.
- États loading/skeleton/empty/error/offline/success conçus explicitement.
- Interactions rapides et feedback immédiat ; aucun jank ou blocage évitable.
- Validation visuelle et UX obligatoire avant Done pour toute fonctionnalité utilisateur.
- Accessibilité et performance perçue intégrées à la Definition of Done.
- Provenance obligatoire pour chaque champ critique.
- Connecteurs isolés : une panne source ne casse pas la plateforme.
- Données brutes immuables + données canoniques versionnées.
- Déduplication probabiliste mais explicable.
- IA hors du chemin critique lorsqu'une règle déterministe suffit.
- Recherche cible <500 ms p95 hors génération IA.
- Aucune source sans statut d'usage documenté.
- Observabilité et tests dès le premier connecteur.
- Feature flags pour fonctionnalités risquées.

## Stack de référence
Web: Next.js + TypeScript. Mobile: React Native/Expo. Backend: TypeScript/Fastify ou NestJS; Python pour ML/data si utile. PostgreSQL, OpenSearch, Redis, S3-compatible, queues/events, Terraform, GitHub Actions, OpenTelemetry.

## Direction UI/UX
Le produit doit paraître simple même lorsqu'il orchestre des millions d'annonces et des dizaines de filtres.

Principes :
- recherche en langage naturel au centre du produit ;
- filtres classiques toujours disponibles mais jamais envahissants ;
- grandes surfaces respirantes, hiérarchie typographique nette, densité maîtrisée ;
- animations courtes, utiles et naturelles, jamais décoratives au détriment de la vitesse ;
- cartes véhicule lisibles en moins de 2 secondes ;
- fiche véhicule structurée par décision : prix, confiance, historique, équipement, vendeur, import, comparaison ;
- favoris, comparaisons et alertes accessibles avec un minimum d'étapes ;
- design cohérent entre iOS, Android et web tout en respectant les conventions natives ;
- dark mode prévu par le design system ;
- aucune page ne doit ressembler à un panneau d'administration brut ou à un empilement de composants génériques.

Le contrat détaillé est `docs/PRODUCT_UX.md`.

## Macro-phases
### P0 — Fondation (S0-S3)
Architecture, schéma canonique v1, source registry, threat model, repo/CI, conventions, ADR, principes UX, information architecture et design foundation.
### P1 — Vertical Slice (S4-S8)
2-3 sources autorisées : ingestion -> normalisation -> index -> API -> UI premium -> favoris. Le vertical slice doit inclure une vraie expérience mobile/web représentative, pas une UI temporaire jetable.
### P2 — MVP France/Allemagne/Corée (S9-S16)
10-20 sources, web+app, comptes, alertes, dedup v1, historique prix, recherche IA v1, design system mature, navigation complète et états UX de production.
### P3 — Product Market Fit (S17-S28)
Deal score, estimation prix, coût import, recommandations, premium, analytics, optimisation onboarding/conversion et polish UX fondé sur données.
### P4 — Europe + Asie (M7-M12)
50-100+ sources, millions d'annonces, dealer feeds, B2B alpha, localisation UX multi-pays.
### P5 — Global Platform (Y2)
20M+ annonces uniques potentielles, API B2B, data products, internationalisation, expérience globale cohérente.

## Workstreams
A Product/UX & Design System; B Data acquisition/connectors; C Canonical vehicle data; D Search/indexing; E Dedup/entity resolution; F AI/NLP/CV; G Pricing; H Import cost; I Accounts/alerts; J Dealer/B2B; K Platform/DevOps/SRE; L Security/privacy/legal; M Analytics/growth.

## Dépendances structurantes
- AI Search dépend de taxonomy + Search API déterministe.
- Deal Score dépend de history + comparables + quality gates.
- Import Cost dépend de règles juridiques versionnées.
- Alerts dépend d'événements idempotents + requêtes canoniques sauvegardées.
- Global rollout dépend du source registry + localisation + monnaie/taxes.
- Les écrans produit dépendent du design system, des user flows et des contrats API ; pas de divergence web/mobile non documentée.

## Séquencement
S0 discovery/legal/source registry + UX principles/user journeys. S1 repo/CI/schema/design foundation/design tokens. S2 raw ingestion/connector SDK/search/1 source légale + application shell/navigation. S3 mapper/API/web search + results UX. S4 2e/3e source/provenance/exact dedup + vehicle detail. S5 accounts/favorites/history. S6 mobile/notifications. S7 NLP search + evals. S8 beta gate incluant UX/performance/accessibility. S9-S12 expansion + probabilistic dedup + alerts. S13-S16 FR/DE/KR + pricing/import + app beta. S17-S28 deal score/compare/recommendations/dealer/monetization/reliability/UX optimization.

## Stop conditions
Stopper une intégration si droits incertains, usage interdit, instabilité chronique, coût de maintenance injustifié ou qualité dangereuse. Ne jamais livrer : filtres LLM non validés, scraper monolithique, UI couplée aux sources, règles fiscales non versionnées, ranking sponsorisé invisible, UI brute ou incohérente considérée "temporaire" puis laissée en production.

## Exécution
La source de vérité opérationnelle est `roadmap/`. Codex lit `AGENTS.md`, puis cette roadmap, puis l'epic actif, et exécute uniquement la première tâche READY dont les dépendances sont satisfaites.
