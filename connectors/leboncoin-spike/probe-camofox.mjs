import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ACCESS_TARGET_URL, diagnosticIdentity, encodeSealedFragments, inspectSealedEnvelope, loadDiagnosticPublicKey, sealAccessCapture } from "./access-diagnostic.mjs";
import { readVisibleLeboncoinDom } from "./capture-dom.mjs";

export const CAMOFOX_REVISION = "31376c27db94204ffdc635ae71a7f61328e91a5e";
const USER_ID = "autofindex-camofox-probe";
const API_ROOT = "http://127.0.0.1:9377";
const MAX_API_BYTES = 128 * 1024;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const status = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

export function classifyCamofox(record) {
  const navigation = record?.navigation;
  const dom = record?.dom;
  const text = [dom?.title, dom?.text, record?.snapshot?.snapshot,
    ...(dom?.frames ?? []).filter((frame) => frame.visible).map((frame) => frame.title)].join("\n");
  if ([403, 429].includes(navigation?.httpStatus)
    || /you (?:have been|are) blocked|access denied|access is temporarily restricted|acc[èe]s refus[ée]|request blocked/iu.test(text)) return "source_refused";
  if (/verify (?:that )?you are human|verification required|v[ée]rifiez que vous [êe]tes (?:un )?humain|slide right|press and hold|checking your browser|please enable (?:js|javascript) and disable/iu.test(text)
    || (dom?.frames ?? []).some((frame) => frame.visible && /captcha-delivery\.com|recaptcha|hcaptcha/iu.test(`${frame.src} ${frame.title}`))) return "verification_present";
  if (record?.api_status === 200 && navigation?.httpStatus === 200 && navigation.url === ACCESS_TARGET_URL
    && dom?.url === ACCESS_TARGET_URL && record?.snapshot?.truncated === false
    && dom?.listing?.titles?.length === 1 && typeof dom.listing.titles[0] === "string" && dom.listing.titles[0].trim().length > 0
    && dom?.listing?.prices?.length === 1 && typeof dom.listing.prices[0] === "string"
    && /^(\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[,.]\d{1,2})?[ \u00a0\u202f]*€$/u.test(dom.listing.prices[0].trim())) return "listing_page_observed";
  return !navigation && record?.error ? "environment_error" : "partial_or_unknown";
}

function readPage() {
  const visible = (element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  return { url: globalThis.location.href, title: globalThis.document.title.slice(0, 256),
    text: (globalThis.document.body?.innerText ?? "").slice(0, 8000),
    user_agent: globalThis.navigator.userAgent.slice(0, 512),
    frames: Array.from(globalThis.document.querySelectorAll("iframe")).slice(0, 16)
      .map((frame) => ({ title: frame.title.slice(0, 256), src: frame.src.slice(0, 1024), visible: visible(frame) })) };
}

/** One creation only; later API operations read the already-open page. */
export async function probeOnce(api) {
  const record = { stage: "create", api_status: null, navigation: null, dom: null, snapshot: null, creation_calls: 1 };
  try {
    const opened = await api("POST", "/tabs", { userId: USER_ID, sessionKey: "single", url: ACCESS_TARGET_URL }, 40_000);
    record.api_status = status(opened.status);
    record.create_response = opened.data;
    if (opened.status !== 200 || !opened.data || typeof opened.data.tabId !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/u.test(opened.data.tabId)) throw new Error("creation_failed");
    record.navigation = { httpStatus: status(opened.data.httpStatus), url: opened.data.url,
      navigationOk: opened.data.navigationOk === true };
    const path = `/tabs/${opened.data.tabId}`;
    record.stage = "snapshot";
    try {
      const snapshot = await api("GET", `${path}/snapshot?userId=${USER_ID}`, null, 10_000);
      if (snapshot.status === 200 && typeof snapshot.data?.snapshot === "string") {
        record.snapshot = { snapshot: snapshot.data.snapshot.slice(0, 8000),
          truncated: snapshot.data.truncated !== false || snapshot.data.snapshot.length > 8000,
          url: snapshot.data.url };
      } else record.snapshot_error = "snapshot_failed";
    } catch { record.snapshot_error = "snapshot_failed"; }
    record.stage = "dom";
    const expression = `(() => { const result = (${readPage.toString()})(); result.listing = (${readVisibleLeboncoinDom.toString()})(); return result; })()`;
    const evaluated = await api("POST", `${path}/evaluate`, { userId: USER_ID, expression, timeoutMs: 5000 }, 7000);
    if (evaluated.status !== 200 || !evaluated.data?.ok || !evaluated.data.result) throw new Error("dom_failed");
    record.dom = evaluated.data.result;
    record.stage = "observed";
  } catch (error) {
    record.error = ["creation_failed", "dom_failed"].includes(error?.message) ? error.message : "operation_failed";
  }
  return record;
}

function makeApi(key, globalSignal) {
  return async (method, path, body, timeoutMs) => {
    const signal = globalThis.AbortSignal.any([globalSignal, globalThis.AbortSignal.timeout(timeoutMs)]);
    const response = await globalThis.fetch(`${API_ROOT}${path}`, { method, redirect: "error", signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(body === null ? {} : { body: JSON.stringify(body) }) });
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_API_BYTES) throw new Error("api_response_limit");
        chunks.push(value);
      }
      return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } finally { await reader.cancel().catch(() => undefined); }
  };
}

