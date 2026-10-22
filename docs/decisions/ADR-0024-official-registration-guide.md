# ADR-0024 — Official registration simulator handoff

Status: Reviewed plan, 2026-10-22; implementation/delivery governed by TASK-0114 and its PR checkpoint.

## Context and decision
The user explicitly selected reuse of the official simulator instead of recreating fiscal calculation. [TASK-0010 / ADR-0019](ADR-0019-fiscal-rule-versioning-readiness.md) remains the readiness gate for any future internal calculator. This increment introduces no tax rules, estimate payload, vehicle facts or public API.

Within the existing independent product lane, [TASK-0114](../../roadmap/tasks/TASK-0114-official-registration-guide.md) adds a static preparation page and ordinary outbound HTTPS links activated only by the user. This narrowly extends [ADR-0012](ADR-0012-synthetic-development-lane.md) to permit that explicit navigation, not a new concurrent READY lane, external listing integration or runtime source acquisition. TASK0005/0005A and TASK0104–0106 remain unchanged.

No automatic external fetch, prefetch, preconnect, DNS prefetch, ping, iframe, proxy or telemetry. Fixed bare URLs; no query parameters, fragments, data prefill, referrer or opener. No input, storage, returned result, network health probe or automatic retry. Opening is not proof of successful official calculation. No source-registry admission is implied by a hyperlink.

These are application controls, not an OS/browser-wide network guarantee. The route also returns `X-DNS-Prefetch-Control: off` to disable speculative DNS resolution in supporting browsers; this nonstandard header does not control every browser, extension or network service. Tests assert the delivered header and absence of application HTTP requests/resource hints, not packet-level DNS silence. References: [MDN header semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-DNS-Prefetch-Control), [Next.js route headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers), checked2026-10-22.

## Reviewed source evidence
Retrieved 2026-10-22:
- [DILA cost guidance](https://www.service-public.gouv.fr/particuliers/vosdroits/F19211), page verified 2026-09-08, directly links the official simulator.
- [DILA simulator](https://www.service-public.gouv.fr/simulateur/calcul/cout-certificat-immatriculation), page verified 2026-05-13, opened through that canonical link. Its form requests procedure, vehicle type, first circulation date, P.6 fiscal horsepower, P.3 energy and residence department. Some cases are not covered.

The short checklist is preparatory, not exhaustive. Service Public owns its questions and estimate; no copied rates, temporal applicability assumptions, rounding rules, tax exemptions or legal-certification claim enter Auto World. Public web access does not establish API, embedding, SIV, scraping or redistribution rights.

## Alternatives and tradeoffs
An isolated footer link is smaller but omits preparation, clear destination and local recovery guidance. An embedded/proxied service lacks reviewed integration rights and creates privacy/maintenance coupling. An internal engine contradicts this user choice and lacks its own DoR-complete official dataset. A short static page is selected: slightly more navigation, but honest responsibility and minimal maintenance.

## UX, privacy and operation
Reuse shared tokens, native anchors/details and semantic server-rendered HTML. One primary link with visible and accessible new-tab notice; same protection on the fallback guidance link. No client island is needed. Help remains usable after the loaded page goes offline; it never promises external availability. No automatic failure detection, fake spinner or success confirmation.

No analytics event is claimed: the route deliberately collects nothing and cannot observe an external result. No new backend logging/tracing workflow or migration applies. Existing global quality and UI tests remain required.

The application lead reviews the two destinations and checklist with changes/releases; external availability is a point-in-time observation, not a guarantee. CI intercepts outbound navigation instead of depending on external uptime. If a source changes, correct or remove the action via reviewed change. Rollback is a code revert of page/entry links. Any later calculation, prefill, storage, telemetry or API integration needs a new task and applicable rights/readiness review.
