import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOwnedContainerRunner, OWNED_TEST_DIAGNOSTIC_TEST_ONLY } from "../scripts/scanner/owned-build.mjs";
import {
  buildOwnedTestFailureDiagnostic,
  createOwnedTestSourceAllowlist,
  readOwnedChildPhase
} from "../scripts/scanner/owned-test-diagnostic.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-owned-test-diagnostic-"));
  const sourceRoot = path.join(root, "source");
  mkdirSync(path.join(sourceRoot, "pkg", "alpha"), { recursive: true });
  writeFileSync(path.join(sourceRoot, "pkg", "alpha", "alpha.go"), "package alpha\n");
  writeFileSync(path.join(sourceRoot, "pkg", "alpha", "alpha_test.go"), "package alpha\nfunc TestAllowed(t *testing.T) {}\n");
  return { root, sourceRoot, phaseFile: path.join(root, "phase"), logFile: path.join(root, "private.log") };
}

function genuineError(processClass = "NONZERO_EXIT") {
  const result = { status: processClass === "NONZERO_EXIT" ? 1 : null, signal: processClass === "SIGNAL" ? "SIGTERM" : null,
    error: processClass === "OUTPUT_LIMIT" ? Object.assign(new Error("private"), { code: "ENOBUFS" }) : processClass === "TIMEOUT" ? Object.assign(new Error("private"), { code: "ETIMEDOUT" }) : null,
    stdout: Buffer.alloc(12), stderr: Buffer.alloc(3) };
  try { OWNED_TEST_DIAGNOSTIC_TEST_ONLY.run("/usr/bin/docker", ["start"], { maxBytes: 1024 }, () => result); }
  catch (error) { return error; }
  throw new Error("expected owned process failure");
}

const fixtureProcessDiagnostic = (processClass = "NONZERO_EXIT") => ({ hostOperation: "DOCKER_START_ATTACH",
  process: { class: processClass, status: processClass === "NONZERO_EXIT" ? 1 : null, stdoutBytes: 12, stderrBytes: 3 },
  container: { observation: "OBSERVED", status: "exited", exitCode: 1, oomKilled: false } });

function executeOwnedStart(startOperation, { stateOutput, stateOperation, budget } = {}) {
  const runValue = { workflow: "wf", runId: "987", runAttempt: 1, sourceSha: "c".repeat(40) };
  const owner = `987-1-${"c".repeat(40)}`; const id = "d".repeat(64); const name = "aw-owned-scanner-987-1-upstream-c1";
  let created = false; let removed = false; let stateProbes = 0;
  const runner = createOwnedContainerRunner({ runValue, scope: "upstream", ...(budget ? { budget } : {}), executeCommand: (_command, args) => {
    const target = args.at(-1);
    if (args[0] === "create") { created = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    if (args[0] === "start") return startOperation();
    if (args[0] === "rm") { removed = true; return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    if (args[0] === "inspect" && args[2]?.includes("State.Status")) {
      stateProbes += 1;
      if (stateOperation) return stateOperation();
      return { status: 0, stdout: stateOutput ?? Buffer.from(`${owner}|${id}|exited|1|false\n`), stderr: Buffer.alloc(0) };
    }
    if (args[0] === "inspect" && args[2]?.includes("Labels")) return { status: 0, stdout: Buffer.from(`${owner}|${id}\n`), stderr: Buffer.alloc(0) };
    if (args[0] === "inspect" && !created) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${name}\n`) };
    if (args[0] === "inspect" && removed) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${target}\n`) };
    return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) };
  } });
  try { return { result: runner.execute(["run", "--rm", "image", "true"], { timeoutMs: 10_000, maxBytes: 1024 }), error: null, stateProbes }; }
  catch (error) { return { result: null, error, stateProbes }; }
}

test("process diagnostics require a genuinely branded error and close container fields", () => {
  assert.equal(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(new Error("scanner_owned_command_failed:docker:1")), null);
  const error = genuineError();
  assert.equal(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(error), null);
});

