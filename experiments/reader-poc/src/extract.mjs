import { createHash } from 'node:crypto';

/** Deterministic, untrusted-HTML -> normalized automobile fields. No model and no seller PII. */
const htmlEntities = {amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>', euro: '€', eacute: 'é', egrave: 'è', agrave: 'à', ugrave: 'ù'};
function decode(s) {
  return String(s ?? '').replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, key) => {
    const k = key.toLowerCase();
    if (k.startsWith('#x')) return safeCodepoint(parseInt(k.slice(2), 16), match);
    if (k.startsWith('#')) return safeCodepoint(parseInt(k.slice(1), 10), match);
    return htmlEntities[k] ?? match;
  });
}
function safeCodepoint(n, fallback) { return Number.isInteger(n) && n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback; }
function normalSpace(s) { return decode(s).replace(/<[^>]*>/g, ' ').replace(/[\s\u00a0\u202f]+/g, ' ').trim(); }
function optionalString(v) { return typeof v === 'string' || typeof v === 'number' ? normalSpace(String(v)) || null : null; }
function numeric(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/[\s\u00a0\u202f€]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const d = s.lastIndexOf('.'), c = s.lastIndexOf(',');
  if (d !== -1 && c !== -1) {
    const dec = Math.max(d, c);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else if (c !== -1) {
    const tail = s.length - c - 1;
    s = tail === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (d !== -1 && s.length - d - 1 === 3) s = s.replace(/\./g, '');
  const out = Number(s);
  return Number.isFinite(out) && out >= 0 ? out : null;
}
function year(v) {
  const s = optionalString(v) ?? '';
  const m = s.match(/\b(19\d\d|20\d\d)\b/);
  const n = m ? Number(m[1]) : null;
  return n && n <= new Date().getUTCFullYear() + 2 ? n : null;
}
function parseLd(html) {
  const values = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    if (!/\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)(?:\s|$)/i.test(attrs)) continue;
    try {
      const parsed = JSON.parse(match[2].trim());
      const queue = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of queue) {
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry['@graph'])) queue.push(...entry['@graph']);
        else values.push(entry);
      }
    } catch { /* malformed untrusted script does not stop other scripts */ }
  }
  return values;
}
function objectLabel(obj) {
  if (typeof obj === 'string') return optionalString(obj);
  if (obj && typeof obj === 'object') return optionalString(obj.name);
  return null;
}
function metaValue(html, attrName, attrValue) {
  const re = /<meta\b[^>]*>/gi;
  for (const [tag] of html.matchAll(re)) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3])]));
    if (String(attrs[attrName] ?? '').toLowerCase() === attrValue) return attrs.content ?? null;
  }
  return null;
}
function validType(v) {
  const types = Array.isArray(v) ? v : [v];
  return types.some(t => typeof t === 'string' && /(?:^|\/)(?:Vehicle|Car|Product)$/i.test(t));
}
function pickVehicle(ldList) {
  return ldList.find(v => validType(v['@type']) && (v.offers || v.mileageFromOdometer || v.vehicleModelDate || v.brand || v.manufacturer)) || null;
}
function pickPrice(item) {
  const offer = Array.isArray(item?.offers) ? item.offers[0] : item?.offers;
  if (!offer || typeof offer !== 'object') return {amount: null, currency: null};
  return {amount: numeric(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price), currency: optionalString(offer.priceCurrency ?? offer.priceSpecification?.priceCurrency)};
}
function pickMileage(item) {
  const odo = item?.mileageFromOdometer;
  if (odo == null) return null;
  if (typeof odo === 'object') {
    const n = numeric(odo.value ?? odo.minValue);
    if (n == null) return null;
    const unit = String(odo.unitCode ?? odo.unitText ?? 'KMT').toLowerCase();
    return /mi(l|$)|smi/.test(unit) ? Math.round(n * 1.609344) : Math.round(n);
  }
  const n = numeric(odo);
  return n == null ? null : Math.round(n);
}
function extractTitle(html) {
  const og = metaValue(html, 'property', 'og:title');
  if (og) return normalSpace(og);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title ? normalSpace(title[1]) : null;
}
export function extractCar(html, options = {}) {
  if (typeof html !== 'string' || !html.trim()) throw new TypeError('HTML_EMPTY');
  const ld = parseLd(html);
  const item = pickVehicle(ld);
  const title = optionalString(item?.name) ?? extractTitle(html);
  const make = objectLabel(item?.brand) ?? objectLabel(item?.manufacturer);
  const model = optionalString(item?.model);
  const builtYear = year(item?.vehicleModelDate ?? item?.productionDate ?? item?.dateVehicleFirstRegistered);
  const price = pickPrice(item);
  // If there is no structured vehicle, avoid scanning unrelated page text for numbers.
  if (price.amount == null && item) {
    price.amount = numeric(metaValue(html, 'property', 'product:price:amount'));
    price.currency ??= optionalString(metaValue(html, 'property', 'product:price:currency'));
  }
  const odometerKm = pickMileage(item);
  const fields = {title, make, model, year: builtYear, odometerKm, price: price.amount, currency: price.currency};
  const missing = Object.entries(fields).filter(([, v]) => v === null).map(([k]) => k);
  const prov = item ? 'json-ld' : title ? 'html-title-only' : 'none';
  return Object.freeze({
    schemaVersion: 1,
    title,
    make,
    model,
    year: builtYear,
    odometerKm,
    price,
    completeness: {requiredFilled: [title,make,builtYear,odometerKm,price.amount].filter(x => x !== null).length, requiredTotal: 5, missing},
    evidence: {method: prov, rawSha256: createHash('sha256').update(html).digest('hex'), extractedAt: options.extractedAt ?? new Date().toISOString()},
  });
}