import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createApplicationRuntime, openApplication } from "../prototype-application/runtime.mjs";
import { WEB_PROJECTION, WEB_SEED_INVOCATION, createWebSeedAdapter } from "./profile.mjs";
import { waitForWebServices } from "./readiness.mjs";

export const WEB_PORT = 3111;
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const webDirectory = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const webPreparation = createApplicationRuntime({ serviceHealth: waitForWebServices });

export function prepareWebApplication(state) {
  return webPreparation.prepareApplication(state, { targetMappingVersion: 2 });
}

export async function assertWebPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("prototype_web_port_unavailable")));
    probe.listen(WEB_PORT, "127.0.0.1", () => probe.close((error) => error ? reject(error) : resolve()));
  });
}

// Only the owned Next process is stopped. The API lifecycle owns its clients and
// the CLI's existing project lifecycle stops services without deleting volumes.
export async function startWebProcess({ signal, launch = spawn, fetcher = globalThis.fetch } = {}) {
  if (signal?.aborted) throw new Error("prototype_web_cancelled");
  await assertWebPortAvailable();
  const child = launch(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(WEB_PORT)],
    { cwd: webDirectory, windowsHide: true, stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production", AUTO_WORLD_DEMO: "1", AUTO_WORLD_WEB_BACKEND: "prototype" } });
  let ended = false;
  const closed = new Promise((resolve) => {
    child.once("error", () => { ended = true; resolve(); });
    child.once("close", () => { ended = true; resolve(); });
  });
  let closing;
  function close() {
    closing ??= (async () => {
      if (ended) return;
      child.kill("SIGTERM");
      await Promise.race([closed, delay(10_000, undefined, { ref: false })]);
      if (!ended) {
        child.kill("SIGKILL");
        await Promise.race([closed, delay(5_000, undefined, { ref: false })]);
        if (!ended) throw new Error("prototype_web_shutdown_timeout");
      }
    })();
    return closing;
  }
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("prototype_web_cancelled");
      if (ended) throw new Error("prototype_web_early_exit");
      try {
        const response = await fetcher(`http://127.0.0.1:${WEB_PORT}/demo`,
          { redirect: "error", signal: globalThis.AbortSignal.timeout(2_000) });
        await response.body?.cancel();
        if (response.ok && !ended) return Object.freeze({ url: `http://127.0.0.1:${WEB_PORT}/demo`, close });
      } catch { /* Wait only for this child to become ready; no alternate backend. */ }
      await delay(100, undefined, signal ? { signal } : {});
    }
    throw new Error("prototype_web_readiness_timeout");
  } catch (error) {
    await close();
    throw error;
  }
}

export async function openWebApplication(state, options = {}, dependencies = {}) {
  if (options.port !== undefined && options.port !== 3211) throw new Error("prototype_web_fixed_port_required");
  await (dependencies.assertWebPortAvailable ?? assertWebPortAvailable)();
  const application = await (dependencies.openApplication ?? openApplication)(state,
    { ...options, port: 3211, projectionV2: WEB_PROJECTION,
      webSeed: { adapter: createWebSeedAdapter(), invocationKey: WEB_SEED_INVOCATION } });
  let web;
  try {
    web = await (dependencies.startWebProcess ?? startWebProcess)({ signal: options.signal });
  } catch (error) {
    await application.close();
    throw error;
  }
  let closing;
  return Object.freeze({ ...application, webUrl: web.url, close() {
    closing ??= (async () => {
      try { await web.close(); } finally { await application.close(); }
    })();
    return closing;
  } });
}
