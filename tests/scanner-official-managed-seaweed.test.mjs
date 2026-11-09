import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readManagedSeaweedStatuses, readManagedSeaweedTests, validateManagedSeaweedConfig, validateManagedSeaweedGoInventory } from "../scripts/scanner/managed-seaweed.mjs";
import { validateManagedImageLock } from "../scripts/scanner/official-audit.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const pkg = "github.com/seaweedfs/seaweedfs/weed/storage";
const second = "github.com/seaweedfs/seaweedfs/weed/util";
const clone = (value) => JSON.parse(JSON.stringify(value));
const fixtureEvents = () => [
  { Action: "start", Package: pkg }, { Action: "start", Package: second },
  { Action: "run", Package: pkg, Test: "TestObject" }, { Action: "pause", Package: pkg, Test: "TestObject" },
  { Action: "run", Package: second, Test: "TestUtility" }, { Action: "pass", Package: second, Test: "TestUtility" },
  { Action: "pass", Package: second }, { Action: "cont", Package: pkg, Test: "TestObject" },
  { Action: "output", Package: pkg, Test: "TestObject", Output: "résultat\n" },
  { Action: "pass", Package: pkg, Test: "TestObject" }, { Action: "pass", Package: pkg },
];
function fixture(context, events = fixtureEvents(), testStatus = 0) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-seaweed-test-evidence-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "go-test-events"));
  const write = (name, bytes) => writeFileSync(path.join(directory, name), bytes);
  const chunks = [events.slice(0, 6), events.slice(6)].map((items) => Buffer.from(`${items.map((item) => JSON.stringify(item)).join("\n")}\n`));
  const names = ["chunk-0000.json", "chunk-0001.json"];
  for (const [index, chunk] of chunks.entries()) write(`go-test-events/${names[index]}`, chunk);
  const manifest = `${chunks.map((chunk, index) => `${names[index]}\t${chunk.length}\t${hash(chunk)}`).join("\n")}\n`;
  write("go-test-manifest.tsv", manifest);
  write("go-test-manifest-bytes.txt", `${Buffer.byteLength(manifest)}\n`);
  write("go-test-manifest.sha256", `${hash(manifest)}  go-test-manifest.tsv\n`);
  const stream = Buffer.concat(chunks), totals = `${stream.length}\t${hash(stream)}\n`;
  write("go-test-stream.tsv", totals); write("go-test-concat.tsv", totals);
  write("package-list.txt", `${pkg}\n${second}\n`);
  write("preparation.exit-code", "0\n");
  write("package-list.exit-code", "0\n"); write("go-test.exit-code", `${testStatus}\n`); write("build.exit-code", "0\n");
  write("go-test-capture.exit-code", "0\n"); write("build-validation.exit-code", "0\n");
  write("build.stdout.txt", ""); write("build.stderr.txt", ""); write("go-test.stderr.txt", "");
  write("binary-pre-test-sha256.txt", `${"a".repeat(64)}\n`); write("binary-post-test-sha256.txt", `${"a".repeat(64)}\n`);
  write("binary-sha256.txt", `${"a".repeat(64)}  /out/weed\n`);
  return { directory, write };
}

test("Seaweed test evidence reconstructs all interleaved events, UTF8 output and exact counts", (context) => {
  const { directory } = fixture(context);
  const result = readManagedSeaweedTests(directory);
  assert.equal(result.events, 11);
  assert.equal(result.statuses.preparation, 0);
  assert.deepEqual(result.counts, { packages: { total: 2, pass: 2, fail: 0, skip: 0 }, tests: { total: 2, pass: 2, fail: 0, skip: 0 } });
  assert.equal(result.result, "passed"); assert.equal(result.runtimeEligible, true); assert.deepEqual(result.skips, []);
});

test("Seaweed private status diagnostics read exactly six bounded numeric statuses without deriving acceptance", (context) => {
  const data = fixture(context);
  data.write("preparation.exit-code", "255\n");
  data.write("package-list.exit-code", "1\n");
  data.write("go-test.exit-code", "2\n");
  data.write("go-test-capture.exit-code", "3\n");
  data.write("build.exit-code", "4\n");
  data.write("build-validation.exit-code", "5\n");
  const statuses = readManagedSeaweedStatuses(data.directory);
  assert.deepEqual(statuses, { preparation: 255, packageList: 1, tests: 2, capture: 3, build: 4, buildValidation: 5 });
  assert.equal(Object.isFrozen(statuses), true);
  assert.equal(Object.hasOwn(statuses, "result"), false);
  assert.equal(Object.hasOwn(statuses, "runtimeEligible"), false);
});

