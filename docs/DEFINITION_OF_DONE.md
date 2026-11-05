# DEFINITION OF DONE

## V1 prototype scope

[ADR-0028](decisions/ADR-0028-v1-prototype-functional-gate.md) permits `DONE_FOR_V1_PROTOTYPE` for isolated synthetic development after the applicable criteria below pass. TASK-0005's remaining image/scanner/security qualification is explicitly deferred until the usable V1 milestone and is not a prerequisite for this scoped completion. This is not a general security/privacy exemption: secrets, isolation, data integrity, ordinary quality checks and review of changed boundaries remain required. Record deferred qualification separately, never as PASS. Full image admission, public deployment, supported operation and real data remain blocked until their release gates pass. Functional and UI/UX criteria are unchanged.

A task is Done only if applicable items pass:
- Acceptance criteria satisfied.
- Unit/contract/integration/E2E tests added and green.
- Type/lint/build green.
- Error/empty/loading states handled.
- Logs/metrics/traces added for new backend workflow.
- Security/privacy reviewed.
- Data migration backward-compatible/rollback documented.
- Feature flag for risky rollout.
- Documentation/ADR updated.
- Analytics event validated for user-facing feature.
- Accessibility checked for UI.
- Performance budget checked.
- No TODO/FIXME blocking correctness.
- Independent review completed.
- Evidence linked in task/PR.

## User-facing UI/UX DoD extra
A user-facing feature is NOT Done merely because it functions technically.

Required when applicable:
- Flow is documented from user intent to successful completion.
- Mobile-first behavior verified on representative phone viewport(s).
- Responsive web behavior verified on representative desktop/tablet viewport(s).
- Shared design-system components/tokens are used; no unnecessary one-off styling.
- Visual hierarchy, spacing, typography and information density are coherent with `docs/PRODUCT_UX.md`.
- Loading uses appropriate skeleton/progressive feedback rather than unexplained blocking waits.
- Empty, error, offline, slow-network, partial-data and success states are intentional and understandable.
- Primary actions are obvious; destructive/irreversible actions are clearly distinguished.
- Interaction feedback is immediate and animations/transitions are purposeful, short and smooth.
- No visible layout shift, accidental horizontal overflow, clipped content or obvious jank in normal use.
- Touch targets, focus states, keyboard navigation and screen-reader semantics are checked where applicable.
- Core user flow is covered by E2E tests.
- Visual inspection evidence is attached to PR/task for material UI changes.
- UX review confirms that advanced capability is progressively disclosed rather than dumped into the default surface.
- Copy is concise, human and consistent; technical/source vocabulary is not exposed unless useful to the user.

A visually crude, inconsistent, confusing or sluggish interface must fail review even when automated tests pass.

## Connector DoD extra
- Rights/status registry approved.
- Fixture corpus representative.
- Parser contract tests.
- Incremental + deletion behavior tested.
- Rate limit/retry/circuit breaker configured.
- Source health dashboard + alert.
- Provenance preserved.
