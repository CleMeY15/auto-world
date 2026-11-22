import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ACCESS_TARGET_URL, diagnosticIdentity, loadDiagnosticPublicKey, sealAccessCapture, selectDiagnosticHeaders } from "./access-diagnostic.mjs";
import { safeRuntimeMetadata } from "./autonomous-probe.mjs";
import { readVisibleLeboncoinDom } from "./capture-dom.mjs";
import { extractLeboncoinDomObservation } from "./extract.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
export const FLOW_BUDGET_MS = 30_000;
export const MAX_FLOW_BYTES = 128 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_NORMALIZED_BYTES = 32 * 1024;
const VERIFICATION_HOSTS = new Set(["ct.captcha-delivery.com", "geo.captcha-delivery.com"]);
const OUTCOMES = ["extracted", "interaction_required", "explicit_refusal", "rate_limited", "unexpected_navigation", "unexpected_popup",
  "identity_mismatch", "verification_timeout", "unexpected_response", "evidence_limit", "environment_error", "navigation_error"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = (value) => Buffer.from(JSON.stringify(value), "utf8");
const identifier = (value) => typeof value === "string" && value.trim() === value && /^[A-Za-z0-9._-]{1,128}$/u.test(value);
const statusCode = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const iso = (value) => typeof value === "string" && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = (value, max = 10_000) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= max ? value : null;
const verificationUrl = (value) => { try { return VERIFICATION_HOSTS.has(new URL(value).hostname); } catch { return false; } };

export const nativeFlowIdentity = (env, id) => ({ ...diagnosticIdentity(env, id), schema_version: "leboncoin-native-flow-capture/v1" });

/** Two document identities, never a mutation of the previous diagnostic tracker. */
export function trackNativeFlow({ frameId, now = Date.now, started = now() }) {
  const documents = [];
  const counts = { main_documents_observed: 0, iframe_documents_observed: 0, redirects_observed: 0,
    navigations_allowed: 0, navigations_blocked: 0, popups_observed: 0 };
  let outcome = null;
  let resolveStop;
  let verificationFrameSeen = false;
  const whenStopped = new Promise((resolve) => { resolveStop = resolve; });
  const stop = (value) => { if (!outcome) { outcome = value; resolveStop(); } };
  const remaining = () => Math.max(0, FLOW_BUDGET_MS - (now() - started));
  const increment = (key) => { counts[key] = Math.min(10_000, counts[key] + 1); if (counts[key] === 10_000) stop("evidence_limit"); };
  const state = {
    whenStopped, stop, remaining,
    outcome: () => outcome,
    documents: () => documents.map((item) => ({ ...item })),
    counts: () => ({ ...counts }),
    verificationSeen: () => verificationFrameSeen,
    current: () => documents.at(-1),
    initialToken: () => documents[0] ? JSON.stringify([documents[0].frame_id, documents[0].request_id, documents[0].loader_id, documents[0].url]) : null,
    initialAttributable: (token) => token !== null && token === state.initialToken() && documents[0]?.finished === true
      && documents[0].failed === false && documents[0].status !== null && counts.redirects_observed === 0
      && !["identity_mismatch", "unexpected_navigation"].includes(outcome),
    token: () => documents.at(-1) ? `${documents.length}:${documents.at(-1).request_id}:${documents.at(-1).loader_id}` : null,
    unchanged: (token) => !outcome && token !== null && token === state.token(),
    permitNavigation(url) {
      if (remaining() === 0) { increment("navigations_blocked"); stop("verification_timeout"); return false; }
      const allowed = !outcome && remaining() > 0 && url === ACCESS_TARGET_URL
        && (counts.navigations_allowed === 0 || (counts.navigations_allowed === 1 && documents[0]?.status === 403));
      increment(allowed ? "navigations_allowed" : "navigations_blocked");
      if (!allowed) stop("unexpected_navigation");
      return allowed;
    },
    popup() { increment("popups_observed"); stop("unexpected_popup"); },
    request(event) {
      if (event?.type !== "Document") return;
      if (event.frameId !== frameId) {
        increment("iframe_documents_observed");
        verificationFrameSeen ||= verificationUrl(event.request?.url);
        if (documents.some((item) => item.request_id === event.requestId)) stop("identity_mismatch");
        return;
      }
      increment("main_documents_observed");
      if (event.redirectResponse) { increment("redirects_observed"); stop("unexpected_navigation"); }
      if (documents.length >= 2 || (documents.length === 1 && documents[0].status !== 403)
        || event.request?.url !== ACCESS_TARGET_URL || event.request?.method !== "GET") { stop("unexpected_navigation"); return; }
      if (!identifier(event.requestId) || !identifier(event.loaderId) || !identifier(event.frameId)
        || documents.some((item) => item.request_id === event.requestId || item.loader_id === event.loaderId)) { stop("identity_mismatch"); return; }
      documents.push({ role: documents.length === 0 ? "initial" : "automatic_return", frame_id: frameId,
        request_id: event.requestId, loader_id: event.loaderId, url: event.request.url,
        requested_at: new Date(now()).toISOString(), responded_at: null, finished_at: null, status: null,
        headers: null, finished: false, failed: false });
    },
    response(event) {
      if (event?.response?.status === 429 && (event.frameId === frameId || verificationUrl(event.response.url))) stop("rate_limited");
      const document = documents.find((item) => item.request_id === event?.requestId);
      if (!document) return;
      if (event.type !== "Document" || event.frameId !== frameId || event.loaderId !== document.loader_id
        || event.response?.url !== ACCESS_TARGET_URL || document.status !== null || statusCode(event.response.status) === null) { stop("identity_mismatch"); return; }
      document.status = event.response.status;
      document.responded_at = new Date(now()).toISOString();
      document.headers = selectDiagnosticHeaders(event.response.headers);
      if (![200, 403, 429].includes(document.status)) stop("unexpected_response");
    },
    finished(event) {
      const document = documents.find((item) => item.request_id === event?.requestId);
      if (document) { document.finished = true; document.finished_at = new Date(now()).toISOString(); }
    },
    failed(event) {
      const document = documents.find((item) => item.request_id === event?.requestId);
      if (document) { document.failed = true; if (!outcome) stop("navigation_error"); }
    },
  };
  return state;
}

/** This function reads rendered content only; no challenge state, cookies or actions. */
export function readNativeFrameDom() {
  const visible = (element) => element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const clip = (text, limit) => {
    const encoded = new globalThis.TextEncoder().encode(String(text ?? "").slice(0, limit));
    return encoded.length <= limit ? String(text ?? "").slice(0, limit)
      : new globalThis.TextDecoder().decode(encoded.subarray(0, limit - 3));
  };
  const text = clip(globalThis.document.body?.innerText, 3072);
  const controls = Array.from(globalThis.document.querySelectorAll('button,[role="button"],input[type="checkbox"],[role="checkbox"],[role="slider"],input[type="range"],canvas')).filter(visible);
  return { title: clip(globalThis.document.title, 128), text,
    visible_control: controls.length > 0,
    visible_checkbox: controls.some((item) => item.matches('input[type="checkbox"],[role="checkbox"]')),
    visible_slider: controls.some((item) => item.matches('[role="slider"],input[type="range"]')),
    visible_canvas: controls.some((item) => item.matches("canvas")),
    listing_title_visible: visible(globalThis.document.querySelector('main h1[data-qa-id="adview_title"]')) === true };
}

/** A hostname or script word alone never establishes an interaction requirement. */
export function visibleFlowStop(frames) {
  for (const frame of frames) {
    if (frame?.state !== "observed" || !["main", "verification"].includes(frame.role)) continue;
    const text = `${frame.title ?? ""}\n${frame.text ?? ""}`;
    if (/you (?:have been|are) blocked|access denied|acc[èe]s refus[ée]|votre acc[èe]s a [ée]t[ée] bloqu[ée]|request blocked/iu.test(text)) return "explicit_refusal";
    const human = /human|humain|robot|captcha|v[ée]rifi|verify|security check/iu.test(text);
    const action = /drag|slide|move the slider|faites glisser|glissez|d[ée]placez|s[ée]lectionnez|select (?:the|all)|r[ée]solvez|complete the puzzle|click (?:to|on)|cliquez (?:sur|pour)|appuyez|press (?:to|and hold)|hold (?:down|the button)|maintenez.{0,40}appuy[ée]/iu.test(text);
    const checkbox = /(?:i am|i'm|je ne suis) (?:not |pas )?(?:a |un )?robot/iu.test(text) && frame.visible_checkbox === true;
    const puzzle = frame.role === "verification" && frame.visible_slider === true && frame.visible_canvas === true;
    const challengeAction = frame.role === "verification" && /(?:drag|slide|glissez|faites glisser).{0,80}(?:slider|puzzle|curseur|compl[ée]ter|complete)/iu.test(text);
    const directPrompt = frame.visible_control === true && /(?:^|[.!?\n]\s*)(?:please )?(?:verify|confirm|prove) (?:that )?you are (?:a )?human/iu.test(text);
    if ((human && action) || checkbox || puzzle || challengeAction || directPrompt) return "interaction_required";
  }
  return null;
}

function bounded(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("bounded_timeout")), Math.max(1, milliseconds)); })])
    .finally(() => globalThis.clearTimeout(timer));
}