for (const [label, mutate] of [
  ["a missing fixed status", ({ directory }) => rmSync(path.join(directory, "go-test.exit-code"))],
  ["a multiline status", ({ write }) => write("go-test.exit-code", "0\n1\n")],
  ["a status without its newline", ({ write }) => write("go-test.exit-code", "0")],
  ["a status larger than the four-byte pre-read limit", ({ write }) => write("go-test.exit-code", "0000\n")],
  ["a negative status", ({ write }) => write("go-test.exit-code", "-1\n")],
  ["a status above 255", ({ write }) => write("go-test.exit-code", "256\n")],
]) test(`Seaweed private status diagnostics refuse ${label}`, (context) => {
  const data = fixture(context); mutate(data);
  assert.throws(() => readManagedSeaweedStatuses(data.directory), /scanner_managed_seaweed_evidence_invalid/u);
});

test("Seaweed private status diagnostics refuse hard-linked status files", (context) => {
  const data = fixture(context);
  linkSync(path.join(data.directory, "go-test.exit-code"), path.join(data.directory, "status-alias.txt"));
  assert.throws(() => readManagedSeaweedStatuses(data.directory), /scanner_managed_seaweed_evidence_invalid/u);
});

test("Seaweed private status diagnostics refuse a noncanonical root alias",
  { skip: process.platform !== "linux" && "Linux symlink semantics are required" }, (context) => {
    const data = fixture(context);
    const alias = `${data.directory}-alias`;
    context.after(() => rmSync(alias, { force: true }));
    symlinkSync(data.directory, alias, "dir");
    assert.throws(() => readManagedSeaweedStatuses(alias), /scanner_managed_seaweed_evidence_invalid/u);
  });

test("Seaweed retains an upstream skip identity but does not authorize unreviewed skips", (context) => {
  const events = fixtureEvents(); events[5].Action = "skip";
  const result = readManagedSeaweedTests(fixture(context, events).directory);
  assert.equal(result.result, "passed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.skipReview, "REQUIRED_NOT_ACCEPTED");
  assert.deepEqual(result.skips, [{ package: second, test: "TestUtility" }]);
  assert.equal(result.counts.tests.skip, 1);
});

test("Seaweed retains a consistent test failure instead of promoting successful evidence export", (context) => {
  const events = fixtureEvents(); events[5].Action = "fail"; events[6].Action = "fail";
  const data = fixture(context, events, 7);
  const result = readManagedSeaweedTests(data.directory);
  assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.statuses.tests, 7); assert.equal(result.statuses.build, 0);
  assert.equal(result.counts.tests.fail, 1); assert.equal(result.counts.packages.fail, 1);
});

test("Seaweed retains the canonical failed prebuild shape without tests or runtime eligibility", (context) => {
  const data = fixture(context);
  rmSync(path.join(data.directory, "go-test-events"), { recursive: true }); mkdirSync(path.join(data.directory, "go-test-events"));
  const emptyHash = hash(Buffer.alloc(0));
  data.write("go-test-manifest.tsv", ""); data.write("go-test-manifest-bytes.txt", "0\n");
  data.write("go-test-manifest.sha256", `${emptyHash}  go-test-manifest.tsv\n`);
  data.write("go-test-stream.tsv", `0\t${emptyHash}\n`); data.write("go-test-concat.tsv", `0\t${emptyHash}\n`);
  data.write("build.exit-code", "2\n"); data.write("go-test.exit-code", "125\n");
  data.write("go-test-capture.exit-code", "125\n"); data.write("build-validation.exit-code", "1\n");
  for (const name of ["binary-pre-test-sha256.txt", "binary-post-test-sha256.txt", "binary-sha256.txt"]) rmSync(path.join(data.directory, name));
  const result = readManagedSeaweedTests(data.directory);
  assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.events, 0); assert.equal(result.counts.tests.total, 0);
  data.write("go-test.exit-code", "0\n");
  assert.throws(() => readManagedSeaweedTests(data.directory));
});

