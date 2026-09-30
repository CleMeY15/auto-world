import { COLD_LOAD_PIN } from "./cold-load-policy.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN } from "./private-evidence-policy.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN } from "./runtime-restore-policy.mjs";

export function freezePostgresPrivateRuntimeEvidence(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezePostgresPrivateRuntimeEvidence(child);
    Object.freeze(value);
  }
  return value;
}

// Reviewed expectations are independent of all three historical JSON/file inputs.
export const POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN = freezePostgresPrivateRuntimeEvidence({
  purpose: "POSTGRES_PRIVATE_RUNTIME_EVIDENCE",
  workspace: POSTGRES_PRIVATE_EVIDENCE_PIN.workspace,
  node: COLD_LOAD_PIN.node,
  setpriv: "/usr/bin/setpriv",
  parent: POSTGRES_PRIVATE_EVIDENCE_PIN.parent,
  subject: POSTGRES_PRIVATE_EVIDENCE_PIN.subject,
  directoryPrefix: "pg-private-runtime-evidence-0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93-",
  legacy: {
    directory: "/home/autoworld/pg-private-evidence-0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93-0ccc0b46842ee0b290ac6134",
    size: 89249,
    sha256: "20cba0fd12d274bdeeb30525a4a0a2304080f36b6a6f525944cc191316c549b6",
    recipeRevision: "48950ca1e08e69a571088e9647f3bcfe4143686b",
    executionId: "local-evidence-intake-0ccc0b46842ee0b290ac6134",
  },
  cold: POSTGRES_RUNTIME_RESTORE_PIN.priorColdLoad,
  sql: {
    recipeRevision: "70c396301808bf89652b1ba408d9aff282340483",
    executionId: "local-pg-restore-f0cc9bfef1873516dd8fe970",
    nonce: "f0cc9bfef1873516dd8fe970",
    workDirectory: "/var/tmp/aw-pr-A4IQqJ/work",
  },
  sources: [
    { role: "COLD_RECEIPT", fd: 3, source: "/var/tmp/aw-cl-NqQrTO/receipt.json", name: "cold-receipt.json",
      size: 59779, sha256: "a686e2bece45448dd81778eea03083519795bcc49d72c58228fed048ea1f9411", uid: 0, gid: 0, mode: 0o600 },
    { role: "SQL_RECEIPT", fd: 4, source: "/var/tmp/aw-pr-A4IQqJ/receipt.json", name: "sql-receipt.json",
      size: 81500, sha256: "ff8c49950216a2de33f1e3a6566d1be662a4436f7d136ac2a7d252e21ab1c617", uid: 0, gid: 0, mode: 0o600 },
    { role: "SQL_DUMP", fd: 5, source: "/var/tmp/aw-pr-A4IQqJ/work/backup/diagnostic.dump", name: "backup/diagnostic.dump",
      size: 4654, sha256: "1f904d53426a380146b592eea6a9ab84eeb9c6d0b7793cd63367ab6faf08bd64", uid: 1000, gid: 1000, mode: 0o600 },
  ],
  requiredMissing: ["EXTERNAL_SOFTWARE_SOURCE_NOTICES", "OFFICIAL_ATTESTATION_BUNDLE", "SECOND_WINDOWS_EVIDENCE_COPY"],
});

export const postgresPrivateRuntimeEvidenceLimits = Object.freeze({
  operationMs: 300000,
  cleanupMs: 10000,
  gitCommandMs: 90000,
  frameBytes: 16384,
  trafficBytes: 131072,
  receiptBytes: 32768,
  sourceBytes: 131072,
  reservedDiskBytes: 1024 * 1024,
});

export const postgresPrivateRuntimeEvidenceEnvironment = Object.freeze({
  PATH: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin:/usr/sbin:/usr/bin:/bin",
  HOME: POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN.parent,
  LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
});

export const postgresPrivateRuntimeEvidenceFailureCodes = Object.freeze([
  "context_invalid", "source_invalid", "historical_invalid", "copy_failed", "publication_failed",
  "control_invalid", "git_invalid", "cleanup_uncertain", "operation_failed",
]);
export const postgresPrivateRuntimeEvidencePhases = Object.freeze([
  "CONTEXT", "SOURCE", "HISTORY", "COPY", "PREPARED", "PUBLICATION", "FINALIZE", "CLEANUP",
]);