test("owned runner observes exact container state before cleanup and preserves the primary error", () => {
  const runValue = { workflow: "wf", runId: "789", runAttempt: 1, sourceSha: "a".repeat(40) };
  const owner = `789-1-${"a".repeat(40)}`; const id = "b".repeat(64); const name = "aw-owned-scanner-789-1-upstream-c1";
  let created = false; let removed = false; const calls = []; const primary = genuineError();
  const runner = createOwnedContainerRunner({ runValue, scope: "upstream", executeCommand: (_command, args, options) => {
    calls.push({ args: args.join(" "), options });
    if (args[0] === "create") { created = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    if (args[0] === "start") throw primary;
    if (args[0] === "rm") { removed = true; return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    if (args[0] === "inspect" && args[2]?.includes("State.Status")) return { status: 0, stdout: Buffer.from(`${owner}|${id}|exited|1|false\n`), stderr: Buffer.alloc(0) };
    if (args[0] === "inspect" && args[2]?.includes("Labels")) return { status: 0, stdout: Buffer.from(`${owner}|${id}\n`), stderr: Buffer.alloc(0) };
    if (args[0] === "inspect" && !created) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${name}\n`) };
    if (args[0] === "inspect" && removed) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${id}\n`) };
    return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) };
  } });
  assert.throws(() => runner.execute(["run", "--rm", "image", "true"], { timeoutMs: 10_000, maxBytes: 1024 }), (error) => error === primary);
  assert.deepEqual(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(primary).container, { observation: "OBSERVED", status: "exited", exitCode: 1, oomKilled: false });
  const observedIndex = calls.findIndex(({ args }) => args.includes("State.Status"));
  assert.ok(observedIndex < calls.findIndex(({ args }) => args.startsWith("rm --force")));
  assert.equal(calls[observedIndex].options.timeoutMs, 5_000); assert.equal(calls[observedIndex].options.maxBytes, 4 * 1024);
  assert.equal(runner.liveCount(), 0);

  const budgetPrimary = genuineError(); let budgetCreated = false; let budgetRemoved = false;
  const budgetRunner = createOwnedContainerRunner({ runValue, scope: "managed", budget: {
    commandTimeoutMs: (cap) => { if (cap === 5_000) throw new Error("scanner_owned_time_budget_refused"); return cap; }, cleanupCommandTimeoutMs: (cap) => cap
  }, executeCommand: (_command, args) => {
    const target = args.at(-1);
    if (args[0] === "create") { budgetCreated = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    if (args[0] === "start") throw budgetPrimary;
    if (args[0] === "rm") { budgetRemoved = true; return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    if (args[0] === "inspect" && args[2]?.includes("Labels")) return { status: 0, stdout: Buffer.from(`${owner}|${id}\n`), stderr: Buffer.alloc(0) };
    if (args[0] === "inspect" && !budgetCreated) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${target}\n`) };
    if (args[0] === "inspect" && budgetRemoved) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${target}\n`) };
    return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) };
  } });
  assert.throws(() => budgetRunner.execute(["run", "--rm", "image", "true"], { timeoutMs: 10_000, maxBytes: 1024 }), (error) => error === budgetPrimary);
  assert.deepEqual(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(budgetPrimary).container, { observation: "UNAVAILABLE", status: null, exitCode: null, oomKilled: null });
  assert.equal(budgetRemoved, true);
});

