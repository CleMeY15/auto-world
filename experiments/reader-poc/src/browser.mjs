import {ReaderError} from './reader.mjs';

/** Optional renderer: install Playwright/Chromium explicitly in an isolated environment. */
export async function renderWithChromium(url, {signal, maxBytes=512*1024}={}) {
  let chromium;
  try { ({chromium} = await import('playwright')); }
  catch { throw new ReaderError('BROWSER_NOT_INSTALLED',501); }
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({serviceWorkers:'block'});
    if (signal?.aborted) throw new ReaderError('RENDER_CANCELLED', 499);
    const response = await page.goto(url, {waitUntil:'domcontentloaded',timeout:12000});
    if (!response || response.status() === 403 || response.status() === 429) throw new ReaderError('ACCESS_DENIED', 403);
    if (response.status() >= 400) throw new ReaderError('SOURCE_UNAVAILABLE',502);
    if (new URL(page.url()).origin !== new URL(url).origin) throw new ReaderError('REDIRECT_DISALLOWED',502);
    // DOM-content-loaded only: never solve challenges, fake fingerprints or execute vendor-protection workarounds.
    const html = await page.content();
    if (Buffer.byteLength(html,'utf8') > maxBytes) throw new ReaderError('PAGE_TOO_LARGE',413);
    return html;
  } finally { await browser.close(); }
}