import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { diagnosticCode } from "./collect-browser.mjs";
import { extractLeboncoinDomObservation } from "./extract.mjs";
import { MIN_INTERVAL_MS, TARGET_URL, projectAttempt, runAutonomousSequence, safeRuntimeMetadata } from "./autonomous-probe.mjs";

const ORIGINAL = readFileSync(new URL("./fixtures/3305814470.json", import.meta.url));
const START = Date.parse("2026-11-22T13:00:00.000Z");
const metadata = { env: { GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123456789", GITHUB_RUN_ATTEMPT: "1" },
  runtime: { node: "22.23.2", platform: "linux", arch: "x64" } };
const iso = (ms) => new Date(ms).toISOString();
const window = (attempt = 1, start = START) => ({ attempt, startedAt: iso(start), completedAt: iso(start + 100) });

// Synthetic execution stub for pure tests. This never launches a browser, and is
// never supplied to the live CLI, whose inputs come only from its own child run.
function executed(start = START) {
  const snapshot = JSON.parse(ORIGINAL.toString("utf8"));
  const runtime = { node: "v22.23.2", context: "fresh_nonpersistent", headless: true, shared_profile: false,
    chromium_sandbox: true, playwright_version: "1.64.0", chromium_version: "156.0.8078.79" };
  snapshot.acquisition = "own_playwright_dom";
  snapshot.captured_at = iso(start + 50);
  snapshot.runtime = runtime;
  snapshot.transport = { engine: "playwright_chromium", navigation_status: 200 };
  const snapshotBytes = Buffer.from(`${JSON.stringify(snapshot)}\n`);
  const normalized = extractLeboncoinDomObservation(snapshotBytes, { expectedUrl: TARGET_URL, expectedListingId: "3305814470" });
  return { execution: "finished", exitCode: 0, snapshotBytes, normalizedBytes: Buffer.from(`${JSON.stringify(normalized)}\n`),
    report: { schema_version: "leboncoin-own-browser-attempt/v1", acquisition: "own_playwright_dom",
      requested_url: TARGET_URL, url: TARGET_URL, captured_at: snapshot.captured_at,
      status: "extracted", navigation_status: 200, extraction_status: "listing", core_fields_observed: true, issue_count: 0,
      runtime, transport: { engine: "playwright_chromium", navigation_attempts: 1, retries: 0, redirect_count: 0 } } };
}

function unsuccessful(status, start = START) {
  const input = executed(start);
  input.exitCode = 2;
  input.report.status = status;
  input.report.core_fields_observed = false;
  input.report.extraction_status = "not_attempted";
  if (status === "access_blocked") input.report.navigation_status = 403;
  delete input.snapshotBytes;
  delete input.normalizedBytes;
  return input;
}

function harness(run) {
  let now = START;
  const calls = [];
  const waits = [];
  const publications = [];
  return { calls, waits, publications,
    execute: () => runAutonomousSequence({ metadata, clock: () => now,
      run: async (attempt, startedAt) => {
        calls.push({ attempt, startedAt });
        const input = await run(attempt, now);
        now += 100;
        return input;
      },
      wait: async (ms) => { waits.push({ ms, at: now }); now += ms; },
      publish: async (receipt) => { publications.push(JSON.parse(JSON.stringify(receipt))); },
    }),
  };
}

test("three successful dispatches wait five minutes after each previous completion", async () => {
  const state = harness((_, now) => executed(now));
  const receipt = await state.execute();
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.completed_observations, 3);
  assert.equal(state.calls.length, 3);
  assert.deepEqual(state.waits.map((entry) => entry.ms), [MIN_INTERVAL_MS, MIN_INTERVAL_MS]);
  for (let index = 1; index < 3; index += 1) {
    assert.equal(Date.parse(receipt.attempts[index].started_at) - Date.parse(receipt.attempts[index - 1].completed_at), MIN_INTERVAL_MS);
  }
  assert.equal(new Set(receipt.attempts.map((entry) => entry.snapshot_sha256)).size, 3);
  assert.equal(state.publications.length, 4);
  assert.deepEqual(state.publications.map((entry) => entry.completed_observations), [0, 1, 2, 3]);
});

for (const status of ["access_blocked", "partial_capture", "environment_error", "navigation_error", "unsupported_markup", "identity_mismatch", "deadline_exceeded"]) {
  test(`stops immediately on ${status}, with no wait or retry`, async () => {
    const state = harness((_, now) => unsuccessful(status, now));
    const receipt = await state.execute();
    assert.equal(receipt.status, "stopped");
    assert.equal(receipt.completed_observations, 0);
    assert.equal(receipt.attempts[0].status, status);
    assert.equal(state.calls.length, 1);
    assert.equal(state.waits.length, 0);
  });
}

test("stops on the second incomplete result rather than dispatching a third", async () => {
  const state = harness((attempt, now) => attempt === 1 ? executed(now) : unsuccessful("partial_capture", now));
  const receipt = await state.execute();
  assert.equal(receipt.completed_observations, 1);
  assert.equal(state.calls.length, 2);
  assert.equal(state.waits.length, 1);
});

test("a child exception or timeout cannot be retried or counted as extraction", async () => {
  const state = harness(() => { throw new Error("PRIVATE_SOURCE_CONTACT"); });
  const receipt = await state.execute();
  assert.equal(receipt.attempts[0].status, "collector_error");
  assert.equal(state.calls.length, 1);
  assert.equal(JSON.stringify(receipt).includes("PRIVATE_SOURCE_CONTACT"), false);
  const timeout = projectAttempt({ ...executed(), execution: "timeout" }, window());
  assert.equal(timeout.status, "collector_timeout");
  assert.equal(timeout.complete, false);
});