async function sampleFrames(page, remaining) {
  const all = page.frames();
  const visible = [];
  let inaccessible = 0;
  for (const frame of all.slice(0, 20)) {
    try {
      if (frame === page.mainFrame() || await bounded(frame.frameElement().then((element) => element.evaluate((node) =>
        node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))), Math.min(250, remaining()))) visible.push(frame);
    } catch { inaccessible += 1; }
  }
  visible.sort((left, right) => (left === page.mainFrame() ? -2 : verificationUrl(left.url()) ? -1 : 0)
    - (right === page.mainFrame() ? -2 : verificationUrl(right.url()) ? -1 : 0));
  const frames = [];
  for (const frame of visible.slice(0, 4)) {
    const role = frame === page.mainFrame() ? "main" : verificationUrl(frame.url()) ? "verification" : "other";
    const base = { role, url: frame.url().slice(0, 512), state: "unavailable" };
    try {
      const observed = await bounded(frame.evaluate(readNativeFrameDom), Math.min(500, remaining()));
      const entry = { ...base, state: "observed", ...observed };
      while (bytes(entry).length > 4096 && entry.text.length > 0) entry.text = entry.text.slice(0, Math.floor(entry.text.length / 2));
      if (bytes(entry).length > 4096) throw new Error("frame_limit");
      frames.push(entry);
    } catch { frames.push(base); inaccessible += 1; }
  }
  const omitted = Math.max(0, visible.length - 4) + Math.max(0, all.length - 20);
  return { kind: "rendered_dom_sample", sampled_at: new Date().toISOString(), frames,
    visible_frames_observed: visible.length, omitted_frames: omitted, inaccessible_frames: inaccessible,
    coverage_complete: omitted === 0 && inaccessible === 0 && frames.some((frame) => frame.role === "main" && frame.state === "observed") };
}

