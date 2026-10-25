import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
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
    },{processExit:true});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  let errorOutput = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
    if (output.includes("ready") && !output.includes("recovered")) child.kill("SIGTERM");
  });
  child.stderr.on("data", (data) => { errorOutput += data.toString(); });
  const exit = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(exit, 143, errorOutput);
  assert.match(output, /recovered/u);
});

test("cancelled real subprocess is terminated before recovery can mutate a marker", { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "aw-child-close-"));
  const pidFile = join(directory, "pid");
  const controller = new globalThis.AbortController();
  try {
    const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>{},30000);`;
    const pending = run(process.execPath, ["-e", childCode], { signal: controller.signal, timeoutMs: 5000 });
    const rejected = assert.rejects(pending, /process_cancelled/u);
    let pid;
    const until = Date.now() + 3000;
    while (!pid && Date.now() < until) {
      try { pid = Number(await readFile(pidFile, "utf8")); } catch { await delay(10); }
    }
    assert.ok(pid);
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), (error) => error.code === "ESRCH");
    await writeFile(join(directory, "recovery"), "child closure verified first");
  } finally {
    controller.abort();
    await rm(directory, { recursive: true });
  }
});
