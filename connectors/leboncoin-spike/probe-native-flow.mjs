import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeSealedFragments, inspectSealedEnvelope, loadDiagnosticPublicKey, MAX_ENVELOPE_BYTES } from "./access-diagnostic.mjs";
import { readBounded, safeRuntimeMetadata } from "./autonomous-probe.mjs";
import { collectNativeFlow, MAX_FLOW_BYTES, nativeFlowIdentity, projectNativeFlow } from "./native-flow.mjs";

const FILE = fileURLToPath(import.meta.url);
const decode = (bytes) => JSON.parse(new globalThis.TextDecoder("utf8", { fatal: true }).decode(bytes));

function executeOnce(directory) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [FILE, "--child", "--out", directory], { detached: true, stdio: "ignore" });
    let settled = false; let timedOut = false; let hardKill;
    const kill = (signal) => { if (child.pid) { try { process.kill(-child.pid, signal); } catch { /* Owned group already exited. */ } } };
    const finish = (exitCode) => {
      if (settled) return;
      settled = true; globalThis.clearTimeout(timer); globalThis.clearTimeout(hardKill);
      process.removeListener("SIGTERM", interrupted); process.removeListener("SIGINT", interrupted);
      kill("SIGKILL");
      resolveResult({ execution: timedOut ? "timeout" : exitCode === null ? "error" : "finished", exitCode });
    };
    const timer = setTimeout(() => { timedOut = true; kill("SIGTERM"); hardKill = setTimeout(() => { kill("SIGKILL"); finish(null); }, 2000); }, 45_000);
    const interrupted = () => { kill("SIGKILL"); finish(null); };
    process.once("SIGTERM", interrupted); process.once("SIGINT", interrupted);
    child.once("error", () => finish(null)); child.once("close", (code) => finish(code));
  });
}

/** The injected run is called once; no result, including refusal, starts another child. */
export async function runNativeFlowProbe({ run, env, runtime, clock = Date.now, prepare = loadDiagnosticPublicKey }) {
  await prepare();
  nativeFlowIdentity(env);
  const started = clock();
  let input;
  try { input = await run(); } catch { input = { execution: "error" }; }
  const completed = clock();
  const failure = { schema_version: "leboncoin-native-flow/v1", ...safeRuntimeMetadata(env, runtime),
    evidence_status: input?.execution === "timeout" ? "collector_timeout" : "collector_error",
    outcome: input?.execution === "timeout" ? "verification_timeout" : "invalid_evidence", collection_success: false };
  try {
    if (input?.execution !== "finished" || input.exitCode !== 0 || !Number.isSafeInteger(started) || !Number.isSafeInteger(completed)
      || completed < started || completed - started > 60_000 || !input.record
      || Date.parse(input.record.started_at) < started || Date.parse(input.record.completed_at) > completed) throw new Error();
    const identity = nativeFlowIdentity(env, input.record.identity?.capture_id);
    const sealed = inspectSealedEnvelope(input.sealedBytes, identity);
    const receipt = projectNativeFlow(input.record, { env, runtime });
    if (receipt.outcome === "invalid_evidence") throw new Error();
    return { receipt: { ...receipt, evidence_status: "sealed", sealed_response_sha256: sealed.sha256, sealed_response_bytes: sealed.bytes },
      sealedBytes: input.sealedBytes };
  } catch { return { receipt: failure }; }
}

async function main(args) {
  const child = args[0] === "--child";
  const values = child ? args.slice(1) : args;
  if (values.length !== 2 || values[0] !== "--out" || !values[1] || process.platform !== "linux") throw new Error("arguments_invalid");
  const directory = resolve(values[1]);
  if (child) { await collectNativeFlow({ out: directory }); return; }
  await mkdir(directory, { mode: 0o700 });
  const runtime = { node: process.versions.node, platform: process.platform, arch: process.arch };
  let outcome;
  try {
    outcome = await runNativeFlowProbe({ env: process.env, runtime,
      run: async () => {
        const privateDirectory = join(directory, "attempt-1");
        const execution = await executeOnce(privateDirectory);
        if (execution.execution !== "finished") return execution;
        try { return { ...execution, record: decode(await readBounded(join(privateDirectory, "native-flow.private.json"), MAX_FLOW_BYTES + 1)),
          sealedBytes: await readBounded(join(privateDirectory, "sealed-native-flow.json"), MAX_ENVELOPE_BYTES) }; }
        catch { return { ...execution, record: null }; }
      },
    });
  } catch {
    outcome = { receipt: { schema_version: "leboncoin-native-flow/v1", ...safeRuntimeMetadata(process.env, runtime),
      evidence_status: "setup_failed", outcome: "invalid_evidence", collection_success: false } };
  }
  const recorded = outcome.receipt.evidence_status === "sealed";
  if (recorded) await writeFile(join(directory, "sealed-native-flow.json"), outcome.sealedBytes, { mode: 0o600, flag: "wx" });
  const temporary = join(directory, ".public-native-flow.tmp");
  await writeFile(temporary, `${JSON.stringify(outcome.receipt)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, join(directory, "public-native-flow.json"));
  process.stdout.write(`AUTO_FINDEX_NATIVE_FLOW ${JSON.stringify(outcome.receipt)}\n`);
  if (recorded) for (const line of encodeSealedFragments(outcome.sealedBytes)) process.stdout.write(`${line}\n`);
  process.exitCode = recorded ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === FILE) {
  try { await main(process.argv.slice(2)); }
  catch { process.stderr.write("Native flow probe setup or private publication failed.\n"); process.exitCode = 2; }
}
