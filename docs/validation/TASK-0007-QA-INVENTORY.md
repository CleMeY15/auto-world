# TASK-0007 QA inventory

This inventory maps the bounded design-system and web-foundation claims to executable evidence. It does not claim that the later Search → Results → Listing detail → Saved product flow exists.

## Automated evidence

| Claim | Controls or states | Viewports / profile | Evidence |
| --- | --- | --- | --- |
| Keyboard operation, focus order and validation recovery work | Skip link, budget field, submit, chip, reset, theme, state selector, retry | 390 × 844; Chromium and WebKit | `apps/web/test/ui/foundation.spec.ts` |
| Stateful interaction regressions stay repaired | Selected-chip hover/active contrast, Enter recovery focus, initial primary action plus focus outline fitting at 320px | Both browsers for interaction; all screenshot viewports for initial fit | `apps/web/test/ui/foundation.spec.ts` |
| Required component states remain usable and accessible | Empty, loading, error, success, disabled, light, dark, reduced motion, 200% text | 320 × 780, 390 × 844, 768 × 1024, 1440 × 900 | `apps/web/test/ui/foundation.spec.ts` screenshots, overflow checks and axe WCAG 2.2 AA checks |
| The built page stays inside bounded mobile lab budgets | Initial rendering plus real keyboard entry and submit click | Chromium, 390 × 844, 150 ms latency, 1.6 Mbps download, 4× CPU slowdown, 10 cold-cache samples | `apps/web/test/ui/performance.spec.ts` JSON attachment: LCP p75 ≤ 2.5 s, CLS p75 ≤ 0.1, Event Timing p75 ≤ 200 ms |

The Event Timing result is lab evidence for the tested controls. A missing sub-16 ms Event Timing entry is conservatively recorded as 16 ms. This is not a production INP measurement or field-performance claim.

## Exploratory cases

1. On a touch device or mobile emulator at 390 × 844, operate every control one-handed in light and dark modes. Confirm that labels stay readable, the focused/pressed state is obvious, and no action is hidden by the browser chrome or on-screen keyboard.
2. With a screen reader and 200% text, traverse the empty → loading → error → retry → success states. Confirm that announcements occur once, state meaning does not rely on color, and focus remains on a useful control after recovery.
3. On a mid-range physical Android device with network throttling, repeat theme changes, text entry and state changes while scrolling. Record any visible input delay, scroll hitch, layout movement or skeleton geometry change for follow-up even when the lab budgets pass.

## Executed exploratory evidence and limits

Persistent Chromium touch emulation at 390×844 passes invalid/decimal-comma validation, chip selection/reset, dark appearance, loaded local controls after offline switching, keyboard-safe recovery and empty ephemeral state after reload; zero page errors. ARIA snapshot reading confirms labels, regions and heading order, and 200% text/reduced motion pass in Chromium and WebKit. Independent pixel review approves the 14 initial/state screenshots plus live empty/focus behavior after the narrow-layout repair. These checks do not simulate browser chrome/on-screen keyboard or prove actual VoiceOver/TalkBack/NVDA announcements. Physical-device and actual assistive-technology cases 1–3 are not claimed executed; they remain later product-flow exploratory coverage, not a missing vehicle-search implementation in this bounded component foundation.
