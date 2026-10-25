import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { types } from "node:util";
import vm from "node:vm";
import { exactIdentity } from "../scripts/postgres-image/gosu-derivative-archives-v1.mjs";
import {
  GOSU_PUBLIC_FILES_V1,
  parseUpstreamTestJson as realParseUpstreamTestJson,
  validateBuildReceipt as realValidateBuildReceipt,
} from "../scripts/postgres-image/gosu-derivative-controls-v1.mjs";

const defaultBuilder = new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url);
const lock = JSON.parse(await readFile(new URL("../infra/postgres-image/materials/gosu-derivative-lock-v1.json", import.meta.url)));
const lockIdentity = exactIdentity(await readFile(new URL("../infra/postgres-image/materials/gosu-derivative-lock-v1.json", import.meta.url)));
const phaseStages = [
  "boundary", "context", "upstream_tests", "binary_build", "source_evidence", "version", "build_info",
  "module_closure", "binary_identity", "sbom", "network_cutoff", "notices", "sumdb_inventory",
  "sumdb_archive", "output_inventory", "reviewed_identities", "receipt_validation", "receipt_record", "controls_record",
];
const failureClasses = ["permission_denied", "path_unavailable", "unclassified"];
const stageTrigger = Object.freeze({
  boundary: "boundary", context: "context", upstream_tests: "write:upstream-tests.json", binary_build: "chmod",
  source_evidence: "read:online", version: "write:version.txt", build_info: "write:build-info.txt",
  module_closure: "write:module-closure.json", binary_identity: "identity:binary", sbom: "write:sbom.cdx.json",
  network_cutoff: "write:network-cutoff.json", notices: "write:notices.json", sumdb_inventory: "readdir:sumdb",
  sumdb_archive: "sumdb_archive", output_inventory: "identity:output", reviewed_identities: "reviewed_identities",
  receipt_validation: "receipt_validation", receipt_record: "write:build-receipt.json", controls_record: "write:controls.json",
});
const id = (character = "a", bytes = 1) => Object.freeze({ bytes, sha256: character.repeat(64) });
const cutoff = Object.freeze({
  checks: Object.freeze({ namespaceChanged: true, loopbackDown: true, routesEmpty: true, ordinaryIdentity: true, zeroCapabilities: true, noNewPrivileges: true }),
  evidence: Object.freeze({ namespaceTransition: id("b", 22), status: id("c"), routes: id("e", 0), loopbackFlags: id("d") }),
});
const testResults = Object.freeze({
  kind: "GOSU_UPSTREAM_TEST_RESULTS_V1", run: 1, passed: 1, skipped: 0, failed: 0,
  packagesPassed: 1, packagesSkipped: 0, functionalValidation: "OBSERVED_UPSTREAM_TESTS_PASSED",
});
const expectedVersion = "1.19 (go1.26.9 on linux/amd64; gc)";
const expectedEnvironment = Object.freeze({ SYNTHETIC_OFFLINE: "true" });
const sourceFiles = Object.freeze([id("1", 10), id("2", 20)]);

function count(text, needle) {
  return text.split(needle).length - 1;
}

function extractBetween(source, start, end, label) {
  assert.equal(count(source, start), 1, `${label} start anchor count`);
  assert.equal(count(source, end), 1, `${label} end anchor count`);
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(endIndex > startIndex, `${label} anchor order`);
  return source.slice(startIndex, endIndex);
}

async function sourceText(file = process.env.AW_GOSU_PHASE_SOURCE_FILE || defaultBuilder) {
  return readFile(file, "utf8");
}

