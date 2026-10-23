import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const HISTORY_PATH = "/historique-vehicule";
const HISTOVEC_URL = "https://histovec.interieur.gouv.fr/histovec/accueil";
const SERVICE_PUBLIC_URL = "https://www.service-public.gouv.fr/particuliers/vosdroits/F1707";
const OFFICIAL_URLS = new Set([HISTOVEC_URL, SERVICE_PUBLIC_URL]);

type StorageSnapshot = {
  readonly cache: ReadonlyArray<{ readonly body: string; readonly name: string; readonly requests: readonly string[] }>;
  readonly cookie: string;
  readonly indexedDatabases: ReadonlyArray<{ readonly name: string | undefined; readonly version: number | undefined }>;
  readonly indexedSeed: string | undefined;
  readonly local: ReadonlyArray<readonly [string, string]>;
  readonly session: ReadonlyArray<readonly [string, string]>;
};

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (
        bounds.width === 0
        || bounds.height === 0
        || bounds.left >= -0.5
        && bounds.right <= viewportWidth + 0.5
      ) return [];
      return [{
        left: Math.round(bounds.left * 10) / 10,
        right: Math.round(bounds.right * 10) / 10,
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
        text: (element.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 80),
        width: Math.round(bounds.width * 10) / 10,
      }];
    });
    const intrinsicOverflow = Array.from(document.querySelectorAll<HTMLElement>("html, body, body *")).flatMap((element) => {
      const style = getComputedStyle(element);
      if (
        element.clientWidth === 0
        || element.scrollWidth <= element.clientWidth + 1
        || style.display === "none"
        || style.visibility === "hidden"
      ) return [];
      return [{
        clientWidth: element.clientWidth,
        overflowX: style.overflowX,
        scrollWidth: element.scrollWidth,
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
        text: (element.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 80),
        whiteSpace: style.whiteSpace,
      }];
    });
    return { documentWidth: document.documentElement.scrollWidth, intrinsicOverflow, offenders, viewportWidth };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({
    documentWidth: report.viewportWidth,
    intrinsicOverflow: [],
    offenders: [],
    viewportWidth: report.viewportWidth,
  });
}

async function expectMinimumTarget(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds, "The actionable element should have rendered bounds").not.toBeNull();
  expect(bounds!.height, "The actionable element should be at least 44px high").toBeGreaterThanOrEqual(44);
  expect(bounds!.width, "The actionable element should be at least 44px wide").toBeGreaterThanOrEqual(44);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const directory = process.env.AW_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({
    fullPage: true,
    path: directory ? path.join(directory, name) : testInfo.outputPath(name),
    scale: "css",
  });
}

async function expectProtectedOfficialLink(page: Page, selector: string, url: string, descriptionId: string) {
  const link = page.locator(selector);
  await expect(link).toHaveAttribute("href", url);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(link).toHaveAttribute("aria-describedby", descriptionId);
  await expect(page.locator(`#${descriptionId}`)).toBeVisible();
  await expect(link).not.toHaveAttribute("ping", /.+/u);
  const rel = (await link.getAttribute("rel"))?.split(/\s+/u) ?? [];
  expect(rel).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  return link;
}

async function openInterceptedOfficialPage(context: BrowserContext, page: Page, selector: string, expectedUrl: string) {
  let observedRequest: { method: string; postData: string | null; referer: string | undefined; resourceType: string; url: string } | undefined;
  await context.route(expectedUrl, async (route) => {
    const request = route.request();
    observedRequest = {
      method: request.method(),
      postData: request.postData(),
      referer: request.headers().referer,
      resourceType: request.resourceType(),
      url: request.url(),
    };
    await route.fulfill({
      body: "<!doctype html><html lang=fr><title>Destination officielle interceptée</title><body>Test local</body></html>",
      contentType: "text/html; charset=utf-8",
      status: 200,
    });
  });
  const popupPromise = page.waitForEvent("popup");
  await page.locator(selector).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(observedRequest).toEqual({
    method: "GET",
    postData: null,
    referer: undefined,
    resourceType: "document",
    url: expectedUrl,
  });
  expect(new URL(popup.url()).search).toBe("");
  expect(new URL(popup.url()).hash).toBe("");
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  await context.unroute(expectedUrl);
}

