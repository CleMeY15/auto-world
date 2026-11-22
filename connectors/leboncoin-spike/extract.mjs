import { createHash } from "node:crypto";

export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const SCHEMA = "leboncoin-dom-observation/v1";
const ACQUISITIONS = new Set(["chatgpt_cloud_browser_dom", "own_playwright_dom"]);
const SELECTORS = Object.freeze({
  title: 'main h1[data-qa-id="adview_title"]',
  price: 'section[data-qa-id="adview_spotlight_description_container"] [data-qa-id="adview_price"]',
  criterion: 'main [data-qa-id^="criteria_item_"]',
  photo: "main img",
  location: 'section[data-qa-id="adview_spotlight_description_container"] a[href$="#map"]',
});
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 2048) => typeof value === "string" && value.length <= max;
const texts = (value, maxItems = 16) => Array.isArray(value) && value.length <= maxItems && value.every((entry) => text(entry));
const absent = () => ({ status: "not_observed" });
const listingId = (url) => typeof url === "string" ? /^https:\/\/www\.leboncoin\.fr\/ad\/voitures\/([1-9][0-9]{0,19})$/u.exec(url)?.[1] : undefined;
const safeInteger = (digits) => {
  const value = BigInt(digits);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

function priceValue(value) {
  // Observed French grouping spaces are allowed; a monthly payment is not a sale price.
  const match = /^(\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[,.](\d{1,2}))?[ \u00a0\u202f]*€$/u.exec(value.trim());
  if (!match) return null;
  const whole = match[1].replace(/[ \u00a0\u202f]/gu, "");
  const amountMinor = safeInteger(`${whole}${(match[2] ?? "").padEnd(2, "0")}`);
  return amountMinor === null ? null : { amountMinor, currency: "EUR" };
}

function mileageValue(value) {
  const match = /^(\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)[ \u00a0\u202f]+km$/u.exec(value.trim());
  if (!match) return null;
  const amount = safeInteger(match[1].replace(/[ \u00a0\u202f]/gu, ""));
  return amount === null ? null : { amount, unit: "km" };
}

function yearValue(value) {
  return /^\d{4}$/u.test(value) && Number(value) >= 1886 ? Number(value) : null;
}

function issuanceValue(value) {
  const match = /^(0[1-9]|1[0-2])\/(\d{4})$/u.exec(value);
  return match && yearValue(match[2]) !== null ? { month: Number(match[1]), year: Number(match[2]), precision: "month" } : null;
}

function field(entries, convert, proof) {
  if (entries.length === 0) return absent();
  const values = entries.map((entry) => convert(entry.raw));
  const evidence = entries.map((entry) => proof(entry.pointer, entry.selector, entry.raw));
  if (values.some((value) => value === null)) return { status: "invalid", evidence };
  if (new Set(values.map((value) => JSON.stringify(value))).size !== 1) return { status: "ambiguous", evidence };
  return { status: "observed", value: values[0], evidence };
}

function criterion(snapshot, key, label, convert, proof) {
  const entries = snapshot.criteria.flatMap((entry, index) => entry.key === key ? [{
    raw: entry.value, label: entry.label, pointer: `/criteria/${index}/value`, selector: SELECTORS.criterion,
  }] : []);
  if (entries.some((entry) => entry.label !== label)) {
    return { status: "invalid", reason: "criterion_label_mismatch", evidence: entries.map((entry) => proof(entry.pointer, entry.selector, entry.raw)) };
  }
  return field(entries, convert, proof);
}

function photoReferences(snapshot, title, proof) {
  if (snapshot.photos.length === 0) return { ...absent(), coverage: "observed_references_only", downloaded: false };
  const positions = new Map();
  for (let index = 0; index < snapshot.photos.length; index += 1) {
    const item = snapshot.photos[index];
    const prefix = `${title} (image `;
    const suffix = item.alt.startsWith(prefix) ? /^([1-9][0-9]{0,2})\)$/u.exec(item.alt.slice(prefix.length)) : null;
    let url;
    try { url = new URL(item.url); } catch { return { status: "invalid", reason: "photo_url", coverage: "observed_references_only", downloaded: false }; }
    if (!suffix || url.protocol !== "https:" || url.hostname !== "img.leboncoin.fr" || url.username || url.password || url.port || url.hash) {
      return { status: "invalid", reason: "photo_scope", coverage: "observed_references_only", downloaded: false };
    }
    const position = Number(suffix[1]);
    const evidence = proof(`/photos/${index}/url`, SELECTORS.photo, item.url);
    const existing = positions.get(position);
    if (existing && existing.url !== item.url) return { status: "ambiguous", reason: "photo_position", coverage: "observed_references_only", downloaded: false };
    if (existing) existing.evidence.push(evidence);
    else positions.set(position, { position, url: item.url, alt: item.alt, evidence: [evidence] });
  }
  return { status: "observed", values: [...positions.values()].sort((left, right) => left.position - right.position),
    coverage: "observed_references_only", downloaded: false };
}