function nativeFailure(reason) {
  if (reason === "unclassified") return new Error("private-message-unclassified");
  const error = new Error("private-message-native");
  Object.defineProperty(error, "code", { value: reason === "permission_denied" ? "EACCES" : "ENOENT", enumerable: false });
  Object.defineProperty(error, "path", { value: "/private/path", enumerable: true });
  return error;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function compilePhase(source, adapters) {
  const support = extractBetween(source, "const COMMAND_STAGES =", "\nasync function checkedOwnedGosuScratch", "diagnostic support");
  let phase = extractBetween(source, "async function offlinePhase(", "\nasync function main(", "offline phase");
  const dynamicImport = 'import("node:fs/promises")';
  assert.equal(count(phase, dynamicImport), 1, "offline phase dynamic fs import count");
  phase = phase.replace(dynamicImport, 'syntheticImport("node:fs/promises")');
  assert.equal(phase.includes("import("), false, "offline phase has no remaining dynamic import");
  const context = vm.createContext({
    Buffer, Object, Error, AggregateError, Set, Map, JSON, Promise,
    types, path: path.posix, process: adapters.process,
    ...adapters.dependencies,
  });
  const script = new vm.Script(`${support}\n${phase}\nglobalThis.__phaseApi = Object.freeze({ offlinePhase, formatChildMainFailure, CHILD_MAIN_FAILURES, CHILD_FAILURE_LINES });`, {
    filename: "gosu-offline-phase-extracted-v1.mjs",
  });
  script.runInContext(context, { timeout: 2_000 });
  return context.__phaseApi;
}

function makeHarness({ failAt = null, failure = null, rejection = false, realParser = false, realReceiptValidator = false } = {}) {
  const trace = [];
  let binaryIdentityCalls = 0;
  let realReceiptObservation = null;
  const hit = (label, detail) => {
    trace.push(detail === undefined ? label : [label, plain(detail)]);
    if (label !== failAt) return undefined;
    if (rejection) return Promise.reject(failure);
    throw failure;
  };
  const writeFile = (file, body, options) => {
    const name = path.posix.basename(file);
    const result = hit(`write:${name}`, { file, options, bytes: Buffer.byteLength(body) });
    return result ?? Promise.resolve();
  };
  const readFile = (file, encoding) => {
    if (file.endsWith("/online.json")) {
      const result = hit("read:online", { file, encoding });
      return result ?? Promise.resolve(JSON.stringify({ sourceFiles }));
    }
    const result = hit("read:sumdb", { file, encoding });
    return result ?? Promise.resolve(Buffer.from("sumdb-proof"));
  };
  const fileIdentity = (file) => {
    let label = "identity:output";
    if (file.endsWith("/go.mod")) label = "identity:source_go_mod";
    else if (file.endsWith("/go.sum")) label = "identity:source_go_sum";
    else if (file === "/output/gosu" && binaryIdentityCalls++ === 0) label = "identity:binary";
    const result = hit(label, file);
    if (result) return result;
    if (label === "identity:source_go_mod") return Promise.resolve(sourceFiles[0]);
    if (label === "identity:source_go_sum") return Promise.resolve(sourceFiles[1]);
    return Promise.resolve(id("f", Buffer.byteLength(file)));
  };
  const run = (stage, command, args, options) => {
    hit(`run:${stage}`, { command, args, options });
    if (stage === "offline_go_test") {
      const body = realParser ? "{\"Action\":\"run\",\"Package\":\"p\",\"Test\":\"orphan\"}\n" : "synthetic-test-stream";
      return { stdout: Buffer.from(body), stderr: Buffer.alloc(0), status: 0 };
    }
    if (stage === "offline_gosu_version") return { stdout: Buffer.from(`${expectedVersion}\n`), stderr: Buffer.alloc(0), status: 0 };
    if (stage === "offline_go_build_info") return { stdout: Buffer.from("synthetic-build-info\n"), stderr: Buffer.alloc(0), status: 0 };
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0 };
  };
  const reviewed = Object.freeze({ lock: lockIdentity, node: id("7", 7), helper: Object.freeze({ build: id("8", 8), controls: id("9", 9), archives: id("a", 10) }) });
  const dependencies = {
    assertOfflineBoundary: () => hit("boundary") ?? Promise.resolve(cutoff),
    cleanEnv: (input) => { hit("context", input); return expectedEnvironment; },
    run,
    parseUpstreamTestJson: (text) => { hit("parse_upstream", text); return realParser ? realParseUpstreamTestJson(text) : testResults; },
    writeFile,
    canonicalJson: (value) => `${JSON.stringify(value, null, 2)}\n`,
    chmod: (file, mode) => hit("chmod", { file, mode }) ?? Promise.resolve(),
    readFile,
    fileIdentity,
    fail: (code) => { throw new Error(code); },
    parseGosuBuildInfo: (text, value) => { hit("parse_build_info", { text, component: value.component }); return Object.freeze({}); },
    moduleClosure: (value) => { hit("module_closure", value.component); return Object.freeze({ kind: "SYNTHETIC_MODULE_CLOSURE" }); },
    canonicalSbom: (value, binary) => { hit("sbom", { component: value.component, binary }); return Object.freeze({ kind: "SYNTHETIC_SBOM" }); },
    canonicalNotices: () => { hit("notices"); return Object.freeze({ kind: "SYNTHETIC_NOTICES" }); },
    GOSU_ARCHIVE_LIMITS_V1: Object.freeze({ sumdb: Object.freeze({ members: 8, totalBytes: 4096, memberBytes: 2048, depth: 8, pathBytes: 256 }) }),
    writeDeterministicUstar: (entries, destination, limits) => hit("sumdb_archive", { entries, destination, limits }) ?? Promise.resolve(id("6", 6)),
    GOSU_PUBLIC_FILES_V1,
    reviewedIdentities: () => hit("reviewed_identities") ?? Promise.resolve(reviewed),
    validateBuildReceipt: (receipt, value, handle) => {
      hit("receipt_validation", { receipt, component: value.component, reviewed: handle });
      if (!realReceiptValidator) return receipt;
      try { return realValidateBuildReceipt(receipt, value, handle); }
      catch (error) {
        realReceiptObservation = { receipt, value, handle, error };
        trace.push(["receipt_validator_error", error.message]);
        throw error;
      }
    },
    exactIdentity,
    syntheticImport: (specifier) => {
      assert.equal(specifier, "node:fs/promises");
      return Promise.resolve({
      readdir: (directory, options) => {
        const result = hit("readdir:sumdb", { directory, options });
        return result ?? Promise.resolve([Object.freeze({ name: "proof", isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true })]);
      },
    }); },
  };
  return {
    trace,
    get realReceiptObservation() { return realReceiptObservation; },
    process: Object.freeze({
      env: Object.freeze({ AW_GOSU_CI_RUN_ID: "100", AW_GOSU_CI_RUN_ATTEMPT: "1", AW_GOSU_CI_HEAD_SHA: "a".repeat(40), AW_GOSU_CI_JOB: "build_1" }),
      version: "v22.23.2",
    }),
    dependencies,
  };
}

