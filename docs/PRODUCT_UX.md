# PRODUCT & UX CONTRACT — Auto World

## Product experience objective
Auto World must make a technically complex global automotive search system feel simple, calm and immediately understandable.

The quality bar is inspired by the principles associated with the best Apple product experiences: clarity, restraint, strong hierarchy, fluidity, consistency, excellent defaults and attention to detail. This is a quality reference, not permission to copy Apple proprietary visual assets, layouts, wording, icons or branding.

The interface itself is a strategic differentiator against legacy aggregators. UX quality must therefore be designed and tested continuously, not added at the end.

## Experience principles
1. **Simple first, complete underneath.** The default surface exposes only what is necessary. Advanced filters and analysis appear through progressive disclosure.
2. **Search is the hero.** Natural-language search and fast structured filters are both first-class and converge on the same canonical query model.
3. **One obvious next action.** Every major state should make the primary next step visually clear.
4. **Vehicle information is decision-oriented.** Prioritize what helps decide: image, exact model/variant, price, mileage, year, location, deal confidence, history, provenance and import implications.
5. **Speed is part of design.** Perceived responsiveness matters as much as backend latency.
6. **Motion explains, never distracts.** Transitions should preserve context and communicate state changes.
7. **Native where it matters.** Web, iOS and Android share product language and tokens while respecting platform navigation, gestures, safe areas and accessibility conventions.
8. **Trust is visible.** Provenance, uncertainty and estimated values are clearly differentiated from verified facts.
9. **No dead ends.** Empty/error/offline states always explain what happened and offer a useful recovery action.
10. **Consistency over novelty.** Reuse established patterns before creating new ones.

## Core information architecture
The consumer experience should converge around five understandable destinations:
- **Search / Discover** — natural-language query, recent searches, smart suggestions and structured filters.
- **Results** — fast scannable vehicle cards, sorting, filters, map/list where useful, saved search.
- **Vehicle** — complete decision page: media, key facts, price/deal analysis, equipment, history, source/seller, import cost, comparisons.
- **Saved** — favorites, comparisons, saved searches and alerts.
- **Account** — preferences, markets/currencies, notification controls, premium and privacy.

Navigation should remain shallow. Avoid duplicating destinations or creating menu hierarchies that hide core actions.

## Home / search experience
The first screen should communicate the product promise within seconds.

Preferred hierarchy:
1. concise value proposition;
2. prominent natural-language search field;
3. optional quick chips / recent searches;
4. high-value discovery modules only when relevant;
5. no dashboard-like clutter.

Example user intent:
`Mercedes S-Class 2021+, less than €80k, Burmester, France Germany or Korea`

The system converts intent into visible structured criteria so the user can understand and edit what the AI inferred.

## Results experience
A result card must be understandable in roughly two seconds.

Primary information:
- strong vehicle image;
- canonical make/model/variant;
- price;
- year / mileage;
- country or locality;
- deal/fair-price signal only when confidence is sufficient;
- favorite action;
- source count when deduplicated across marketplaces.

Secondary details remain accessible without overloading the default card.

Filters must:
- open quickly;
- retain selections reliably;
- show active criteria clearly;
- support reset/undo;
- avoid forcing repeated full-screen navigation for common changes;
- work with one hand on mobile where practical.

## Vehicle detail experience
Structure the page by decision priority rather than source data order.

Recommended sections:
1. media gallery;
2. identity + key specifications;
3. price + market/deal explanation;
4. primary CTA to original seller/source;
5. price history / listing history;
6. equipment and detected options;
7. seller/source and provenance;
8. import-cost module when cross-border;
9. comparable vehicles;
10. technical detail for advanced users.

Estimated or AI-derived information must carry confidence/qualification. Never visually present inference as verified source fact.

## Design system
Create a shared `packages/design-system` with documented primitives before UI duplication grows.

At minimum define:
- semantic color tokens;
- typography scale;
- spacing scale;
- radius scale;
- elevation/surface model;
- icon rules;
- motion durations/easing;
- breakpoints/layout primitives;
- focus and accessibility tokens;
- component states.

Core reusable components should include buttons, fields, search field, chips, filter controls, cards, sheets/modals, navigation, tabs, segmented controls, skeletons, toasts, banners, empty/error states, price/deal indicators and vehicle media.

Support light and dark themes from tokens rather than one-off overrides.

## Visual direction
Desired character:
- generous whitespace;
- precise alignment;
- restrained use of borders and decoration;
- strong photography;
- clear typography hierarchy;
- limited simultaneous emphasis;
- premium but neutral visual language;
- dense information available on demand, not always visible.

Avoid:
- gradients/effects without information purpose;
- excessive cards-inside-cards;
- dashboard aesthetics for consumer search;
- giant blocks of filters on initial load;
- tiny automotive-spec text walls;
- inconsistent radii/icon sets/spacing;
- animations that delay interaction;
- generic template appearance.

## Motion and feedback
- Prefer immediate state updates with optimistic feedback where safe.
- Use skeletons for content that has predictable geometry.
- Preserve scroll/context when opening filters or returning from a vehicle.
- Animations should usually be short and interruptible.
- Respect reduced-motion preferences.
- Haptics may be used sparingly for meaningful native mobile confirmations.

## Performance experience budgets
Exact budgets may be refined with measurement, but UX implementation must actively protect:
- rapid first usable surface;
- responsive typing/filter interaction;
- stable layouts during image/data loading;
- smooth scrolling on representative mid-range mobile hardware;
- progressive image loading/caching;
- no LLM call required to render deterministic search results.

Performance regressions in primary flows are release blockers when material.

## Accessibility
Target WCAG 2.2 AA for web where applicable and equivalent native accessibility practices.

Required considerations include semantic labels, dynamic text scaling, contrast, focus visibility, keyboard paths, screen-reader ordering, reduced motion, non-color-only status communication and adequate touch targets.

## UX validation process
For each material flow:
1. state user goal and success condition;
2. define happy path and major recovery states;
3. implement using design system;
4. test mobile first;
5. test responsive desktop/tablet;
6. verify accessibility;
7. verify perceived/actual performance;
8. capture screenshots or other visual evidence in PR;
9. conduct independent UX review before Done when impact is significant.

## Product metrics
UX decisions should eventually be informed by metrics such as:
- search-to-result success;
- result-to-vehicle-detail rate;
- time to first useful result;
- filter abandonment;
- saved-search/favorite conversion;
- alert engagement;
- return-to-results continuity;
- crash/error rate;
- Core Web Vitals / native responsiveness;
- task completion in usability tests.

Metrics guide iteration but do not justify deceptive patterns or visual clutter.

## Non-negotiable release rule
A feature can pass backend tests and still fail release if it feels unfinished.

If a reasonable user encounters confusing hierarchy, inconsistent interaction, obvious jank, missing states or an interface that feels like an internal tool, the user-facing feature is not Done.
