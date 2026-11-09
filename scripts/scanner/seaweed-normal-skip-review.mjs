import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual, TextDecoder } from "node:util";

const DATA_SHA256 = "e5d714d8234fe8c5c3d3a4f3171ffc1ade740e9d68f379d8ef020474a3feb03a";
const PROFILE = "NORMAL_LINUX_AMD64_SKIP_REVIEW_V1";
const SUPPLEMENTAL_SCHEMA = "NORMAL_LINUX_AMD64_SUPPLEMENTAL_V1";
const PACKAGE_PREFIX = "github.com/seaweedfs/seaweedfs/weed";
const COMMAND_PACKAGE = `${PACKAGE_PREFIX}/command`;
const STORAGE_PACKAGE = `${PACKAGE_PREFIX}/storage`;
const COMMAND_TEST = "TestParseScanTimeHonoursTimezone";
const STORAGE_TESTS = Object.freeze([
  "TestValidateEcVolume_TransientStatErrorKeeps",
  "TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume",
]);
const COMMAND = "go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./command -run '^TestParseScanTimeHonoursTimezone$'";
const STORAGE = "go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./storage -run '^(TestValidateEcVolume_TransientStatErrorKeeps|TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume)$'";
const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const invalid = () => { throw new Error("scanner_managed_seaweed_skip_review_invalid"); };
const requireValue = (condition) => { if (!condition) invalid(); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const dataBytes = readFileSync(new URL("./seaweed-normal-skip-review-data.json", import.meta.url));
const dataText = utf8(dataBytes).replaceAll("\r\n", "\n");
requireValue(!dataText.includes("\r") && sha256(Buffer.from(dataText)) === DATA_SHA256);
const fixed = JSON.parse(dataText);
requireValue(fixed.schemaVersion === 1 && fixed.profile === PROFILE &&
  fixed.provenance?.inventorySha256 === "cdcc317b71cc9baadae2d8552b74376a17a105b108242e63f5a9a77388f9dfc8" &&
  fixed.sourceCommit === "ffa87c25fdf587178b1521ad87f2a4a72a02e584" &&
  fixed.sourceArchive?.bytes === 81881370 && fixed.sourceArchive?.sha256 === "d650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9" &&
  fixed.packages?.length === 76 && fixed.tests?.length === 72 && fixed.sourceProofs?.length === 26);

const OBSOLETE_TESTS = new Set([
  "TestSeaweedMQHandler_GetStoredRecords_EmptyTopic", "TestSeaweedMQHandler_GetStoredRecords_EmptyPartition",
  "TestSeaweedMQHandler_GetStoredRecords_OffsetBeyondHighWaterMark", "TestSeaweedMQHandler_GetStoredRecords_MaxRecordsLimit",
  "TestSeaweedMQHandler_MapSeaweedToKafkaOffsets", "TestSeaweedMQHandler_MapSeaweedToKafkaOffsets_EmptyRecords",
]);
const UNSUPPORTED_TESTS = new Set(["TestExtractAllRecords_CompressedBatch", "TestSQLEngine_SelectFromNonExistentTable"]);

function reviewedTestCategory(entry) {
  if (["LOCAL_ENVIRONMENT_TIMEZONE", "LOCAL_ENVIRONMENT_ROOT"].includes(entry.category)) return "SUPPLEMENTAL_PROOF_REQUIRED";
  if (["CONDITIONAL_EXTERNAL_SERVICE_OPT_IN", "CONDITIONAL_EXTERNAL_CLOUD_CREDENTIALS", "EXPECTED_REJECTION_REPORTED_AS_SKIP"].includes(entry.category)) {
    return "EXTERNAL_PROFILE_NOT_RUN";
  }
  requireValue(entry.category === "UPSTREAM_UNCONDITIONAL_SKIP");
  if (UNSUPPORTED_TESTS.has(entry.test)) return "KNOWN_UNSUPPORTED_FEATURE";
  if (OBSOLETE_TESTS.has(entry.test)) return "UPSTREAM_OBSOLETE_TEST_NOT_RUN";
  return "UPSTREAM_NO_EXECUTABLE_COVERAGE";
}

const packageReview = Object.freeze(fixed.packages.map((entry) => Object.freeze({
  package: entry.package,
  category: entry.category === "PACKAGE_TEST_FILES_EXCLUDED_BY_BUILD_TAG" ? "OPTIONAL_PROFILE_NOT_RUN" : "NO_DIRECT_TEST_COVERAGE",
  reasonOutput: entry.reasonEvent.text,
})));
const testReview = Object.freeze(fixed.tests.map((entry) => Object.freeze({
  package: entry.package, test: entry.test, category: reviewedTestCategory(entry), reasonOutput: entry.reasonEvent.text,
})));

function exactLines(bytes) {
  const text = utf8(bytes);
  requireValue(text.length > 0 && text.endsWith("\n") && !text.includes("\r") && !text.includes("\0"));
  return text.slice(0, -1).split("\n");
}

function parseTsv(bytes, columns) {
  return exactLines(bytes).map((line) => {
    const values = line.split("\t");
    requireValue(values.length === columns);
    return values;
  });
}

function readStatus(view, name) {
  const bytes = view.read(`supplemental/${name}.exit-code`, 4);
  const text = utf8(bytes);
  requireValue(/^(?:0|[1-9][0-9]{0,2})\n$/u.test(text));
  const value = Number(text.slice(0, -1));
  requireValue(value <= 255);
  return value;
}

function validateNormalReview(inspection) {
  const { summary, eventRecords } = inspection;
  requireValue(summary.result === "passed" && Object.values(summary.statuses).every((value) => value === 0) &&
    isDeepStrictEqual(summary.counts, {
      packages: { total: 234, pass: 158, fail: 0, skip: 76 },
      tests: { total: 14290, pass: 14218, fail: 0, skip: 72 },
    }));
  const expectedSkips = [...packageReview.map((entry) => ({ package: entry.package, test: null })),
    ...testReview.map((entry) => ({ package: entry.package, test: entry.test }))];
  const identity = (entry) => `${entry.package}\0${entry.test ?? ""}`;
  requireValue(summary.skips.length === 148 && new Set(summary.skips.map(identity)).size === 148 &&
    isDeepStrictEqual([...summary.skips].map(identity).sort(), expectedSkips.map(identity).sort()));

  const packageEvents = new Map(), testEvents = new Map();
  for (const [index, { event }] of eventRecords.entries()) {
    const target = event.Test === undefined ? packageEvents : testEvents;
    const key = event.Test === undefined ? event.Package : `${event.Package}\0${event.Test}`;
    if (!target.has(key)) target.set(key, []);
    target.get(key).push({ event, index });
  }
  for (const entry of packageReview) {
    const events = packageEvents.get(entry.package) ?? [];
    const start = events.filter(({ event }) => event.Action === "start");
    const reason = events.filter(({ event }) => event.Action === "output" && event.Output === `${entry.reasonOutput}\n`);
    const terminal = events.filter(({ event }) => event.Action === "skip");
    requireValue(start.length === 1 && reason.length === 1 && terminal.length === 1 && start[0].index < reason[0].index && reason[0].index < terminal[0].index);
  }
  for (const entry of testReview) {
    const events = testEvents.get(`${entry.package}\0${entry.test}`) ?? [];
    const run = events.filter(({ event }) => event.Action === "run");
    const reason = events.filter(({ event }) => event.Action === "output" && event.Output === `    ${entry.reasonOutput}\n`);
    const terminal = events.filter(({ event }) => event.Action === "skip");
    requireValue(run.length === 1 && reason.length === 1 && terminal.length === 1 && run[0].index < reason[0].index && reason[0].index < terminal[0].index);
  }
}

const BUILDER_MATERIALS = Object.freeze([
  Object.freeze({ path: "/usr/local/go/lib/time/zoneinfo.zip", bytes: 408467, sha256: "b2d18a7c8fa8142097a48c99609fb3c92db5ee98bc740294e57eab8ae9f94779" }),
  Object.freeze({ path: "/usr/local/go/src/time/zoneinfo.go", bytes: 18613, sha256: "198928e8d2573d88d8743db57b86777a26506f17ef2b0283882a9f5c884979b7" }),
  Object.freeze({ path: "/usr/local/go/src/time/zoneinfo_read.go", bytes: 14741, sha256: "812b0025c6e4face22e709053183d59e03e71e3c1459187350f4088587f4a134" }),
]);

function materialRows(view) {
  const normal = (name, materialPath) => {
    const bytes = view.read(name);
    return { path: materialPath, bytes: bytes.length, sha256: sha256(bytes) };
  };
  const binaryHash = utf8(view.read("binary-pre-test-sha256.txt"));
  requireValue(/^[a-f0-9]{64}\n$/u.test(binaryHash));
  const sourceRows = fixed.sourceProofs.map((entry) => ({ path: `/src/seaweedfs/${entry.path}`, bytes: entry.bytes, sha256: entry.sha256 }));
  const expected = [
    ...BUILDER_MATERIALS,
    { path: "/src/seaweedfs/go.mod", bytes: 26652, sha256: "5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9" },
    { path: "/src/seaweedfs/go.sum", bytes: 232835, sha256: "abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a" },
    ...sourceRows,
  ];
  const rows = parseTsv(view.read("supplemental/materials-before.tsv"), 3).map(([materialPath, bytes, digest]) => ({
    path: materialPath, bytes: Number(bytes), sha256: digest,
  }));
  requireValue(rows.length === expected.length + 5 && rows.every((entry) => Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && /^[a-f0-9]{64}$/u.test(entry.sha256)));
  for (const [index, entry] of expected.entries()) requireValue(isDeepStrictEqual(rows[index], entry));
  const tail = rows.slice(expected.length);
  requireValue(tail[0].path === "/input/weed" && tail[0].bytes > 0 && tail[0].sha256 === binaryHash.trimEnd());
  const normalBindings = [
    normal("source-sha256.txt", "/input/evidence/source-sha256.txt"),
    normal("module-inventory.json", "/input/evidence/module-inventory.json"),
    normal("module-verify.txt", "/input/evidence/module-verify.txt"),
    normal("binary-sha256.txt", "/input/evidence/binary-sha256.txt"),
  ];
  requireValue(isDeepStrictEqual(tail.slice(1), normalBindings));
  const after = parseTsv(view.read("supplemental/materials-after.tsv"), 3).map(([materialPath, bytes, digest]) => ({ path: materialPath, bytes: Number(bytes), sha256: digest }));
  requireValue(isDeepStrictEqual(after, rows));
  requireValue(view.read("supplemental/source-sha256.txt").equals(view.read("source-sha256.txt")));
  return { count: rows.length, candidateSha256: tail[0].sha256 };
}

function validateContext(view) {
  const values = [
    ["schema", SUPPLEMENTAL_SCHEMA], ["uid", "10001"], ["gid", "10001"], ["go_version", "go1.27.3"],
    ["goos", "linux"], ["goarch", "amd64"], ["cgo_enabled", "0"], ["build_tags", ""],
    ["command_zoneinfo", "/usr/local/go/lib/time/zoneinfo.zip"], ["command", COMMAND], ["storage_zoneinfo", ""], ["storage", STORAGE],
  ];
  requireValue(isDeepStrictEqual(parseTsv(view.read("supplemental/context.tsv"), 2), values));
}

function parseGoTest(bytes, expectedPackage, expectedTests, status) {
  const text = utf8(bytes);
  requireValue(!text.includes("\r") && !text.includes("\0") && (text.length === 0 || text.endsWith("\n")));
  if (text.length === 0) {
    requireValue(status === 125);
    return { result: "NOT_RUN", events: 0, tests: [] };
  }
  let events;
  try { events = text.slice(0, -1).split("\n").map((line) => JSON.parse(line)); } catch { invalid(); }
  const tests = new Map(expectedTests.map((name) => [name, { run: null, phase: null, terminal: null }]));
  let packageStart = null, packageTerminal = null, buildFailure = false;
  for (const [index, event] of events.entries()) {
    requireValue(object(event) && typeof event.Action === "string");
    if (["build-output", "build-fail"].includes(event.Action)) {
      requireValue(status !== 0 && typeof event.ImportPath === "string" && event.ImportPath.length > 0 && packageStart === null);
      if (event.Action === "build-fail") buildFailure = true;
      continue;
    }
    requireValue(event.Package === expectedPackage && ["start", "run", "pause", "cont", "pass", "fail", "skip", "output"].includes(event.Action) &&
      packageTerminal === null);
    if (event.Test !== undefined) {
      requireValue(tests.has(event.Test));
      const state = tests.get(event.Test);
      if (event.Action === "run") { requireValue(state.run === null); state.run = index; state.phase = "running"; }
      else {
        requireValue(state.run !== null && state.terminal === null);
        if (event.Action === "pause") { requireValue(state.phase === "running"); state.phase = "paused"; }
        else if (event.Action === "cont") { requireValue(state.phase === "paused"); state.phase = "running"; }
        else if (["pass", "fail", "skip"].includes(event.Action)) {
          requireValue(state.phase === "running"); state.terminal = { action: event.Action, index };
        } else requireValue(event.Action === "output");
      }
    } else if (event.Action === "start") { requireValue(packageStart === null && index === 0); packageStart = index; }
    else if (["pass", "fail", "skip"].includes(event.Action)) packageTerminal = { action: event.Action, index };
    else requireValue(packageStart !== null);
  }
  if (buildFailure) {
    requireValue(packageStart === null && packageTerminal === null && [...tests.values()].every((entry) => entry.run === null && entry.terminal === null));
    return { result: "FAILED", events: events.length, tests: [] };
  }
  requireValue(packageStart === 0 && packageTerminal?.index === events.length - 1 &&
    [...tests.values()].every((entry) => entry.run !== null && entry.terminal !== null && entry.run < entry.terminal.index));
  const goSuccess = packageTerminal.action === "pass" && [...tests.values()].every((entry) => ["pass", "skip"].includes(entry.terminal.action));
  requireValue((status === 0) === goSuccess);
  const allPass = goSuccess && [...tests.values()].every((entry) => entry.terminal.action === "pass");
  return { result: allPass ? "PASS" : "FAILED", events: events.length,
    tests: [...tests].map(([test, entry]) => ({ package: expectedPackage, test, result: entry.terminal.action.toUpperCase() })) };
}

function validateSupplemental(view) {
  const statusNames = ["preflight", "command", "storage", "capture", "finalization"];
  const statusPresence = statusNames.map((name) => view.has(`supplemental/${name}.exit-code`));
  if (statusPresence.every((present) => !present)) {
    return Object.freeze({ schemaVersion: 1, schema: SUPPLEMENTAL_SCHEMA, statuses: undefined,
      materials: undefined, command: { result: "NOT_RUN", events: 0, tests: [] },
      storage: { result: "NOT_RUN", events: 0, tests: [] }, evidenceCompleteness: "NOT_AVAILABLE", result: "FAILED" });
  }
  requireValue(statusPresence.every(Boolean));
  const statuses = Object.freeze(Object.fromEntries(statusNames.map((name) => [name, readStatus(view, name)])));
  const allNotExecuted = Object.values(statuses).every((value) => value === 125);
  if (allNotExecuted) {
    if (view.has("supplemental/context.tsv")) validateContext(view);
    return Object.freeze({ schemaVersion: 1, schema: SUPPLEMENTAL_SCHEMA, statuses, materials: undefined,
      command: { result: "NOT_RUN", events: 0, tests: [] }, storage: { result: "NOT_RUN", events: 0, tests: [] },
      evidenceCompleteness: "INCOMPLETE", result: "FAILED" });
  }
  validateContext(view);
  const materials = materialRows(view);
  const captures = ["command.go-test.json", "command.stderr.txt", "storage.go-test.json", "storage.stderr.txt"];
  const manifest = parseTsv(view.read("supplemental/capture-manifest.tsv"), 3);
  requireValue(manifest.length === captures.length);
  const captured = new Map();
  for (const [index, [name, bytesText, digest]] of manifest.entries()) {
    requireValue(name === captures[index] && /^(?:0|[1-9][0-9]*)$/u.test(bytesText) && /^[a-f0-9]{64}$/u.test(digest));
    const bytes = view.read(`supplemental/${name}`);
    requireValue(bytes.length === Number(bytesText) && sha256(bytes) === digest);
    captured.set(name, bytes);
  }
  const command = parseGoTest(captured.get("command.go-test.json"), COMMAND_PACKAGE, [COMMAND_TEST], statuses.command);
  const storage = parseGoTest(captured.get("storage.go-test.json"), STORAGE_PACKAGE, STORAGE_TESTS, statuses.storage);
  const passed = Object.values(statuses).every((value) => value === 0) && command.result === "PASS" && storage.result === "PASS";
  return Object.freeze({ schemaVersion: 1, schema: SUPPLEMENTAL_SCHEMA, statuses, materials, command, storage,
    evidenceCompleteness: "COMPLETE", result: passed ? "PASS" : "FAILED" });
}

export function hasManagedSeaweedSkipReviewEvidence(view) {
  return view.has("normal-skip-sources.tsv") || view.has("supplemental/context.tsv");
}

export function reviewManagedSeaweedNormalProfile(inspection, view) {
  requireValue(object(inspection) && object(inspection.summary) && Array.isArray(inspection.eventRecords) && object(view));
  const expectedSourceRows = fixed.sourceProofs.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}`);
  requireValue(isDeepStrictEqual(exactLines(view.read("normal-skip-sources.tsv")), expectedSourceRows));
  const supplemental = validateSupplemental(view);
  if (inspection.summary.result !== "passed") {
    return Object.freeze({ ...inspection.summary, supplemental, result: "failed", runtimeEligible: false,
      skipReview: "REQUIRED_NOT_ACCEPTED", sourceMainCoverage: "GENERIC_POLICY_UNCHANGED" });
  }
  validateNormalReview(inspection);
  const runtimeEligible = supplemental.result === "PASS";
  const categoryCounts = {};
  for (const entry of [...packageReview, ...testReview]) categoryCounts[entry.category] = (categoryCounts[entry.category] ?? 0) + 1;
  return Object.freeze({ ...inspection.summary, profile: PROFILE, normalProfileTests: "PASS", skipReview: "REVIEWED_WITH_LIMITATIONS",
    reviewedExclusions: Object.freeze({ total: 148, packages: 76, tests: 72, categories: Object.freeze(categoryCounts) }),
    optionalCoverage: "NOT_RUN", externalCoverage: "NOT_RUN",
    knownUnsupportedFeatures: Object.freeze([...UNSUPPORTED_TESTS].sort()), supplemental,
    result: runtimeEligible ? "passed" : "failed", runtimeEligible,
    sourceMainCoverage: "GENERIC_POLICY_UNCHANGED" });
}

export function diagnoseManagedSeaweedFailedProfile(statuses, view, normalSummary) {
  requireValue(object(statuses) && Object.values(statuses).every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 255) && object(view));
  const statusNames = ["preflight", "command", "storage", "capture", "finalization"];
  const present = statusNames.map((name) => view.has(`supplemental/${name}.exit-code`));
  let supplemental;
  if (present.every((value) => !value)) supplemental = Object.freeze({ schemaVersion: 1, schema: SUPPLEMENTAL_SCHEMA,
    statuses: undefined, evidenceCompleteness: "NOT_AVAILABLE", result: "FAILED" });
  else {
    requireValue(present.every(Boolean));
    supplemental = Object.freeze({ schemaVersion: 1, schema: SUPPLEMENTAL_SCHEMA,
      statuses: Object.freeze(Object.fromEntries(statusNames.map((name) => [name, readStatus(view, name)]))),
      evidenceCompleteness: "FAILED_DIAGNOSTIC_ONLY", result: "FAILED" });
  }
  return Object.freeze({ ...(object(normalSummary) ? normalSummary : { schemaVersion: 1, statuses }), result: "failed", runtimeEligible: false,
    skipReview: "REQUIRED_NOT_ACCEPTED", normalProfileTests: "FAILED", supplemental,
    sourceMainCoverage: "GENERIC_POLICY_UNCHANGED" });
}

export const MANAGED_SEAWEED_SKIP_REVIEW_PROFILE = PROFILE;
