# Auto World design contract

## Source of truth
- Status: TASK-0007 implementation visually approved on its dedicated branch; final delivery gates remain in [validation](docs/validation/TASK-0007.md). The later synthetic search/detail/Saved flow is not implemented.
- Last refreshed: 2026-10-08.
- Primary product surfaces: responsive web search, results, synthetic listing detail and local saved listings. Native mobile comes later.
- Evidence reviewed: [product UX](docs/PRODUCT_UX.md), [roadmap](ROADMAP.md), [Definition of Done](docs/DEFINITION_OF_DONE.md), [vehicle intelligence](docs/VEHICLE_INTELLIGENCE.md), implemented `apps/web/src/app/`, shared `packages/design-system/` and [reviewed viewport/state screenshots](docs/validation/TASK-0007.md#visual-and-interaction-evidence).

## Brand
- Personality: calm, precise, premium and helpful; clarity over decoration.
- Trust signals: visible synthetic/demo label, observation provenance, explicit unknowns and reversible actions.
- Avoid: copying Apple assets or layouts, invented car imagery/specifications, fake deal/trust badges, dashboard clutter and dark patterns.

## Product goals
- Goals: understand a small search result quickly, inspect its evidence, save and revisit it without losing context.
- Non-goals for synthetic P1: real marketplace inventory, AI search, account sync, valuation, VIN/history reports and import estimates.
- Success signals: task completion in the E2E flow, readable cards, stable layout, accessible controls and measured responsiveness.

## Personas and jobs
- Primary persona: a mobile-first vehicle shopper comparing possible listings; desktop shoppers use the same core flow.
- Jobs: narrow results, inspect price/mileage observations and their source, save/remove a listing and recover from missing data.
- Key context: one-handed phone use, slower networks, screen readers and keyboard navigation on web.

## Information architecture
- Primary navigation in this slice: Search/Results and Saved; synthetic listing detail is reached from a result or saved item. A resolved Vehicle page is later scope.
- Core routes: search/results, synthetic listing detail and local saved list. Return to results preserves filters and scroll.
- Content hierarchy: persistent demo disclosure, search controls, scannable synthetic listing card, evidence/history on demand, one clear next action.

## Design principles
- Show only accepted facts by default; disclose provenance and contradictions progressively.
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
- New/changed components: shared tokens/primitives first, then search field/filter controls, result card, evidence row, favorite control, navigation, skeleton and recovery states.
- Variants and states: default, focus, hover, pressed, disabled, loading, empty, error, offline, partial and success where applicable.
- Token/component ownership: one shared design-system boundary before web duplication; native consumers may later reuse semantic tokens without forcing identical platform widgets.

## Accessibility
- Target standard: WCAG 2.2 AA for web.
- Keyboard/focus behavior: every action operable in document order, visible focus, Escape closes overlays, focus returns to trigger.
- Contrast/readability: verify semantic tokens in light and dark themes; do not convey status by color alone.
- Screen-reader semantics: labelled search/filter/save controls, useful result counts and polite state announcements; evidence timestamps and uncertainty have readable text.
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

## Content voice
- Tone: concise, neutral and decision-oriented.
- Terminology: say “données de démonstration” persistently; say “observé le …” for an observation and “non vérifié” for unsupported claims.
- Microcopy rules: no “bonne affaire”, “historique vérifié”, “VIN certifié” or real-source endorsement in the synthetic slice.

## Implementation constraints
- Framework/styling system: TASK-0007 implements Next.js 16.3.8 / React 19.3.0 / TypeScript 5.9.2 on the pinned workspace toolchain. Server-rendered document/page plus one ephemeral client island; CSS handles initial system appearance without storage reads or hydration effects. The only layout effect restores focus after a user-triggered state replacement. No second UI framework.
- Design-token constraints: establish semantic tokens in a shared boundary; do not create an additional UI framework or add dependencies without a reviewed need.
- Performance constraints: search p95 under 500 ms outside generation, stable layout, responsive input and no LLM in the deterministic path; measure rather than infer.
- Compatibility constraints: public DTOs are separate from internal VIN/policy/raw contracts; synthetic composition is dev/test only.
- Test/screenshot expectations: E2E keyboard/touch/offline/reopen flows; viewport screenshots and independent UX/accessibility/performance review before a user-facing task is Done.

## Open questions and sign-off
- [x] Independent Product/UX reviewer: APPROVE for TASK-0007's exact palette, platform-native hierarchy, wordmark, local icons and 14 phone/tablet/desktop/state screenshots. The original 320px primary-action clipping was repaired and independently rechecked with its focus outline fully contained. Final production branding remains separate; this sign-off covers the implemented component preview, not later screens.
- [x] Frontend/architecture boundary: exact framework versions and server/client hydration contract recorded in TASK-0007 validation and architecture docs; no persistent storage in this task.
- [ ] TASK-0103 owner: implement the separately versioned `localStorage` favorite schema with denied/quota/corrupt recovery before the Saved flow ships.
- [ ] Product owner: decide whether a later public-ready search includes natural-language parsing; the synthetic slice explicitly does not claim it.
