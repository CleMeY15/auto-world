# ADR-0025 — Official HistoVec buyer guide

Status: Reviewed plan, 2026-10-23; implementation/delivery governed by TASK-0115 and its final PR checkpoint. Sequential independent Architect and Critic APPROVE before code.

## Context and decision

The roadmap's Vehicle History Gateway and Vehicle Intelligence contract allow transparent outbound routing when direct history access is unavailable. [TASK-0115](../../roadmap/tasks/TASK-0115-official-history-guide.md) adds only a short static buyer guide and ordinary user-activated links to official public pages. It follows [ADR-0024](ADR-0024-official-registration-guide.md)'s navigation pattern without inferring any new provider rights. This narrow extension of the [ADR-0012](ADR-0012-synthetic-development-lane.md) product lane neither acquires a source nor opens a new concurrent READY lane. Infrastructure prerequisites remain unchanged.

The current registration-certificate holder — generally the seller — generates the report; buyers request its link from the seller/holder. Opening the general HistoVec site does not retrieve a specific report. Auto World does not retrieve, verify, display, analyse or store it. Administrative history is not a guarantee of condition or a replacement for the separate sale documents/checks.

## Official evidence and limits

Checked 2026-10-23:

- [Ministry HistoVec landing](https://histovec.interieur.gouv.fr/histovec/accueil): canonical public destination; holder generation and buyer request are separate actions.
- [Buyer guidance](https://histovec.interieur.gouv.fr/histovec/acheteur): administrative history derived from the vehicle registration system, shared by the seller.
- [Use FAQ](https://histovec.interieur.gouv.fr/histovec/faq-comment-utiliser-histovec): only the holder of a valid current registration certificate can generate a report; others cannot directly query the vehicle's data.
- [Unavailable vehicle/report FAQ](https://histovec.interieur.gouv.fr/histovec/faq-ne-trouve-pas-vehicule): ask the seller again when a report link is unavailable. Some categories are excluded and updates may lag; the page makes no eligibility decision.
- [Service Public sale/gift guidance](https://www.service-public.gouv.fr/particuliers/vosdroits/F34300/2_0_0_0_1), verified 2026-10-13: separate sale-document requirements and history sharing. UI copy does not reproduce legal deadlines.

HistoVec pages expose no revision date. This bounded research establishes public destinations and actor guidance, not API/embedding/scraping/report reuse rights, generic integration permission, affiliation or source-registry admission. Only ordinary explicit public navigation is implemented. No vehicle data enters Auto World and no Observation/Provenance object is created.

## Alternatives, drivers and tradeoffs

Drivers: immediate buyer utility, honest limits, minimal privacy/maintenance risk and shared design consistency. A bare footer link is smaller but leaves the holder's role, report-link access and recovery unexplained. A short guide adds a destination but resolves those ambiguities. An integrated lookup/import/iframe would require unestablished rights, PII contracts and infrastructure; it is out of scope. Select one concise page, one primary action and native help, not a generic provider framework.

## UI, privacy and operations

Static server HTML, existing tokens/fonts, no client island or new dependency. Root/demo footer entries do not compete with search navigation. Fixed bare HTTPS URLs, target `_blank`, `noopener noreferrer`, `no-referrer`, accessible new-tab notices. No query/fragment/prefill/ping, form/input/upload, iframe, API/fetch/proxy, background probe, resource hints, report URL handling, storage, cookies or telemetry.

The route sends `X-DNS-Prefetch-Control: off` with the same bounded semantics as ADR-0024: supporting browsers only, not OS/network-wide DNS silence. Browser tests assert the header and absence of application HTTP activity/hints. Native help works after disconnect, not offline first navigation; external results/availability are unobservable, so no invented success/error/loading state or analytics event is emitted.

No backend workflow or migration. Application lead checks links/copy on changes/releases; CI intercepts navigation instead of depending on provider uptime. Correct/remove stale links via reviewed change. Rollback is a code revert of route/entries/header. Any later report import, API, prefill, storage, telemetry or analysis needs its own task, explicit rights, privacy and data contracts before implementation.
