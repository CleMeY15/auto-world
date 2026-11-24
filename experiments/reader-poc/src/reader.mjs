import {extractCar} from './extract.mjs';

export class ReaderError extends Error {
  constructor(code, status = 422) { super(code); this.name = 'ReaderError'; this.code = code; this.status = status; }
}

function sourceFor(sources, sourceId, url) {
  const source = sources[sourceId];
  if (!source || source.enabled !== true ||
      !['official_api','licensed_partner','dealer_feed','permitted_crawl'].includes(source.rightsStatus) ||
      typeof source.evidenceRef !== 'string' || !source.evidenceRef.trim()) throw new ReaderError('SOURCE_NOT_AUTHORIZED', 403);
  let parsed;
  try { parsed = new URL(url); } catch { throw new ReaderError('INVALID_URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.port ||
      !/^[a-z0-9.-]+$/i.test(parsed.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) ||
      parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) throw new ReaderError('UNSAFE_URL');
  if (!Array.isArray(source.allowedOrigins) || !source.allowedOrigins.includes(parsed.origin)) throw new ReaderError('ORIGIN_NOT_AUTHORIZED', 403);
  return {source, url: parsed.href};
}

function appearsBlocked(body) {
  return /(?:captcha|datadome|you have been blocked|verify you are human|cf-turnstile|access denied)/i.test(body.slice(0, 15000));
}
function responseError(status) {
  if ([401, 403, 429].includes(status)) throw new ReaderError('ACCESS_DENIED', 403);
  if (status === 304) throw new ReaderError('NOT_MODIFIED_WITHOUT_CACHE', 502);
  if (status >= 300 && status < 400) throw new ReaderError('REDIRECT_DISALLOWED', 502);
  if (status < 200 || status >= 300) throw new ReaderError('SOURCE_UNAVAILABLE', 502);
}
async function readLimited(response, maxBytes) {
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new ReaderError('UNSUPPORTED_CONTENT', 415);
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > maxBytes) throw new ReaderError('PAGE_TOO_LARGE', 413);
  if (!response.body?.getReader) throw new ReaderError('EMPTY_RESPONSE', 502);
  const stream = response.body.getReader();
  const chunks = [];
  let n = 0;
  try {
    while (true) {
      const {done, value} = await stream.read();
      if (done) break;
      n += value.byteLength;
      if (n > maxBytes) throw new ReaderError('PAGE_TOO_LARGE', 413);
      chunks.push(value);
    }
  } finally { try { await stream.cancel(); } catch {} }
  const output = new Uint8Array(n);
  let pos = 0;
  for (const chunk of chunks) { output.set(chunk, pos); pos += chunk.length; }
  try { return new TextDecoder('utf-8', {fatal:true}).decode(output); }
  catch { throw new ReaderError('INVALID_UTF8'); }
}
function compare(prev, curr) {
  if (!prev) return [];
  const changes = [];
  const fields = ['title','make','model','year','odometerKm'];
  for (const key of fields) {
    if (curr[key] !== null && curr[key] !== prev[key]) changes.push({field:key, from:prev[key], to:curr[key]});
  }
  if (curr.price.amount !== null && curr.price.amount !== prev.price.amount) changes.push({field:'price.amount',from:prev.price.amount,to:curr.price.amount});
  return changes;
}

/**
 * Small Jina-like reader interface for explicitly authorized origins only.
 * Source permission must have been authenticated independently: a declaration
 * here is not legal authorization or proof of an active rights grant.
 * No CAPTCHA solving, IP rotation, stealth or challenge retries.
 */
export function createReader({sources = {}, fetchImpl = globalThis.fetch, renderBrowser = null, now = () => Date.now(),
  maxBytes = 512 * 1024, timeoutMs = 12_000, fixtureTransport = false} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 2 * 1024 * 1024) throw new TypeError('INVALID_MAX_BYTES');
  const cache = new Map();
  const counters = {reads:0,http:0,browser:0,cacheHits:0,notModified:0,failed:0};
  async function read({sourceId, url, refresh = false, signal} = {}) {
    counters.reads++;
    try {
      const selected = sourceFor(sources, sourceId, url);
      const {source} = selected;
      const canonical = selected.url;
      if (source.fixtureOnly && !fixtureTransport) throw new ReaderError('FIXTURE_REQUIRES_INJECTED_TRANSPORT', 403);
      const key = `${sourceId}|${canonical}`;
      const previous = cache.get(key);
      const t = now();
      const ttlMs = Number.isInteger(source.cacheTtlMs) ? Math.max(0,Math.min(source.cacheTtlMs,24*60*60*1000)) : 30*60*1000;
      if (!refresh && previous && previous.expiresAt > t) {
        counters.cacheHits++;
        return {...previous.result, cacheHit:true, changes:[]};
      }
      const abort = signal ? AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const requestHeaders = {Accept:'text/html,application/xhtml+xml'};
      if (previous?.etag) requestHeaders['If-None-Match'] = previous.etag;
      if (previous?.lastModified) requestHeaders['If-Modified-Since'] = previous.lastModified;
      counters.http++;
      const response = await fetchImpl(canonical, {method:'GET', headers:requestHeaders, redirect:'manual', signal:abort});
      if (response.status === 304 && previous) {
        counters.notModified++;
        previous.expiresAt = t + ttlMs;
        return {...previous.result, cacheHit:true, unchanged:true, changes:[]};
      }
      responseError(response.status);
      let html = await readLimited(response, maxBytes);
      if (appearsBlocked(html)) throw new ReaderError('VERIFICATION_REQUIRED', 403);
      let extracted = extractCar(html, {extractedAt:new Date(t).toISOString()});
      let engine = 'http';
      const hasAppShell = /<script\b[^>]+src\s*=|\bid\s*=\s*["'](?:root|app)["']/i.test(html);
      if (renderBrowser && source.allowBrowser === true && hasAppShell && extracted.completeness.requiredFilled <= 1) {
        counters.browser++;
        html = await renderBrowser(canonical, {signal:abort, maxBytes});
        if (typeof html !== 'string' || Buffer.byteLength(html,'utf8') > maxBytes) throw new ReaderError('PAGE_TOO_LARGE', 413);
        if (appearsBlocked(html)) throw new ReaderError('VERIFICATION_REQUIRED', 403);
        extracted = extractCar(html, {extractedAt:new Date(t).toISOString()});
        engine = 'browser';
      }
      const result = {
        sourceId, url:canonical, engine, cacheHit:false, unchanged: false,
        capturedAt:new Date(t).toISOString(), ...extracted,
        changes: compare(previous?.result, extracted),
      };
      // POC-only in-memory cache: no persistent raw HTML, VIN or seller PII.
      cache.set(key,{expiresAt:t+ttlMs, etag:response.headers?.get?.('etag') ?? null,
        lastModified:response.headers?.get?.('last-modified') ?? null, result});
      return result;
    } catch (error) { counters.failed++; throw error; }
  }
  return {read, stats:() => ({...counters,cacheEntries:cache.size}), clear:()=>cache.clear()};
}