async function processIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, parent: Number(fields[1]), born: fields[19], state: fields[0] };
  } catch { return null; }
}

/** Stop only the owned server tree, including descendants in detached groups. */
export async function stopOwnedProcesses(rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1) return { established: false, tracked: 0, remaining: null };
  const root = await processIdentity(rootPid);
  if (!root || root.state === "Z") return { established: false, tracked: 0, remaining: null };
  const owned = new Map([[rootPid, root]]);
  const signal = async (identity, name) => {
    const current = await processIdentity(identity.pid);
    if (current?.born !== identity.born || current.state === "Z") return;
    try { process.kill(identity.pid, name); } catch { /* Identity disappeared between verification and signal. */ }
  };
  let settled = false;
  try {
    // Freeze parents before discovery so closing the server cannot orphan a
    // detached Firefox, and no frozen process can create another descendant.
    await signal(root, "SIGSTOP");
    for (let pass = 0; pass < 8; pass += 1) {
      const pids = (await readdir("/proc")).filter((name) => /^[1-9][0-9]*$/u.test(name)).map(Number);
      const processes = (await Promise.all(pids.map(processIdentity))).filter(Boolean);
      let added = 0;
      for (const item of processes) {
        const parent = owned.get(item.parent);
        if (!parent || owned.has(item.pid) || item.state === "Z") continue;
        const liveParent = processes.find((entry) => entry.pid === parent.pid);
        if (liveParent?.born !== parent.born) continue;
        owned.set(item.pid, item); added += 1;
        await signal(item, "SIGSTOP");
      }
      if (added === 0) { settled = true; break; }
    }
  } finally {
    for (const item of [...owned.values()].reverse()) await signal(item, "SIGKILL");
  }
  let remaining = owned.size;
  for (let pass = 0; pass < 20 && remaining > 0; pass += 1) {
    await delay(50);
    const states = await Promise.all([...owned.values()].map(async (item) => {
      const current = await processIdentity(item.pid);
      return current?.born === item.born && current.state !== "Z";
    }));
    remaining = states.filter(Boolean).length;
  }
  return { established: settled && remaining === 0, tracked: owned.size, remaining };
}

