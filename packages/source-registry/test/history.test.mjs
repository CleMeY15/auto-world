import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendSourceRevision,
  parseSourceRegistry,
} from "@auto-world/source-registry";
import {
  cloneSynthetic,
  syntheticConfiguration,
  syntheticEnabledRegistry,
  syntheticEvent,
  syntheticRegistry,
  syntheticRevision,
} from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

function enableRevision(configuration = syntheticConfiguration()) {
  return syntheticRevision({
    revision: 2,
    state: "enabled",
    configuration,
    event: syntheticEvent({
      eventId: "aud_synthetic_enable",
      kind: "enable",
      at: "2026-01-02T00:00:00.000Z",
      reasonRef: "reason_synthetic_enable",
    }),
  });
}

test("appends a valid disabled-to-enabled transition and preserves genesis", () => {
  const current = syntheticRegistry();
  const next = enableRevision(cloneSynthetic(current.revisions[0].configuration));
  const appended = assertSuccess(appendSourceRevision(current, next));
  assert.equal(appended.revisions.length, 2);
  assert.deepEqual(appended.revisions[0], current.revisions[0]);
  assert.deepEqual(appended.revisions[1], next);
  assert.equal(Object.isFrozen(appended.revisions), true);
});

test("accepts only an identical entire latest revision replay", () => {
  const current = syntheticEnabledRegistry();
  assert.deepEqual(assertSuccess(appendSourceRevision(current, cloneSynthetic(current.revisions[1]))), assertSuccess(parseSourceRegistry(current)));
});

test("rejects a changed latest revision replay", () => {
  const current = syntheticEnabledRegistry();
  const changed = cloneSynthetic(current.revisions[1]);
  changed.event.reasonRef = "reason_changed";
  assert.equal(appendSourceRevision(current, changed).success, false);
});

test("rejects replay of an older revision", () => {
  const current = syntheticEnabledRegistry();
  assert.equal(appendSourceRevision(current, cloneSynthetic(current.revisions[0])).success, false);
});

test("rejects revision gaps", () => {
  const next = enableRevision();
  next.revision = 3;
  assert.equal(appendSourceRevision(syntheticRegistry(), next).success, false);
});

test("rejects duplicate audit event IDs", () => {
  const next = enableRevision();
  next.event.eventId = "aud_synthetic_create";
  assert.equal(appendSourceRevision(syntheticRegistry(), next).success, false);
});

test("rejects decreasing audit timestamps", () => {
  const next = enableRevision();
  next.event.at = "2025-12-31T23:59:59.999Z";
  assert.equal(appendSourceRevision(syntheticRegistry(), next).success, false);
});

test("requires unchanged configuration for enable and disable events", () => {
  const changed = cloneSynthetic(syntheticRegistry().revisions[0].configuration);
  changed.displayName = "Changed during enable";
  assert.equal(appendSourceRevision(syntheticRegistry(), enableRevision(changed)).success, false);
});

test("requires configuration replacement to leave the source disabled", () => {
  const current = syntheticEnabledRegistry();
  const next = syntheticRevision({
    revision: 3,
    state: "enabled",
    configuration: syntheticConfiguration({ displayName: "Replacement" }),
    event: syntheticEvent({
      eventId: "aud_synthetic_replace",
      kind: "replace_configuration",
      at: "2026-02-01T00:00:00.000Z",
      reasonRef: "reason_synthetic_replace",
    }),
  });
  assert.equal(appendSourceRevision(current, next).success, false);
});

test("rejects disabled-to-disabled replacement with unchanged configuration", () => {
  const current = syntheticRegistry();
  const next = syntheticRevision({
    revision: 2,
    state: "disabled",
    configuration: cloneSynthetic(current.revisions[0].configuration),
    event: syntheticEvent({
      eventId: "aud_synthetic_noop_replace",
      kind: "replace_configuration",
      at: "2026-02-01T00:00:00.000Z",
      reasonRef: "reason_synthetic_replace",
    }),
  });
  assertIssue(appendSourceRevision(current, next), "invalid_value", "$.nextRevision.configuration");
});

test("rejects enabled-to-disabled replacement with unchanged configuration", () => {
  const current = syntheticEnabledRegistry();
  const next = syntheticRevision({
    revision: 3,
    state: "disabled",
    configuration: cloneSynthetic(current.revisions[1].configuration),
    event: syntheticEvent({
      eventId: "aud_synthetic_disguised_disable",
      kind: "replace_configuration",
      at: "2026-02-01T00:00:00.000Z",
      reasonRef: "reason_synthetic_replace",
    }),
  });
  assertIssue(appendSourceRevision(current, next), "invalid_value", "$.nextRevision.configuration");
});

test("retains full prior snapshots across configuration replacement", () => {
  const current = syntheticEnabledRegistry();
  const next = syntheticRevision({
    revision: 3,
    state: "disabled",
    configuration: syntheticConfiguration({ displayName: "Synthetic replacement" }),
    event: syntheticEvent({
      eventId: "aud_synthetic_replace",
      kind: "replace_configuration",
      at: "2026-02-01T00:00:00.000Z",
      reasonRef: "reason_synthetic_replace",
    }),
  });
  const appended = assertSuccess(appendSourceRevision(current, next));
  assert.deepEqual(appended.revisions.slice(0, 2), assertSuccess(parseSourceRegistry(current)).revisions);
  assert.equal(appended.revisions[2].configuration.displayName, "Synthetic replacement");
});

test("makes takedown terminal", () => {
  const current = syntheticEnabledRegistry();
  const takedown = syntheticRevision({
    revision: 3,
    state: "takedown",
    configuration: cloneSynthetic(current.revisions[1].configuration),
    event: syntheticEvent({
      eventId: "aud_synthetic_takedown",
      kind: "takedown",
      at: "2026-02-01T00:00:00.000Z",
      reasonRef: "reason_synthetic_takedown",
    }),
  });
  const takenDown = assertSuccess(appendSourceRevision(current, takedown));
  const after = syntheticRevision({
    revision: 4,
    state: "disabled",
    configuration: cloneSynthetic(takedown.configuration),
    event: syntheticEvent({
      eventId: "aud_synthetic_after_takedown",
      kind: "disable",
      at: "2026-02-02T00:00:00.000Z",
      reasonRef: "reason_synthetic_disable",
    }),
  });
  assert.equal(appendSourceRevision(takenDown, after).success, false);
});

test("does not mutate registry or revision inputs during append", () => {
  const current = syntheticRegistry();
  const next = enableRevision(cloneSynthetic(current.revisions[0].configuration));
  const beforeCurrent = JSON.stringify(current);
  const beforeNext = JSON.stringify(next);
  assertSuccess(appendSourceRevision(current, next));
  assert.equal(JSON.stringify(current), beforeCurrent);
  assert.equal(JSON.stringify(next), beforeNext);
  assert.equal(Object.isFrozen(current), false);
  assert.equal(Object.isFrozen(next), false);
});
