import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { authenticateColdLoadMaterial } from "./cold-load-input.mjs";
import { coldLoadClientIdentity, validatePostgresColdLoadReceipt } from "./local-cold-load-diagnostic.mjs";
import { validatePostgresRemoteRuntimePolicy } from "./candidate-remote-runtime-diagnostic.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN as PIN } from "./runtime-restore-policy.mjs";
import { validatePostgresRuntimeRestoreStart } from "./runtime-restore-protocol.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");
const fail = () => { throw new Error("postgres_runtime_restore_material_invalid"); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, fields) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...fields].sort());
const parse = (v) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(v));
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, v]) => [key, freeze(v)])));
  return value;
}
export function authenticatePostgresRuntimeRestoreMaterial(policyBytes, copyBytes, runtimeBytes) {
  try {
    if (!Buffer.isBuffer(runtimeBytes) || runtimeBytes.length !== PIN.runtimePolicy.size || sha(runtimeBytes) !== PIN.runtimePolicy.sha256) fail();
    const material = authenticateColdLoadMaterial(policyBytes, copyBytes);
    const runtimePolicy = validatePostgresRemoteRuntimePolicy(parse(runtimeBytes), material.policy);
    if (runtimePolicy.audit.runId !== PIN.auditRunId || runtimePolicy.audit.recipeRevision !== PIN.auditRecipeRevision
      || runtimePolicy.audit.receipt.sha256 !== PIN.auditReceiptSha256) fail();
    return freeze({ ...material, runtimePolicy });
  } catch { fail(); }
}
export function authenticatePriorPostgresColdLoad(bytes, material, policyBytes, copyBytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length !== PIN.priorColdLoad.size || sha(bytes) !== PIN.priorColdLoad.sha256) fail();
    const receipt = parse(bytes);
    const start = { kind: "START", nonce: PIN.priorColdLoad.nonce, recipeRevision: PIN.priorColdLoad.recipeRevision,
      executionId: PIN.priorColdLoad.executionId, identity: coldLoadClientIdentity(receipt.daemonIdentity, PIN.priorColdLoad.nonce),
      policyBytesBase64: policyBytes.toString("base64"), copyReceiptBytesBase64: copyBytes.toString("base64") };
    validatePostgresColdLoadReceipt(receipt, start, material);
    return freeze(receipt);
  } catch { fail(); }
}
export function validatePostgresRuntimeRestoreEngineIdentity(value, nonce) {
  const fields = ["endpoint", "daemonId", "dataRoot", "containerdAddress", "containersNamespace", "pluginsNamespace",
    "dockerConfig", "contextName", "socket", "socketDirectory"];
  if (!exact(value, fields) || typeof nonce !== "string" || !/^[0-9a-f]{24}$/u.test(nonce)
    || typeof value.dockerConfig !== "string" || !/^\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}\/client$/u.test(value.dockerConfig)
    || typeof value.daemonId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.daemonId)) fail();
  const parent = value.dockerConfig.slice(0, -7);
  if (value.endpoint !== `unix://${parent}/endpoint/docker.sock` || value.dataRoot !== `${parent}/infra/data`
    || value.containerdAddress !== "/run/containerd/containerd.sock" || value.containersNamespace !== `awpgsql-${nonce}`
    || value.pluginsNamespace !== `plugins.awpgsql-${nonce}` || value.contextName !== `aw-pg-restore-${nonce}`) fail();
  for (const [field, mode] of [["socket", 0o660], ["socketDirectory", 0o710]]) {
    const v = value[field];
    if (!exact(v, ["dev", "ino", "uid", "gid", "mode"]) || v.uid !== 0 || v.gid !== 1000 || v.mode !== mode
      || [v.dev, v.ino].some((n) => typeof n !== "string" || !/^[1-9][0-9]{0,29}$/u.test(n))) fail();
  }
  return freeze(value);
}
export function postgresRuntimeRestoreEngineInput(startValue) {
  const start = validatePostgresRuntimeRestoreStart(startValue);
  const material = authenticatePostgresRuntimeRestoreMaterial(Buffer.from(start.policyBytesBase64, "base64"),
    Buffer.from(start.copyReceiptBytesBase64, "base64"), Buffer.from(start.runtimePolicyBytesBase64, "base64"));
  if (start.auditReceiptSha256 !== PIN.auditReceiptSha256) fail();
  return freeze({ directory: PIN.directory, files: material.copyReceipt.linuxFinalProof.files,
    archiveProof: material.copyReceipt.linuxFinalProof.archiveProof, policy: material.policy,
    originalRecipeRevision: PIN.original.originalRecipeRevision, originalExecutionId: PIN.original.originalExecutionId,
    recipeRevision: start.recipeRevision, executionId: start.executionId,
    identity: validatePostgresRuntimeRestoreEngineIdentity(start.identity, start.nonce),
    workDirectory: start.workDirectory, auditReceiptSha256: PIN.auditReceiptSha256 });
}
