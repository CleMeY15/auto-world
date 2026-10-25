import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { requirePostgresPrivateEvidenceDiagnosticContext } from "./local-private-evidence-diagnostic.mjs";
import { intakePostgresPrivateRuntimeEvidence } from "./private-runtime-evidence.mjs";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN, postgresPrivateRuntimeEvidenceLimits as LIMITS } from "./private-runtime-evidence-policy.mjs";
import { postgresPrivateRuntimeEvidenceChannel, validatePostgresPrivateRuntimeEvidenceFrame as validateFrame,
  postgresPrivateRuntimeEvidenceFailureDiagnostic as diagnostic } from "./private-runtime-evidence-protocol.mjs";

const PREFIX = "postgres_private_runtime_evidence_";
const fail = () => { throw new Error(PREFIX + "control_invalid"); };
const budget = (deadline, maximum) => Math.max(1, Math.min(maximum, deadline - Date.now()));

// Reuse the already reviewed actual Node/UID/GID/kernel-groups/capabilities/NNP/environment guard.
export function requirePostgresPrivateRuntimeEvidenceWorkerContext(argv, env) {
  try {
    const context = requirePostgresPrivateEvidenceDiagnosticContext(argv, env);
    if (context.workspace !== PIN.workspace || context.node !== PIN.node) fail();
    return Object.freeze({ ...context, purpose: PIN.purpose });
  } catch { throw new Error(PREFIX + "context_invalid"); }
}

export async function runPostgresPrivateRuntimeEvidenceWorker(argv = process.argv.slice(2), env = process.env) {
  requirePostgresPrivateRuntimeEvidenceWorkerContext(argv, env);
  const channel = postgresPrivateRuntimeEvidenceChannel(process.stdin, process.stdout);
  let start;
  try {
    start = validateFrame(await channel.next(LIMITS.cleanupMs), { kind: "START" });
    return await intakePostgresPrivateRuntimeEvidence(start, {
      commit: async (prepared) => {
        channel.healthy();
        await channel.sendAndAllowNext(prepared, budget(start.deadline, LIMITS.cleanupMs));
        const commit = validateFrame(await channel.next(budget(start.deadline, LIMITS.gitCommandMs)), { kind: "COMMIT", nonce: start.nonce });
        if (!isDeepStrictEqual(commit.sources, start.sources)) fail();
        return commit;
      },
      finalize: async (published) => {
        channel.healthy();
        await channel.sendAndAllowNext(published, budget(start.deadline, LIMITS.cleanupMs));
        const finalize = validateFrame(await channel.next(budget(start.deadline, LIMITS.gitCommandMs)), { kind: "FINALIZE", nonce: start.nonce });
        await channel.eof(budget(start.deadline, LIMITS.cleanupMs)); channel.healthy(); return finalize;
      },
      result: async (result) => {
        requirePostgresPrivateRuntimeEvidenceWorkerContext(argv, env); channel.healthy();
        await channel.send(result, budget(start.deadline, LIMITS.cleanupMs));
        await channel.end(budget(start.deadline, LIMITS.cleanupMs));
        if (!channel.writerClosed()) fail();
      },
    });
  } catch (error) {
    let phase; let cleanup;
    try { phase = error?.phase; cleanup = error?.cleanup; } catch { /* Project only the closed diagnostic. */ }
    let failure = diagnostic(error, phase, cleanup);
    try {
      if (!start) fail();
      await channel.send({ kind: "FAILED", nonce: start.nonce, ...failure }, LIMITS.cleanupMs);
      await channel.end(LIMITS.cleanupMs);
      if (!channel.writerClosed()) fail();
    } catch { failure = diagnostic(new Error(PREFIX + "cleanup_uncertain"), "CLEANUP", "UNVERIFIED"); }
    return Object.freeze({ state: "INCOMPLETE", failure });
  } finally { channel.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runPostgresPrivateRuntimeEvidenceWorker();
    if (result.state === "INCOMPLETE") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ state: "INCOMPLETE", failure: diagnostic(error, "CONTEXT", "UNVERIFIED") }));
    process.exitCode = 1;
  }
}