export async function readInitialBody(session, tracker, remaining) {
  const token = tracker.initialToken();
  if (!tracker.initialAttributable(token)) return { status: "identity_rejected" };
  const document = tracker.documents()[0];
  try {
    const body = await bounded(session.send("Network.getResponseBody", { requestId: document.request_id }), Math.min(1000, remaining()));
    if (!tracker.initialAttributable(token)) return { status: "identity_rejected" };
    if (typeof body?.body !== "string" || typeof body.base64Encoded !== "boolean" || body.body.length > 12 * 1024) return { status: "limit_exceeded" };
    const content = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8");
    if (content.length > 8 * 1024) return { status: "limit_exceeded" };
    if (body.base64Encoded && content.toString("base64") !== body.body) return { status: "unavailable" };
    return { status: "captured", kind: "cdp_initial_response_body", document_token: token, representation: body.base64Encoded ? "cdp_base64" : "cdp_text_utf8",
      bytes: content.length, sha256: sha(content), base64: content.toString("base64") };
  } catch { return { status: "unavailable" }; }
}

export function projectNativeFlow(record, { env, runtime }) {
  const metadata = safeRuntimeMetadata(env, runtime);
  let valid = false;
  let success = false;
  let snapshotHash = null;
  const documents = Array.isArray(record?.documents) ? record.documents : [];
  try {
    valid = record?.schema_version === "leboncoin-native-flow-capture/v1"
      && JSON.stringify(record.identity) === JSON.stringify(nativeFlowIdentity(env, record.identity?.capture_id))
      && iso(record.started_at) && iso(record.completed_at) && Date.parse(record.completed_at) >= Date.parse(record.started_at)
      && Date.parse(record.completed_at) - Date.parse(record.started_at) <= 45_000
      && OUTCOMES.includes(record.outcome) && documents.length <= 2 && bytes(record).length <= MAX_FLOW_BYTES
      && documents.every((document, index) => identifier(document.request_id) && identifier(document.loader_id)
        && identifier(document.frame_id) && document.role === (index === 0 ? "initial" : "automatic_return")
        && document.url === ACCESS_TARGET_URL && iso(document.requested_at)
        && (document.status === null || statusCode(document.status) !== null))
      && (record.runtime?.playwright_version === "1.64.0" || (record.outcome === "environment_error" && record.goto_calls === 0 && record.runtime?.playwright_version === null))
      && record.runtime.headless === true
      && record.runtime.chromium_sandbox === true && record.runtime.context === "fresh_nonpersistent" && record.runtime.shared_profile === false
      && integer(record.goto_calls, 1) !== null;
    if (valid && typeof record.snapshot_json === "string" && Buffer.byteLength(record.snapshot_json) <= MAX_SNAPSHOT_BYTES) {
      const snapshotBytes = Buffer.from(record.snapshot_json, "utf8");
      snapshotHash = sha(snapshotBytes);
      const snapshot = JSON.parse(record.snapshot_json);
      const normalized = extractLeboncoinDomObservation(snapshotBytes, { expectedUrl: ACCESS_TARGET_URL, expectedListingId: "3305814470" });
      success = record.outcome === "extracted" && documents.length >= 1 && documents.at(-1).status === 200
        && record.goto_calls === 1 && record.counts?.main_documents_observed === documents.length && record.counts.redirects_observed === 0
        && record.counts.popups_observed === 0 && record.counts.navigations_blocked === 0 && record.counts.navigations_allowed === documents.length
        && (documents.length === 1 || (documents[0].status === 403 && documents[0].request_id !== documents[1].request_id
          && documents[0].loader_id !== documents[1].loader_id && documents[0].frame_id === documents[1].frame_id))
        && record.dom_sample?.coverage_complete === true && visibleFlowStop(record.dom_sample.frames ?? []) === null
        && record.dom_sample.frames.some((frame) => frame.role === "main" && frame.state === "observed" && frame.listing_title_visible === true)
        && record.capture_document_token === `${documents.length}:${documents.at(-1).request_id}:${documents.at(-1).loader_id}`
        && snapshot.acquisition === "own_playwright_dom" && snapshot.transport?.navigation_status === 200
        && iso(snapshot.captured_at) && Date.parse(snapshot.captured_at) >= Date.parse(record.started_at) && Date.parse(snapshot.captured_at) <= Date.parse(record.completed_at)
        && normalized.status === "listing" && normalized.core_fields_observed === true && normalized.issues.length === 0
        && bytes(normalized).length <= MAX_NORMALIZED_BYTES && JSON.stringify(normalized) === JSON.stringify(record.normalized);
    }
  } catch { valid = false; success = false; }
  const finalOutcome = !valid || (record?.outcome === "extracted" && !success) ? "invalid_evidence" : record.outcome;
  return { schema_version: "leboncoin-native-flow/v1", ...metadata, outcome: finalOutcome, collection_success: success && valid,
    capture_id: valid ? record.identity.capture_id : null,
    started_at: valid ? record.started_at : null, completed_at: valid ? record.completed_at : null,
    initial_status: valid ? statusCode(documents[0]?.status) : null, return_status: valid ? statusCode(documents[1]?.status) : null,
    initial_requested_at: valid ? documents[0]?.requested_at ?? null : null, return_requested_at: valid ? documents[1]?.requested_at ?? null : null,
    goto_calls: valid ? record.goto_calls : null,
    ...Object.fromEntries(["main_documents_observed", "iframe_documents_observed", "redirects_observed", "navigations_allowed", "navigations_blocked", "popups_observed"]
      .map((key) => [key, valid ? integer(record.counts?.[key]) : null])),
    verification_frame_observed: valid && record.verification_frame_observed === true,
    dom_coverage_complete: valid && record.dom_sample?.coverage_complete === true,
    omitted_frames: valid ? integer(record.dom_sample?.omitted_frames) : null,
    inaccessible_frames: valid ? integer(record.dom_sample?.inaccessible_frames) : null,
    extraction_status: valid && ["not_attempted", "not_listing", "partial_capture", "listing", "invalid_snapshot"].includes(record.extraction_status) ? record.extraction_status : null,
    snapshot_sha256: valid ? snapshotHash : null,
    snapshot_bytes: valid && snapshotHash ? Buffer.byteLength(record.snapshot_json) : null,
    initial_body_status: valid && ["captured", "unavailable", "limit_exceeded", "identity_rejected", "not_attempted", "omitted_budget"].includes(record.initial_body?.status) ? record.initial_body.status : null,
    chromium_version: typeof record?.runtime?.chromium_version === "string" && record.runtime.chromium_version.trim() === record.runtime.chromium_version
      && /^[0-9]{1,4}(?:\.[0-9]{1,8}){3}$/u.test(record.runtime.chromium_version) ? record.runtime.chromium_version : null };
}