async function main(args) {
  if (args.length !== 4 || args[0] !== "--runtime" || args[2] !== "--out" || process.platform !== "linux") throw new Error("invalid_arguments");
  const runtime = resolve(args[1]); const out = resolve(args[3]);
  const key = await loadDiagnosticPublicKey();
  const identity = { ...diagnosticIdentity(process.env), schema_version: "leboncoin-camofox-capture/v1" };
  await mkdir(out, { mode: 0o700 });
  const packageJson = JSON.parse(await readFile(join(runtime, "package.json"), "utf8"));
  if (packageJson.name !== "@askjo/camofox-browser" || packageJson.version !== "1.19.0") throw new Error("runtime_mismatch");
  const browserManifest = JSON.parse(await readFile(join(homedir(), ".cache/camoufox/version.json"), "utf8"));
  if (browserManifest.version !== "152.0.4" || browserManifest.release !== "beta.30") throw new Error("browser_manifest_mismatch");
  const accessKey = randomBytes(32).toString("hex");
  const started = new Date().toISOString();
  const controller = new globalThis.AbortController();
  let log = ""; let processStarted = false; let processExited = false; let exitCode = null;
  const child = spawn(process.execPath, ["server.js"], { cwd: runtime, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, LANG: process.env.LANG || "C.UTF-8", NODE_ENV: "production",
      RUNNER_TRACKING_ID: process.env.RUNNER_TRACKING_ID || "",
      CAMOFOX_BIND_HOST: "127.0.0.1", CAMOFOX_PORT: "9377", CAMOFOX_ACCESS_KEY: accessKey,
      CAMOFOX_CRASH_REPORT_ENABLED: "false", CAMOFOX_COOKIES_DIR: join(out, "cookies"),
      CAMOFOX_PROFILE_DIR: join(out, "profiles"), CAMOFOX_UPLOADS_DIR: join(out, "uploads"), CAMOFOX_TRACES_DIR: join(out, "traces") } });
  child.on("spawn", () => { processStarted = true; });
  child.on("error", () => { controller.abort(); });
  const exited = new Promise((done) => child.once("close", (code) => { processExited = true; exitCode = code; done(); }));
  const append = (chunk) => { if (log.length < 8000) log += chunk.toString("utf8").slice(0, 8000 - log.length); };
  child.stdout.on("data", append); child.stderr.on("data", append);
  const timer = setTimeout(() => { controller.abort(); }, 90_000);
  const api = makeApi(accessKey, controller.signal);
  let record = { stage: "server_start", error: "server_unavailable", creation_calls: 0 };
  let cleanup;
  try {
    const until = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < until && !controller.signal.aborted && !processExited) {
      try {
        const health = await api("GET", "/health", null, 2000);
        if (health.status === 200 && health.data?.ok && health.data.engine === "camoufox") { ready = true; break; }
      } catch { /* Only local startup readiness is polled; no source request. */ }
      await delay(250);
    }
    if (ready) record = await probeOnce(api);
  } finally {
    controller.abort();
    cleanup = await stopOwnedProcesses(child.pid);
    await Promise.race([exited, delay(2000)]);
    globalThis.clearTimeout(timer);
  }
  const completed = new Date().toISOString();
  const outcome = classifyCamofox(record);
  const capture = { identity, started_at: started, completed_at: completed, camofox_revision: CAMOFOX_REVISION,
    camofox_version: packageJson.version, browser_manifest: browserManifest, node: process.version,
    evidence_kind: "camofox_rest_status_and_rendered_dom", http_response_body: "not_exposed_by_rest_api",
    frame_body_coverage: "not_established", record, server_log: log, process_started: processStarted,
    process_exited: processExited, process_exit_code: exitCode, cleanup };
  const sealed = sealAccessCapture(capture, key);
  const inspected = inspectSealedEnvelope(sealed, identity);
  const receipt = { schema_version: "leboncoin-camofox-summary/v1", identity, started_at: started, completed_at: completed,
    camofox_revision: CAMOFOX_REVISION, camofox_version: "1.19.0", browser_manifest: "152.0.4-beta.30", node: process.version,
    engine: "camofox_firefox", outcome, listing_page_observed: outcome === "listing_page_observed",
    recurring_collection_proven: false, creation_calls: record.creation_calls, api_status: status(record.api_status),
    navigation_status: status(record.navigation?.httpStatus), navigation_status_scope: "initial_goto_reported_by_camofox",
    final_url_matches: record.dom?.url === ACCESS_TARGET_URL,
    title_observed: !!record.dom?.listing?.titles?.some((item) => typeof item === "string" && item.trim()),
    price_observed: !!record.dom?.listing?.prices?.some((item) => typeof item === "string" && item.trim()),
    process_started: processStarted, process_exited: processExited, cleanup, http_response_body: "not_captured",
    frame_body_coverage: "not_established", sealed_sha256: inspected.sha256, sealed_bytes: inspected.bytes,
    dom_sha256: record.dom ? hash(JSON.stringify(record.dom)) : null };
  await writeFile(join(out, "sealed-camofox.json"), sealed, { mode: 0o600, flag: "wx" });
  await writeFile(join(out, "public-camofox.json"), `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`AUTO_FINDEX_CAMOFOX ${JSON.stringify(receipt)}\n`);
  for (const line of encodeSealedFragments(sealed)) process.stdout.write(`${line}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const code = ["invalid_arguments", "runtime_mismatch", "browser_manifest_mismatch", "public_key_invalid", "diagnostic_identity_invalid", "diagnostic_seal_failed"].includes(error?.message)
      ? error.message : "setup_or_evidence_failed";
    process.stderr.write(`Camofox experiment stopped: ${code}.\n`); process.exitCode = 2;
  });
}
