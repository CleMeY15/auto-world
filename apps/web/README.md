# Web app

The existing `/` design-system preview is preserved. `/demo` provides synthetic Search, Results, Detail and Saved under [ADR-0016](../../docs/decisions/ADR-0016-synthetic-web-flow.md). Every screen discloses that no vehicle is for sale. Observations, contradictions, missing values and withdrawn publications stay explicit. Unsupported free text remains editable and sends no invented query.

Build with the pinned Node22.23.2/pnpm10.15.0 toolchain. Run `pnpm --filter @auto-world/api demo` in one terminal. In another, set the server-only `AUTO_WORLD_DEMO=1` and run `pnpm --filter @auto-world/web start --port 3107`. Open `http://127.0.0.1:3107/demo`. Both processes bind loopback; the proxy uses only the fixed API3210 and public DTOs.

Favorites persist only validated public IDs under the versioned local key. Storage failures retain qualified session state; unread/corrupt/future values are protected. Cross-tab undo stays truthful and reset requires confirmation. With the flag disabled, Saved remains locally recoverable without API fetching; proxy routes return404.

`pnpm --filter @auto-world/web test` covers helpers and production traces. `pnpm test:ui` owns API3210, enabled production web3107 and disabled production web3110 without reuse. Actual API flow/performance, simulated recovery, visual/accessibility matrices and rollback recovery have separate evidence. See [validation](../../docs/validation/TASK-0103.md) for reviews, measurements and delivery gates.