async function snapshotStorage(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const cache = [];
    for (const name of (await caches.keys()).sort()) {
      const current = await caches.open(name);
      const requests = (await current.keys()).map((request) => request.url).sort();
      const body = requests[0] ? await (await current.match(requests[0]))?.text() ?? "" : "";
      cache.push({ body, name, requests });
    }
    const indexedSeed = await new Promise<string | undefined>((resolve, reject) => {
      const request = indexedDB.open("aw-history-indexed-db", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("seed", "readonly");
        const read = transaction.objectStore("seed").get("indexed-key");
        read.onerror = () => reject(read.error);
        read.onsuccess = () => resolve(read.result as string | undefined);
        transaction.oncomplete = () => database.close();
      };
    });
    return {
      cache,
      cookie: document.cookie,
      indexedDatabases: "databases" in indexedDB
        ? (await indexedDB.databases()).map(({ name, version }) => ({ name, version })).sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""))
        : [],
      indexedSeed,
      local: Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right)),
      session: Object.entries(sessionStorage).sort(([left], [right]) => left.localeCompare(right)),
    };
  });
}

async function seedStorage(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    document.cookie = "aw_history_seed=cookie-value; Path=/; SameSite=Strict";
    localStorage.setItem("aw-history-local", "local-value");
    sessionStorage.setItem("aw-history-session", "session-value");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("aw-history-indexed-db", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("seed");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("seed", "readwrite");
        transaction.objectStore("seed").put("indexed-value", "indexed-key");
        transaction.oncomplete = () => {
          request.result.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const cache = await caches.open("aw-history-cache");
    await cache.put(new Request(`${location.origin}/__history-cache-entry`), new Response("cache-value"));
  });
}

