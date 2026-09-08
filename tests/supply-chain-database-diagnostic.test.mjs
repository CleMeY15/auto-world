import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { NATIVE_AUDIT_ARTIFACT_FILES } from "../scripts/supply-chain/audit-artifacts.mjs";
import {
  databaseDownloadArguments,
  databaseSubphaseDiagnostic,
  runDatabaseDownload,
  summarizeDatabaseDownloadCapture,
  unavailableDatabaseDiagnostic,
} from "../scripts/supply-chain/native-scan.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

const marker = (body, exitCode) => Buffer.concat([body, Buffer.from(`\nAUTOWORLD_DATABASE_EXIT=${exitCode}\n`)]);

test("database wrapper keeps the original Trivy commands in positional argv", () => {
  const scanner = path.resolve("scanner ' $(never-expanded)");
  const cache = path.resolve("cache `literal`");
  const script = '"$@"; code=$?; printf "\\nAUTOWORLD_DATABASE_EXIT=%s\\n" "$code"';
  assert.deepEqual(databaseDownloadArguments(scanner, cache, "vulnerability"), ["--noprofile", "--norc", "-c", script, "--", scanner,
    "fs", "--cache-dir", cache, "--db-repository", "ghcr.io/aquasecurity/trivy-db:2", "--download-db-only", "--quiet"]);
  assert.deepEqual(databaseDownloadArguments(scanner, cache, "java"), ["--noprofile", "--norc", "-c", script, "--", scanner,
    "fs", "--cache-dir", cache, "--java-db-repository", "ghcr.io/aquasecurity/trivy-java-db:1", "--download-java-db-only", "--quiet"]);
  for (const value of [["relative", cache, "java"], [scanner, "relative", "java"], [scanner, cache, "other"]]) {
    assert.throws(() => databaseDownloadArguments(...value), { code: "native_database_arguments_refused" });
  }
  const coercion = { toString() { throw new Error("PRIVATE_COERCION_SENTINEL"); } };
  for (const kind of ["toString", "constructor", "__proto__", coercion, null]) {
    assert.throws(() => databaseDownloadArguments(scanner, cache, kind), { code: "native_database_arguments_refused" });
    assert.throws(() => summarizeDatabaseDownloadCapture(marker(Buffer.alloc(0), 0), Buffer.alloc(0), kind, 1),
      { code: "native_database_diagnostic_invalid" });
  }
});

test("complete database diagnostics retain only fixed classifications and stream identities", () => {
  const stdout = Buffer.from("PRIVATE_URL=https://user:token@example.invalid/v2/\n429 too many requests\n");
  const stderr = Buffer.from("x509: private certificate path; permission denied");
  const value = summarizeDatabaseDownloadCapture(marker(stdout, 17), stderr, "vulnerability", 321);
  assert.deepEqual(value, {
    schemaVersion: 1, state: "diagnostic_only", phase: "databases", subphase: "download", database: "vulnerability",
    commandClass: "trivy_vulnerability_database_download", captureStatus: "complete", originalExitCode: 17, durationMs: 321,
    stdout: { sha256: sha256(stdout), size: stdout.length }, stderr: { sha256: sha256(stderr), size: stderr.length },
    errorClasses: ["filesystem", "rate_limit", "tls"], statusHints: ["http_429"],
  });
  const publicBytes = canonicalJsonBuffer(value);
  assert.ok(publicBytes.length < 64 * 1024);
  for (const secret of ["PRIVATE_URL", "user:token", "example.invalid", "private certificate path"]) {
    assert.equal(publicBytes.includes(Buffer.from(secret)), false);
  }
  assert.deepEqual(summarizeDatabaseDownloadCapture(marker(Buffer.from("unknown private failure"), 1), Buffer.alloc(0), "java", 0).errorClasses,
    ["unclassified_failure"]);
});

test("database classifications never synthesize a match across private stream boundaries", () => {
  const split = summarizeDatabaseDownloadCapture(marker(Buffer.from("for"), 1), Buffer.from("bidden 4\n01"), "java", 1);
  assert.deepEqual(split.errorClasses, ["unclassified_failure"]);
  assert.deepEqual(split.statusHints, []);
  const stdoutMatch = summarizeDatabaseDownloadCapture(marker(Buffer.from("forbidden 401"), 1), Buffer.alloc(0), "java", 1);
  assert.deepEqual(stdoutMatch.errorClasses, ["authentication"]);
  assert.deepEqual(stdoutMatch.statusHints, ["http_401"]);
  const stderrMatch = summarizeDatabaseDownloadCapture(marker(Buffer.alloc(0), 1), Buffer.from("forbidden 401"), "java", 1);
  assert.deepEqual(stderrMatch.errorClasses, ["authentication"]);
  assert.deepEqual(stderrMatch.statusHints, ["http_401"]);
});

