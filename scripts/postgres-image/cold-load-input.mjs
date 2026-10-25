import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { validateLocalPostgresRetentionPolicyBytes } from "./local-retention-diagnostic.mjs";
import { validatePostgresLocalPrivateCopyReceipt } from "./local-private-copy-diagnostic.mjs";
import { COLD_LOAD_PIN as PIN } from "./cold-load-policy.mjs";
import { validateColdLoadStart } from "./cold-load-protocol.mjs";

const fail = () => { throw new Error("postgres_cold_load_material_invalid"); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function authenticateColdLoadMaterial(policyBytes, copyBytes) {
  try {
    if (!Buffer.isBuffer(policyBytes) || !Buffer.isBuffer(copyBytes) || copyBytes.length !== PIN.copyReceiptBytes
      || sha(copyBytes) !== PIN.copyReceiptSha256) fail();
    const policy = validateLocalPostgresRetentionPolicyBytes(policyBytes);
    const receipt = validatePostgresLocalPrivateCopyReceipt(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(copyBytes)), policy);
    if (receipt.recipeRevision !== PIN.copyRecipeRevision || receipt.executionId !== PIN.copyExecutionId
      || receipt.linuxFinalProof.directory !== PIN.directory || receipt.archiveProof !== undefined
      || receipt.linuxFinalProof.archiveProof.imageId !== PIN.imageId || receipt.linuxFinalProof.archiveProof.tag !== PIN.tag) fail();
    return Object.freeze({ policy, copyReceipt: receipt });
  } catch { fail(); }
}
export function coldLoadEngineInput(startValue) {
  const start = validateColdLoadStart(startValue);
  const { policy, copyReceipt } = authenticateColdLoadMaterial(Buffer.from(start.policyBytesBase64, "base64"),
    Buffer.from(start.copyReceiptBytesBase64, "base64"));
  return Object.freeze({ directory: PIN.directory, files: copyReceipt.linuxFinalProof.files,
    archiveProof: copyReceipt.linuxFinalProof.archiveProof, policy, originalRecipeRevision: PIN.original.originalRecipeRevision,
    originalExecutionId: PIN.original.originalExecutionId, recipeRevision: start.recipeRevision,
    executionId: start.executionId, identity: start.identity });
}