/** Pure offline replay of observed DOM JSON, not an HTTP fetch or SDK source grant. */
export function extractLeboncoinDomObservation(bytes, { expectedUrl, expectedListingId } = {}) {
  const base = { schema_version: "leboncoin-replay/v1", parser_version: "visible-dom/v1" };
  const reject = (status, reason) => ({ ...base, status, reason });
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_SNAPSHOT_BYTES) return reject("invalid_snapshot", "byte_limit");
  const hash = createHash("sha256").update(bytes).digest("hex");
  base.observation_sha256 = hash;
  base.observation_bytes = bytes.byteLength;
  let snapshot;
  try { snapshot = JSON.parse(new globalThis.TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return reject("invalid_snapshot", "encoding_or_json"); }
  if (!plain(snapshot) || snapshot.schema_version !== SCHEMA || !ACQUISITIONS.has(snapshot.acquisition)
    || !text(snapshot.captured_at, 32) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(snapshot.captured_at)
    || !Number.isFinite(Date.parse(snapshot.captured_at)) || new Date(snapshot.captured_at).toISOString() !== snapshot.captured_at
    || !texts(snapshot.titles) || !texts(snapshot.prices) || !texts(snapshot.location)
    || !Array.isArray(snapshot.times) || snapshot.times.length > 16
    || snapshot.times.some((entry) => !plain(entry) || !text(entry.text) || !(entry.datetime === null || text(entry.datetime, 128)))
    || !Array.isArray(snapshot.criteria) || snapshot.criteria.length > 100
    || snapshot.criteria.some((entry) => !plain(entry) || !text(entry.key, 100) || !text(entry.label, 200) || !text(entry.value, 2048))
    || !Array.isArray(snapshot.photos) || snapshot.photos.length > 100
    || snapshot.photos.some((entry) => !plain(entry) || !text(entry.alt) || !text(entry.url, 4096))) {
    return reject("invalid_snapshot", "schema");
  }
  if (!expectedListingId || listingId(expectedUrl) !== expectedListingId
    || snapshot.requested_url !== expectedUrl || snapshot.url !== expectedUrl
    || listingId(snapshot.url) !== expectedListingId) return reject("identity_mismatch", "expected_url_and_id");
  const proof = (pointer, selector, raw) => ({ observation_sha256: hash, json_pointer: pointer, selector, raw });
  const title = field(snapshot.titles.map((raw, index) => ({ raw, pointer: `/titles/${index}`, selector: SELECTORS.title })),
    (value) => value.trim() || null, proof);
  if (title.status !== "observed") return reject("not_listing", title.status === "ambiguous" ? "ambiguous_title" : "missing_title");
  const fields = {
    title,
    price: field(snapshot.prices.map((raw, index) => ({ raw, pointer: `/prices/${index}`, selector: SELECTORS.price })), priceValue, proof),
    mileage: criterion(snapshot, "mileage", "Kilométrage", mileageValue, proof),
    brand: criterion(snapshot, "u_car_brand", "Marque", (value) => value.trim() || null, proof),
    model: criterion(snapshot, "u_car_model", "Modèle", (value) => value.trim() || null, proof),
    model_year: criterion(snapshot, "regdate", "Année modèle", yearValue, proof),
    issuance_date: criterion(snapshot, "issuance_date", "Date de première mise en circulation", issuanceValue, proof),
    // No VIN-bearing criterion occurs in the authentic corpus. A future explicit
    // VIN label is interpreted only as supplied text, never inferred or OCR'd.
    vin: field(snapshot.criteria.flatMap((entry, index) => entry.label === "VIN" ? [{
      raw: entry.value, pointer: `/criteria/${index}/value`, selector: SELECTORS.criterion,
    }] : []), (value) => /^[A-HJ-NPR-Z0-9]{17}$/u.test(value) ? value : null, proof),
  };
  fields.vin.scope = "supplied_dom_criteria_only_no_ocr";
  const photos = photoReferences(snapshot, title.value, proof);
  return { ...base, status: "listing",
    // Completeness of this DOM sample, not accuracy or autonomous transport success.
    core_fields_observed: ["title", "price", "mileage", "brand", "model"].every((name) => fields[name].status === "observed"),
    source: { name: "leboncoin", listing_id: expectedListingId, original_url: snapshot.url },
    provenance: { acquisition: snapshot.acquisition, captured_at: snapshot.captured_at,
      evidence_kind: "provided_dom_observation_json", hash_identifies: "exact_observation_file_not_http_body" },
    fields,
    criteria: snapshot.criteria.map((entry, index) => ({ key: entry.key, label: entry.label, value: entry.value,
      evidence: proof(`/criteria/${index}/value`, SELECTORS.criterion, entry.value) })),
    photos,
    location: snapshot.location.map((value, index) => ({ value, evidence: proof(`/location/${index}`, SELECTORS.location, value) })),
    source_times: snapshot.times.map((entry, index) => ({ text: entry.text, datetime: entry.datetime,
      evidence: [proof(`/times/${index}/text`, "main time", entry.text),
        ...(entry.datetime === null ? [] : [proof(`/times/${index}/datetime`, "main time[datetime]", entry.datetime)])] })),
    issues: [...Object.entries(fields).filter(([, value]) => ["invalid", "ambiguous"].includes(value.status))
      .map(([name, value]) => ({ field: name, status: value.status })),
    ...(["invalid", "ambiguous"].includes(photos.status) ? [{ field: "photos", status: photos.status }] : [])],
  };
}
