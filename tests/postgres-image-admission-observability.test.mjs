import assert from "node:assert/strict";
import test from "node:test";

import * as observabilityModule from "../scripts/postgres-image/admission-observability.mjs";

const { createPostgresAdmissionObservability } = observabilityModule;
const INTENTS = ["SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP", "RESTORE_VERIFY"];
const PHASES = ["AUTHORITY", "IMAGE_ACQUIRE", "DAEMON_START", "IMAGE_LOAD", "VOLUME_CREATE", "CONTAINER_CREATE",
  "CONTAINER_START", "READINESS", "SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP", "RESTORE_VERIFY", "STOP", "CLEANUP"];

test("admission observability emits bounded canonical events and fixed-label metrics", () => {
  assert.deepEqual(Object.keys(observabilityModule), ["createPostgresAdmissionObservability"]);
  const lines = [], observability = createPostgresAdmissionObservability({ emit: line => { lines.push(line); } });
  assert.equal(Object.isFrozen(observability), true);
  const authority = observability.authorityCheck({ result: "SUCCEEDED", reason: "NONE", durationMs: 12.5,
    authoritySha256: "a".repeat(64) });
  observability.leaseState({ state: "CURRENT" });
  observability.renewal({ result: "FAILED", reason: "ARCHIVE_STALE", durationMs: 20 });
  observability.session({ intent: "SERVICE", result: "FAILED", reason: "REVOKED", durationMs: 30 });
  observability.phase({ phase: "STOP", result: "SUCCEEDED", reason: "NONE", durationMs: 4 });
  observability.drain({ result: "SUCCEEDED", reason: "REVOKED", durationMs: 8 });
  observability.currentness({ p2SecondsRemaining: 100, p3SettingsSecondsRemaining: 200,
    p3ManifestSecondsRemaining: 300, archiveHealthSecondsRemaining: 400, supportSecondsRemaining: 500 });
  observability.alert({ alert: "ARCHIVE_WARNING", severity: "WARNING", reason: "ARCHIVE_STALE", durationMs: 0, publicId: null });
  assert.equal(Object.isFrozen(authority), true); assert.equal(lines.length, 8);
  for (const line of lines) {
    assert.equal(line.endsWith("\n"), true); assert.ok(Buffer.byteLength(line) <= 4096);
    assert.deepEqual(`${JSON.stringify(JSON.parse(line))}\n`, line);
    assert.doesNotMatch(line, /authorization|cookie|environment|password|secret|path|receipt|stdout|stderr/iu);
  }
  const snapshot = observability.snapshot();
  assert.equal(Object.isFrozen(snapshot), true); assert.equal(Object.isFrozen(snapshot.counters), true);
  assert.deepEqual(snapshot.counters.map(item => item.value), [1, 1, 1, 1, 1]);
  assert.equal(snapshot.gauges.length, 12);
  assert.equal(snapshot.gauges.find(item => item.name.includes("state=CURRENT")).value, 1);
});

test("admission observability accepts every closed intent and phase including SQL_CHECK", () => {
  const lines = [], observability = createPostgresAdmissionObservability({ emit: line => { lines.push(line); } });
  for (const intent of INTENTS) {
    assert.equal(observability.session({ intent, result: "SUCCEEDED", reason: "NONE", durationMs: 0 }).intent, intent);
  }
  for (const phase of PHASES) {
    assert.equal(observability.phase({ phase, result: "SUCCEEDED", reason: "NONE", durationMs: 0 }).phase, phase);
  }
  assert.equal(lines.length, INTENTS.length + PHASES.length);
  assert.equal(lines.some(line => line.includes('"intent":"SQL_CHECK"')), true);
  assert.equal(lines.some(line => line.includes('"phase":"SQL_CHECK"')), true);
});

test("admission observability rejects open labels, unsafe values, and sink ambiguity", () => {
  const observability = createPostgresAdmissionObservability({ emit() {} });
  assert.throws(() => observability.renewal({ result: "OK", reason: "NONE", durationMs: 1 }),
    /postgres_admission_observability_invalid/u);
  assert.throws(() => observability.currentness({ p2SecondsRemaining: -1, p3SettingsSecondsRemaining: 1,
    p3ManifestSecondsRemaining: 1, archiveHealthSecondsRemaining: 1, supportSecondsRemaining: 1 }),
  /postgres_admission_observability_invalid/u);
  assert.throws(() => observability.alert({ alert: "ARCHIVE_WARNING", severity: "WARNING", reason: "ARCHIVE_STALE",
    durationMs: 0, publicId: "SECRET" }), /postgres_admission_observability_invalid/u);
  const failed = createPostgresAdmissionObservability({ emit() { throw new Error("private sink detail"); } });
  assert.throws(() => failed.session({ intent: "SQL_CHECK", result: "SUCCEEDED", reason: "NONE", durationMs: 1 }),
    /postgres_admission_observability_sink_failed/u);
  assert.deepEqual(failed.snapshot(), { counters: [], gauges: [] });
  const ambiguous = createPostgresAdmissionObservability({ emit() { return true; } });
  assert.throws(() => ambiguous.phase({ phase: "SQL_CHECK", result: "SUCCEEDED", reason: "NONE", durationMs: 1 }),
    /postgres_admission_observability_sink_failed/u);
  assert.deepEqual(ambiguous.snapshot(), { counters: [], gauges: [] });
});
