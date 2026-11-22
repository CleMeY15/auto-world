import { extractLeboncoinDomObservation } from "./extract.mjs";
import { URLSearchParams } from "node:url";

const ORIGIN = "https://www.leboncoin.fr";
const LISTING_PATH = /^\/ad\/voitures\/([1-9][0-9]{0,19})$/u;
const REFUSAL = /you (?:have been|are) blocked|access denied|access is temporarily restricted|request blocked|acc[èe]s (?:refus[ée]|interdit)|vous (?:avez [ée]t[ée]|[êe]tes) bloqu[ée]|403 forbidden/iu;
const HUMAN = /verify (?:that )?you are human|v[ée]rifiez que vous [êe]tes (?:un )?humain|i(?: am|['’]m) not a robot|je ne suis pas un robot|confirm you are human|confirmez que vous [êe]tes (?:un )?humain|slide right|press and hold|faites glisser (?:le curseur|pour)|maintenez (?:le bouton|appuy[ée])/iu;
const VERIFICATION = /captcha|verification|v[ée]rification|checking your browser|please enable (?:js|javascript) and disable/iu;
const isIso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

function sourceUrl(value) {
  if (typeof value !== "string" || value.length > 4096 || value !== value.trim()
    || !value.startsWith(`${ORIGIN}/`)) return null;
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && url.hostname === "www.leboncoin.fr" && !url.username && !url.password
      && !url.port ? url : null;
  } catch { return null; }
}

/** Tracking query/fragment removal does not permit another host or category. */
export function canonicalListingUrl(value) {
  const url = sourceUrl(value);
  return url && LISTING_PATH.test(url.pathname) ? `${ORIGIN}${url.pathname}` : null;
}

/** Only observed category links and bounded ordinary pagination are admissible. */
export function canonicalDiscoveryUrl(value) {
  const url = sourceUrl(value);
  if (!url || !["/c/voitures", "/c/voitures/", "/recherche"].includes(url.pathname)) return null;
  const search = url.pathname === "/recherche";
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(search ? ["category", "page"] : ["page"]);
  if (keys.some((key) => !allowed.has(key)) || keys.length !== new Set(keys).size
    || (search && url.searchParams.get("category") !== "2")) return null;
  const page = url.searchParams.get("page");
  if (page !== null && (!/^[1-9][0-9]{0,2}$/u.test(page) || Number(page) > 100)) return null;
  const query = new URLSearchParams(search ? { category: "2" } : {});
  if (page !== null) query.set("page", page);
  const suffix = query.size ? `?${query.toString()}` : "";
  return `${ORIGIN}${search ? "/recherche" : "/c/voitures"}${suffix}`;
}

/**
 * Read-only, self-contained browser projection, serializable with toString().
 * No imported helper, cookies, embedded application state or iframe-body reads.
 */
export function readBatchPage() {
  const doc = globalThis.document;
  const viewport = { width: globalThis.innerWidth, height: globalThis.innerHeight };
  const visible = (element) => element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) === true;
  const rounded = (number) => Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
  const rectangle = (element) => {
    const value = element.getBoundingClientRect();
    return { x: rounded(value.x), y: rounded(value.y), width: rounded(value.width), height: rounded(value.height) };
  };
  const intersection = (rect) => {
    const left = Math.max(0, rect.x); const top = Math.max(0, rect.y);
    const right = Math.min(viewport.width, rect.x + rect.width);
    const bottom = Math.min(viewport.height, rect.y + rect.height);
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const points = (rect) => {
    const clipped = intersection(rect);
    if (clipped.width < 1 || clipped.height < 1) return [];
    return [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]
      .map(([x, y]) => ({ x: rounded(clipped.x + clipped.width * x), y: rounded(clipped.y + clipped.height * y) }));
  };
  const allFrames = Array.from(doc.querySelectorAll("iframe"));
  const frameElements = allFrames.slice(0, 16);
  const frames = frameElements.map((frame, index) => {
    const rect = rectangle(frame); const clipped = intersection(rect);
    const css = globalThis.getComputedStyle(frame);
    const area = viewport.width * viewport.height;
    return { index, title: (frame.title || "").slice(0, 128), src: (frame.src || "").slice(0, 512),
      visible: visible(frame), rect, in_viewport: clipped.width > 0 && clipped.height > 0,
      viewport_area_ratio: area > 0 ? Math.round(clipped.width * clipped.height / area * 1_000_000) / 1_000_000 : 0,
      style: { display: css.display.slice(0, 32), visibility: css.visibility.slice(0, 32), opacity: css.opacity.slice(0, 32),
        pointer_events: css.pointerEvents.slice(0, 32), position: css.position.slice(0, 32), z_index: css.zIndex.slice(0, 32) },
      aria_hidden: frame.getAttribute("aria-hidden")?.slice(0, 16) ?? null,
      hit_test_points: points(rect).map((point) => ({ ...point, top_is_frame: doc.elementFromPoint(point.x, point.y) === frame })) };
  });
  const targetProjection = (selector) => Array.from(doc.querySelectorAll(selector)).filter(visible).slice(0, 8).map((element) => {
    const rect = rectangle(element);
    const hits = points(rect).map((point) => {
      const top = doc.elementFromPoint(point.x, point.y);
      return { ...point, target_on_top: top === element || element.contains(top),
        blocking_frame_index: frameElements.indexOf(top) >= 0 ? frameElements.indexOf(top) : null };
    });
    return { visible: true, rect, in_viewport: hits.length > 0,
      occluded: hits.length > 0 && hits.every((hit) => !hit.target_on_top),
      blocking_frame_indexes: [...new Set(hits.flatMap((hit) => hit.blocking_frame_index === null ? [] : [hit.blocking_frame_index]))],
      hit_test_points: hits };
  });
  const targets = {
    title: targetProjection('main h1[data-qa-id="adview_title"]'),
    price: targetProjection('section[data-qa-id="adview_spotlight_description_container"] [data-qa-id="adview_price"]'),
  };
  const links = []; let linkBytes = 0; let linksTruncated = false; let candidateLinks = 0;
  const encoder = new globalThis.TextEncoder();
  for (const anchor of doc.querySelectorAll("main a[href]")) {
    if (!visible(anchor)) continue;
    const href = anchor.href || "";
    // This is a coarse capture filter only. Node performs strict URL validation.
    if (!/^https:\/\/www\.leboncoin\.fr\/(?:ad\/voitures\/|c\/voitures(?:[/?#]|$)|recherche(?:[?#]|$))/u.test(href)) continue;
    candidateLinks += 1;
    if (href.length > 256 || links.length >= 200) { linksTruncated = true; continue; }
    const item = { href, text: (anchor.innerText || "").slice(0, 80), rel: (anchor.rel || "").slice(0, 32) };
    const bytes = encoder.encode(JSON.stringify(item)).byteLength + 1;
    if (linkBytes + bytes > 48 * 1024) { linksTruncated = true; continue; }
    links.push(item); linkBytes += bytes;
  }
  const statusTexts = [];
  for (const element of doc.querySelectorAll('h1, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
    if (!visible(element) || element.matches('[data-qa-id="adview_title"]')
      || element.closest('[data-qa-id="adview_description_container"], [data-qa-id="adview_description"]')) continue;
    if (statusTexts.length >= 8) break;
    statusTexts.push({ kind: element.tagName === "H1" ? "heading" : "dialog", text: (element.innerText || "").slice(0, 512) });
  }
  const text = doc.body?.innerText || "";
  const result = { url: globalThis.location.href.slice(0, 4096), url_truncated: globalThis.location.href.length > 4096,
    title: (doc.title || "").slice(0, 256), text: text.slice(0, 8000),
    text_truncated: text.length > 8000, viewport, frames, frame_count: allFrames.length, frames_truncated: allFrames.length > 16,
    targets, links, links_truncated: linksTruncated, candidate_links_count: candidateLinks,
    page_status: { texts: statusTexts,
      notice_only: targets.title.length === 0 && candidateLinks === 0 && text.length <= 2000 },
    frame_body_coverage: "not_established", projection_limit_exceeded: false };
  // Leave room within the REST/encryption caps for listing fields and identity.
  const projectionBytes = () => encoder.encode(JSON.stringify(result)).byteLength;
  while (projectionBytes() > 64 * 1024 && result.links.length > 0) {
    result.links.pop(); result.links_truncated = true;
  }
  while (projectionBytes() > 64 * 1024 && result.text.length > 0) {
    result.text = result.text.slice(0, Math.floor(result.text.length / 2)); result.text_truncated = true;
  }
  if (projectionBytes() > 64 * 1024) return { ...result, text: "", frames: [], frames_truncated: true,
    targets: { title: [], price: [] }, links: [], links_truncated: true,
    page_status: { texts: [], notice_only: false }, projection_limit_exceeded: true };
  return result;
}

function controlState(record) {
  const dom = record?.dom;
  const frames = Array.isArray(dom?.frames) ? dom.frames : [];
  const signals = frames.filter((frame) => VERIFICATION.test(`${frame?.title ?? ""} ${frame?.src ?? ""}`));
  const visibleSignals = signals.filter((frame) => frame?.visible === true && frame.in_viewport === true
    && Number.isFinite(frame.viewport_area_ratio) && frame.viewport_area_ratio > 0);
  const targets = [...(Array.isArray(dom?.targets?.title) ? dom.targets.title : []),
    ...(Array.isArray(dom?.targets?.price) ? dom.targets.price : [])];
  const obstructing = visibleSignals.some((frame) =>
    (frame.viewport_area_ratio >= 0.5 && Array.isArray(frame.hit_test_points)
      && frame.hit_test_points.some((point) => point?.top_is_frame === true))
    || targets.some((target) => target?.visible === true && target.in_viewport === true && target.occluded === true
      && Array.isArray(target.blocking_frame_indexes) && target.blocking_frame_indexes.includes(frame.index)));
  // Seller title/description are not control instructions. Status regions are
  // read separately; body text is eligible only on a small notice-only page.
  const texts = Array.isArray(dom?.page_status?.texts) ? dom.page_status.texts.slice(0, 8)
    .filter((entry) => ["heading", "dialog"].includes(entry?.kind) && typeof entry.text === "string")
    .map((entry) => entry.text.slice(0, 512)) : [];
  if (dom?.page_status?.notice_only === true) texts.push(dom.title ?? "", dom.text ?? "");
  const statusText = texts.join("\n");
  const frameTitles = visibleSignals.map((frame) => frame.title).join("\n");
  const human = HUMAN.test(statusText) || HUMAN.test(frameTitles);
  const refused = [403, 429].includes(record?.navigation?.httpStatus) || REFUSAL.test(statusText) || REFUSAL.test(frameTitles);
  return { signal_present: signals.length > 0 || VERIFICATION.test(statusText) || human,
    obstructing, human, refused };
}

/** A batch verdict does not alter the older fixed pilot's historical verdicts. */
export function assessBatchRecord(record, targetUrl, kind, capturedAt) {
  const control = controlState(record);
  const result = { outcome: "environment_error", stop: true, normalized: null, observation: null, observation_json: null,
    listing_urls: [], discovery_urls: [], control,
    counts: { links_observed: Array.isArray(record?.dom?.links) ? record.dom.links.length : 0,
      listing_urls: 0, discovery_urls: 0, criteria: 0, photo_references: 0,
      links_truncated: record?.dom?.links_truncated === true, frames_truncated: record?.dom?.frames_truncated === true } };
  const finish = (outcome, stop) => ({ ...result, outcome, stop });
  const canonical = kind === "listing" ? canonicalListingUrl : kind === "discovery" ? canonicalDiscoveryUrl : null;
  const target = canonical?.(targetUrl);
  if (!target || target !== targetUrl || !isIso(capturedAt)) return finish("identity_mismatch", true);
  if (control.refused) return finish("source_refused", true);
  if (control.human) return finish("human_verification", true);
  if (control.obstructing) return finish("verification_obstructing", true);
  if (record?.error || record?.api_status !== 200 || !record?.navigation || !record?.dom) return result;
  if (canonical(record.navigation.url) !== target || canonical(record.dom.url) !== target) return finish("identity_mismatch", true);
  if ([404, 410].includes(record.navigation.httpStatus)) return finish("listing_unavailable", false);
  if (record.navigation.httpStatus !== 200) return finish("navigation_incomplete", true);
  if (!Array.isArray(record.dom.links) || record.dom.links.length > 200
    || !Array.isArray(record.dom.frames) || record.dom.frames.length > 16
    || record.dom.frames_truncated === true || record.dom.projection_limit_exceeded === true
    || record.dom.url_truncated === true) return finish("observation_incomplete", true);
  const listingUrls = new Set(); const discoveryUrls = new Set();
  for (const entry of record.dom.links) {
    if (typeof entry?.href !== "string" || entry.href.length > 256) continue;
    const listing = canonicalListingUrl(entry.href); const discovery = canonicalDiscoveryUrl(entry.href);
    if (listing) listingUrls.add(listing);
    if (discovery && discovery !== target) discoveryUrls.add(discovery);
  }
  result.listing_urls = [...listingUrls]; result.discovery_urls = [...discoveryUrls];
  result.counts.listing_urls = result.listing_urls.length; result.counts.discovery_urls = result.discovery_urls.length;
  if (kind === "discovery") return finish("discovery_observed", false);
  const observation = { ...record.dom.listing, acquisition: "own_playwright_dom", captured_at: capturedAt,
    requested_url: target, url: canonicalListingUrl(record.dom.url) };
  const observationJson = JSON.stringify(observation);
  const normalized = extractLeboncoinDomObservation(Buffer.from(observationJson), {
    expectedUrl: target, expectedListingId: LISTING_PATH.exec(new URL(target).pathname)[1],
  });
  result.observation = observation; result.observation_json = observationJson; result.normalized = normalized;
  result.counts.criteria = normalized.criteria?.length ?? 0;
  result.counts.photo_references = normalized.photos?.status === "observed" ? normalized.photos.values.length : 0;
  const complete = normalized.status === "listing" && normalized.core_fields_observed === true
    && normalized.fields.model_year.status === "observed" && normalized.issues.length === 0;
  return finish(complete ? "listing_observed" : "listing_partial", false);
}