test("Seaweed failed prebuild refuses missing diagnostics and stale candidate hashes", (context) => {
  const prepare = () => {
    const data = fixture(context), emptyHash = hash(Buffer.alloc(0));
    rmSync(path.join(data.directory, "go-test-events"), { recursive: true }); mkdirSync(path.join(data.directory, "go-test-events"));
    data.write("go-test-manifest.tsv", ""); data.write("go-test-manifest-bytes.txt", "0\n");
    data.write("go-test-manifest.sha256", `${emptyHash}  go-test-manifest.tsv\n`);
    data.write("go-test-stream.tsv", `0\t${emptyHash}\n`); data.write("go-test-concat.tsv", `0\t${emptyHash}\n`);
    data.write("build.exit-code", "2\n"); data.write("go-test.exit-code", "125\n"); data.write("go-test-capture.exit-code", "125\n");
    data.write("build-validation.exit-code", "1\n");
    for (const name of ["binary-pre-test-sha256.txt", "binary-post-test-sha256.txt", "binary-sha256.txt"]) rmSync(path.join(data.directory, name));
    return data;
  };
  const missing = prepare(); rmSync(path.join(missing.directory, "build.stderr.txt"));
  assert.throws(() => readManagedSeaweedTests(missing.directory));
  const stale = prepare(); stale.write("binary-pre-test-sha256.txt", `${"a".repeat(64)}\n`);
  assert.throws(() => readManagedSeaweedTests(stale.directory));
});

test("Seaweed binds the pre-test, post-test and final candidate hashes", (context) => {
  for (const file of ["binary-post-test-sha256.txt", "binary-sha256.txt"]) {
    const data = fixture(context); data.write(file, `${"b".repeat(64)}${file === "binary-sha256.txt" ? "  /out/weed" : ""}\n`);
    assert.throws(() => readManagedSeaweedTests(data.directory));
  }
  const missing = fixture(context); rmSync(path.join(missing.directory, "binary-sha256.txt"));
  assert.throws(() => readManagedSeaweedTests(missing.directory));
  missing.write("build-validation.exit-code", "1\n");
  assert.throws(() => readManagedSeaweedTests(missing.directory));
  const impossibleFinal = fixture(context);
  impossibleFinal.write("binary-post-test-sha256.txt", `${"b".repeat(64)}\n`);
  impossibleFinal.write("build-validation.exit-code", "1\n");
  assert.throws(() => readManagedSeaweedTests(impossibleFinal.directory));
});

for (const file of ["go-test-capture.exit-code", "build-validation.exit-code"]) {
  test(`Seaweed refuses runtime after ${file} fails despite otherwise successful tests`, (context) => {
    const data = fixture(context); data.write(file, "1\n");
    const result = readManagedSeaweedTests(data.directory);
    assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  });
}

for (const [label, mutate] of [
  ["missing package completion", (events) => events.pop()],
  ["duplicate test completion", (events) => events.splice(6, 0, clone(events[5]))],
  ["test completion without start", (events) => events.splice(4, 1)],
  ["unknown package", (events) => { events[4].Package = `${pkg}/foreign`; }],
  ["success status over failure", (events) => { events[5].Action = "fail"; events[6].Action = "fail"; }],
  ["package start repeated", (events) => events.splice(3, 0, clone(events[0]))],
]) test(`Seaweed refuses ${label} even with recomputed fragment hashes`, (context) => {
  const events = fixtureEvents(); mutate(events);
  assert.throws(() => readManagedSeaweedTests(fixture(context, events).directory));
});

