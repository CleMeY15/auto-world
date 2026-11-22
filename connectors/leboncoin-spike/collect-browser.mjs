import { mkdir, chmod, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readVisibleLeboncoinDom } from "./capture-dom.mjs";
import { extractLeboncoinDomObservation } from "./extract.mjs";
import { ACCESS_TARGET_URL, diagnosticIdentity, installAccessObserver, loadDiagnosticPublicKey,
  sealAccessCapture, summarizeAccessCapture } from "./access-diagnostic.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const PLAYWRIGHT_VERSION = "1.64.0";
const LIMIT_MS = 30_000;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const TITLE = 'main h1[data-qa-id="adview_title"]';
const usage = "Usage: node connectors/leboncoin-spike/collect-browser.mjs --url https://www.leboncoin.fr/ad/voitures/<digits> --out <private-directory> [--diagnostic-access]";

function options(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (key === "--diagnostic-access" && values[key] === undefined) { values[key] = true; index -= 1; continue; }
    if (!["--url", "--out"].includes(key) || values[key] !== undefined || !args[index + 1]) throw new Error("invalid_arguments");
    values[key] = args[index + 1];
  }
  if (!/^https:\/\/www\.leboncoin\.fr\/ad\/voitures\/[1-9][0-9]{0,19}$/u.test(values["--url"] ?? "") || !values["--out"]) {
    throw new Error("invalid_arguments");
  }
  return { url: values["--url"], out: resolve(values["--out"]), diagnostic: values["--diagnostic-access"] === true };
}

export function diagnosticCode(error) {
  const message = String(error?.message);
  if (/socket\(\)\s*failed:\s*Operation not permitted/iu.test(message)) return "local_socket_permission_denied";
  if (/No usable sandbox|sandbox.*(?:not available|unavailable|not supported)|Failed to move to new namespace/iu.test(message)) return "sandbox_unavailable";
  if (message === "playwright_version_mismatch") return "playwright_version_mismatch";
  return /(?:net::ERR_[A-Z_]+|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET)/u.exec(message)?.[0]
    ?? (error?.name === "TimeoutError" ? "operation_timeout" : "operation_failed");
}