test("the guide is a static independent route linked from root, demo and demo-disabled mode", async ({ browser, page }, testInfo) => {
  const response = await page.goto(HISTORY_PATH);
  expect(response?.status()).toBe(200);
  expect(await response?.headerValue("x-dns-prefetch-control")).toBe("off");
  await expect(page).toHaveTitle(/HistoVec|historique du véhicule/i);
  await expect(page.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
  await expect(page.locator("#main")).toBeVisible();
  await expect(page.locator("details")).toHaveCount(1);
  await expect(page.locator("details > summary")).toHaveCount(1);

  for (const entryPath of ["/", "/demo"]) {
    await page.goto(entryPath);
    await expect(page.locator(`footer a[href="${HISTORY_PATH}"]`)).toHaveText("Historique du véhicule");
  }

  const demoDisabledBaseURL = String(testInfo.config.metadata.demoDisabledBaseURL);
  const disabledContext = await browser.newContext({ baseURL: demoDisabledBaseURL });
  const disabledPage = await disabledContext.newPage();
  await disabledPage.goto("/");
  await expect(disabledPage.locator(`footer a[href="${HISTORY_PATH}"]`)).toHaveText("Historique du véhicule");
  await disabledPage.goto(HISTORY_PATH);
  await expect(disabledPage.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
  await disabledContext.close();
});

test("the server-rendered guide and official handoffs remain usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3107", javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(HISTORY_PATH);
  expect(response?.status()).toBe(200);
  await expect(page.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
  await expect(page.locator("details")).toHaveJSProperty("open", false);
  await page.locator("details > summary").click();
  await expect(page.locator("details")).toHaveJSProperty("open", true);
  await expect(page.locator("#history-help")).toBeVisible();
  await openInterceptedOfficialPage(context, page, "#history-official", HISTOVEC_URL);
  await openInterceptedOfficialPage(context, page, "#history-help", SERVICE_PUBLIC_URL);
  await expect(page.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
  await context.close();
});

test("the buyer guide states the holder workflow and its limits without claiming a report", async ({ page }) => {
  await page.goto(HISTORY_PATH);
  const main = page.locator("#main");
  await expect(main).toContainText(/titulaire.{0,80}carte grise|carte grise.{0,80}titulaire/iu);
  await expect(main).toContainText(/vendeur/iu);
  await expect(main).toContainText(/génèr\w*.{0,80}rapport|rapport.{0,80}génèr\w*/iu);
  await expect(main).toContainText(/acheteur|vous/iu);
  await expect(main).toContainText(/demand\w*.{0,100}vendeur.{0,100}lien|vendeur.{0,100}partag\w*.{0,100}lien/iu);
  await expect(main).toContainText(/site général.{0,100}(?:ne|n’|n').{0,40}(?:donne|ouvre|récupère|retrouve).{0,80}rapport|rapport.{0,100}lien.{0,80}partag/iu);
  await expect(main).toContainText(/Auto World.{0,80}(?:ne|n’|n').{0,30}(?:récupère|vérifie)|(?:ne|n’|n').{0,30}(?:récupéré|vérifié).{0,60}Auto World/iu);
  await expect(main).toContainText(/(?:ne|n’|n').{0,40}garanti.{0,80}(?:état|condition)|(?:état|condition).{0,80}(?:ne|n’|n').{0,40}garanti/iu);
  await expect(main.locator("ol > li")).toHaveCount(3);
  await page.locator("details > summary").click();
  await expect(main).toContainText(/redemand\w*.{0,80}vendeur|demand\w*.{0,80}vendeur/iu);
  await expect(main.getByText(/sans accident|véhicule fiable|historique complet|rapport vérifié/iu)).toHaveCount(0);
});

test("official links are exact private handoffs with no automatic traffic, forms or hints", async ({ context, page }) => {
  const externalRequests: string[] = [];
  const apiRequests: string[] = [];
  const applicationRequests: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(request.url());
    if (["fetch", "xhr"].includes(request.resourceType())) applicationRequests.push(request.url());
  });
  await page.goto(HISTORY_PATH);
  await expectProtectedOfficialLink(page, "#history-official", HISTOVEC_URL, "history-destination");
  await page.locator("details > summary").click();
  await expectProtectedOfficialLink(page, "#history-help", SERVICE_PUBLIC_URL, "history-help-destination");

  await expect(page.locator("form, input, textarea, select, iframe, [contenteditable=true]")).toHaveCount(0);
  await expect(page.locator('link[rel="prefetch"], link[rel="preconnect"], link[rel="dns-prefetch"]')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(applicationRequests).toEqual([]);

  await openInterceptedOfficialPage(context, page, "#history-official", HISTOVEC_URL);
  expect(page.url()).toBe("http://127.0.0.1:3107/historique-vehicule");
  await openInterceptedOfficialPage(context, page, "#history-help", SERVICE_PUBLIC_URL);
  expect(new Set(externalRequests)).toEqual(OFFICIAL_URLS);
  expect(apiRequests).toEqual([]);
  expect(applicationRequests).toEqual([]);
  await expect(page.locator("#main [role=status], #main [role=alert]")).toHaveCount(0);
});

test("the guide preserves seeded browser state and remains usable when storage is denied", async ({ browser, browserName }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  const cacheOperations: string[] = [];
  await context.exposeBinding("__awRecordHistoryCacheOperation", (_source, operation: string) => {
    cacheOperations.push(operation);
  });
  await context.addInitScript(() => {
    const storage = caches;
    const prototype = Object.getPrototypeOf(storage) as Record<string, (...args: unknown[]) => unknown>;
    const record = (operation: string) => {
      void (window as typeof window & { __awRecordHistoryCacheOperation: (value: string) => Promise<void> })
        .__awRecordHistoryCacheOperation(operation);
    };
    for (const method of ["delete", "has", "keys", "match", "open"] as const) {
      const original = prototype[method]!;
      Object.defineProperty(prototype, method, {
        configurable: true,
        value(this: CacheStorage, ...args: unknown[]) {
          record(`CacheStorage.${method}`);
          return original.apply(this, args);
        },
      });
    }
  });
  const page = await context.newPage();
  await seedStorage(page);
  const before = await snapshotStorage(page);
  const cookiesBefore = await context.cookies();
  await page.evaluate(() => (window as typeof window & { __awRecordHistoryCacheOperation: (value: string) => Promise<void> })
    .__awRecordHistoryCacheOperation("seed-audit-barrier"));
  cacheOperations.length = 0;
  await page.goto(HISTORY_PATH);
  await page.locator("details > summary").click();
  await expect(page.locator("#history-help")).toBeVisible();
  await page.evaluate(() => (window as typeof window & { __awRecordHistoryCacheOperation: (value: string) => Promise<void> })
    .__awRecordHistoryCacheOperation("audit-barrier"));
  expect(cacheOperations).toEqual(["audit-barrier"]);

  const afterNavigation = await snapshotStorage(page);
  expect(afterNavigation.cookie).toBe(before.cookie);
  expect(afterNavigation.indexedDatabases).toEqual(before.indexedDatabases);
  expect(afterNavigation.indexedSeed).toBe(before.indexedSeed);
  expect(afterNavigation.local).toEqual(before.local);
  expect(afterNavigation.session).toEqual(before.session);
  expect(afterNavigation.cache.map(({ name }) => name)).toEqual(before.cache.map(({ name }) => name));
  if (browserName !== "webkit") {
    expect(afterNavigation.cache).toEqual(before.cache);
  }
  // Playwright WebKit drops Cache entries on any same-origin document navigation,
  // including the no-application control recorded in .omx/validation/task-0115/cache-control.md.
  // The API audit above plus the exact post-navigation interaction comparison below
  // provide equivalent mutation detection without treating that engine behavior as app activity.
  expect(await context.cookies()).toEqual(cookiesBefore);

  await page.evaluate(async () => {
    const cache = await caches.open("aw-history-cache");
    await cache.put(new Request(`${location.origin}/__history-cache-entry`), new Response("cache-value"));
  });
  const cacheBeforeInteraction = (await snapshotStorage(page)).cache;
  await page.evaluate(() => (window as typeof window & { __awRecordHistoryCacheOperation: (value: string) => Promise<void> })
    .__awRecordHistoryCacheOperation("interaction-seed-audit-barrier"));
  cacheOperations.length = 0;
  await page.locator("details > summary").click();
  await page.locator("details > summary").click();
  await page.evaluate(() => (window as typeof window & { __awRecordHistoryCacheOperation: (value: string) => Promise<void> })
    .__awRecordHistoryCacheOperation("audit-barrier"));
  expect(cacheOperations).toEqual(["audit-barrier"]);
  expect((await snapshotStorage(page)).cache).toEqual(cacheBeforeInteraction);
  await context.close();

  const deniedContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  await deniedContext.addInitScript(() => {
    const denied = () => { throw new DOMException("Storage denied for test", "SecurityError"); };
    Object.defineProperties(window, {
      caches: { configurable: true, get: denied },
      indexedDB: { configurable: true, get: denied },
      localStorage: { configurable: true, get: denied },
      sessionStorage: { configurable: true, get: denied },
    });
  });
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto(HISTORY_PATH);
  const deniedResults = await deniedPage.evaluate(() => ["caches", "indexedDB", "localStorage", "sessionStorage"].map((property) => {
    try {
      Reflect.get(window, property);
      return `${property}:allowed`;
    } catch (error) {
      return `${property}:${error instanceof DOMException ? error.name : "unexpected-error"}`;
    }
  }));
  expect(deniedResults).toEqual([
    "caches:SecurityError",
    "indexedDB:SecurityError",
    "localStorage:SecurityError",
    "sessionStorage:SecurityError",
  ]);
  await expect(deniedPage.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
  await deniedPage.locator("details > summary").click();
  await expect(deniedPage.locator("#history-help")).toBeVisible();
  await deniedContext.close();
});

test("native help, skip navigation, keyboard focus and offline-local behavior remain truthful", async ({ context, page }, testInfo) => {
  await page.goto(HISTORY_PATH);
  const skipLink = page.getByRole("link", { name: "Aller au contenu" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  const details = page.locator("details");
  const summary = details.locator("summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  const focus = await summary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focus.outlineStyle).not.toBe("none");
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  await screenshot(page, testInfo, `history-${testInfo.project.name}-keyboard-focus.png`);
  await page.keyboard.press("Enter");
  await expect(details).toHaveJSProperty("open", true);
  await expect(summary).toBeFocused();

  await context.setOffline(true);
  await expect(page.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
  await expect(page.locator("#history-help")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(details).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();
  await page.keyboard.press("Space");
  await expect(details).toHaveJSProperty("open", true);
  await expect(page.locator("#main [role=status], #main [role=alert]")).toHaveCount(0);
  await expect(page.getByText(/rapport (?:chargé|récupéré|vérifié)|service disponible/iu)).toHaveCount(0);
});

test("the required light and dark viewport matrix fits and passes WCAG checks", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`${HISTORY_PATH}?visual=${browserName}-${width}-${theme}`);
      await expect(page.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
      await screenshot(page, testInfo, `history-${browserName}-${width}-${theme}-collapsed.png`);
      await page.locator("details > summary").click();
      await expectNoHorizontalOverflow(page);
      await expectMinimumTarget(page.locator("#history-official"));
      await expectMinimumTarget(page.locator("details > summary"));
      await expectMinimumTarget(page.locator("#history-help"));
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await screenshot(page, testInfo, `history-${browserName}-${width}-${theme}-help-open.png`);
    }
  }
});

test("200 percent platform and Verdana text remain operable with reduced motion", async ({ page, browserName }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  for (const [width, height] of [[320, 780], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const font of ["platform", "verdana"] as const) {
      await page.goto(`${HISTORY_PATH}?text=${width}-${font}`);
      if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await page.locator("details > summary").click();
      await screenshot(page, testInfo, `history-${browserName}-${width}-light-text-200-${font}-before-overflow-check.png`);
      await expectNoHorizontalOverflow(page);
      await expect(page.locator("#history-title")).toHaveText("Demander un rapport HistoVec");
      await expect(page.locator("#history-official")).toBeVisible();
      await expect(page.locator("#history-help")).toBeVisible();
      await expectMinimumTarget(page.locator("#history-official"));
      await expectMinimumTarget(page.locator("details > summary"));
      await expectMinimumTarget(page.locator("#history-help"));
      const contentFit = await page.locator("main h1, main h2, main p, main li, main a, main summary").evaluateAll((elements) => elements
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => ({
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          overflowY: getComputedStyle(element).overflowY,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
          text: (element.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 80),
        })));
      expect(contentFit.filter((element) => (
        element.scrollWidth > element.clientWidth + 1
        || element.overflowY !== "visible" && element.scrollHeight > element.clientHeight + 1
      ))).toEqual([]);
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await screenshot(page, testInfo, `history-${browserName}-${width}-light-text-200-${font}.png`);
    }
  }
});
