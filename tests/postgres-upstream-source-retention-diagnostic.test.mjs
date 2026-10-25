import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { POSTGRES_UPSTREAM_SOURCE_PIN as PIN } from "../scripts/postgres-image/postgres-upstream-source-policy.mjs";
import { requirePostgresUpstreamSourceRetentionDiagnosticContext,
  validatePostgresUpstreamSourceRetentionEnvironment } from "../scripts/postgres-image/local-upstream-source-retention-diagnostic.mjs";
import { requirePostgresUpstreamSourcePreflightDiagnosticContext,
  validatePostgresUpstreamSourcePreflightEnvironment } from "../scripts/postgres-image/local-upstream-source-preflight-diagnostic.mjs";

const environment = () => ({
  PATH: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin:/usr/sbin:/usr/bin:/bin",
  HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
});

test("source retention rejects added paths and accessor environments before native work", () => {
  assert.doesNotThrow(() => validatePostgresUpstreamSourceRetentionEnvironment(environment()));
  for (const changed of [{ ...environment(), SOURCE: "/tmp/untrusted" },
    { ...environment(), NODE_OPTIONS: "--require=/tmp/untrusted" },
    Object.assign(Object.create(null), environment()),
    { ...environment(), PATH: "/tmp/untrusted:/usr/bin" }]) {
    assert.throws(() => validatePostgresUpstreamSourceRetentionEnvironment(changed));
  }
  let reads = 0;
  const accessor = environment();
  Object.defineProperty(accessor, "HOME", { enumerable: true, get() { reads++; return "/home/autoworld"; } });
  assert.throws(() => validatePostgresUpstreamSourceRetentionEnvironment(accessor));
  assert.equal(reads, 0);
  assert.throws(() => requirePostgresUpstreamSourceRetentionDiagnosticContext(["--source=/tmp/untrusted"], environment()));
  const decorated = [];
  decorated.source = "/tmp/untrusted";
  assert.throws(() => requirePostgresUpstreamSourceRetentionDiagnosticContext(decorated, environment()));
});

test("actual input-free CLI emits only a closed refusal for path arguments", () => {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts/postgres-image/local-upstream-source-retention-diagnostic.mjs"),
    "--source=/tmp/source-retention-argument-fixture",
  ], { env: environment(), encoding: "utf8", timeout: 10000, maxBuffer: 16384 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const diagnostic = JSON.parse(result.stderr);
  assert.deepEqual(Object.keys(diagnostic).sort(), ["admission", "authority", "failure", "state"]);
  assert.equal(diagnostic.state, "INCOMPLETE");
  assert.equal(diagnostic.authority, "LOCAL_DIAGNOSTIC");
  assert.equal(diagnostic.admission, "NOT_AUTHORIZED");
  assert.deepEqual(Object.keys(diagnostic.failure).sort(), ["cleanup", "code", "phase"]);
  assert.equal(diagnostic.failure.phase, "CONTEXT");
  assert.ok(!result.stderr.includes("argument-fixture"));
});

test("fixed policy never exposes archive transport or Python site configuration", () => {
  assert.equal(PIN.archives.length, 2);
  assert.ok(Object.isFrozen(PIN) && PIN.archives.every(Object.isFrozen));
  assert.equal(PIN.python.executable, "/usr/bin/python3.12");
  assert.deepEqual(PIN.python.arguments, ["-I", "-S", "-B", "/proc/self/fd/7"]);
  assert.equal(PIN.python.transitiveStdlibClosure, "NOT_INDEPENDENTLY_AUTHENTICATED");
  assert.ok(PIN.archives.every(archive => /^[0-9a-f]{64}$/u.test(archive.sha256)));
  assert.ok(PIN.archives.every(archive => archive.selectedFiles.every(file => /^[0-9a-f]{64}$/u.test(file.sha256))));
});

test("readonly preflight accepts no environment, directory, or execution authority override", () => {
  assert.doesNotThrow(() => validatePostgresUpstreamSourcePreflightEnvironment(environment()));
  for (const changed of [{ ...environment(), SOURCE: "/tmp/untrusted" },
    { ...environment(), PYTHONPATH: "/tmp/untrusted" },
    { ...environment(), NODE_OPTIONS: "--require=/tmp/untrusted" }]) {
    assert.throws(() => validatePostgresUpstreamSourcePreflightEnvironment(changed));
  }
  for (const argument of ["--source=/tmp/preflight-argument-fixture",
    "--directory=/tmp/preflight-argument-fixture", "--executionId=untrusted"]) {
    assert.throws(() => requirePostgresUpstreamSourcePreflightDiagnosticContext([argument], environment()));
    const result = spawnSync(process.execPath, [
      path.resolve("scripts/postgres-image/local-upstream-source-preflight-diagnostic.mjs"), argument,
    ], { env: environment(), encoding: "utf8", timeout: 10000, maxBuffer: 16384 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    const diagnostic = JSON.parse(result.stderr);
    assert.deepEqual(Object.keys(diagnostic).sort(), ["admission", "authority", "failure", "state"]);
    assert.equal(diagnostic.state, "INCOMPLETE");
    assert.equal(diagnostic.admission, "NOT_AUTHORIZED");
    assert.equal(diagnostic.failure.phase, "CONTEXT");
    assert.ok(!result.stderr.includes("argument-fixture"));
  }
});