export async function collectNativeFlow({ out, env = process.env }) {
  const key = await loadDiagnosticPublicKey();
  const identity = nativeFlowIdentity(env);
  await mkdir(out, { mode: 0o700 });
  const began = Date.now();
  const remaining = () => Math.max(0, FLOW_BUDGET_MS - (Date.now() - began));
  let browser; let page; let tracker; let closed = false; let timer; let bodyPromise;
  let snapshotJson = null; let normalized = null; let captureToken = null; let domSample = null;
  let extractionStatus = "not_attempted"; let fallbackOutcome = "environment_error"; let gotoCalls = 0;
  const runtime = { playwright_version: null, chromium_version: null, headless: true, chromium_sandbox: true, context: "fresh_nonpersistent", shared_profile: false };
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { fallbackOutcome = "verification_timeout"; tracker?.stop("verification_timeout"); resolve(); }, FLOW_BUDGET_MS); });
  async function run() {
    if (require("@playwright/test/package.json").version !== "1.64.0") throw new Error("runtime_mismatch");
    runtime.playwright_version = "1.64.0";
    browser = await require("@playwright/test").chromium.launch({ headless: true, chromiumSandbox: true, timeout: Math.max(1, Math.min(10_000, remaining())) });
    if (closed || remaining() === 0) { await browser.close().catch(() => undefined); return; }
    runtime.chromium_version = browser.version();
    const context = await browser.newContext({ acceptDownloads: false });
    page = await context.newPage();
    const session = await context.newCDPSession(page);
    const { frameTree } = await session.send("Page.getFrameTree");
    tracker = trackNativeFlow({ frameId: frameTree.frame.id, started: began });
    session.on("Network.requestWillBeSent", tracker.request);
    session.on("Network.responseReceived", tracker.response);
    session.on("Network.loadingFailed", tracker.failed);
    session.on("Network.loadingFinished", (event) => {
      tracker.finished(event);
      const initial = tracker.documents()[0];
      if (!bodyPromise && !closed && initial?.request_id === event.requestId && initial.finished) bodyPromise = readInitialBody(session, tracker, remaining);
    });
    await session.send("Network.enable", { maxResourceBufferSize: 64 * 1024, maxTotalBufferSize: 128 * 1024, maxPostDataSize: 0 });
    context.on("page", (popup) => { if (popup !== page) { tracker.popup(); void popup.close().catch(() => undefined); } });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (closed || tracker.outcome()) { await route.abort("blockedbyclient"); return; }
      if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
        if (request.frame().page() !== page) { tracker.popup(); await route.abort("blockedbyclient"); return; }
        if (!tracker.permitNavigation(request.url())) { await route.abort("blockedbyclient"); return; }
      }
      if (!/^https?:\/\//u.test(request.url())) { await route.abort("blockedbyclient"); return; }
      await route.continue();
    });
    fallbackOutcome = "navigation_error";
    if (closed || remaining() === 0) return;
    gotoCalls = 1;
    const navigation = page.goto(ACCESS_TARGET_URL, { waitUntil: "domcontentloaded", timeout: Math.max(1, remaining()) });
    await Promise.race([navigation, tracker.whenStopped]);
    if (tracker.outcome() || closed) return;
    fallbackOutcome = "verification_timeout";
    while (!closed && !tracker.outcome() && remaining() > 0) {
      const tokenBefore = tracker.token();
      domSample = await sampleFrames(page, remaining);
      if (closed || tracker.outcome()) return;
      const stop = visibleFlowStop(domSample.frames);
      if (stop) { tracker.stop(stop); return; }
      if (tracker.unchanged(tokenBefore) && tracker.current()?.status === 200 && page.url() === ACCESS_TARGET_URL
        && domSample.coverage_complete && domSample.frames.some((frame) => frame.role === "main" && frame.listing_title_visible)) {
        const projection = await bounded(page.evaluate(readVisibleLeboncoinDom), Math.min(1000, remaining()));
        if (closed || !tracker.unchanged(tokenBefore) || page.url() !== ACCESS_TARGET_URL) continue;
        const snapshot = { ...projection, acquisition: "own_playwright_dom", requested_url: ACCESS_TARGET_URL, url: page.url(),
          captured_at: new Date().toISOString(), transport: { engine: "playwright_chromium", navigation_status: 200 }, runtime };
        snapshotJson = `${JSON.stringify(snapshot)}\n`;
        if (Buffer.byteLength(snapshotJson) > MAX_SNAPSHOT_BYTES) { snapshotJson = null; tracker.stop("evidence_limit"); return; }
        normalized = extractLeboncoinDomObservation(Buffer.from(snapshotJson), { expectedUrl: ACCESS_TARGET_URL, expectedListingId: "3305814470" });
        if (bytes(normalized).length > MAX_NORMALIZED_BYTES) { normalized = null; tracker.stop("evidence_limit"); return; }
        extractionStatus = normalized.status === "listing" ? (normalized.core_fields_observed && normalized.issues.length === 0 ? "listing" : "partial_capture") : normalized.status;
        captureToken = tokenBefore;
        if (extractionStatus === "listing") { fallbackOutcome = "extracted"; return; }
      }
      await delay(Math.min(200, remaining()));
    }
  }
  try { await Promise.race([run(), deadline]); }
  catch { if (remaining() === 0) fallbackOutcome = "verification_timeout"; }
  finally {
    closed = true; globalThis.clearTimeout(timer);
    if (browser) await browser.close().catch(() => undefined);
  }
  const outcome = tracker?.outcome() ?? (fallbackOutcome === "extracted" && !tracker?.unchanged(captureToken) ? "identity_mismatch" : fallbackOutcome);
  let body = { status: "not_attempted" };
  if (bodyPromise) { try { body = await bounded(bodyPromise, 50); } catch { body = { status: "unavailable" }; } }
  if (body.status === "captured" && !tracker?.initialAttributable(body.document_token)) body = { status: "identity_rejected" };
  const record = { schema_version: "leboncoin-native-flow-capture/v1", identity, started_at: new Date(began).toISOString(), completed_at: new Date().toISOString(),
    outcome, runtime, goto_calls: gotoCalls, documents: tracker?.documents() ?? [], counts: tracker?.counts() ?? {},
    verification_frame_observed: tracker?.verificationSeen() ?? false, initial_body: body, dom_sample: domSample,
    snapshot_json: snapshotJson, normalized, capture_document_token: captureToken, extraction_status: extractionStatus };
  if (bytes(record).length > MAX_FLOW_BYTES) {
    record.outcome = "evidence_limit"; record.snapshot_json = null; record.normalized = null;
    record.initial_body = { status: "omitted_budget" }; record.extraction_status = "not_attempted";
  }
  const sealed = sealAccessCapture(record, key);
  await writeFile(join(out, "native-flow.private.json"), `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(join(out, "sealed-native-flow.json"), sealed, { flag: "wx", mode: 0o600 });
  return record;
}