for (const [label, mutate] of [
  ["missing chunk", ({ directory }) => rmSync(path.join(directory, "go-test-events/chunk-0001.json"))],
  ["extra chunk", ({ write }) => write("go-test-events/chunk-0002.json", "{}\n")],
  ["changed chunk", ({ write }) => write("go-test-events/chunk-0001.json", "{}\n")],
  ["changed stream hash", ({ write }) => write("go-test-stream.tsv", `1\t${"a".repeat(64)}\n`)],
  ["changed manifest byte count", ({ write }) => write("go-test-manifest-bytes.txt", "1\n")],
  ["changed manifest hash", ({ write }) => write("go-test-manifest.sha256", `${"a".repeat(64)}  go-test-manifest.tsv\n`)],
  ["extra expected package", ({ write }) => write("package-list.txt", `${pkg}\n${second}\n${pkg}/foreign\n`)],
  ["duplicated expected package", ({ write }) => write("package-list.txt", `${pkg}\n${pkg}\n`)],
  ["missing build status", ({ directory }) => rmSync(path.join(directory, "build.exit-code"))],
  ["missing preparation status", ({ directory }) => rmSync(path.join(directory, "preparation.exit-code"))],
  ["failed preparation despite successful test evidence", ({ write }) => write("preparation.exit-code", "7\n")],
  ["malformed preparation status", ({ write }) => write("preparation.exit-code", "0\n7\n")],
  ["nonzero test status over success", ({ write }) => write("go-test.exit-code", "1\n")],
  ["reordered manifest", ({ directory, write }) => {
    const manifest = `${readFileSync(path.join(directory, "go-test-manifest.tsv"), "utf8").trim().split("\n").reverse().join("\n")}\n`;
    write("go-test-manifest.tsv", manifest); write("go-test-manifest-bytes.txt", `${Buffer.byteLength(manifest)}\n`);
    write("go-test-manifest.sha256", `${hash(manifest)}  go-test-manifest.tsv\n`);
  }],
]) test(`Seaweed refuses ${label}`, (context) => {
  const data = fixture(context); mutate(data);
  assert.throws(() => readManagedSeaweedTests(data.directory));
});

test("Seaweed lock rejects every substituted material and any undeclared field", () => {
  const lock = JSON.parse(readFileSync(new URL("../infra/managed-images/lock.json", import.meta.url), "utf8"));
  const official = JSON.parse(readFileSync(new URL("../infra/scanner/official-release.json", import.meta.url), "utf8"));
  for (const key of [...Object.keys(lock.seaweedfs), "foreign"]) {
    const changed = clone(lock); changed.seaweedfs[key] = "substituted";
    assert.throws(() => validateManagedImageLock(changed, official), /scanner_managed_lock_invalid/u);
  }
});

test("Seaweed runtime configuration preserves the exact base fields while labels identify the derivative", () => {
  const base = [{ Id: "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6", Os: "linux", Architecture: "amd64",
    Config: { Env: ["PATH=/usr/bin"], Entrypoint: ["weed"], Cmd: ["server"], WorkingDir: "", Volumes: { "/data": {} }, ExposedPorts: { "8333/tcp": {} }, User: "" } }];
  const final = clone(base); final[0].Id = `sha256:${"a".repeat(64)}`; final[0].Config.Labels = { derivative: "diagnostic" };
  assert.equal(validateManagedSeaweedConfig(base, final).imageId, final[0].Id);
  for (const key of Object.keys(base[0].Config)) {
    const changed = clone(final); changed[0].Config[key] = "changed";
    assert.throws(() => validateManagedSeaweedConfig(base, changed));
  }
  const foreign = clone(base); foreign[0].Id = final[0].Id;
  assert.throws(() => validateManagedSeaweedConfig(foreign, final));
});

test("Seaweed Go inventory requires the patched dependencies and preserves actual unversioned main", () => {
  const report = { Results: [{ Target: "usr/bin/weed", Class: "lang-pkgs", Type: "gobinary", Packages: [
    { Name: "github.com/seaweedfs/seaweedfs" }, { Name: "github.com/go-jose/go-jose/v4", Version: "v4.1.6" },
    { Name: "golang.org/x/net", Version: "v0.62.0" }, { Name: "stdlib", Version: "v1.27.3" },
  ] }] };
  const before = clone(report);
  assert.equal(validateManagedSeaweedGoInventory(report).packageCount, 4); assert.deepEqual(report, before);
  for (let index = 0; index < 4; index++) {
    const missing = clone(report); missing.Results[0].Packages.splice(index, 1);
    assert.throws(() => validateManagedSeaweedGoInventory(missing));
    const doubled = clone(report); doubled.Results[0].Packages.push(clone(doubled.Results[0].Packages[index]));
    assert.throws(() => validateManagedSeaweedGoInventory(doubled));
  }
  const old = clone(report); old.Results[0].Packages[2].Version = "v0.61.0";
  assert.throws(() => validateManagedSeaweedGoInventory(old));
});
