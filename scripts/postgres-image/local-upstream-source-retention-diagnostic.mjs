import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { requirePostgresSourceInventoryDiagnosticContext, finishPostgresSourceInventoryOutput,
  validatePostgresSourceInventoryEnvironment } from "./local-source-inventory-diagnostic.mjs";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";
import { POSTGRES_UPSTREAM_SOURCE_PIN as PIN, postgresUpstreamSourceLimits as LIMITS } from "./postgres-upstream-source-policy.mjs";
import { collectPostgresUpstreamSources, validatePostgresUpstreamSourceRetentionAcknowledgement,
  postgresUpstreamSourceRetentionFailureDiagnostic } from "./postgres-upstream-source-retention.mjs";

export const validatePostgresUpstreamSourceRetentionEnvironment = validatePostgresSourceInventoryEnvironment;
export const requirePostgresUpstreamSourceRetentionDiagnosticContext = requirePostgresSourceInventoryDiagnosticContext;

export async function runPostgresUpstreamSourceRetentionDiagnostic(argv = process.argv.slice(2), env = process.env) {
  const context = requirePostgresUpstreamSourceRetentionDiagnosticContext(argv, env);
  const signal = globalThis.AbortSignal.timeout(LIMITS.operationMs);
  const source = await inspectPostgresPrivateEvidenceSource({ workspace: context.workspace,
    deadline: Date.now() + LIMITS.operationMs, signal });
  const nonce = randomBytes(12).toString("hex");
  const expected = { recipeRevision: source.head, executionId: PIN.executionPrefix + nonce,
    directory: path.posix.join(PIN.parent, PIN.directoryPrefix + nonce) };
  let published;
  const result = await collectPostgresUpstreamSources({ workspace: context.workspace, ...expected, signal }, {
    result: async value => {
      if (published !== undefined) throw new Error("postgres_upstream_source_output_failed");
      published = validatePostgresUpstreamSourceRetentionAcknowledgement(value, expected);
      await finishPostgresSourceInventoryOutput(process.stdout, published);
    },
  });
  if (!published || !isDeepStrictEqual(validatePostgresUpstreamSourceRetentionAcknowledgement(result, expected), published)) {
    throw new Error("postgres_upstream_source_output_failed");
  }
  return published;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on("error", () => { process.exitCode = 1; });
  try { await runPostgresUpstreamSourceRetentionDiagnostic(); }
  catch (error) {
    process.stderr.write(JSON.stringify({ state: "INCOMPLETE", authority: "LOCAL_DIAGNOSTIC",
      admission: "NOT_AUTHORIZED", failure: postgresUpstreamSourceRetentionFailureDiagnostic(error) }) + "\n");
    process.exitCode = 1;
  }
}