async function invoke(source, options) {
  const harness = makeHarness(options);
  const api = compilePhase(source, harness);
  const receipt = await api.offlinePhase(1, lock, lockIdentity, "/scratch", "/output", "/source", "/compiler", Object.freeze({ base: "synthetic" }));
  return { api, harness, receipt: plain(receipt) };
}

async function captureFailure(source, options) {
  const harness = makeHarness(options);
  const api = compilePhase(source, harness);
  let caught;
  try {
    await api.offlinePhase(1, lock, lockIdentity, "/scratch", "/output", "/source", "/compiler", Object.freeze({ base: "synthetic" }));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected failure at ${options.failAt ?? "pure helper"}`);
  return { api, harness, error: caught };
}

assert.equal(phaseStages.length, 19);
assert.equal(new Set(Object.values(stageTrigger)).size, 19);
for (const [stageIndex, stage] of phaseStages.entries()) test(`real private offlinePhase closes ${stage} failures without private data`, async () => {
  const source = await sourceText();
  const observed = [];
  const expected = [];
  for (const [classIndex, reason] of failureClasses.entries()) {
    const failure = nativeFailure(reason);
    const { api, harness, error } = await captureFailure(source, {
      failAt: stageTrigger[stage], failure, rejection: !["context", "receipt_validation"].includes(stage) && (stageIndex + classIndex) % 2 === 0,
    });
    const expectedMessage = `gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_offline_${stage}_${reason}`;
    expected.push({ message: expectedMessage, wire: `${expectedMessage}\n`, leaked: false });
    observed.push({
      message: error.message,
      wire: api.formatChildMainFailure(error, true),
      leaked: ["private-message", "/private/path", "EACCES", "ENOENT"].some((secret) => error.message?.includes(secret)),
    });
    assert.equal(harness.trace.some((entry) => JSON.stringify(entry).includes("private")), false);
    const triggerIndex = harness.trace.findIndex((entry) => Array.isArray(entry) ? entry[0] === stageTrigger[stage] : entry === stageTrigger[stage]);
    assert.notEqual(triggerIndex, -1, `${stage} trigger reached`);
    const labels = harness.trace.map((entry) => Array.isArray(entry) ? entry[0] : entry);
    const nextStage = phaseStages[stageIndex + 1];
    if (nextStage) assert.equal(labels.includes(stageTrigger[nextStage]), false, `${stage} never reaches ${nextStage}`);
    if (stage === "output_inventory") {
      assert.equal(labels.slice(triggerIndex).every((label) => label === "identity:output"), true, "output Promise.all only initiates its remaining siblings");
      assert.equal(labels.slice(triggerIndex).length, GOSU_PUBLIC_FILES_V1.filter((name) => !["build-receipt.json", "controls.json"].includes(name)).length, "all output identity siblings are initiated in original order");
    } else assert.equal(harness.trace.length, triggerIndex + 1, `${stage} has no later operation after failure`);
  }
  assert.deepEqual(observed, expected);
});

test("errno inspection is safe for hostile errors and always falls back to unclassified", async () => {
  const source = await sourceText();
  const hostile = [];
  const inherited = new Error("private-inherited"); Object.setPrototypeOf(inherited, Object.assign(Object.create(Error.prototype), { code: "EACCES" })); hostile.push(inherited);
  const accessor = new Error("private-accessor"); Object.defineProperty(accessor, "code", { get() { throw new Error("private-getter"); } }); hostile.push(accessor);
  hostile.push(new Proxy(new Error("private-proxy"), { getOwnPropertyDescriptor() { throw new Error("private-trap"); }, get() { throw new Error("private-get"); } }));
  hostile.push({ code: "EACCES", message: "private-plain" }, "private-string", null);
  for (const failure of hostile) {
    const { error } = await captureFailure(source, { failAt: "write:notices.json", failure, rejection: true });
    assert.equal(error.message, "gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_offline_notices_unclassified");
  }
});

test("actual phase errno mapping covers native aliases and malformed own code values", async () => {
  const source = await sourceText();
  const cases = [
    ["EPERM", "permission_denied"], ["ENOTDIR", "path_unavailable"], ["EIO", "unclassified"],
    [7, "unclassified"], [null, "unclassified"], [{ private: "value" }, "unclassified"],
  ];
  for (const [code, reason] of cases) {
    const failure = new Error("private-native-message");
    Object.defineProperty(failure, "code", { value: code });
    const { error } = await captureFailure(source, { failAt: "write:notices.json", failure, rejection: true });
    assert.equal(error.message, `gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_offline_notices_${reason}`);
  }
});

test("accessors, hostile proxies and revoked proxies cannot run traps during classification", async () => {
  const source = await sourceText();
  let getterCalls = 0;
  const accessor = new Error("private-accessor");
  Object.defineProperty(accessor, "code", { get() { getterCalls += 1; return "EACCES"; } });
  const accessorResult = await captureFailure(source, { failAt: "write:notices.json", failure: accessor, rejection: true });
  assert.equal(accessorResult.error.message, "gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_offline_notices_unclassified");
  assert.equal(getterCalls, 0);

  const traps = { get: 0, getOwnPropertyDescriptor: 0 };
  const proxy = new Proxy(new Error("private-proxy"), {
    get() { traps.get += 1; throw new Error("private-get-trap"); },
    getOwnPropertyDescriptor() { traps.getOwnPropertyDescriptor += 1; throw new Error("private-descriptor-trap"); },
  });
  const proxyResult = await captureFailure(source, { failAt: "write:notices.json", failure: proxy, rejection: true });
  assert.equal(proxyResult.error.message, "gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_offline_notices_unclassified");
  assert.deepEqual(traps, { get: 0, getOwnPropertyDescriptor: 0 });

  const revocable = Proxy.revocable(new Error("private-revoked"), {});
  revocable.revoke();
  const revokedResult = await captureFailure(source, { failAt: "write:notices.json", failure: revocable.proxy, rejection: true });
  assert.equal(revokedResult.error.message, "gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_offline_notices_unclassified");
});

test("historical recognized failures are rethrown as the exact same object", async () => {
  const source = await sourceText();
  for (const [label, message] of [["run:offline_go_test", "gosu_tests_invalid"], ["run:offline_gosu_version", "gosu_version_invalid"], ["write:notices.json", "gosu_sumdb_invalid"]]) {
    const failure = new Error(message);
    const { error } = await captureFailure(source, { failAt: label, failure, rejection: label === "write:notices.json" });
    assert.equal(error, failure);
  }
  const hostileKnown = new Error("gosu_tests_invalid");
  Object.defineProperty(hostileKnown, "code", { get() { throw new Error("private-code-getter"); } });
  const preserved = await captureFailure(source, { failAt: "context", failure: hostileKnown });
  assert.equal(preserved.error, hostileKnown);
});

test("every extracted canonical packet is rethrown by identity without reading its code accessor", async () => {
  const source = await sourceText();
  const catalogHarness = makeHarness();
  const catalog = [...compilePhase(source, catalogHarness).CHILD_FAILURE_LINES].map(({ code }) => code);
  assert.equal(catalog.length, 165);
  assert.equal(new Set(catalog).size, 165);
  for (const code of catalog) {
    let getterCalls = 0;
    const failure = new Error(code);
    Object.defineProperty(failure, "code", { get() { getterCalls += 1; throw new Error("private-code-getter"); } });
    const { error } = await captureFailure(source, { failAt: "context", failure });
    assert.equal(error, failure, code);
    assert.equal(getterCalls, 0, code);
  }
});

test("actual pure parser and receipt validator reject at their real phase call sites", async () => {
  const source = await sourceText();
  assert.throws(() => realParseUpstreamTestJson("{\"Action\":\"run\",\"Package\":\"p\",\"Test\":\"orphan\"}\n"), /^Error: gosu_tests_invalid$/u);
  const parser = await captureFailure(source, { realParser: true });
  assert.equal(parser.error.message, "gosu_tests_invalid");
  assert.equal(parser.harness.trace.at(-1)?.[0] ?? parser.harness.trace.at(-1), "parse_upstream");

  const receipt = await captureFailure(source, { realReceiptValidator: true });
  assert.equal(receipt.error.message, "gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_offline_receipt_validation_unclassified");
  assert.deepEqual(receipt.harness.trace.at(-1), ["receipt_validator_error", "gosu_receipt_shape_invalid"]);
  const observation = receipt.harness.realReceiptObservation;
  assert.ok(observation);
  assert.equal(observation.value, lock);
  assert.equal(observation.receipt.kind, "POSTGRES_GOSU_DERIVATIVE_BUILD_RECEIPT_V1");
  assert.equal(observation.error.message, "gosu_receipt_shape_invalid");
  assert.notEqual(Object.getPrototypeOf(observation.receipt), Object.prototype, "the extracted VM receipt is intentionally cross-realm");
  assert.throws(() => realValidateBuildReceipt(plain(observation.receipt), observation.value, observation.handle), /^Error: gosu_receipt_review_identity_missing$/u);
});

test("complete synthetic success preserves commands, ordering, receipt and silent behavior", async () => {
  const source = await sourceText();
  const { harness, receipt } = await invoke(source);
  const labels = harness.trace.map((entry) => Array.isArray(entry) ? entry[0] : entry);
  const requiredOrder = [
    "boundary", "context", "run:offline_go_test", "parse_upstream", "write:upstream-tests.json", "run:offline_go_build", "chmod",
    "read:online", "identity:source_go_mod", "identity:source_go_sum", "run:offline_gosu_version", "write:version.txt",
    "run:offline_go_build_info", "parse_build_info", "write:build-info.txt", "module_closure", "write:module-closure.json",
    "identity:binary", "sbom", "write:sbom.cdx.json", "write:network-cutoff.json", "notices", "write:notices.json",
    "readdir:sumdb", "read:sumdb", "sumdb_archive", ...GOSU_PUBLIC_FILES_V1.filter((name) => !["build-receipt.json", "controls.json"].includes(name)).map(() => "identity:output"),
    "reviewed_identities", "receipt_validation", "write:build-receipt.json", "write:controls.json",
  ];
  assert.deepEqual(labels, requiredOrder);
  assert.equal(receipt.kind, "POSTGRES_GOSU_DERIVATIVE_BUILD_RECEIPT_V1");
  assert.equal(receipt.state, "PREPARATION_ONLY");
  assert.equal(receipt.authority, "NOT_AUTHORIZED");
  assert.deepEqual(receipt.lock, lockIdentity);
  assert.deepEqual(receipt.networkCutoff, plain(cutoff));
  assert.deepEqual(receipt.tests, { count: 1, passed: 1, skipped: 0, failed: 0, packagesPassed: 1, packagesSkipped: 0, functionalValidation: "OBSERVED_UPSTREAM_TESTS_PASSED" });
  assert.equal(receipt.claims.actualTestCount, 1);
  assert.deepEqual(Object.keys(receipt.files), GOSU_PUBLIC_FILES_V1.filter((name) => !["build-receipt.json", "controls.json"].includes(name)));
  for (const [stage, expected] of [["offline_go_test", ["test", ...lock.build.testFlags]], ["offline_go_build", ["build", ...lock.build.flags, "-o", "/output/gosu", lock.build.package]], ["offline_gosu_version", ["--version"]], ["offline_go_build_info", ["version", "-m", "./gosu"]]]) {
    const call = harness.trace.find((entry) => Array.isArray(entry) && entry[0] === `run:${stage}`)[1];
    assert.deepEqual(call.args, expected);
    assert.deepEqual(call.options.env, expectedEnvironment);
  }
});

test("optional frozen accepted builder has the identical complete success trace and receipt", async (context) => {
  const baselineFile = process.env.AW_GOSU_PHASE_BASELINE_FILE;
  if (!baselineFile) return context.skip("local sealed pre-edit comparison only; standard CI uses the explicit success contract above");
  const [current, baseline] = await Promise.all([sourceText(), sourceText(baselineFile)]);
  const [currentResult, baselineResult] = await Promise.all([invoke(current), invoke(baseline)]);
  assert.deepEqual(currentResult.harness.trace, baselineResult.harness.trace);
  assert.deepEqual(currentResult.receipt, baselineResult.receipt);
});
