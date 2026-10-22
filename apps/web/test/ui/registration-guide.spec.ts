import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const REGISTRATION_PATH = "/carte-grise";
const SIMULATOR_URL = "https://www.service-public.gouv.fr/simulateur/calcul/cout-certificat-immatriculation";
const GUIDANCE_URL = "https://www.service-public.gouv.fr/particuliers/vosdroits/F19211";
const OFFICIAL_URLS = new Set([SIMULATOR_URL, GUIDANCE_URL]);

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
    return { documentWidth: document.documentElement.scrollWidth, offenders, viewportWidth };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({
    documentWidth: report.viewportWidth,
    offenders: [],
    viewportWidth: report.viewportWidth,
  });
}

async function expectMinimumTarget(locator: import("@playwright/test").Locator) {
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

async function expectProtectedOfficialLink(page: Page, selector: string, url: string) {
  const link = page.locator(selector);
  await expect(link).toHaveAttribute("href", url);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
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
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  await context.unroute(expectedUrl);
}

test("the guide is a static independent route linked from root, demo and demo-disabled mode", async ({ browser, page }, testInfo) => {
  const response = await page.goto(REGISTRATION_PATH);
  expect(response?.status()).toBe(200);
  expect(await response?.headerValue("x-dns-prefetch-control")).toBe("off");
  await expect(page).toHaveTitle(/carte grise/i);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
  await expect(page.locator("main")).toBeVisible();

  for (const entryPath of ["/", "/demo"]) {
    await page.goto(entryPath);
    const entry = page.locator(`footer a[href="${REGISTRATION_PATH}"]`);
    await expect(entry).toHaveText("Carte grise");
  }

  const demoDisabledBaseURL = String(testInfo.config.metadata.demoDisabledBaseURL);
  const disabledContext = await browser.newContext({ baseURL: demoDisabledBaseURL });
  const disabledPage = await disabledContext.newPage();
  await disabledPage.goto("/");
  await expect(disabledPage.locator(`footer a[href="${REGISTRATION_PATH}"]`)).toHaveText("Carte grise");
  await disabledPage.goto(REGISTRATION_PATH);
  await expect(disabledPage.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
  await disabledContext.close();
});

test("the server-rendered guide and its handoff remain usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3107", javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(REGISTRATION_PATH);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
  await expect(page.locator("details")).toHaveJSProperty("open", false);
  await page.locator("details > summary").click();
  await expect(page.locator("details")).toHaveJSProperty("open", true);
  await expect(page.locator("#registration-help")).toBeVisible();
  await expect(page.locator("#registration-simulator")).toHaveAttribute("href", SIMULATOR_URL);
  await openInterceptedOfficialPage(context, page, "#registration-simulator", SIMULATOR_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
  await context.close();
});

test("official links are explicit, private handoffs with no automatic external activity or storage", async ({ context, page }) => {
  const externalRequests: string[] = [];
  const apiRequests: string[] = [];
  const applicationRequests: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(request.url());
    if (["fetch", "xhr"].includes(request.resourceType())) applicationRequests.push(request.url());
  });
  await page.goto(REGISTRATION_PATH);
  await expect(page.locator("#registration-destination")).toBeVisible();
  await expect(page.locator("#registration-simulator")).toHaveAttribute("aria-describedby", "registration-destination");
  await expectProtectedOfficialLink(page, "#registration-simulator", SIMULATOR_URL);

  await expect(page.locator("form, iframe")).toHaveCount(0);
  await expect(page.locator('link[rel="prefetch"], link[rel="preconnect"], link[rel="dns-prefetch"]')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(applicationRequests).toEqual([]);
  const storage = await page.evaluate(async () => ({
    cacheKeys: await caches.keys(),
    indexedDatabases: "databases" in indexedDB ? (await indexedDB.databases()).map((database) => database.name) : [],
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage).toEqual({ cacheKeys: [], indexedDatabases: [], local: [], session: [] });
  expect(await context.cookies()).toEqual([]);

  await openInterceptedOfficialPage(context, page, "#registration-simulator", SIMULATOR_URL);
  expect(page.url()).toBe("http://127.0.0.1:3107/carte-grise");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
  await expect(page.getByText(/calcul (?:terminé|réussi)|estimation disponible/iu)).toHaveCount(0);

  await page.getByText("Si le simulateur ne s’ouvre pas", { exact: true }).click();
  await expectProtectedOfficialLink(page, "#registration-help", GUIDANCE_URL);
  await openInterceptedOfficialPage(context, page, "#registration-help", GUIDANCE_URL);
  expect(new Set(externalRequests)).toEqual(OFFICIAL_URLS);
  expect(apiRequests).toEqual([]);
  expect(applicationRequests).toEqual([]);
});

test("the checklist, native help, focus path and offline-local behavior remain truthful", async ({ context, page }) => {
  await page.goto(REGISTRATION_PATH);
  const checklist = page.locator("main");
  await expect(checklist).toContainText("carte grise actuelle");
  await expect(checklist).toContainText(/première (?:mise en circulation|circulation)/i);
  await expect(checklist).toContainText("P.6");
  await expect(checklist).toContainText("P.3");
  await expect(checklist).toContainText(/département.*résidence|résidence.*département/i);
  await expect(checklist).toContainText(/non exhaustif|informations supplémentaires|autres informations/i);

  await page.getByRole("link", { name: "Aller au contenu" }).focus();
  await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

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
  await page.keyboard.press("Enter");
  await expect(details).toHaveJSProperty("open", true);

  await context.setOffline(true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
  await expect(page.locator("#registration-help")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(details).toHaveJSProperty("open", false);
  await page.keyboard.press("Space");
  await expect(details).toHaveJSProperty("open", true);
  await expect(page.locator("main [role=status]")).toHaveCount(0);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});

test("the required light and dark viewport matrix fits and passes WCAG checks", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`${REGISTRATION_PATH}?visual=${browserName}-${width}-${theme}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
      await screenshot(page, testInfo, `registration-${browserName}-${width}-${theme}-collapsed.png`);
      await page.locator("details > summary").click();
      await expectNoHorizontalOverflow(page);
      await expectMinimumTarget(page.locator("#registration-simulator"));
      await expectMinimumTarget(page.locator("details > summary"));
      await expectMinimumTarget(page.locator("#registration-help"));
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await screenshot(page, testInfo, `registration-${browserName}-${width}-${theme}-help-open.png`);
    }
  }
});

test("200 percent platform and Verdana text remain operable with reduced motion", async ({ page, browserName }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  for (const [width, height] of [[320, 780], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const font of ["platform", "verdana"] as const) {
      await page.goto(`${REGISTRATION_PATH}?text=${width}-${font}`);
      if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await page.locator("details > summary").click();
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estimer ma carte grise");
      await expect(page.locator("#registration-simulator")).toBeVisible();
      await expect(page.locator("#registration-help")).toBeVisible();
      await expectMinimumTarget(page.locator("#registration-simulator"));
      await expectMinimumTarget(page.locator("details > summary"));
      await expectMinimumTarget(page.locator("#registration-help"));
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
      await screenshot(page, testInfo, `registration-${browserName}-${width}-light-text-200-${font}.png`);
    }
  }
});
