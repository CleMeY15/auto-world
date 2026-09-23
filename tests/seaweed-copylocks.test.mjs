import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BASELINE_COPYLOCKS, requireBaselineCopylocks } from "../scripts/seaweed/copylocks.mjs";

const pristineSum = readFileSync(new URL("./fixtures/seaweed-source/upstream/go.sum", import.meta.url));
const validate = (bytes, result) => requireBaselineCopylocks(bytes, result, pristineSum);
const execution = { status: 1, groupAbsent: true };
const log = (lines = BASELINE_COPYLOCKS) => Buffer.from(`${lines.join("\n")}\n`);

test("baseline vet characterizes the exact18 diagnostic multiset and binds the actual bytes", () => {
  const bytes = log();
  assert.equal(bytes.length, 3799);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "95444f6297aa2139935bdfb4236faeb71eda5eba4edab2fb3c6e3985df2f4178");
  const proof = validate(bytes, execution);
  assert.deepEqual(proof, { result: "EXPECTED_FAILURE", exitStatus: 1, groupAbsent: true,
    log: { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }, diagnostics: BASELINE_COPYLOCKS, downloads: [] });
  const reordered = validate(log([...BASELINE_COPYLOCKS].reverse()), execution);
  assert.deepEqual(reordered.diagnostics, proof.diagnostics);
  assert.notEqual(reordered.log.sha256, proof.log.sha256);
  const header = "# github.com/seaweedfs/seaweedfs/weed/admin/plugin";
  assert.deepEqual(validate(log([header, ...BASELINE_COPYLOCKS]), execution).diagnostics, BASELINE_COPYLOCKS);
  assert.throws(() => validate(log([header, header, ...BASELINE_COPYLOCKS]), execution), /baseline_vet_invalid/u);
});

test("baseline vet rejects missing, extra, duplicate, malformed or unconsumed output", () => {
  for (const bytes of [log(BASELINE_COPYLOCKS.slice(1)), log([...BASELINE_COPYLOCKS, BASELINE_COPYLOCKS[0]]),
    log([...BASELINE_COPYLOCKS, "unexpected failure"]), log([...BASELINE_COPYLOCKS, ""]),
    log([...BASELINE_COPYLOCKS, "# github.com/seaweedfs/seaweedfs/weed/foreign"]),
    log([...BASELINE_COPYLOCKS, "go: downloading example.org/unreviewed v1.0.0"]),
    Buffer.from(log().toString().replace("599:18", "599:19")), Buffer.from(log().toString().replaceAll("\n", "\r\n")),
    log().subarray(0, -1), Buffer.concat([log(), Buffer.from([0xff, 0x0a])]), Buffer.alloc(65537)]) {
    assert.throws(() => validate(bytes, execution), /baseline_vet_invalid/u);
  }
});

test("ordinary vet failure cannot mask timeout, monitor failure, spawn error or absent process-group proof", () => {
  for (const mutation of [{ status: 0 }, { status: 2 }, { status: null }, { groupAbsent: false }, { groupAbsent: undefined },
    { error: new Error("timeout") }, { monitorReason: "seaweed_work_budget_exceeded" }, { monitorReason: "" }]) {
    assert.throws(() => validate(log(), { ...execution, ...mutation }), /baseline_vet_invalid/u);
  }
});


test("baseline downloads require authentic pristine ZIP checksums and unique exact progress lines", () => {
  const rows = pristineSum.toString("utf8").trim().split("\n").map((line) => line.split(" "));
  const known = rows.find((row) => !row[1].endsWith("/go.mod")).slice(0, 2).join(" ");
  const modOnly = rows.find((row) => row[1].endsWith("/go.mod") && !rows.some((zip) => zip[0] === row[0] && zip[1] === row[1].slice(0, -7)));
  assert.ok(modOnly);
  const progress = `go: downloading ${known}`;
  assert.deepEqual(validate(log([progress, ...BASELINE_COPYLOCKS]), execution).downloads, [known]);
  for (const lines of [[progress, progress], [`go: downloading ${modOnly[0]} ${modOnly[1].slice(0, -7)}`],
    [`go: downloading ${known}/go.mod`], ["go: downloading example.invalid/unknown v1.0.0"],
    [`go: downloading ${known} extra`], [`go: downloading  ${known}`]]) {
    assert.throws(() => validate(log([...lines, ...BASELINE_COPYLOCKS]), execution), /baseline_vet_invalid/u);
  }
  for (const sum of [undefined, Buffer.from("changed"), Buffer.from(pristineSum.toString().replace("h1:", "h2:"))]) {
    assert.throws(() => requireBaselineCopylocks(log(), execution, sum), /baseline_vet_sum_invalid/u);
  }
});
