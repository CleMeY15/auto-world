import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { parseCommand, runCli } from "../scripts/data-infra/cli.mjs";

test("infra CLI accepts only documented scoped commands and relevant options", () => {
  assert.equal(parseCommand(["migrate", "--direction", "down"]).direction, "down");
  assert.deepEqual(parseCommand(["stop", "--service", "redis"]).services, ["redis"]);
  for (const args of [[], ["prune"], ["up", "--file", "/other"], ["up", "--direction", "down"], ["stop", "--service", "unknown"], ["up", "--project"], ["restore-check"], ["reset", "--project", "aw-local-a", "--project", "aw-local-b"]]) {
    assert.throws(() => parseCommand(args));
  }
});

test("status health failures do not overwrite the authoritative signal exit code", async () => {
  const priorExit = process.exitCode;
  try {
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
      const emitted = [];
      await runCli(["status"], { execute: async (args) => {
        assert.deepEqual(args, ["status"]);
        process.emit(signal);
        return { health: [{ status: "failed" }] };
      }, emit: (value) => emitted.push(value) });
      assert.equal(process.exitCode, code);
      assert.deepEqual(emitted, [{ status: "cancelled", code: "process_cancelled" }]);
    }
  } finally { process.exitCode = priorExit; }
});

for (const [signal, expected] of [["SIGINT", 130], ["SIGTERM", 143]]) test(`spawned CLI status result retains ${signal}`, { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const cli = new URL("../scripts/data-infra/cli.mjs", import.meta.url).href;
  const runtime = new URL("../scripts/data-infra/runtime.mjs", import.meta.url).href;
  // Inject only the service probe so this CLI result-path test needs no Docker.
  const code = `import {runCli} from ${JSON.stringify(cli)}; import {run} from ${JSON.stringify(runtime)};
    await runCli(['status'],{execute:async()=>{console.log('status-probing');
      try{await run(process.execPath,['-e','setTimeout(()=>{},30000)'],{timeoutMs:30000});}
      catch(error){if(error.code!=='process_cancelled')throw error;}
      return {health:[{status:'failed'}]};}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let sent = false;
  let output = "";
  let errors = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
    if (!sent && output.includes("status-probing")) { sent = true; child.kill(signal); }
  });
  child.stderr.on("data", (data) => { errors += data.toString(); });
  const exit = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(exit, expected, errors);
  assert.match(output, /"status":"cancelled"/u);
});