test("real and bounded process failures retain every closed class without publishing private output", () => {
  const value = fixture();
  try {
    value.sourceAllowlist = createOwnedTestSourceAllowlist(value.sourceRoot);
    writeFileSync(value.phaseFile, "SETUP\nMAGE_INSTALL\nUNIT_TESTS\n");
    const logFile = value.logFile;
    const nonzero = executeOwnedStart(() => OWNED_TEST_DIAGNOSTIC_TEST_ONLY.run(process.execPath,
      ["-e", "process.stdout.write('PRIVATE_PROCESS_SENTINEL'); process.exit(7)"], { maxBytes: 1024, timeoutMs: 5_000, logFile }));
    assert.equal(nonzero.error.message.endsWith(":7"), true);
    assert.equal(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(nonzero.error).process.class, "NONZERO_EXIT");
    const projected = OWNED_TEST_DIAGNOSTIC_TEST_ONLY.project(nonzero.error, value);
    assert.equal(JSON.stringify(projected).includes("PRIVATE_PROCESS_SENTINEL"), false);
    assert.equal(projected.privateLog.observed, true);

    const timeout = executeOwnedStart(() => OWNED_TEST_DIAGNOSTIC_TEST_ONLY.run(process.execPath,
      ["-e", "setInterval(() => {}, 1000)"], { maxBytes: 1024, timeoutMs: 20 }));
    assert.equal(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(timeout.error).process.class, "TIMEOUT");

    const outputLimit = executeOwnedStart(() => OWNED_TEST_DIAGNOSTIC_TEST_ONLY.run(process.execPath,
      ["-e", "process.stdout.write('x'.repeat(20000))"], { maxBytes: 1024, timeoutMs: 5_000 }));
    const outputProcess = OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(outputLimit.error).process;
    assert.equal(outputProcess.class, "OUTPUT_LIMIT"); assert.equal(outputProcess.stdoutBytes <= 1024, true); assert.equal(outputProcess.stderrBytes <= 1024, true);

    const spawnFailure = executeOwnedStart(() => OWNED_TEST_DIAGNOSTIC_TEST_ONLY.run(path.join(value.root, "missing-executable"), [], { maxBytes: 1024, timeoutMs: 5_000 }));
    assert.equal(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(spawnFailure.error).process.class, "SPAWN_ERROR");

    const signalFailure = executeOwnedStart(() => OWNED_TEST_DIAGNOSTIC_TEST_ONLY.run("synthetic", [], { maxBytes: 1024, timeoutMs: 5_000 },
      () => ({ status: null, signal: "SIGKILL", error: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })));
    const signalProcess = OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(signalFailure.error).process;
    assert.deepEqual(signalProcess, { class: "SIGNAL", status: null, stdoutBytes: 0, stderrBytes: 0 });
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("container observation rejects malformed, foreign, noncanonical and unavailable state without changing the primary", () => {
  const unavailable = { observation: "UNAVAILABLE", status: null, exitCode: null, oomKilled: null };
  for (const stateOutput of [
    Buffer.from([0xff]),
    Buffer.from(`${"foreign"}|${"d".repeat(64)}|exited|1|false\n`),
    Buffer.from(`987-1-${"c".repeat(40)}|${"d".repeat(64)}|exited|01|false\n`),
    Buffer.from(`987-1-${"c".repeat(40)}|${"d".repeat(64)}|exited|1|false|extra\n`),
    Buffer.from(`987-1-${"c".repeat(40)}|${"d".repeat(64)}|exited|1|false\n\n`)
  ]) {
    const primary = genuineError();
    const outcome = executeOwnedStart(() => { throw primary; }, { stateOutput });
    assert.equal(outcome.error, primary); assert.deepEqual(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(primary).container, unavailable);
  }
  const timedPrimary = genuineError();
  const timed = executeOwnedStart(() => { throw timedPrimary; }, { stateOperation: () => OWNED_TEST_DIAGNOSTIC_TEST_ONLY.run(process.execPath,
    ["-e", "setInterval(() => {}, 1000)"], { maxBytes: 1024, timeoutMs: 20 }) });
  assert.equal(timed.error, timedPrimary); assert.deepEqual(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.processDiagnostic(timedPrimary).container, unavailable);

  const success = executeOwnedStart(() => ({ status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }));
  assert.equal(success.error, null); assert.equal(success.stateProbes, 0);
});

test("private child phase accepts only a single exact ordered regular-file prefix", () => {
  const { root, phaseFile } = fixture();
  try {
    for (const [contents, expected] of [
      ["SETUP\n", "SETUP"],
      ["SETUP\nMAGE_INSTALL\n", "MAGE_INSTALL"],
      ["SETUP\nMAGE_INSTALL\nUNIT_TESTS\n", "UNIT_TESTS"],
      ["SETUP\nMAGE_INSTALL\nUNIT_TESTS\nCOMPLETE\n", "COMPLETE"],
      ["MAGE_INSTALL\n", "UNKNOWN"],
      ["SETUP\nSETUP\n", "UNKNOWN"],
      ["SETUP\nEXTRA\n", "UNKNOWN"]
    ]) { writeFileSync(phaseFile, contents); assert.equal(readOwnedChildPhase(phaseFile), expected); }
    rmSync(phaseFile); assert.equal(readOwnedChildPhase(phaseFile), "UNKNOWN");
    writeFileSync(path.join(root, "phase-target"), "SETUP\n"); symlinkSync(path.join(root, "phase-target"), phaseFile);
    assert.equal(readOwnedChildPhase(phaseFile), "UNKNOWN");
    rmSync(phaseFile); linkSync(path.join(root, "phase-target"), phaseFile);
    assert.equal(readOwnedChildPhase(phaseFile), "UNKNOWN");
    rmSync(phaseFile); writeFileSync(phaseFile, Buffer.alloc(129, 65)); assert.equal(readOwnedChildPhase(phaseFile), "UNKNOWN");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("failure projection publishes only allowlisted package and top-level test observations", () => {
  const value = fixture();
  try {
    value.sourceAllowlist = createOwnedTestSourceAllowlist(value.sourceRoot);
    writeFileSync(value.phaseFile, "SETUP\nMAGE_INSTALL\nUNIT_TESTS\n");
    writeFileSync(value.logFile, [
      "--- FAIL: TestAllowed/private-secret-subtest (0.01s)",
      "--- FAIL: TestUnknown (0.01s)",
      "FAIL\tgithub.com/aquasecurity/trivy/pkg/alpha\t0.01s",
      "FAIL\thttps://secret.invalid/token [setup failed]",
      "open C:/private/secret.txt: no space left on device",
      "tool: executable file not found",
      "signal: killed"
    ].join("\n"));
    const diagnostic = buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value });
    assert.equal(diagnostic.childPhase, "UNIT_TESTS");
    assert.deepEqual(diagnostic.output, {
      capture: "COMPLETE",
      observedFailedPackages: ["github.com/aquasecurity/trivy/pkg/alpha"],
      observedFailedTopLevelTests: ["TestAllowed"],
      observedFixedTokens: ["EXECUTABLE_FILE_NOT_FOUND", "NO_SPACE_LEFT_ON_DEVICE", "SIGNAL_KILLED"],
      truncated: false
    });
    const serialized = JSON.stringify(diagnostic);
    for (const sentinel of ["private-secret-subtest", "TestUnknown", "secret.invalid", "private/secret.txt"]) assert.equal(serialized.includes(sentinel), false);
    assert.equal(diagnostic.privateLog.observed, true);
    assert.equal(diagnostic.privateLog.bytes, readFileSync(value.logFile).length);
    assert.match(diagnostic.privateLog.sha256, /^[a-f0-9]{64}$/u);
  } finally { if (existsSync(value.logFile)) unlinkSync(value.logFile); rmSync(value.root, { recursive: true, force: true }); }
});

test("parser fails closed for invalid UTF-8, oversized lines, output limits and identifier caps", () => {
  const value = fixture();
  try {
    value.sourceAllowlist = createOwnedTestSourceAllowlist(value.sourceRoot);
    writeFileSync(value.phaseFile, "SETUP\n");
    writeFileSync(value.logFile, Buffer.from([0xff]));
    assert.equal(buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value }).output.capture, "MALFORMED");
    writeFileSync(value.logFile, "x".repeat(4097));
    assert.equal(buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value }).output.capture, "MALFORMED");
    writeFileSync(value.logFile, "--- FAIL: TestAllowed (0.01s)\n");
    assert.deepEqual(buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic("OUTPUT_LIMIT"), ...value }).output, {
      capture: "LIMIT_EXCEEDED", observedFailedPackages: [], observedFailedTopLevelTests: [], observedFixedTokens: [], truncated: false
    });
    const testFile = path.join(value.sourceRoot, "pkg", "alpha", "many_test.go");
    writeFileSync(testFile, Array.from({ length: 18 }, (_, index) => `func TestCap${String(index).padStart(2, "0")}(t *testing.T) {}`).join("\n"));
    for (let index = 0; index < 10; index += 1) {
      const directory = path.join(value.sourceRoot, "pkg", `cap${String(index).padStart(2, "0")}`);
      mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, "cap.go"), `package cap${index}\n`);
    }
    value.sourceAllowlist = createOwnedTestSourceAllowlist(value.sourceRoot);
    writeFileSync(value.logFile, [...Array.from({ length: 18 }, (_, index) => `--- FAIL: TestCap${String(index).padStart(2, "0")} (0.01s)`),
      ...Array.from({ length: 10 }, (_, index) => `FAIL\tgithub.com/aquasecurity/trivy/pkg/cap${String(index).padStart(2, "0")}\t0.01s`)].join("\n"));
    const capped = buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value }).output;
    assert.equal(capped.capture, "TRUNCATED"); assert.equal(capped.truncated, true);
    assert.equal(capped.observedFailedTopLevelTests.length, 16); assert.equal(capped.observedFailedPackages.length, 8);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("missing or non-regular private logs remain unavailable and never create evidence for forged errors", () => {
  const value = fixture();
  try {
    value.sourceAllowlist = createOwnedTestSourceAllowlist(value.sourceRoot);
    writeFileSync(value.phaseFile, "SETUP\n");
    assert.equal(OWNED_TEST_DIAGNOSTIC_TEST_ONLY.project(new Error("forged"), value), null);
    assert.equal(buildOwnedTestFailureDiagnostic({ processDiagnostic: { ...fixtureProcessDiagnostic(), raw: "secret" }, ...value }), null);
    const missing = buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value });
    assert.deepEqual(missing.privateLog, { observed: false, bytes: null, sha256: null });
    assert.equal(missing.output.capture, "UNAVAILABLE");
    writeFileSync(path.join(value.root, "log-target"), "secret"); symlinkSync(path.join(value.root, "log-target"), value.logFile);
    assert.deepEqual(buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value }).privateLog, { observed: false, bytes: null, sha256: null });
    unlinkSync(value.logFile); linkSync(path.join(value.root, "log-target"), value.logFile);
    assert.deepEqual(buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value }).privateLog, { observed: false, bytes: null, sha256: null });
  } finally { if (existsSync(value.logFile)) unlinkSync(value.logFile); rmSync(value.root, { recursive: true, force: true }); }
});

