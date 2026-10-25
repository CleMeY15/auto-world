import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "@auto-world/connector-sdk";
import {
  adapter,
  copy,
  fakeLease,
  fakeTime,
  registry,
  request,
} from "../test-support/fixtures.mjs";
import { syntheticStore } from "../test-support/store.mjs";

async function genuineCheckpoints() {
  const time = fakeTime();
  const trace = [];
  const storage = syntheticStore(time, trace);
  const sourceRegistry = registry();
  const ports = {
    clock: time.clock,
    scheduler: time.scheduler,
    random: { next: () => 0 },
    telemetry: { emit() {} },
    lease: fakeLease(time, trace),
    store: storage.port,
    adapter: adapter(undefined, trace),
    authority: {
      async loadVerifiedCurrent(input) {
        return {
          trust: "authenticated_current",
          registry: sourceRegistry,
          authorityRevision: sourceRegistry.revisions.at(-1).revision,
          verifiedAsOf: input.asOf,
          authorizationBasisRef: sourceRegistry.revisions.at(-1).configuration.policy.authorization.basisRef,
        };
      },
    },
  };
  const result = await time.drive(sdk.runConnector(request(), ports));
  assert.equal(result.status, "completed", JSON.stringify(result));
  const snapshot = storage.snapshot();
  return {
    completed: [...snapshot.runs.values()][0],
    running: [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed").data.checkpoint,
  };
}

test("the public checkpoint parser detaches and deeply freezes genuine SDK checkpoints", async () => {
  assert.equal(typeof sdk.parseConnectorCheckpoint, "function");
  const { completed, running } = await genuineCheckpoints();
  for (const checkpoint of [running, completed]) {
    const originalMode = checkpoint.request.mode;
    const parsed = sdk.parseConnectorCheckpoint(checkpoint);
    assert.equal(parsed.success, true, JSON.stringify(parsed));
    assert.notEqual(parsed.data, checkpoint);
    assert.equal(Object.isFrozen(parsed.data), true);
    assert.equal(Object.isFrozen(parsed.data.request), true);
    assert.equal(Object.isFrozen(parsed.data.scope), true);
    checkpoint.request.mode = originalMode === "full" ? "incremental" : "full";
    assert.equal(parsed.data.request.mode, originalMode);
  }
});

test("the public checkpoint parser rejects malformed terminal fields and hostile objects", async () => {
  const { completed, running } = await genuineCheckpoints();
  const malformed = [
    (value) => { value.status = "unsupported"; },
    (value) => { value.completionOperationKey = 42; },
    (value) => { value.finalInventoryRevision = 1.5; },
    (value) => { value.finalInventoryGenerationId = {}; },
    (value) => { value.completedAt = 42; },
    (value) => { value.result = {}; },
  ];
  for (const mutate of malformed) {
    const candidate = copy(running);
    mutate(candidate);
    assert.equal(sdk.parseConnectorCheckpoint(candidate).success, false);
  }
  for (const mutate of [
    (value) => { value.completedAt = 42; },
    (value) => { value.result = {}; },
  ]) {
    const candidate = copy(completed);
    mutate(candidate);
    assert.equal(sdk.parseConnectorCheckpoint(candidate).success, false);
  }

  let getterCalled = false;
  const accessor = copy(running);
  Object.defineProperty(accessor, "status", { enumerable: true, get() { getterCalled = true; return "running"; } });
  assert.equal(sdk.parseConnectorCheckpoint(accessor).success, false);
  assert.equal(getterCalled, false);

  const revocable = Proxy.revocable(copy(running), {});
  revocable.revoke();
  assert.equal(sdk.parseConnectorCheckpoint(revocable.proxy).success, false);
});