test("missing or non-finished child execution cannot count as a success", () => {
  const input = executed(); delete input.execution;
  assert.equal(projectAttempt(input, window()).complete, false);
  input.execution = "finished"; input.exitCode = 2;
  assert.equal(projectAttempt(input, window()).complete, false);
});

test("an unchanged cloud fixture never counts as an autonomous observation", () => {
  const input = executed();
  input.snapshotBytes = ORIGINAL;
  input.normalizedBytes = Buffer.from(JSON.stringify(extractLeboncoinDomObservation(ORIGINAL, {
    expectedUrl: TARGET_URL, expectedListingId: "3305814470",
  })));
  const result = projectAttempt(input, window());
  assert.equal(result.status, "invalid_evidence");
  assert.equal(result.complete, false);
  assert.equal(result.price_minor, null);
});

test("reusing an earlier snapshot fails the next dispatch time window", async () => {
  const first = executed();
  const state = harness(() => first);
  const receipt = await state.execute();
  assert.equal(state.calls.length, 2);
  assert.equal(receipt.completed_observations, 1);
  assert.equal(receipt.attempts[1].status, "invalid_evidence");
});

test("a claimed extracted status is insufficient without the core and clean evidence", () => {
  for (const change of [
    (input) => { input.report.core_fields_observed = false; },
    (input) => { input.report.issue_count = 1; },
    (input) => { input.report.runtime.chromium_sandbox = false; },
    (input) => { input.report.transport.redirect_count = 1; },
    (input) => { input.report.runtime.playwright_version = "1.62.1"; },
    (input) => { input.normalizedBytes = Buffer.from('{}'); },
    (input) => { input.snapshotBytes = Buffer.alloc(1024 * 1024 + 1); },
  ]) {
    const input = executed(); change(input);
    assert.equal(projectAttempt(input, window()).complete, false);
  }
});

test("public projection copies only allowed numeric facts and bounded diagnostics", () => {
  const input = executed();
  input.report.title = "PRIVATE_TITLE";
  input.report.contact = "PRIVATE_EMAIL";
  input.report.vin = "PRIVATE_VIN";
  input.report.runtime.executable_path = "PRIVATE_PATH";
  input.report.reason = "PRIVATE_ERROR";
  const result = projectAttempt(input, window());
  assert.equal(result.complete, true);
  assert.equal(result.price_minor, 14699000);
  assert.equal(result.mileage_km, 23000);
  assert.equal(result.model_year, 2021);
  assert.equal(result.reason_code, null);
  const output = JSON.stringify(result);
  for (const privateValue of ["PRIVATE_", "Porsche", "Carrera", "leboncoin.fr", "WVWZZZ", "image 1", "Tourcoing"]) {
    assert.equal(output.includes(privateValue), false);
  }
});

test("a modified private normalization is rejected without exposing extra fields", () => {
  const input = executed();
  const normalized = JSON.parse(input.normalizedBytes.toString("utf8"));
  normalized.private_extra = "PRIVATE_EXTRA";
  input.normalizedBytes = Buffer.from(JSON.stringify(normalized));
  const result = projectAttempt(input, window());
  assert.equal(result.complete, false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_EXTRA"), false);
});

test("runtime metadata cannot pass arbitrary environment or version text", () => {
  const result = safeRuntimeMetadata({ GITHUB_SHA: "PRIVATE_SHA", GITHUB_RUN_ID: "PRIVATE_RUN", GITHUB_RUN_ATTEMPT: "PRIVATE_ATTEMPT", SECRET: "PRIVATE_SECRET" },
    { node: "PRIVATE_NODE", platform: "PRIVATE_PLATFORM", arch: "PRIVATE_ARCH" });
  assert.equal(result.commit_sha, null);
  assert.equal(result.github_run_id, null);
  assert.equal(result.runtime.node, null);
  assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
  assert.equal(safeRuntimeMetadata({ GITHUB_SHA: `${"a".repeat(40)}\n` }, { node: "22.23.2\n" }).runtime.node, null);
});

test("sandbox and socket failures have finite actionable codes, never raw messages", () => {
  assert.equal(diagnosticCode(new Error("No usable sandbox! PRIVATE_DETAIL")), "sandbox_unavailable");
  assert.equal(diagnosticCode(new Error("socket() failed: Operation not permitted PRIVATE_DETAIL")), "local_socket_permission_denied");
  const input = unsuccessful("environment_error");
  input.report.reason = "launch:sandbox_unavailable";
  assert.equal(projectAttempt(input, window()).reason_code, "launch:sandbox_unavailable");
  input.report.reason = "launch:PRIVATE_DETAIL";
  assert.equal(projectAttempt(input, window()).reason_code, null);
});

test("a wait failure or backwards clock prevents further dispatch", async () => {
  let calls = 0;
  let now = START;
  const common = { metadata, clock: () => now, publish: async () => undefined,
    run: async () => { calls += 1; const value = executed(now); now += 100; return value; } };
  const failed = await runAutonomousSequence({ ...common, wait: async () => { throw new Error("PRIVATE_WAIT"); } });
  assert.equal(failed.status, "stopped");
  assert.equal(calls, 1);
  calls = 0; now = START;
  const shortWait = await runAutonomousSequence({ ...common, wait: async () => undefined });
  assert.equal(shortWait.stop_reason, "clock_invalid");
  assert.equal(calls, 1);
});
