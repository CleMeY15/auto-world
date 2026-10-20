# Auto World design contract

## Source of truth
- Status: Active. TASK-0103/0107/0108/0109/0110/0111/0112 are accepted on main; TASK-0113 adds explicit local comparison links under its own [validation gates](docs/validation/TASK-0113.md).
- Last refreshed: 2026-10-20.
- Primary product surfaces: responsive web search, results, synthetic listing detail, local saved searches and listings. Native mobile comes later.
- Evidence reviewed: [product UX](docs/PRODUCT_UX.md), [roadmap](ROADMAP.md), [Definition of Done](docs/DEFINITION_OF_DONE.md), [vehicle intelligence](docs/VEHICLE_INTELLIGENCE.md), implemented `apps/web/src/app/`, shared `packages/design-system/` and [reviewed viewport/state screenshots](docs/validation/TASK-0007.md#visual-and-interaction-evidence).

## Brand
- Personality: calm, precise, premium and helpful; clarity over decoration.
- Trust signals: visible synthetic/demo label, observation provenance, explicit unknowns and reversible actions.
- Avoid: copying Apple assets or layouts, invented car imagery/specifications, fake deal/trust badges, dashboard clutter and dark patterns.

## Product goals
- Goals: understand a small search result quickly, narrow it by exact fictitious make/model/first-registration year, inspect separate canonical observations and authored-description evidence, then save and revisit it without losing context.
- Non-goals for synthetic P1: real marketplace inventory, AI search, account sync, valuation, VIN/history reports and import estimates.
- Success signals: task completion in the E2E flow, readable cards, stable layout, accessible controls and measured responsiveness.

## Personas and jobs
- Primary persona: a mobile-first vehicle shopper comparing possible listings; desktop shoppers use the same core flow.
- Jobs: narrow results, inspect price/mileage observations and their source, save/remove a listing and recover from missing data.
- Key context: one-handed phone use, slower networks, screen readers and keyboard navigation on web.

## Information architecture
- Primary navigation in this slice: Search/Results and Saved; synthetic listing detail is reached from a result or saved item. A resolved Vehicle page is later scope.
- Core routes: search/results, synthetic listing detail and local saved list. Return to results preserves filters and scroll.
- TASK-0108 navigation labels: Recherche / Enregistrés; retain `#saved` and avoid an ambiguous combined counter. Saved contains compact Recherches enregistrées (n sur 10), then existing Favoris synthétiques. One global empty state when both lists are empty; concise section-empty copy otherwise. No extra destination or home dashboard.
- Content hierarchy: persistent demo disclosure, search controls, scannable synthetic listing card, evidence/history on demand, one clear next action.

## Design principles
- Show only accepted facts by default; disclose observation provenance and authored-fixture provenance separately, with distinct historical observations progressively available. A historical variation alone does not establish a contradiction.
- Make search and save actions immediate, reversible and understandable.
- Prefer an honest empty field over a guessed make, model, year, image, price signal or VIN.
- Tradeoff: the synthetic slice has less automotive detail than the target product, but never pretends placeholder content is verified inventory.

## Visual language
- Color: working demo direction is warm ivory surfaces, graphite text and one deep-petrol action accent, with semantic warning/error colors; light/dark values and measured contrast are specified together in TASK-0007. Avoid decorative gradients.
- Typography: intentional platform-native stack—San Francisco through the iOS system UI font, Roboto through the Android system UI font, and Segoe UI Variable on Windows, with `system-ui` fallback. This is a branded performance/accessibility choice: instant offline rendering, familiar native reading rhythm and no copied/proprietary font asset or remote request. Distinction comes from a restrained large display line, precise weight/spacing and tabular price numerals, not a generic default paragraph style. Product/UX must reject it at TASK-0007 visual sign-off if the result lacks premium character; a self-hosted licensed typeface would then require a reviewed follow-up.
- Spacing/layout rhythm: consistent token scale, generous touch spacing and stable card geometry.
- Shape/radius/elevation: one coherent scale with elevation only where it clarifies interaction.
- Motion: brief, interruptible feedback; no transition may delay the primary action; honor reduced motion.
- Imagery/iconography: no external seller media; use a clearly labeled local illustration/placeholder, never a photo implying an actual vehicle. Use one small, consistent line-icon family implemented from reviewed local vectors.

## Components
- Existing components to reuse: `@auto-world/design-system` Button, Field, Chip, Card, Skeleton and Banner; shared tokens and local Search/Bookmark/Filter/Back/Close vectors. `apps/web` demonstrates these primitives without vehicle data.
- New/changed components: the existing advanced-filter disclosure owns exact fictitious make/model/year controls; the make selection scopes models and clears an incompatible model. Result, Detail and Saved reuse one description summary plus a separate authored-description history. Catalog loading/error/retry reuses Skeleton, Banner and Button rather than adding a second component system.
- Variants and states: default, focus, hover, pressed, disabled, loading, empty, error, offline, partial and success where applicable.
- Saved-search controls reuse Button, Field, Banner and token spacing. Results progressively reveals a short name form after accepted criteria; Saved uses compact rows rather than nested cards. Name is trimmed/NFC, 1–60 Unicode code points; maximum 10 entries. All summaries include exact numeric criteria and sort, never raw taxonomy identifiers.
- Token/component ownership: one shared design-system boundary before web duplication; native consumers may later reuse semantic tokens without forcing identical platform widgets.

## Accessibility
- Target standard: WCAG 2.2 AA for web.
- Keyboard/focus behavior: every action operable in document order, visible focus, Escape closes overlays, focus returns to trigger.
- Contrast/readability: verify semantic tokens in light and dark themes; do not convey status by color alone.
- Screen-reader semantics: labelled search/filter/save controls, useful result counts and polite state announcements; evidence timestamps and uncertainty have readable text.
- Saved-search focus: opening the form focuses its name; cancel/success returns to its trigger (or the duplicate destination action). Loading criteria focuses Search heading without submitting. Deletion focuses its own undo action; undo focuses the restored row's removal action. Independent confirmations reset searches or favorites, never both.
- Reduced motion and sensory considerations: honor `prefers-reduced-motion`; no essential meaning in animation or haptics.

## Responsive behavior
- Supported review viewports: 390 × 844 phone, 768 × 1024 tablet and 1440 × 900 desktop; also test narrow 320 px width for overflow.
- Layout adaptations: one-column phone cards and reachable filters; wider layouts may place filters beside results without changing the evidence order.
- Touch/hover differences: touch targets at least 44 × 44 CSS px; hover is enhancement, never the only disclosure path.

## Interaction states
- Loading: stable-geometry skeletons and nonblocking feedback.
- Empty: explain that the synthetic corpus has no match and offer clear filter reset.
- Error: identify a safe retry or return path without displaying raw payloads.
- Success: results count and save/remove feedback; no fake verification badge.
- Disabled: explain why an action is unavailable.
- Offline/slow network: the demo API may be unavailable after disconnect. Preserve the query/filters and offer retry; local Saved IDs remain viewable/removable with details marked unavailable. Do not bundle a second browser-side fixture/search implementation or imply offline search still works.
- Catalog mismatch: never expose raw taxonomy identifiers or stale labels. Keep price/mileage/year usable, hide unresolved description labels, and perform one bounded refresh against the explicit catalog route.
- Saved searches: save only the immutable first accepted cursorless criteria, not an edited draft or result pages. Loading fills editable filters and clears/cancels prior search state; it never submits. Matching fixture/release and make/model parent are required to restore identity. Otherwise explain the unavailable identity and offer explicit Charger sans marque ni modèle; retain budget, mileage, year and sort. No silent omission or automatic/background search.
- Storage: separate versioned key; no account, sync or alert. Denied/quota/unavailable storage keeps changes in memory with session-only copy. Corrupt bytes are preserved until confirmed reset; future versions are read-only and cannot be reset. Session reset clears memory only and says so. A changed cross-tab snapshot invalidates pending undo/reset authority; simultaneous writes remain last-writer, not transactionally synchronized. Disabled demo permits local management only, with zero API requests.

## Content voice
- Tone: concise, neutral and decision-oriented.
- Terminology: say “données de démonstration” persistently; say “observé le …” for canonical observations, “première immatriculation fictive” for the authored year, and “déclaration issue d’une fixture synthétique, non vérifiée” for make/model/year provenance. Never shorten this year to “année-modèle”.
- Microcopy rules: no “bonne affaire”, “historique vérifié”, “VIN certifié” or real-source endorsement in the synthetic slice.
- Saved heading: Mes listes. Initial Éléments enregistrés fragmented a word at200% with wider font metrics; the shorter title preserves hierarchy and the no-fragmentation guard. Persistent disclosure: Recherches et favoris conservés uniquement dans ce navigateur. Aucun compte ni alerte n’est créé. Distinguish enregistré sur cet appareil from conservé pour cette session; clearing browser data loses local records.

## Implementation constraints
- Framework/styling system: TASK-0007 implements Next.js 16.3.8 / React 19.3.0 / TypeScript 5.9.2 on the pinned workspace toolchain. Server-rendered document/page plus one ephemeral client island; CSS handles initial system appearance without storage reads or hydration effects. The only layout effect restores focus after a user-triggered state replacement. No second UI framework.
- Design-token constraints: establish semantic tokens in a shared boundary; do not create an additional UI framework or add dependencies without a reviewed need.
- Performance constraints: search p95 under 500 ms outside generation, stable layout, responsive input and no LLM in the deterministic path; measure rather than infer.
- Compatibility constraints: public DTOs are separate from internal VIN/policy/raw contracts; synthetic composition is dev/test only.
- Test/screenshot expectations: E2E keyboard/touch/offline/reopen flows; viewport screenshots and independent UX/accessibility/performance review before a user-facing task is Done.

## Open questions and sign-off
- [x] Independent Product/UX reviewer: APPROVE for TASK-0007's exact palette, platform-native hierarchy, wordmark, local icons and 14 phone/tablet/desktop/state screenshots plus two wider-font regressions. Original 320px clipping and the later real Linux system-font wrapping defect are repaired; final regenerated screenshots/copy are independently re-reviewed with primary action and focus outline fully contained. Final production branding remains separate; this sign-off covers the implemented component preview, not later screens.
- [x] Frontend/architecture boundary: exact framework versions and server/client hydration contract recorded in TASK-0007 validation and architecture docs; no persistent storage in this task.
- [x] TASK-0103 owner: the separately versioned `localStorage` favorite schema, denied/quota/corrupt recovery and Saved flow are implemented and retained by TASK-0107.
- [x] TASK-0108 implementation: independent code APPROVE, architecture CLEAR and actual Windows/Linux viewport/enlarged-text UX APPROVE. Local gates and125 passing browser tests per platform validate the saved-search flow; [evidence](docs/validation/TASK-0108.md).
- [x] TASK-0108 delivery: sourceCI38707338245/mainCI38708392017 SUCCESS; accepted main45bcb652. [Final checkpoint](https://github.com/CleMeY15/auto-world/pull/173#issuecomment-6188438418).
- [x] TASK-0109 implementation: independent code APPROVE, architecture CLEAR and final actual-pixel Windows/Linux UX APPROVE/CLEAR;149 browser tests per platform, accessibility and performance gates pass. [Evidence](docs/validation/TASK-0109.md). Final-head/main delivery remains a separate PR checkpoint.
- [x] TASK-0109 delivery: sourceCI38729166121/mainCI38730858398 SUCCESS, accepted main d929158. [Final checkpoint](https://github.com/CleMeY15/auto-world/pull/176#issuecomment-6191690565).
- [x] TASK-0110 implementation: selected observation plus native field-history disclosure, exact representation and honest snapshot states; independent code/architecture/final Windows/Linux pixel approvals,192 passing browser tests per platform and performance/accessibility gates. [Evidence](docs/validation/TASK-0110.md). Exact-source/main CI delivery remains a separate PR checkpoint.
- [x] TASK-0110 delivery: sourceCI38744869739/mainCI38746704125 SUCCESS, accepted main5e220c7. [Final checkpoint](https://github.com/CleMeY15/auto-world/pull/177#issuecomment-6248301095).
- [x] TASK-0111 implementation: explicit criteria-only create/copy/review/load/search flow; independent architecture/code/actual-pixel Windows/Linux UX/acceptance reviews CLEAR or APPROVE;255 browser tests passed per platform, accessibility and performance budgets retained. [Evidence and preserved first-run performance incident](docs/validation/TASK-0111.md). Final-head/main delivery remains a separate PR checkpoint.
- [ ] Product owner: decide whether a later public-ready search includes natural-language parsing; the synthetic slice explicitly does not claim it.

## TASK-0109 comparison contract
- Current-results publications only,2–3, ephemeral IDs. Selection reset on first-page request/restore/reload; no new storage/API or vehicle identity claim. Reuse buttons/tokens, keep primary navigation unchanged.
- Availability is active at the accepted search instant, not a live lifecycle status; the existing search protocol rejects non-active results before comparison.
- Results selection → compact count/Comparer action → local #compare. Entry focuses Comparer heading; return restores Results scroll and comparison trigger. Removal focuses next remove or heading. Below2 retains remaining item and return CTA. Pending first-page refresh locks old-result selection.
- Semantic fact table, readable columns, labelled keyboard-focusable horizontal scroll region and narrow-screen hint; no viewport overflow. Ordinary table headers preferred over overlapping sticky labels. Text states Identique/Différences/Incomplet/Non comparable, not color alone. Unknown values are not equal; currencies/units are never converted or ranked. Preserve exact values when formatting would hide a distinction.
- Decision hierarchy: availability, then observed price/mileage, then authored make/model/year. Consolidate their shared authored provenance once per publication under the year rather than repeating it in three rows. The scroll hint explicitly applies to narrow screens. Both engines validate two- and three-publication layouts in every required viewport/theme.
- Result selection uses concise Comparer / Retirer labels with publication-specific accessible names that include the visible label. Enlarged wide-font text must not split those words; cards and actions can shrink without clipping. Table cells and headings explicitly bind to semantic text tokens to preserve contrast during WebKit theme changes.
- Values from the accepted search, dataAsOf visible, never auto-refreshed. Partial/stale/offline and differing histories explicit. Observed evidence dates/confidence stay distinct from authored make/model/year declarations; unmatched catalog makes that whole declaration unavailable, but observed price/mileage remain usable. No fabricated photos/specs/scores/AI explanation.
- Validate320/390/768/1440 light/dark,200% platform/wide-font, keyboard/focus/44px/axe and responsiveness before sign-off. Production Compare/Garage remains separate scope.

## TASK-0110 history contract
- Detail remains the existing destination. Display accepted facts/availability and dataAsOf before Historique des observations. State plainly that values are not automatically refreshed; partial/stale/offline qualify only the already-loaded response.404 is unavailable, not proof of withdrawal/deletion; successful ended detail keeps status and evidence.
- Separate Prix observé and Kilométrage observé sections. Show Observation affichée selected by exact evidenceId; all other observations live in field-specific native details/summary, with no empty disclosure. Preserve reverse accepted-array order, including timestamp ties, without claiming precedence among ties. Keep every retained record; no chart, trend, conversion or inferred vehicle history.
- Clear currency codes in history; exact minor-unit and tiny mileage values shared with other observation surfaces. UTC dates with seconds/nonzero milliseconds; observation confidence preserves basis points. Unknowns, mixed units/currencies and same-instant observations use neutral explanatory text. Authored declarations remain separate and catalogue-gated; varied declarations are not automatically contradictions.
- Reuse tokens, restrained borders and native disclosure behavior. Selected row has subtle emphasis; auto-fit field columns collapse naturally on narrow/enlarged text.44px summaries, visible keyboard focus, focus retained during toggle, no new navigation/requests/storage/analytics schema. Open state resets when the detail response is replaced.
- Validate both engines320/390/768/1440 light/dark,200% platform/Verdana, empty/hostile/expanded states, axe/content fit and256-record interaction feedback≤100ms. Actual-pixel review is mandatory, not inferred from automated passes.

## TASK-0111 search-link contract
- One secondary Créer un lien action near saved-search controls on accepted Results, never one per listing. Inline labelled region, aria-expanded/controls, readonly Lien de recherche field dir=ltr, focus/select on open; Copier le lien and Fermer. Close restores trigger focus. Reuse tokens, Field, Button and existing criteria summary; no modal or new primary destination.
- State that the link contains criteria, not results, and anyone holding it can read them. Current local-demo constraint is visible before copy. No automatic clipboard access; visible polite success only after confirmed write, manual selectable-field fallback on failure/unavailable API. Replacement/navigation cannot announce obsolete completion.
- Recherche reçue is a shallow received-link screen with exact readable criteria, never raw identifiers. Opening leaves existing draft untouched. Explicit Charger les critères loads editable Search and focuses its heading; only Rechercher submits. Ignorer le lien preserves draft. Invalid/unsupported links show fixed recovery copy without echoing payload.
- Catalogue loading explains disabled identity load; missing/mismatched catalogue offers explicit Charger sans marque ni modèle, retaining budget/km/year/sort. Numeric links restore offline; API availability remains honest. Disabled demo remains Saved-only with no API calls.
- Inspect320/390/768/1440 light/dark,200% platform/Verdana, long-link internal field scrolling with no page overflow,44px targets, keyboard/focus/axe/reduced motion and create/load feedback≤100ms. Clipboard OS latency is outside that UI budget. [Task and evidence](roadmap/tasks/TASK-0111-synthetic-search-links.md) govern final sign-off.

## TASK-0112 publication-link contract

- Accepted detail only: response ID must equal route ID for the entire body/creator. Keep all availability, partial/stale/offline qualifiers; successful missing is distinct from HTTP404.
- Inline creator after snapshot summary, before evidence/history. Reuse link field/actions/status/tokens; no extra modal, card, navigation destination or header competition with favorites. Label « Lien de publication »; explicit create/copy/manual fallback/close with focus restoration.
- Copy: « Ce lien pointe vers cette publication synthétique. Il ne fige ni les valeurs ni sa disponibilité et n’identifie pas un véhicule réel. » Retain local-computer/demo-only disclosure. Only validated public ID in URL, no frozen/current-across-fixtures guarantee.
- Same clipboard lifecycle and access/performance matrix as0111; stale completion after close/navigation/replacement must not announce success. No clipboard read or implicit write. [Task](roadmap/tasks/TASK-0112-synthetic-publication-links.md) and [evidence](docs/validation/TASK-0112.md) govern sign-off.
- TASK-0111 delivery is accepted: sourceCI39139363548/mainCI39140493041 SUCCESS, main3cccfb4; [checkpoint](https://github.com/CleMeY15/auto-world/pull/180#issuecomment-6251833551).
- TASK-0112 implementation: independent code APPROVE/architecture CLEAR and final Windows/Linux actual-pixel UX APPROVE;291 passing browser tests per platform,78 web unit tests and existing accessibility/performance budgets pass. Exact-head/main delivery remains separate; [evidence](docs/validation/TASK-0112.md).

## TASK-0113 comparison-link contract

- TASK0112 delivery is accepted on main1d0133e17a9b8bcf763ae520ab1a2a05bc25e334, sourceCI39145354060/mainCI39146578449 SUCCESS; [checkpoint](https://github.com/CleMeY15/auto-world/pull/181#issuecomment-6252629201).
- Existing Compare gains one inline secondary Créer un lien action for2–3 publications, using the shared labelled field/copy/manual fallback/focus pattern. No new modal, card stack, primary navigation or visual theme. Use the established calm palette, tokens and touch targets.
- Received Comparaison reçue explains that the link contains publication references, not frozen values or a real vehicle identity. State the local-computer/current-runtime limit before explicit Charger la comparaison. No implicit detail reads/search/save/copy; no editing of existing draft/results/selection.
- Show each requested numbered slot during loading/failure. Full comparison appears only after all requested compatible detail reads succeed; unavailable/mixed-fixture data offers explained retry-all rather than a silently reduced table. Successful ended/missing publications retain their availability label.
- Each column has its own read timestamp (UTC seconds/nonzero milliseconds) and partial/stale qualification. Catalogue mismatch leaves identity unavailable; observed price/km retain their provenance and exact units. No fabricated common instant, conversion or rank.
- Explicit re-read clears old table and provides immediate loading/slow feedback; no late response or clipboard completion may announce a superseded action. Offline loaded data stays qualified. Return/retry/focus/keyboard/44px/axe and both-engine viewport/enlarged-text gates remain mandatory. [Task](roadmap/tasks/TASK-0113-synthetic-comparison-links.md) and [validation](docs/validation/TASK-0113.md) govern acceptance.
- Local sign-off: code APPROVE, architecture CLEAR and independently inspected Windows/Linux Chromium/WebKit pixels APPROVE. Both full browser suites361 pass/7 existing exclusions; Windows full production-source run precedes two fixture-only clock repairs validated20/20 separately, Linux full run includes them. No relaxed assertion/budget/exclusion. Exact-source/main delivery remains pending and is not implied by visual approval.
