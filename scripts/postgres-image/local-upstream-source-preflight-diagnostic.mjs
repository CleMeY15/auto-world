import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { requirePostgresSourceInventoryDiagnosticContext, finishPostgresSourceInventoryOutput,
  validatePostgresSourceInventoryEnvironment } from "./local-source-inventory-diagnostic.mjs";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";
import { postgresUpstreamSourceLimits as LIMITS } from "./postgres-upstream-source-policy.mjs";
import { inspectPostgresUpstreamSourceInputs, validatePostgresUpstreamSourcePreflight,
  postgresUpstreamSourceRetentionFailureDiagnostic } from "./postgres-upstream-source-retention.mjs";

export const validatePostgresUpstreamSourcePreflightEnvironment = validatePostgresSourceInventoryEnvironment;
export const requirePostgresUpstreamSourcePreflightDiagnosticContext = requirePostgresSourceInventoryDiagnosticContext;

export async function runPostgresUpstreamSourcePreflightDiagnostic(argv = process.argv.slice(2), env = process.env) {
  const context = requirePostgresUpstreamSourcePreflightDiagnosticContext(argv, env);
  const signal = globalThis.AbortSignal.timeout(LIMITS.operationMs);
  const source = await inspectPostgresPrivateEvidenceSource({ workspace: context.workspace,
    deadline: Date.now() + LIMITS.operationMs, signal });
  const expected = { workspace: context.workspace, recipeRevision: source.head };
  let published;
  const result = await inspectPostgresUpstreamSourceInputs({ ...expected, signal }, {
    result: async value => {
      if (published !== undefined) throw new Error("postgres_upstream_source_output_failed");
      published = validatePostgresUpstreamSourcePreflight(value, expected);
      // The fixed metadata result also obeys the established 16KiB output bound.
      await finishPostgresSourceInventoryOutput(process.stdout, published);
    },
  });
  if (!published || !isDeepStrictEqual(validatePostgresUpstreamSourcePreflight(result, expected), published)) {
    throw new Error("postgres_upstream_source_output_failed");
  }
  return published;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on("error", () => { process.exitCode = 1; });
  try { await runPostgresUpstreamSourcePreflightDiagnostic(); }
  catch (error) {
    process.stderr.write(JSON.stringify({ state: "INCOMPLETE", authority: "LOCAL_DIAGNOSTIC",
      admission: "NOT_AUTHORIZED", failure: postgresUpstreamSourceRetentionFailureDiagnostic(error) }) + "\n");
    process.exitCode = 1;
  }
}
