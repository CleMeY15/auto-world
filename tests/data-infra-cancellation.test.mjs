import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { operationSignal, protectedRecovery, withCancellation } from "../scripts/data-infra/cancellation.mjs";
import { run } from "../scripts/data-infra/runtime.mjs";

test("cooperative cancellation aborts work but preserves bounded recovery", async () => {
  await withCancellation(async () => {
    process.emit("SIGINT");
    assert.equal(operationSignal().aborted, true);
    await assert.rejects(async () => run(process.execPath, ["-e", "process.exit(0)"]), /process_cancelled/u);
    await protectedRecovery(async () => {
      assert.equal(operationSignal(), undefined);
      assert.equal((await run(process.execPath, ["-e", "process.exit(0)"])).code, 0);
    });
  });
  assert.equal(operationSignal(), undefined);
});

test("POSIX SIGTERM interrupts the child and completes recovery before exit", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const cancellation = new URL("../scripts/data-infra/cancellation.mjs", import.meta.url).href;
  const runtime = new URL("../scripts/data-infra/runtime.mjs", import.meta.url).href;
  const code = `import {withCancellation,protectedRecovery} from ${JSON.stringify(cancellation)};
    import {run} from ${JSON.stringify(runtime)};
    await withCancellation(async()=>{ console.log('ready');
      try { await run(process.execPath,['-e','setTimeout(()=>{},30000)'],{timeoutMs:30000}); }
      catch(error) { if(error.code!=='process_cancelled') throw error; }
      finally { await protectedRecovery(async()=>{await run(process.execPath,['-e','process.exit(0)']); console.log('recovered');}); }
    });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  let errorOutput = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
    if (output.includes("ready") && !output.includes("recovered")) child.kill("SIGTERM");
  });
  child.stderr.on("data", (data) => { errorOutput += data.toString(); });
  const exit = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(exit, 0, errorOutput);
  assert.match(output, /recovered/u);
});