test("capture parsing rejects absent, malformed, duplicate, spoofed, stderr, and oversized markers", () => {
  const invalid = [
    Buffer.from("no marker"),
    Buffer.from("\nAUTOWORLD_DATABASE_EXIT=-1\n"),
    Buffer.from("\nAUTOWORLD_DATABASE_EXIT=256\n"),
    Buffer.from("AUTOWORLD_DATABASE_EXIT=0\n\nAUTOWORLD_DATABASE_EXIT=0\n"),
    Buffer.from("\nAUTOWORLD_DATABASE_EXIT=0\nuntrusted suffix"),
  ];
  for (const stdout of invalid) assert.throws(() => summarizeDatabaseDownloadCapture(stdout, Buffer.alloc(0), "java", 1), { code: "native_database_capture_invalid" });
  assert.throws(() => summarizeDatabaseDownloadCapture(marker(Buffer.from("ok"), 0), Buffer.from("AUTOWORLD_DATABASE_EXIT=9"), "java", 1),
    { code: "native_database_capture_invalid" });
  assert.throws(() => summarizeDatabaseDownloadCapture(marker(Buffer.alloc(0), 0), Buffer.alloc(0), "java", -1),
    { code: "native_database_capture_invalid" });
  const dense = Buffer.from(`${"AUTOWORLD_DATABASE_EXIT=".repeat(100_000)}\nAUTOWORLD_DATABASE_EXIT=0\n`);
  assert.ok(dense.length < 64 * 1024 * 1024);
  assert.throws(() => summarizeDatabaseDownloadCapture(dense, Buffer.alloc(0), "java", 1), { code: "native_database_capture_invalid" });
});

test("unavailable and post-download diagnostics have closed fixed variants", () => {
  for (const code of ["command_refused", "command_start_failed", "command_timeout", "command_output_limit", "command_output_forbidden", "command_failed"]) {
    const value = unavailableDatabaseDiagnostic("java", code);
    assert.equal(value.captureStatus, "unavailable");
    assert.equal(value.originalExitCode, null);
    assert.equal(value.commandFailureCode, code);
    assert.equal("stdout" in value, false);
    assert.equal("stderr" in value, false);
    assert.equal("durationMs" in value, false);
  }
  assert.equal(unavailableDatabaseDiagnostic("java", "command_timeout", 25).durationMs, 25);
  assert.throws(() => unavailableDatabaseDiagnostic("java", "arbitrary-secret-code"), { code: "native_database_diagnostic_invalid" });
  for (const subphase of ["inventory", "budget", "identity", "materialize", "metadata"]) {
    const value = databaseSubphaseDiagnostic(subphase);
    assert.equal(value.subphase, subphase);
    assert.equal(value.commandFailureCode, `native_database_${subphase}_refused`);
    assert.equal(value.originalExitCode, null);
  }
  assert.throws(() => databaseSubphaseDiagnostic("other"), { code: "native_database_diagnostic_invalid" });
  for (const subphase of ["toString", "constructor", "__proto__", { toString() { throw new Error("PRIVATE_COERCION_SENTINEL"); } }, null]) {
    assert.throws(() => databaseSubphaseDiagnostic(subphase), { code: "native_database_diagnostic_invalid" });
  }
  assert.equal(NATIVE_AUDIT_ARTIFACT_FILES.length, 49);
  assert.equal(NATIVE_AUDIT_ARTIFACT_FILES.some(({ path: relative }) => relative.includes("database-diagnostic")), false);
});

