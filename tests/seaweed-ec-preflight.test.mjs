import assert from "node:assert/strict";
import test from "node:test";
import { EC_PACKAGE, EC_TESTS, ecTestArguments, requireEcPreflight, summarizeEcPreflight } from "../scripts/seaweed/ec-preflight.mjs";

const events = (failed = false) => [
  ...EC_TESTS.map((Test, index) => ({ Package: EC_PACKAGE, Test, Action: failed && index === 0 ? "fail" : "pass" })),
  { Package: EC_PACKAGE, Action: failed ? "fail" : "pass" },
];
const bytes = (value) => Buffer.from(value.map(JSON.stringify).join("\n") + "\n");

test("EC preflight runs only both exact upstream tests with the existing test flags", () => {
  assert.deepEqual(ecTestArguments(), ["test", "-json", "-count=1", "-p=2", "-run", "^(TestEcEncodeLeavesRightFilesAndRemovesStubAndSource|TestEcEncodeJulorLayoutConverges)$", "./weed/worker/tasks/erasure_coding"]);
});

test("EC preflight distinguishes complete passing and ordinary failed arms", () => {
  const passed = summarizeEcPreflight(bytes(events()), 0);
  const failed = summarizeEcPreflight(bytes(events(true)), 1);
  assert.equal(passed.result, "PASSED"); assert.equal(failed.result, "FAILED");
  assert.deepEqual(failed.tests.map(({ result }) => result), ["fail", "pass"]);
  assert.doesNotThrow(() => requireEcPreflight(passed, passed));
  for (const pair of [[failed, passed], [passed, failed], [undefined, passed]]) assert.throws(() => requireEcPreflight(...pair), /seaweed_ec_preflight_failed/u);
});

test("EC preflight rejects incomplete, skipped, contradictory, foreign and malformed evidence", () => {
  const cases = [events().slice(1), events().slice(0, 2), [...events(), events()[0]],
    events().map((event, index) => index === 0 ? { ...event, Action: "skip" } : event),
    events().map((event) => ({ ...event, Package: "foreign" })),
    [{ ...events()[0], Test: "TestUnexpected" }, ...events().slice(1)],
    [...events(), { Package: EC_PACKAGE, Test: `${EC_TESTS[0]}/child`, Action: "fail" }]];
  for (const value of cases) assert.equal(summarizeEcPreflight(bytes(value), 0).result, "INVALID");
  for (const status of [1, null, 2, 125]) assert.equal(summarizeEcPreflight(bytes(events()), status).result, "INVALID");
  assert.equal(summarizeEcPreflight(Buffer.from("bad-json"), 0).result, "INVALID");
  assert.equal(summarizeEcPreflight(bytes(events(true)), 0).result, "INVALID");
});
