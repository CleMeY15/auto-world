import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readVisibleLeboncoinDom } from "./capture-dom.mjs";
import { canonicalDiscoveryUrl, canonicalListingUrl, readBatchPage } from "./batch-dom.mjs";
import { CAMOFOX_REVISION, stopOwnedProcesses } from "./probe-camofox.mjs";

const USER_ID = "autofindex-bounded-batch";
const ROOT = "http://127.0.0.1:9377";
const MAX_BYTES = 128 * 1024;
const httpStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

export function makeBatchApi(key, globalSignal) {
  return async (method, path, body, timeoutMs, pageSignal) => {
    const signals = [globalSignal, globalThis.AbortSignal.timeout(timeoutMs)];
    if (pageSignal) signals.push(pageSignal);
    const response = await globalThis.fetch(`${ROOT}${path}`, { method, redirect: "error",
      signal: globalThis.AbortSignal.any(signals), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(body === null ? {} : { body: JSON.stringify(body) }) });
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.byteLength;
        if (length > MAX_BYTES) throw new Error("response_limit");
        chunks.push(item.value);
      }
      return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } finally { await reader.cancel().catch(() => undefined); }
  };
}

/** A normal tab open, one passive load pause and one DOM read; never a reload. */
export async function observeBatchPage(api, targetUrl, { wait = delay, now = Date.now } = {}) {
  if (canonicalListingUrl(targetUrl) !== targetUrl && canonicalDiscoveryUrl(targetUrl) !== targetUrl) throw new Error("invalid_target");
  const startedAt = new Date(now()).toISOString();
  const pageSignal = globalThis.AbortSignal.timeout(90_000);
  const record = { api_status: null, navigation: null, dom: null, creation_calls: 1, tab_closed: false };
  let path = null;
  try {
    const opened = await api("POST", "/tabs", { userId: USER_ID, sessionKey: "batch100", url: targetUrl }, 55_000, pageSignal);
    record.api_status = httpStatus(opened.status);
    if (opened.status !== 200 || !/^[A-Za-z0-9_-]{1,128}$/u.test(opened.data?.tabId ?? "")) throw new Error("creation_failed");
    path = `/tabs/${opened.data.tabId}`;
    record.navigation = { httpStatus: httpStatus(opened.data.httpStatus), url: opened.data.url,
      navigationOk: opened.data.navigationOk === true };
    if (record.navigation.httpStatus === 200) await wait(1000, undefined, { signal: pageSignal });
    const expression = `(() => { const result = (${readBatchPage.toString()})(); result.listing = (${readVisibleLeboncoinDom.toString()})(); return result; })()`;
    const evaluated = await api("POST", `${path}/evaluate`, { userId: USER_ID, expression, timeoutMs: 5000 }, 8000, pageSignal);
    if (evaluated.status !== 200 || evaluated.data?.ok !== true || !evaluated.data.result) throw new Error("dom_failed");
    record.dom = evaluated.data.result;
  } catch (error) {
    record.error = ["creation_failed", "dom_failed"].includes(error?.message) ? error.message : "operation_failed";
  } finally {
    if (path) {
      try {
        const closed = await api("DELETE", `${path}?userId=${USER_ID}`, null, 7000);
        record.tab_closed = closed.status === 200 && closed.data?.ok === true;
      } catch { record.tab_closed = false; }
    }
  }
  return { started_at: startedAt, completed_at: new Date(now()).toISOString(), record };
}

/** One isolated upstream session for the batch, using its ordinary configuration. */
export async function startBatchRuntime({ runtime, out }) {
  if (process.platform !== "linux" || typeof runtime !== "string" || typeof out !== "string") throw new Error("invalid_arguments");
  runtime = resolve(runtime); out = resolve(out);
  await mkdir(out, { mode: 0o700, recursive: true });
  const packageJson = JSON.parse(await readFile(join(runtime, "package.json"), "utf8"));
  const browser = JSON.parse(await readFile(join(homedir(), ".cache/camoufox/version.json"), "utf8"));
  if (packageJson.name !== "@askjo/camofox-browser" || packageJson.version !== "1.19.0"
    || browser.version !== "152.0.4" || browser.release !== "beta.30") throw new Error("runtime_mismatch");
  const key = randomBytes(32).toString("hex");
  const controller = new globalThis.AbortController();
  let exited = false; let log = ""; let stopped = false;
  const child = spawn(process.execPath, ["server.js"], { cwd: runtime, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, LANG: process.env.LANG || "C.UTF-8", NODE_ENV: "production",
      RUNNER_TRACKING_ID: process.env.RUNNER_TRACKING_ID || "", CAMOFOX_BIND_HOST: "127.0.0.1", CAMOFOX_PORT: "9377",
      CAMOFOX_ACCESS_KEY: key, CAMOFOX_CRASH_REPORT_ENABLED: "false", CAMOFOX_COOKIES_DIR: join(out, "cookies"),
      CAMOFOX_PROFILE_DIR: join(out, "profiles"), CAMOFOX_UPLOADS_DIR: join(out, "uploads"), CAMOFOX_TRACES_DIR: join(out, "traces") } });
  child.on("error", () => controller.abort());
  const closed = new Promise((done) => child.once("close", () => { exited = true; done(); }));
  const append = (chunk) => { if (log.length < 8000) log += chunk.toString("utf8").slice(0, 8000 - log.length); };
  child.stdout.on("data", append); child.stderr.on("data", append);
  const timer = setTimeout(() => controller.abort(), 45 * 60_000);
  const api = makeBatchApi(key, controller.signal);
  const stop = async () => {
    if (stopped) throw new Error("runtime_already_stopped");
    stopped = true; controller.abort();
    const cleanup = await stopOwnedProcesses(child.pid);
    await Promise.race([closed, delay(2000)]);
    globalThis.clearTimeout(timer);
    return { ...cleanup, process_exited: exited };
  };
  try {
    const until = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < until && !controller.signal.aborted && !exited) {
      try {
        const health = await api("GET", "/health", null, 2000);
        if (health.status === 200 && health.data?.ok === true && health.data.engine === "camoufox") { ready = true; break; }
      } catch { /* Only loopback startup readiness is polled. */ }
      await delay(250);
    }
    if (!ready) throw new Error("runtime_unavailable");
  } catch (error) { await stop(); throw error; }
  return { api, stop, privateLog: () => log, signal: controller.signal,
    metadata: { camofox_revision: CAMOFOX_REVISION, camofox_version: packageJson.version,
      browser_manifest: "152.0.4-beta.30", node: process.version } };
}
