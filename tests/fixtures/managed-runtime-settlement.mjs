import childProcess from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate } from "node:timers";
import { setImmediate as nextTurn } from "node:timers/promises";
import { operationSignal } from "../../scripts/data-infra/cancellation.mjs";
import { run } from "../../scripts/data-infra/runtime.mjs";
import { runManagedRuntimeCases } from "../managed-image-runtime.integration.mjs";

const events = [];
const cases = await runManagedRuntimeCases(async (index) => {
  events.push(`start ${index}`);
  if (index === 1) {
    if (process.env.AW_FIXTURE_OUTCOME === "reject") throw new Error("fixture failure");
    if (process.env.AW_FIXTURE_OUTCOME === "same-turn") {
      await new Promise((resolve) => {
        setImmediate(() => {
          resolve();
          throw new Error("same-turn fixture failure");
        });
      });
    }
    if (process.env.AW_FIXTURE_OUTCOME === "pipe-error") {
      const spawn = childProcess.spawn;
      childProcess.spawn = (...args) => {
        const child = spawn(...args);
        child.once("spawn", () => child.stdout.emit("error", new Error("fixture read error")));
        child.once("close", () => events.push("child closed"));
        return child;
      };
      syncBuiltinESMExports();
      try {
        await run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 2000 });
      } catch (error) {
        events.push(error.code);
        throw error;
      } finally {
        childProcess.spawn = spawn;
        syncBuiltinESMExports();
      }
    }
    if (process.env.AW_FIXTURE_OUTCOME === "interrupted") {
      const aborted = once(operationSignal(), "abort");
      void nextTurn().then(() => { throw new Error("detached fixture rejection"); });
      await aborted;
      events.push("cancelled");
      await nextTurn();
    }
  }
  events.push(`finish ${index}`);
});
events.push("cleanup");
await writeFile(process.env.AW_FIXTURE_RESULT, JSON.stringify({ events, cases }), { flag: "wx" });
