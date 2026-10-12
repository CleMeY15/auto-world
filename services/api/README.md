# Auto World synthetic search API

TASK-0102 is delivered on main through [PR150](https://github.com/CleMeY15/auto-world/pull/150) with accepted final-head/identical-tree/main gates. It implements the deterministic adapter over committed SDK evidence and typed loopback API. [ADR-0014](../../docs/decisions/ADR-0014-demo-search-api.md) defines protocol, cursors, freshness and telemetry; [validation](../../docs/validation/TASK-0102.md) records delivery. This API does not resolve vehicles or authorize a real source.

The production core imports only public contracts and Fastify5.12.5. The isolated demo factory/server live outside src/dist and reject NODE_ENV=production, including forced demo conditions. Package files/exports include dist only. No database, Docker, external network/source, LLM or source credential is used. The existing SDK test-support store is a fixture proof, not durable storage.

After a successful package build, `pnpm --filter @auto-world/api demo` runs the explicit demo entrypoint on127.0.0.1:3210. POST /v1/demo/search accepts the exact versioned JSON query; GET /v1/demo/listings/:listingId reads one neutral publication, including ended history. The response includes a request ID and unchanged public synthetic envelope; unavailable/partial/stale data is explicit. The web preview is not yet connected: TASK-0103 owns that flow and same-origin proxy.

Host/Origin are exact loopback identities and Forwarded/X-Forwarded-* are rejected. A five-second application deadline cancels a stalled read; late results cannot change the response or terminal telemetry. SDK associations and referenced observations fail closed when missing or mismatched.

Run package tests/typecheck/lint/build plus root/browser/secrets/dependency gates. `test:performance` measures only the committed-fixture profile, with sample/environment evidence; no production latency guarantee follows. Rollback disables the demo entrypoint and reverts the isolated API increment without rewriting canonical SDK evidence, history or image admission.
