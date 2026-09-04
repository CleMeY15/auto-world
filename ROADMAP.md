# ROADMAP MASTER — Auto World Search

## North Star
Construire le moteur de recherche automobile mondial le plus rapide, complet et intelligent : une recherche unique multi-pays/multi-sources, web+iOS+Android, langage naturel, scoring d'affaires, historique des prix, coût rendu France, alertes et données B2B.

## Principes non négociables
- Mobile-first, API-first.
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

## Macro-phases
### P0 — Fondation (S0-S3)
Architecture, schéma canonique v1, source registry, threat model, repo/CI, conventions, ADR.
### P1 — Vertical Slice (S4-S8)
2-3 sources autorisées : ingestion -> normalisation -> index -> API -> UI -> favoris.
### P2 — MVP France/Allemagne/Corée (S9-S16)
10-20 sources, web+app, comptes, alertes, dedup v1, historique prix, recherche IA v1.
### P3 — Product Market Fit (S17-S28)
Deal score, estimation prix, coût import, recommandations, premium, analytics.
### P4 — Europe + Asie (M7-M12)
50-100+ sources, millions d'annonces, dealer feeds, B2B alpha.
### P5 — Global Platform (Y2)
20M+ annonces uniques potentielles, API B2B, data products, internationalisation.

## Workstreams
A Product/UX; B Data acquisition/connectors; C Canonical vehicle data; D Search/indexing; E Dedup/entity resolution; F AI/NLP/CV; G Pricing; H Import cost; I Accounts/alerts; J Dealer/B2B; K Platform/DevOps/SRE; L Security/privacy/legal; M Analytics/growth.

## Dépendances structurantes
- AI Search dépend de taxonomy + Search API déterministe.
- Deal Score dépend de history + comparables + quality gates.
- Import Cost dépend de règles juridiques versionnées.
- Alerts dépend d'événements idempotents + requêtes canoniques sauvegardées.
- Global rollout dépend du source registry + localisation + monnaie/taxes.

## Séquencement
S0 discovery/legal/source registry. S1 repo/CI/schema/design foundation. S2 raw ingestion/connector SDK/search/1 source légale. S3 mapper/API/web search. S4 2e/3e source/provenance/exact dedup. S5 accounts/favorites/history. S6 mobile/notifications. S7 NLP search + evals. S8 beta gate. S9-S12 expansion + probabilistic dedup + alerts. S13-S16 FR/DE/KR + pricing/import + app beta. S17-S28 deal score/compare/recommendations/dealer/monetization/reliability.

## Stop conditions
Stopper une intégration si droits incertains, usage interdit, instabilité chronique, coût de maintenance injustifié ou qualité dangereuse. Ne jamais livrer : filtres LLM non validés, scraper monolithique, UI couplée aux sources, règles fiscales non versionnées, ranking sponsorisé invisible.

## Exécution
La source de vérité opérationnelle est `roadmap/`. Codex lit `AGENTS.md`, puis cette roadmap, puis l'epic actif, et exécute uniquement la première tâche READY dont les dépendances sont satisfaites.
