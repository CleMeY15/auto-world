import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalDiscoveryUrl, canonicalListingUrl } from "./batch-dom.mjs";
import { observeBatchPage } from "./batch-runtime.mjs";

const USER_ID = "autofindex-bounded-batch";
const SESSION_KEY = "batch100";
const MARKER = "__autofindex_batch_session_nonce__";
const tabId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const observationError = (message, sourceStarted = false) => Object.assign(new Error(message),
  { source_observation_started: sourceStarted });

/**
 * Keep one owned local page alive while ordinary listing tabs open and close.
 * The marker belongs only to about:blank; no source page, cookie or browser
 * preference is modified. A lost page is never recreated by this module.
 */
export async function createBatchSessionGuard(api, { wait = delay, now = Date.now } = {}) {
  if (typeof api !== "function" || typeof wait !== "function" || typeof now !== "function") {
    throw new Error("session_initialization_failed");
  }
  const nonce = randomBytes(32).toString("hex");
  let path = null; let active = null; let closing = null; let closeRequested = false;
  const state = { anchor_creation_calls: 0, anchor_initialized: false,
    continuity_checks: 0, continuity_failures: 0,
    source_observations_started: 0, source_observations_completed: 0,
    continuity_lost: false, halted: false, stop_reason: null, close_calls: 0, closed: false };
  const halt = (reason) => {
    state.halted = true;
    if (state.stop_reason === null || reason === "session_continuity_lost") state.stop_reason = reason;
    if (reason === "session_continuity_lost") state.continuity_lost = true;
  };
  const deleteAnchor = async () => {
    if (!path) return Object.freeze({ established: false, tab_closed: false });
    state.close_calls += 1;
    let confirmed = false;
    try {
      const response = await api("DELETE", `${path}?userId=${USER_ID}`, null, 7000);
      confirmed = response.status === 200 && response.data?.ok === true;
    } catch { /* The owner still stops its runtime if tab cleanup is unconfirmed. */ }
    state.closed = confirmed;
    if (!confirmed) halt("session_close_failed");
    return Object.freeze({ established: confirmed, tab_closed: confirmed });
  };
  const close = () => {
    if (closing) return closing;
    closeRequested = true;
    const inFlight = active;
    closing = (async () => {
      if (inFlight) await inFlight;
      return deleteAnchor();
    })();
    return closing;
  };
  const markerKey = JSON.stringify(MARKER);
  const initialExpression = `(() => {
    const blank = globalThis.location.href === "about:blank";
    if (!blank || Object.prototype.hasOwnProperty.call(globalThis, ${markerKey})) return { blank, nonce: null };
    Object.defineProperty(globalThis, ${markerKey}, { value: ${JSON.stringify(nonce)}, enumerable: false, writable: false, configurable: false });
    return { blank: globalThis.location.href === "about:blank", nonce: globalThis[${markerKey}] };
  })()`;
  const checkExpression = `(() => ({ blank: globalThis.location.href === "about:blank", nonce: globalThis[${markerKey}] }))()`;
  const verified = (response) => response?.status === 200 && response.data?.ok === true
    && response.data.result?.blank === true && response.data.result?.nonce === nonce;
  try {
    state.anchor_creation_calls += 1;
    // Omitting url is intentional: upstream creates about:blank without goto.
    const opened = await api("POST", "/tabs", { userId: USER_ID, sessionKey: SESSION_KEY }, 55_000);
    if (tabId(opened?.data?.tabId)) path = `/tabs/${opened.data.tabId}`;
    if (opened?.status !== 200 || !path || opened.data.url !== "about:blank") throw new Error("invalid_local_tab");
    const initialized = await api("POST", `${path}/evaluate`, { userId: USER_ID, expression: initialExpression, timeoutMs: 5000 }, 8000);
    if (!verified(initialized)) throw new Error("local_marker_failed");
    state.anchor_initialized = true;
  } catch {
    if (path) await close();
    throw new Error("session_initialization_failed");
  }

  const check = async () => {
    state.continuity_checks += 1;
    try {
      const response = await api("POST", `${path}/evaluate`, { userId: USER_ID, expression: checkExpression, timeoutMs: 5000 }, 8000);
      if (verified(response)) return true;
    } catch { /* A failed check is a permanent loss of continuity evidence. */ }
    state.continuity_failures += 1;
    halt("session_continuity_lost");
    return false;
  };
  const observe = async (targetUrl) => {
    if (closeRequested || state.halted) throw observationError("session_unavailable");
    if (active) throw observationError("session_busy");
    if (typeof targetUrl !== "string" || (canonicalListingUrl(targetUrl) !== targetUrl && canonicalDiscoveryUrl(targetUrl) !== targetUrl)) {
      halt("observation_failed"); throw observationError("invalid_target");
    }
    let release;
    active = new Promise((done) => { release = done; });
    let capture = null; let before = false; let sourceStarted = false;
    try {
      before = await check();
      if (!before) throw new Error("session_continuity_lost");
      state.source_observations_started += 1;
      sourceStarted = true;
      capture = await observeBatchPage(api, targetUrl, { wait, now });
      state.source_observations_completed += 1;
      const after = await check();
      capture.record.session_continuity = { before, after };
      // Cover the post-observation check, not only the source tab's closure.
      capture.completed_at = new Date(now()).toISOString();
      if (!after) capture.record.error = "session_continuity_lost";
      if ([403, 429].includes(capture.record.navigation?.httpStatus)) halt("source_refused");
      else if (capture.record.error || capture.record.tab_closed !== true) halt("observation_failed");
      return capture;
    } catch {
      halt("session_continuity_lost");
      if (capture) {
        capture.record.session_continuity = { before, after: false };
        capture.record.error = "session_continuity_lost";
        // An invalid injected clock remains a failed observation, never success.
        try { capture.completed_at = new Date(now()).toISOString(); } catch { /* Keep the existing failed capture. */ }
        return capture;
      }
      throw observationError("session_continuity_lost", sourceStarted);
    } finally {
      active = null; release();
    }
  };
  return Object.freeze({ observe, close, stats: () => Object.freeze({ ...state }) });
}
