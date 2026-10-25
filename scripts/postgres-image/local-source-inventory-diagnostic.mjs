import { randomBytes } from "node:crypto";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { requirePostgresPrivateEvidenceDiagnosticContext } from "./local-private-evidence-diagnostic.mjs";
import { validatePostgresPrivateRuntimeEvidenceEnvironment } from "./local-private-runtime-evidence-diagnostic.mjs";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";
import { POSTGRES_SOURCE_INVENTORY_PIN as PIN, postgresSourceInventoryLimits as LIMITS } from "./source-inventory-policy.mjs";
import { collectPostgresSourceInventory, validatePostgresSourceInventoryAcknowledgement,
  postgresSourceInventoryFailureDiagnostic } from "./source-inventory.mjs";

const PREFIX = "postgres_source_inventory_diagnostic_";
const ROOT = path.resolve(import.meta.dirname, "../..");
const fail = code => { throw new Error(PREFIX + code); };

// Reuse the established five-field native environment contract, with no override.
export function validatePostgresSourceInventoryEnvironment(value) {
  try { return validatePostgresPrivateRuntimeEvidenceEnvironment(value); }
  catch { fail("context_invalid"); }
}
export function requirePostgresSourceInventoryDiagnosticContext(argv, env) {
  try {
    if (!Array.isArray(argv) || Object.getPrototypeOf(argv) !== Array.prototype
      || !isDeepStrictEqual(Reflect.ownKeys(argv), ["length"]) || argv.length !== 0
      || process.execArgv.length !== 0 || ROOT !== PIN.workspace) fail("context_invalid");
    validatePostgresSourceInventoryEnvironment(env);
    return requirePostgresPrivateEvidenceDiagnosticContext(argv, env);
  } catch { fail("context_invalid"); }
}

// The successful public finish callback is observed before Node restores stdout.
// The parent must independently require exit0, complete EOF and empty stderr.
export async function finishPostgresSourceInventoryOutput(output, acknowledgement) {
  const bytes = Buffer.from(JSON.stringify(acknowledgement) + "\n");
  if (bytes.length > LIMITS.acknowledgementBytes || !output || typeof output.end !== "function"
    || typeof output.on !== "function" || output.destroyed || output.writableEnded) fail("output_invalid");
  let broken = false;
  const error = () => { broken = true; };
  output.on("error", error);
  await new Promise((resolve, reject) => {
    const stop = () => reject(new Error(PREFIX + "output_invalid"));
    const timer = setTimeout(stop, LIMITS.outputMs);
    const onError = () => { clearTimeout(timer); stop(); };
    output.once("error", onError);
    try {
      output.end(bytes, failure => {
        clearTimeout(timer); output.removeListener("error", onError);
        if (failure || broken || output.writableFinished !== true || output.writableEnded !== true) stop();
        else resolve();
      });
    } catch { clearTimeout(timer); output.removeListener("error", onError); stop(); }
  });
  if (broken) fail("output_invalid");
}

export async function runPostgresSourceInventoryDiagnostic(argv = process.argv.slice(2), env = process.env) {
  const context = requirePostgresSourceInventoryDiagnosticContext(argv, env);
  const signal = globalThis.AbortSignal.timeout(LIMITS.operationMs);
  const source = await inspectPostgresPrivateEvidenceSource({ workspace: context.workspace,
    deadline: Date.now() + LIMITS.operationMs, signal });
  const nonce = randomBytes(12).toString("hex");
  const expected = { recipeRevision: source.head, executionId: PIN.executionPrefix + nonce,
    directory: path.posix.join(PIN.parent, PIN.directoryPrefix + nonce) };
  let published;
  const result = await collectPostgresSourceInventory({ workspace: context.workspace, ...expected, signal }, {
    result: async value => {
      if (published !== undefined) fail("output_invalid");
      published = validatePostgresSourceInventoryAcknowledgement(value, expected);
      await finishPostgresSourceInventoryOutput(process.stdout, published);
    },
  });
  if (!published || !isDeepStrictEqual(validatePostgresSourceInventoryAcknowledgement(result, expected), published)) fail("output_invalid");
  return published;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A late terminal stream error cannot become an accepted parent execution.
  process.stdout.on("error", () => { process.exitCode = 1; });
  try { await runPostgresSourceInventoryDiagnostic(); }
  catch (error) {
    const failure = postgresSourceInventoryFailureDiagnostic(error);
    process.stderr.write(JSON.stringify({ state: "INCOMPLETE", authority: "LOCAL_DIAGNOSTIC",
      admission: "NOT_AUTHORIZED", failure }) + "\n");
    process.exitCode = 1;
  }
}