function diagnosticUrl(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`.slice(0, 512); }
  catch { return "unavailable"; }
}

async function challengeVisible(page) {
  return page.evaluate(() => {
    const text = (globalThis.document.body?.innerText ?? "").slice(0, 12_000);
    return /verify (?:that )?you are human|v[ée]rifiez que vous [êe]tes (?:un )?humain|access denied|acc[èe]s refus[ée]|unusual traffic|trafic inhabituel|please enable (?:javascript|js) and disable|votre acc[èe]s a [ée]t[ée] bloqu[ée]|checking your browser/iu.test(text)
      || (!globalThis.document.querySelector('main h1[data-qa-id="adview_title"]') && /captcha|v[ée]rification de s[ée]curit[ée]/iu.test(text));
  }).catch(() => false);
}

export async function collect({ url, out, diagnostic = false }) {
  // Key and execution identity are checked before loading or starting Chromium.
  if (diagnostic && url !== ACCESS_TARGET_URL) throw new Error("diagnostic_identity_invalid");
  const diagnosticKey = diagnostic ? await loadDiagnosticPublicKey() : null;
  const diagnosticId = diagnostic ? diagnosticIdentity(process.env) : null;
  await mkdir(out, { mode: 0o700 });
  await chmod(out, 0o700);
  const report = {
    schema_version: "leboncoin-own-browser-attempt/v1",
    acquisition: "own_playwright_dom",
    requested_url: url,
    url: null,
    captured_at: new Date().toISOString(),
    status: "navigation_error",
    navigation_status: null,
    extraction_status: "not_attempted",
    core_fields_observed: false,
    transport: {
      engine: "playwright_chromium", navigation_attempts: 0, retries: 0,
      redirect_policy: "ordinary_browser_follow_then_reject_capture",
      redirect_chain: [], redirect_count: 0,
      image_requests_blocked: 0,
    },
    runtime: {
      node: process.version, context: "fresh_nonpersistent", headless: true,
      playwright_version: null, chromium_version: null, chromium_sandbox: true,
      shared_profile: false,
    },
  };
  let browser;
  let page;
  let stage = "launch";
  let snapshot;
  let normalized;
  let observer;
  let privateDiagnostic;
  let sealedDiagnostic;
  let diagnosticSummary;
  let diagnosticCapture;
  let mainNavigationAdmitted = false;
  let navigationMismatch = false;
  let expired = false;
  const expiresAt = Date.now() + LIMIT_MS;
  const remaining = (maximum) => Math.max(1, Math.min(maximum, expiresAt - Date.now()));
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("deadline_exceeded"));
      if (browser) void browser.close().catch(() => undefined);
    }, LIMIT_MS);
  });

  async function run() {
    const version = require("@playwright/test/package.json").version;
    if (version !== PLAYWRIGHT_VERSION) throw new Error("playwright_version_mismatch");
    const { chromium } = require("@playwright/test");
    report.runtime.playwright_version = version;
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      timeout: remaining(10_000),
    });
    report.runtime.chromium_version = browser.version();
    stage = "context";
    const context = await browser.newContext({ acceptDownloads: false });
    page = await context.newPage();
    if (diagnostic) {
      report.transport.navigation_requests_allowed = 0;
      report.transport.additional_navigations_blocked = 0;
      observer = await installAccessObserver(context, page);
    }
    await context.route("**/*", async (route) => {
      const request = route.request();
      const mainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (diagnostic && mainNavigation && mainNavigationAdmitted) {
        report.transport.additional_navigations_blocked += 1;
        await route.abort("blockedbyclient");
        return;
      }
      if (["image", "media"].includes(request.resourceType())) {
        report.transport.image_requests_blocked += 1;
        await route.abort("blockedbyclient");
      } else if (request.isNavigationRequest() && request.url() !== url) {
        if (request.frame() === page.mainFrame()) navigationMismatch = true;
        await route.abort("blockedbyclient");
      } else {
        if (diagnostic && mainNavigation) {
          mainNavigationAdmitted = true;
          report.transport.navigation_requests_allowed += 1;
        }
        await route.continue();
      }
    });
    page.on("response", (response) => {
      if (response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) {
        if (!diagnostic || report.navigation_status === null) report.navigation_status = response.status();
      }
    });
    stage = "navigation";
    report.transport.navigation_attempts = 1;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: remaining(20_000) });
    report.url = diagnosticUrl(page.url());
    if (!diagnostic || report.navigation_status === null) report.navigation_status = response?.status() ?? report.navigation_status;
    const chain = [];
    for (let request = response?.request(); request; request = request.redirectedFrom()) {
      chain.push(diagnosticUrl(request.url()));
      if (chain.length > 20) break;
    }
    report.transport.redirect_count = Math.max(0, chain.length - 1);
    report.transport.redirect_chain = chain.reverse();
    if ([403, 429].includes(report.navigation_status)) {
      report.status = "access_blocked";
      return;
    }
    if (navigationMismatch || page.url() !== url || report.transport.redirect_count > 0) {
      report.status = "identity_mismatch";
      return;
    }
    if (report.navigation_status !== 200) {
      report.status = "unsupported_markup";
      report.reason = "non_200_navigation";
      return;
    }
    // The optional response diagnostic inspects this document only. It does not
    // expand criteria or claim that a 200 response is an extracted listing.
    if (diagnostic) { report.status = "diagnostic_only"; return; }
    stage = "headline";
    try { await page.locator(TITLE).first().waitFor({ state: "visible", timeout: remaining(10_000) }); }
    catch {
      if (expired) return;
      report.status = await challengeVisible(page) ? "access_blocked" : "unsupported_markup";
      report.reason = "expected_headline_not_visible";
      return;
    }
    // A 200 page may finish ordinary JavaScript rendering during the bounded
    // headline wait. No reload or challenge interaction is attempted.
    if (await challengeVisible(page)) { report.status = "access_blocked"; return; }
    const expand = page.locator('[data-qa-id="criteria_more"]')
      .filter({ hasText: /Voir les \d+ critères supplémentaires/u }).first();
    report.criteria_expansion = "not_present";
    if (await expand.isVisible()) {
      try {
        await expand.click({ timeout: remaining(1500) });
        report.criteria_expansion = "expanded_once";
      } catch { report.criteria_expansion = "not_expanded"; }
    }
    if (await challengeVisible(page)) { report.status = "access_blocked"; return; }
    if (navigationMismatch || page.url() !== url) { report.status = "identity_mismatch"; return; }
    stage = "capture";
    const projection = await page.evaluate(readVisibleLeboncoinDom);
    const candidate = {
      ...projection,
      acquisition: "own_playwright_dom", requested_url: url, url: page.url(),
      captured_at: new Date().toISOString(),
      transport: { engine: "playwright_chromium", navigation_status: report.navigation_status },
      runtime: report.runtime,
    };
    const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
      report.status = "unsupported_markup";
      report.reason = "snapshot_byte_limit";
      return;
    }
    if (expired) return;
    snapshot = bytes;
    stage = "extraction";
    normalized = extractLeboncoinDomObservation(bytes, {
      expectedUrl: url, expectedListingId: url.slice(url.lastIndexOf("/") + 1),
    });
    report.captured_at = candidate.captured_at;
    report.extraction_status = normalized.status;
    report.core_fields_observed = normalized.status === "listing" && normalized.core_fields_observed === true;
    report.issue_count = normalized.issues?.length ?? 0;
    report.status = report.core_fields_observed && report.issue_count === 0 ? "extracted" : "partial_capture";
    report.counts = {
      titles: projection.titles?.length ?? 0, prices: projection.prices?.length ?? 0,
      criteria: projection.criteria?.length ?? 0, photo_urls: projection.photos?.length ?? 0,
    };
  }

  try { await Promise.race([run(), deadline]); }
  catch (error) {
    snapshot = undefined;
    normalized = undefined;
    report.url = page ? diagnosticUrl(page.url()) : null;
    report.status = [403, 429].includes(report.navigation_status) ? "access_blocked"
      : navigationMismatch || (page && page.url() !== "about:blank" && page.url() !== url) ? "identity_mismatch"
        : expired ? "deadline_exceeded"
          : ["launch", "context"].includes(stage) ? "environment_error" : "navigation_error";
    report.reason = expired ? "global_30s_deadline" : `${stage}:${diagnosticCode(error)}`;
  }
  if (diagnostic && !expired) {
    try {
      diagnosticCapture = observer ? await Promise.race([observer.capture(remaining(1500)), deadline]) : {
        identity_status: "missing", counts: { document_requests_observed: 0, main_document_requests_observed: 0,
          iframe_document_requests_observed: 0, redirects_observed: 0 }, document: null,
        body: { status: "no_response", representation: null, bytes: null, sha256: null, base64: null },
      };
    } catch {
      report.diagnostic_status = expired ? "diagnostic_timeout" : "diagnostic_failed";
      privateDiagnostic = undefined; sealedDiagnostic = undefined; diagnosticSummary = undefined;
    }
  }
  try {
    if (diagnostic && expired) report.diagnostic_status = "diagnostic_timeout";
  } finally {
    globalThis.clearTimeout(timer);
    if (browser) await browser.close().catch(() => undefined);
  }
  if (diagnosticCapture !== undefined && !expired) {
    try {
      const capture = observer ? observer.finalize(diagnosticCapture) : diagnosticCapture;
      const record = { schema_version: "leboncoin-access-capture/v1", identity: diagnosticId,
        captured_at: new Date().toISOString(), ...capture };
      diagnosticSummary = { ...summarizeAccessCapture(record), goto_calls: report.transport.navigation_attempts,
        navigation_requests_allowed: report.transport.navigation_requests_allowed ?? 0,
        additional_navigations_blocked: report.transport.additional_navigations_blocked ?? 0 };
      record.public_summary = diagnosticSummary;
      sealedDiagnostic = sealAccessCapture(record, diagnosticKey);
      privateDiagnostic = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
      report.diagnostic_status = "sealed";
    } catch {
      report.diagnostic_status = "diagnostic_failed";
      privateDiagnostic = undefined; sealedDiagnostic = undefined; diagnosticSummary = undefined;
    }
  }
  if (sealedDiagnostic !== undefined) {
    await writeFile(join(out, "access-response.private.json"), privateDiagnostic, { mode: 0o600, flag: "wx" });
    await writeFile(join(out, "sealed-response.json"), sealedDiagnostic, { mode: 0o600, flag: "wx" });
    await writeFile(join(out, "access-summary.json"), `${JSON.stringify(diagnosticSummary)}\n`, { mode: 0o600, flag: "wx" });
  }
  if (snapshot !== undefined) {
    await writeFile(join(out, "snapshot.json"), snapshot, { mode: 0o600, flag: "wx" });
  }
  if (normalized !== undefined) {
    await writeFile(join(out, "result.json"), `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  await writeFile(join(out, "attempt.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify({ status: report.status, navigation_status: report.navigation_status,
    extraction_status: report.extraction_status, core_fields_observed: report.core_fields_observed,
    counts: report.counts ?? {}, output: out })}\n`);
  if (report.status !== "extracted") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await collect(options(process.argv.slice(2))); }
  catch (error) {
    process.stderr.write(`${error?.message === "invalid_arguments" ? usage : "Collector failed before saving its private report."}\n`);
    process.exitCode = 1;
  }
}
