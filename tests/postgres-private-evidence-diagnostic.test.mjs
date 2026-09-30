import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { COLD_LOAD_PIN } from "../scripts/postgres-image/cold-load-policy.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN as PIN, postgresPrivateEvidenceBlobPins } from "../scripts/postgres-image/private-evidence-policy.mjs";
import { requirePostgresPrivateEvidenceDiagnosticContext, runPostgresPrivateEvidenceDiagnostic,
  validatePostgresPrivateEvidenceDiagnosticResult } from "../scripts/postgres-image/local-private-evidence-diagnostic.mjs";

const revision = "f".repeat(40);
const nonce = "b".repeat(24);
const expected = { executionId: `local-evidence-intake-${nonce}`, recipeRevision: revision,
  directory: path.posix.join(PIN.parent, PIN.directoryPrefix + nonce) };
const environment = { PATH: `${path.posix.dirname(COLD_LOAD_PIN.node)}:/usr/sbin:/usr/bin:/bin`,
  HOME: PIN.parent, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" };
const clone = (value) => globalThis.structuredClone(value);
function acknowledgement() {
  return { state: "INTAKE_VERIFIED", ...expected, receipt: { name: "receipt.json", size: 4000, sha256: "a".repeat(64),
    identity: { dev: "2096", ino: "123", uid: 1000, gid: 1000, mode: 0o600, nlink: 1, size: 4000,
      mtimeNs: "1790786471778509866", ctimeNs: "1790786471778509866" } } };
}

test("independent public byte expectations still match the eleven committed materials", () => {
  assert.equal(PIN.publicFiles.length, 11);
  assert.equal(new Set(PIN.publicFiles.map((file) => file.name)).size, 11);
  for (const item of PIN.publicFiles) {
    const bytes = readFileSync(new URL(`../${item.source}`, import.meta.url));
    assert.equal(bytes.length, item.size, item.source);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.source);
    assert.equal(Object.isFrozen(item), true);
  }
  assert.equal(Object.isFrozen(PIN.recipes), true);
  const pins = postgresPrivateEvidenceBlobPins(revision);
  assert.equal(pins.length, 18);
  assert.equal(new Set(pins.map((item) => `${item.recipeRevision}:${item.path}`)).size, 18);
  for (const recipe of Object.values(PIN.recipes)) assert.ok(pins.some((item) => item.recipeRevision === recipe));
  assert.throws(() => postgresPrivateEvidenceBlobPins([revision]), /recipe_invalid/u);
});

test("fixed diagnostic rejects caller-selected source, subject or transport before native work", async () => {
  for (const argv of [["--subject", "untrusted-subject"], ["--directory", "/tmp/foreign"], ["--skip-verification"], {}, null]) {
    await assert.rejects(runPostgresPrivateEvidenceDiagnostic(argv, environment), { message: "postgres_private_evidence_diagnostic_context_invalid" });
  }
});

test("closed environment refuses ambient fields and accessors without executing them", () => {
  for (const env of [{ ...environment, EXTRA_FIELD: "untrusted" }, { ...environment, TZ: "Europe/Paris" }, {}]) {
    assert.throws(() => requirePostgresPrivateEvidenceDiagnosticContext([], env), /context_invalid/u);
  }
  let reads = 0; const env = { ...environment };
  Object.defineProperty(env, "PATH", { enumerable: true, get() { reads += 1; return environment.PATH; } });
  assert.throws(() => requirePostgresPrivateEvidenceDiagnosticContext([], env), /context_invalid/u);
  assert.equal(reads, 0);
});

test("diagnostic acknowledgement validation emits only closed public metadata and no runtime permission", () => {
  // Pure shape validation is not native receipt/file acceptance.
  const ack = acknowledgement(); const value = validatePostgresPrivateEvidenceDiagnosticResult(ack, expected);
  assert.equal(value.state, "INTAKE_VERIFIED"); assert.equal(value.closure, "INCOMPLETE");
  assert.equal(value.currentness, "NOT_EVALUATED"); assert.equal(value.runtimePermission, "NOT_GRANTED");
  assert.equal(value.admission, "NOT_AUTHORIZED");
  assert.deepEqual([value.supportStartedAt, value.supportEndsAt, value.archiveUntil], [null, null, null]);
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.receipt), true);
  assert.equal(JSON.stringify(value).includes("identity"), false);
  ack.receipt.sha256 = "changed"; assert.equal(value.receipt.sha256, "a".repeat(64));
});