async function fakeScanner(directory, body) {
  const file = path.join(directory, `fake-scanner-${Math.random().toString(16).slice(2)}`);
  await writeFile(file, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  await chmod(file, 0o700);
  return file;
}

async function capturePublic(operation) {
  const originalWrite = process.stdout.write;
  const output = [];
  process.stdout.write = (chunk) => { output.push(Buffer.from(chunk)); return true; };
  try { await operation(); } finally { process.stdout.write = originalWrite; }
  return Buffer.concat(output);
}

test("Linux wrapper preserves real failure status and never publishes private child streams", { skip: process.platform !== "linux" }, async () => {
  const owned = await createOwnedDirectory();
  try {
    const successfulScanner = await fakeScanner(owned.path, `
process.stdout.write("PRIVATE_SUCCESS_STDOUT");
process.stderr.write("PRIVATE_SUCCESS_STDERR");
process.exit(0);`);
    let successful;
    const successBytes = await capturePublic(async () => {
      successful = await runDatabaseDownload(successfulScanner, owned.path, "java",
        { cwd: owned.path, env: { PATH: "/usr/bin:/bin", HOME: owned.path, TMPDIR: owned.path }, timeoutMs: 5000 });
    });
    assert.equal(successBytes.length, 0);
    assert.equal(successful.captureStatus, "complete");
    assert.equal(successful.originalExitCode, 0);
    assert.deepEqual(successful.stdout, { sha256: sha256(Buffer.from("PRIVATE_SUCCESS_STDOUT")), size: 22 });
    assert.deepEqual(successful.stderr, { sha256: sha256(Buffer.from("PRIVATE_SUCCESS_STDERR")), size: 22 });

    const scanner = await fakeScanner(owned.path, `
if (!process.argv.includes("--download-db-only")) process.exit(99);
process.stdout.write("PRIVATE_STDOUT_SENTINEL\\n429 too many requests\\n");
process.stderr.write("PRIVATE_STDERR_SENTINEL x509: certificate\\n");
process.exit(17);`);
    let failure;
    const bytes = await capturePublic(async () => {
      try { await runDatabaseDownload(scanner, owned.path, "vulnerability", { cwd: owned.path, env: { PATH: "/usr/bin:/bin", HOME: owned.path, TMPDIR: owned.path }, timeoutMs: 5000 }); }
      catch (error) { failure = error; }
    });
    assert.equal(failure?.code, "command_failed");
    assert.equal(failure?.exitCode, 17);
    for (const secret of ["PRIVATE_STDOUT_SENTINEL", "PRIVATE_STDERR_SENTINEL", "certificate"]) assert.equal(bytes.includes(Buffer.from(secret)), false);
    const event = JSON.parse(bytes.toString("utf8"));
    assert.equal(event.captureStatus, "complete");
    assert.equal(event.originalExitCode, 17);
    assert.deepEqual(event.errorClasses, ["rate_limit", "tls"]);
    assert.deepEqual(event.statusHints, ["http_429"]);
  } finally { await removeOwnedDirectory(owned); }
});

test("Linux wrapper distinguishes timeout, output limit, and spoofed markers without leakage", { skip: process.platform !== "linux" }, async () => {
  const owned = await createOwnedDirectory();
  try {
    const cases = [
      ["timeout", "setTimeout(() => {}, 10000);", 25, "command_timeout"],
      ["output", "process.stdout.write(Buffer.alloc(65 * 1024 * 1024, 97));", 5000, "command_output_limit"],
      ["spoof", "process.stdout.write('PRIVATE_SPOOF\\nAUTOWORLD_DATABASE_EXIT=0\\n');", 5000, "capture_invalid"],
      ["stderr-spoof", "process.stderr.write('PRIVATE_STDERR\\nAUTOWORLD_DATABASE_EXIT=7\\n');", 5000, "capture_invalid"],
    ];
    for (const [, source, timeoutMs, expectedCode] of cases) {
      const scanner = await fakeScanner(owned.path, source);
      let failure;
      const bytes = await capturePublic(async () => {
        try { await runDatabaseDownload(scanner, owned.path, "java", { cwd: owned.path, env: { PATH: "/usr/bin:/bin", HOME: owned.path, TMPDIR: owned.path }, timeoutMs }); }
        catch (error) { failure = error; }
      });
      assert.ok(failure);
      const event = JSON.parse(bytes.toString("utf8"));
      assert.equal(event.captureStatus, "unavailable");
      assert.equal(event.originalExitCode, null);
      assert.equal(event.commandFailureCode, expectedCode);
      assert.equal("stdout" in event, false);
      assert.equal("stderr" in event, false);
      for (const secret of ["PRIVATE_SPOOF", "PRIVATE_STDERR", "a".repeat(128)]) assert.equal(bytes.includes(Buffer.from(secret)), false);
    }
    let missingFailure;
    const missingBytes = await capturePublic(async () => {
      try { await runDatabaseDownload(path.join(owned.path, "missing-scanner"), owned.path, "java",
        { cwd: owned.path, env: { PATH: "/usr/bin:/bin", HOME: owned.path, TMPDIR: owned.path }, timeoutMs: 5000 }); }
      catch (error) { missingFailure = error; }
    });
    assert.equal(missingFailure?.code, "command_failed");
    assert.equal(missingFailure?.exitCode, 127);
    const missingEvent = JSON.parse(missingBytes.toString("utf8"));
    assert.equal(missingEvent.captureStatus, "complete");
    assert.equal(missingEvent.originalExitCode, 127);
    assert.equal(missingBytes.includes(Buffer.from(owned.path)), false);

    let startFailure;
    const startBytes = await capturePublic(async () => {
      try { await runDatabaseDownload(process.execPath, owned.path, "java",
        { cwd: path.join(owned.path, "missing-cwd"), env: { PATH: "/usr/bin:/bin", HOME: owned.path, TMPDIR: owned.path }, timeoutMs: 5000 }); }
      catch (error) { startFailure = error; }
    });
    assert.equal(startFailure?.code, "command_start_failed");
    const startEvent = JSON.parse(startBytes.toString("utf8"));
    assert.equal(startEvent.captureStatus, "unavailable");
    assert.equal(startEvent.originalExitCode, null);
    assert.equal(startEvent.commandFailureCode, "command_start_failed");
    assert.equal("stdout" in startEvent, false);
    assert.equal("stderr" in startEvent, false);
  } finally { await removeOwnedDirectory(owned); }
});