test("diagnostic-only allowlist and projection failures degrade without mutating the primary error", () => {
  const value = fixture();
  try {
    value.sourceAllowlist = createOwnedTestSourceAllowlist(path.join(value.root, "missing-source"));
    writeFileSync(value.phaseFile, "SETUP\nMAGE_INSTALL\nUNIT_TESTS\n");
    writeFileSync(value.logFile, "--- FAIL: TestAllowed (0.01s)\n");
    const unavailable = buildOwnedTestFailureDiagnostic({ processDiagnostic: fixtureProcessDiagnostic(), ...value });
    assert.deepEqual(unavailable.output, { capture: "UNAVAILABLE", observedFailedPackages: [], observedFailedTopLevelTests: [], observedFixedTokens: [], truncated: false });
    assert.equal(JSON.stringify(unavailable).includes("missing-source"), false);

    const attached = executeOwnedStart(() => { throw genuineError(); }).error;
    const before = Reflect.ownKeys(attached);
    const hostileContext = new Proxy({}, { ownKeys: () => { throw new Error("diagnostic_failed"); } });
    assert.throws(() => OWNED_TEST_DIAGNOSTIC_TEST_ONLY.project(attached, hostileContext), /diagnostic_failed/u);
    assert.deepEqual(Reflect.ownKeys(attached), before);
    assert.equal(Object.hasOwn(attached, "diagnosticEvidenceError"), false);
    const source = readFileSync(path.join(path.resolve(import.meta.dirname, ".."), "scripts/scanner/owned-build.mjs"), "utf8");
    assert.doesNotMatch(source, /diagnosticEvidenceError/u);
    assert.match(source, /failureDiagnosticContext = null/u);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});