test("diagnostic rejects foreign, malformed or surplus acknowledgement fields", () => {
  const changes = [
    (v) => { v.state = "VERIFIED"; }, (v) => { v.executionId = "local-evidence-intake-" + "c".repeat(24); },
    (v) => { v.recipeRevision = "0".repeat(40); }, (v) => { v.directory = "/tmp/foreign"; },
    (v) => { v.rawData = "untrusted"; }, (v) => { v.receipt.name = "../receipt.json"; },
    (v) => { v.receipt.size = 128 * 1024 + 1; }, (v) => { v.receipt.size = "4000"; },
    (v) => { v.receipt.sha256 = ["a".repeat(64)]; }, (v) => { v.receipt.identity.uid = "1000"; },
    (v) => { v.receipt.identity.gid = 0; }, (v) => { v.receipt.identity.mode = 0o644; },
    (v) => { v.receipt.identity.nlink = 2; }, (v) => { v.receipt.identity.size = 3999; },
    (v) => { v.receipt.identity.ino = "0123"; }, (v) => { v.receipt.identity.mtimeNs = 1; },
    (v) => { v.receipt.identity.extra = "untrusted"; },
  ];
  for (const change of changes) {
    const ack = acknowledgement(); change(ack);
    assert.throws(() => validatePostgresPrivateEvidenceDiagnosticResult(ack, expected), /result_invalid/u);
  }
});

test("acknowledgement accessors, prototypes, hidden fields and scalar coercion cannot escape validation", () => {
  let calls = 0; const ack = acknowledgement();
  Object.defineProperty(ack.receipt, "sha256", { enumerable: true, get() { calls += 1; return "a".repeat(64); } });
  assert.throws(() => validatePostgresPrivateEvidenceDiagnosticResult(ack, expected), /result_invalid/u);
  assert.equal(calls, 0);
  const hidden = acknowledgement(); Object.defineProperty(hidden, "extra", { value: "hidden" });
  assert.throws(() => validatePostgresPrivateEvidenceDiagnosticResult(hidden, expected), /result_invalid/u);
  const symbol = acknowledgement(); symbol[Symbol("extra")] = true;
  assert.throws(() => validatePostgresPrivateEvidenceDiagnosticResult(symbol, expected), /result_invalid/u);
  const foreign = Object.assign(Object.create({ extra: "foreign" }), acknowledgement());
  assert.throws(() => validatePostgresPrivateEvidenceDiagnosticResult(foreign, expected), /result_invalid/u);
  const context = clone(expected); context.recipeRevision = { toString() { calls += 1; return revision; } };
  assert.throws(() => validatePostgresPrivateEvidenceDiagnosticResult(acknowledgement(), context), /result_invalid/u);
  assert.equal(calls, 0);
});

test("fixed host accepts real cleared groups while refusing a kernel supplementary primary group", {
  skip: process.platform !== "linux" || process.getuid() !== 0 || !existsSync(COLD_LOAD_PIN.node) || !existsSync(PIN.workspace)
    ? "Requires the real root test bootstrap and fixed Linux Node22 host; covered separately on that host" : false,
}, () => {
  const module = new URL("../scripts/postgres-image/local-private-evidence-diagnostic.mjs", import.meta.url).href;
  const code = `import { requirePostgresPrivateEvidenceDiagnosticContext as context } from ${JSON.stringify(module)};
    try { console.log(JSON.stringify(context([], process.env))); }
    catch (error) { if (error.message !== "postgres_private_evidence_diagnostic_context_invalid") throw error; process.exitCode = 9; }`;
  for (const cleared of [true, false]) {
    const result = spawnSync("/usr/bin/setpriv", ["--reuid=1000", "--regid=1000", cleared ? "--clear-groups" : "--groups=1000",
      "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", "/usr/bin/env", "-i",
      ...Object.entries(environment).map(([name, value]) => `${name}=${value}`), COLD_LOAD_PIN.node, "--input-type=module", "--eval", code],
    { cwd: PIN.workspace, env: { PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 10000, maxBuffer: 8192 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr, "");
    assert.equal(result.status, cleared ? 0 : 9);
    if (cleared) assert.deepEqual(JSON.parse(result.stdout), { workspace: PIN.workspace, node: COLD_LOAD_PIN.node, uid: 1000, gid: 1000,
      supplementalGroups: "CLEARED", capabilities: "NONE", noNewPrivileges: true });
    else assert.equal(result.stdout, "");
  }
});
