import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statfsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { COLD_LOAD_PIN } from "./cold-load-policy.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN as PIN, postgresPrivateEvidenceLimits as LIMITS } from "./private-evidence-policy.mjs";
import { intakePostgresPrivateEvidence, postgresPrivateEvidenceFailureDiagnostic } from "./private-evidence.mjs";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";

const CONTEXT = "postgres_private_evidence_diagnostic_context_invalid";
const RESULT = "postgres_private_evidence_diagnostic_result_invalid";
const fail = (code = CONTEXT) => { throw new Error(code); };
const keys = (value, names) => value !== null && typeof value === "object" && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...names].sort());
function dataRecord(value, names, code, plain = true) {
  if (!keys(value, names) || Reflect.ownKeys(value).length !== names.length
    || plain && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !("value" in descriptor))) fail(code);
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}
const expectedEnvironment = Object.freeze({
  PATH: `${path.posix.dirname(COLD_LOAD_PIN.node)}:/usr/sbin:/usr/bin:/bin`,
  HOME: PIN.parent,
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: "UTC",
});

// No injectable platform, actor, process status, clock or source revision.
export function requirePostgresPrivateEvidenceDiagnosticContext(argv, env) {
  try {
    if (!Array.isArray(argv) || argv.length !== 0) fail();
    env = dataRecord(env, Object.keys(expectedEnvironment), CONTEXT, false);
    if (Object.entries(expectedEnvironment).some(([name, value]) => env[name] !== value)
      || process.platform !== "linux" || process.version !== "v22.23.2" || process.execPath !== COLD_LOAD_PIN.node
      || [process.getuid(), process.geteuid(), process.getgid(), process.getegid()].some((id) => id !== 1000)
      || !isDeepStrictEqual(process.getgroups(), [1000]) || realpathSync(process.cwd()) !== PIN.workspace
      || Number(statfsSync(PIN.workspace).type) !== 0xef53) fail();
    const binary = lstatSync(COLD_LOAD_PIN.node);
    if (!binary.isFile() || binary.isSymbolicLink() || binary.uid !== 0 || binary.gid !== 0
      || (binary.mode & 0o7777) !== 0o755 || binary.nlink !== 1 || realpathSync(COLD_LOAD_PIN.node) !== COLD_LOAD_PIN.node) fail();
    const status = readFileSync("/proc/self/status", "utf8");
    for (const name of ["Uid", "Gid"]) {
      const match = status.match(new RegExp(`^${name}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*$`, "mu"));
      if (!match || match.slice(1).some((id) => id !== "1000")) fail();
    }
    if (!/^Groups:\s*$/mu.test(status) || !/^NoNewPrivs:\s+1\s*$/mu.test(status)
      || ["CapInh", "CapPrm", "CapEff", "CapAmb"].some((name) => !new RegExp(`^${name}:\\s+0{16}\\s*$`, "mu").test(status))) fail();
    return Object.freeze({ workspace: PIN.workspace, node: COLD_LOAD_PIN.node, uid: 1000, gid: 1000,
      supplementalGroups: "CLEARED", capabilities: "NONE", noNewPrivileges: true });
  } catch { fail(); }
}

export function validatePostgresPrivateEvidenceDiagnosticResult(value, expected) {
  try {
    expected = dataRecord(expected, ["executionId", "recipeRevision", "directory"], RESULT);
    value = dataRecord(value, ["state", "executionId", "recipeRevision", "directory", "receipt"], RESULT);
    value.receipt = dataRecord(value.receipt, ["name", "size", "sha256", "identity"], RESULT);
    value.receipt.identity = dataRecord(value.receipt.identity, ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"], RESULT);
    if (["executionId", "recipeRevision", "directory"].some((name) => typeof expected[name] !== "string")
      || !/^local-evidence-intake-[0-9a-f]{24}$/u.test(expected.executionId)
      || !/^[0-9a-f]{40}$/u.test(expected.recipeRevision)
      || expected.directory !== path.posix.join(PIN.parent, PIN.directoryPrefix + expected.executionId.slice("local-evidence-intake-".length))
      || value.state !== "INTAKE_VERIFIED" || value.executionId !== expected.executionId
      || value.recipeRevision !== expected.recipeRevision || value.directory !== expected.directory
      || value.receipt.name !== "receipt.json"
      || !Number.isSafeInteger(value.receipt.size) || value.receipt.size <= 0 || value.receipt.size > LIMITS.receiptBytes
      || typeof value.receipt.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.receipt.sha256)
      || ["dev", "ino", "mtimeNs", "ctimeNs"].some((name) => typeof value.receipt.identity[name] !== "string"
        || !/^(?:0|[1-9]\d*)$/u.test(value.receipt.identity[name]))
      || value.receipt.identity.uid !== 1000 || value.receipt.identity.gid !== 1000 || value.receipt.identity.mode !== 0o600
      || value.receipt.identity.nlink !== 1 || value.receipt.identity.size !== value.receipt.size) fail(RESULT);
    return Object.freeze({ state: "INTAKE_VERIFIED", authority: "LOCAL_DIAGNOSTIC", executionId: expected.executionId,
      recipeRevision: expected.recipeRevision, privateRoot: expected.directory,
      receipt: Object.freeze({ size: value.receipt.size, sha256: value.receipt.sha256 }),
      closure: "INCOMPLETE", historicalIntegrity: "VERIFIED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED",
      registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
      supportStartedAt: null, supportEndsAt: null, archiveUntil: null });
  } catch { fail(RESULT); }
}

export async function runPostgresPrivateEvidenceDiagnostic(argv = process.argv.slice(2), env = process.env) {
  const context = requirePostgresPrivateEvidenceDiagnosticContext(argv, env);
  const deadline = Date.now() + LIMITS.operationMs;
  const signal = globalThis.AbortSignal.timeout(LIMITS.operationMs);
  const source = await inspectPostgresPrivateEvidenceSource({ workspace: context.workspace, deadline, signal });
  if (source.workspace !== context.workspace || typeof source.head !== "string" || !/^[0-9a-f]{40}$/u.test(source.head)) fail();
  const nonce = randomBytes(12).toString("hex");
  const expected = { executionId: `local-evidence-intake-${nonce}`, recipeRevision: source.head,
    directory: path.posix.join(PIN.parent, PIN.directoryPrefix + nonce) };
  const result = await intakePostgresPrivateEvidence({ workspace: context.workspace, ...expected, pin: PIN, signal });
  return validatePostgresPrivateEvidenceDiagnosticResult(result, expected);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runPostgresPrivateEvidenceDiagnostic())); }
  catch (error) {
    const failure = error?.message === CONTEXT || error?.message === RESULT
      ? { code: error.message, phase: error.message === CONTEXT ? "CONTEXT" : "PUBLICATION", cleanup: "UNVERIFIED" }
      : postgresPrivateEvidenceFailureDiagnostic(error);
    console.error(JSON.stringify({ state: "INCOMPLETE", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", failure }));
    process.exitCode = 1;
  }
}
