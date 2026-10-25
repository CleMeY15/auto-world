import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import path from "node:path";

import {
  fulfillJson,
  mockDemoCatalog,
  v2Envelope,
  v2Error,
  v2Response,
} from "./demo-v2-fixtures";

const favoritesKey = "auto-world.demo.favorites.v1";
const savedSearchesKey = "auto-world.demo.saved-searches.v1";
const publicationIds = {
  first: "lst_publication-01",
  second: "lst_publication-02",
  max: `lst_${"a".repeat(64)}`,
} as const;

type Availability = "active" | "withdrawn" | "deleted" | "missing";
type DetailState = "complete" | "partial" | "stale";

function publication(listingId: string, availability: Availability = "active", index = 1, observedAt = new Date().toISOString()) {
  const priceEvidence = `ev_${String(index * 2 - 1).padStart(64, "0")}`;
  const mileageEvidence = `ev_${String(index * 2).padStart(64, "0")}`;
  return {
    listingId,
    availability,
    price: { status: "observed", value: { amountMinor: 3_000_000 + index, currency: "EUR" }, evidenceId: priceEvidence },
    mileage: { status: "observed", value: { amount: 40_000 + index, unit: "km" }, evidenceId: mileageEvidence },
    evidence: [
      { evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 9_000, value: { amountMinor: 3_000_000 + index, currency: "EUR" } },
      { evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 8_500, value: { amount: 40_000 + index, unit: "km" } },
    ],
    description: { status: "unavailable" },
    descriptionEvidence: [],
  };
}

function acceptedDetail(listingId: string, options: { readonly availability?: Availability; readonly state?: DetailState; readonly index?: number } = {}) {
  const state = options.state ?? "complete";
  const dataAsOf = state === "stale" ? new Date(Date.now() - 120_000).toISOString() : new Date().toISOString();
  return v2Envelope(v2Response(
    [publication(listingId, options.availability, options.index, dataAsOf)],
    { state, dataAsOf, total: 1 },
  ));
}

async function waitUntilReady(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
}

async function interceptDetails(page: Page, handler: (route: Route, listingId: string) => Promise<void>) {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const segment = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    return handler(route, decodeURIComponent(segment));
  });
}

async function openAcceptedDetail(page: Page, listingId: string = publicationIds.first) {
  await page.goto(`/demo#detail/${encodeURIComponent(listingId)}`);
  await waitUntilReady(page);
  await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
  await expect(page.locator("#demo-publication-link-start")).toBeVisible();
}

async function openPublicationCreator(page: Page) {
  await page.locator("#demo-publication-link-start").click();
  const field = page.locator("#demo-publication-link-url");
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("readonly", "");
  await expect(field).toBeFocused();
  return field;
}

async function installClipboardStub(context: BrowserContext, mode: "success" | "denied" | "missing" | "deferred") {
  await context.addInitScript((selectedMode) => {
    const state = { calls: [] as string[], settled: false };
    Object.defineProperty(window, "__awPublicationClipboard", { configurable: true, value: state });
    if (selectedMode === "missing") {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      return;
    }
    let resolveDeferred: (() => void) | undefined;
    const deferred = selectedMode === "deferred" ? new Promise<void>((resolve) => { resolveDeferred = resolve; }) : undefined;
    Object.defineProperty(window, "__awResolvePublicationClipboard", { configurable: true, value: () => resolveDeferred?.() });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          state.calls.push(value);
          if (selectedMode === "denied") throw new DOMException("denied", "NotAllowedError");
          if (deferred) await deferred;
          state.settled = true;
        },
      },
    });
  }, mode);
}

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0 || bounds.right <= viewportWidth + 0.5) return [];
      return [{
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${Array.from(element.classList).map((name) => `.${name}`).join("")}`,
        right: Math.round(bounds.right * 10) / 10,
        text: (element.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 80),
      }];
    });
    return { documentWidth: document.documentElement.scrollWidth, offenders, viewportWidth };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({ documentWidth: report.viewportWidth, offenders: [], viewportWidth: report.viewportWidth });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page);
  const file = process.env.AW_SCREENSHOT_DIR ? path.join(process.env.AW_SCREENSHOT_DIR, name) : testInfo.outputPath(name);
  if (process.env.AW_SCREENSHOT_DIR) await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
}

test("the real API publication pointer opens a fresh detail with GET-only reads and no storage mutation", async ({ page, context }) => {
  await page.goto("/demo");
  await waitUntilReady(page);
  const searchResponse = page.waitForResponse((response) => response.url().endsWith("/api/demo/v2/search") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  const acceptedSearch = await searchResponse;
  expect(acceptedSearch.status()).toBe(200);
  const listingId = ((await acceptedSearch.json()) as { data: { results: Array<{ listingId: string }> } }).data.results[0]?.listingId;
  expect(listingId).toBeDefined();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await page.locator(".demo-result-card").first().getByRole("button", { name: "Voir le détail", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#detail/${encodeURIComponent(listingId!)}$`, "u"));
  await expect(page.locator("#demo-publication-link-start")).toBeVisible();
  const url = await (await openPublicationCreator(page)).inputValue();
  expect(new URL(url).pathname).toBe("/demo");
  expect(new URL(url).search).toBe("");
  expect(new URL(url).hash).toBe(`#detail/${encodeURIComponent(listingId!)}`);

  const fresh = await context.newPage();
  const requests: Array<{ method: string; pathname: string }> = [];
  await fresh.addInitScript(({ favorites, saved }) => {
    localStorage.setItem(favorites, JSON.stringify({ schemaVersion: 1, listingIds: [] }));
    localStorage.setItem(saved, JSON.stringify({ schemaVersion: 1, searches: [] }));
    const writes: string[] = [];
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      writes.push(key);
      return nativeSetItem.call(this, key, value);
    };
    Object.defineProperty(window, "__awPublicationStorageWrites", { configurable: true, value: writes });
  }, { favorites: favoritesKey, saved: savedSearchesKey });
  fresh.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/demo/")) requests.push({ method: request.method(), pathname });
  });
  await fresh.goto(url);
  await expect(fresh.locator("#demo-publication-link-start")).toBeVisible();
  expect(requests.some((request) => request.method === "GET" && request.pathname.includes("/api/demo/v2/listings/"))).toBe(true);
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(await fresh.evaluate(() => (window as typeof window & { __awPublicationStorageWrites: string[] }).__awPublicationStorageWrites)).toEqual([]);
});

test("Saved opens the same accepted detail publication creator", async ({ page, context }) => {
  await context.addInitScript(({ key, listingId }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, listingIds: [listingId] }));
  }, { key: favoritesKey, listingId: publicationIds.first });
  await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
  await page.goto("/demo#saved");
  await page.locator(".demo-saved-card").getByRole("button", { name: "Voir le détail", exact: true }).click();
  await expect(page.locator("#demo-publication-link-start")).toBeVisible();
  const url = await (await openPublicationCreator(page)).inputValue();
  expect(new URL(url).hash).toBe(`#detail/${publicationIds.first}`);
});

test("all accepted availability and projection states expose an explicitly qualified pointer", async ({ page, context }) => {
  await interceptDetails(page, (route, listingId) => {
    const [availability = "active", state = "complete"] = listingId.replace("lst_publication-", "").split("-") as [Availability, DetailState];
    return fulfillJson(route, acceptedDetail(listingId, { availability, state }));
  });
  for (const availability of ["active", "withdrawn", "deleted", "missing"] as const) {
    for (const state of ["complete", "partial", "stale"] as const) {
      const listingId = `lst_publication-${availability}-${state}`;
      await openAcceptedDetail(page, listingId);
      await openPublicationCreator(page);
      const panel = page.locator("#demo-publication-link-panel");
      await expect(panel).toContainText("publication synthétique");
      await expect(panel).toContainText(/ne fige ni les valeurs ni sa disponibilité/i);
      await expect(panel).toContainText(/uniquement sur cet ordinateur/i);
      await page.locator("#demo-publication-link-close").click();
    }
  }
  await context.setOffline(true);
  await openPublicationCreator(page);
  await expect(page.locator("#demo-publication-link-url")).toHaveValue(/#detail\/lst_publication-missing-stale$/);
  await context.setOffline(false);
});

test("pending replacement and mismatched accepted data never retain the previous publication creator", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await interceptDetails(page, async (route, listingId) => {
    if (listingId === publicationIds.second) await gate;
    await fulfillJson(route, acceptedDetail(listingId === publicationIds.second ? publicationIds.first : listingId));
  });
  await openAcceptedDetail(page);
  await page.evaluate((listingId) => { window.location.hash = `detail/${listingId}`; }, publicationIds.second);
  await expect(page.locator("#demo-publication-link-start")).toHaveCount(0);
  await expect(page.locator(".demo-detail")).toHaveCount(0);
  release();
  await expect(page.getByText("Détail indisponible", { exact: true })).toBeVisible();
  await expect(page.locator("#demo-publication-link-start")).toHaveCount(0);
});

test("an HTTP 404 exposes no publication creator", async ({ page }) => {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => fulfillJson(route, v2Error("not_found"), 404));
  await page.goto(`/demo#detail/${publicationIds.first}`);
  await expect(page.getByText("Publication non disponible", { exact: true })).toBeVisible();
  await expect(page.locator("#demo-publication-link-start")).toHaveCount(0);
});

test("an invalid encoded detail route exposes no creator and echoes no hostile bytes", async ({ page }) => {
  await mockDemoCatalog(page);
  let invalidRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/demo/v2/listings/")) invalidRequests += 1; });
  await page.goto("/demo#detail/%E0%A4%A");
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("%E0%A4%A");
  expect(invalidRequests).toBe(0);
  await expect(page.locator("#demo-publication-link-start")).toHaveCount(0);
});

test("a direct detail opened offline exposes retry recovery and no creator", async ({ page, context }) => {
  await mockDemoCatalog(page);
  await page.goto("/demo");
  await waitUntilReady(page);
  await context.setOffline(true);
  await page.evaluate((listingId) => { window.location.hash = `detail/${listingId}`; }, publicationIds.first);
  await expect(page.getByText("Détail indisponible", { exact: true })).toBeVisible();
  await expect(page.getByText(/Reconnectez-vous/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator("#demo-publication-link-start")).toHaveCount(0);
});

test("a disabled runtime exposes no creator and performs zero demo API requests", async ({ page }, testInfo) => {
  const disabledBase = (testInfo.config.metadata as { readonly demoDisabledBaseURL?: unknown }).demoDisabledBaseURL;
  if (typeof disabledBase !== "string") throw new Error("demoDisabledBaseURL metadata is required");
  const demoRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) demoRequests.push(request.url()); });
  await page.goto(`${disabledBase}/demo#detail/${publicationIds.first}`);
  await waitUntilReady(page);
  await expect(page.locator("#demo-publication-link-start")).toHaveCount(0);
  expect(demoRequests).toEqual([]);
});

test("clipboard success is announced only after the explicit write resolves", async ({ page, context }) => {
  await installClipboardStub(context, "deferred");
  await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
  await openAcceptedDetail(page);
  expect(await page.evaluate(() => (window as typeof window & { __awPublicationClipboard: { calls: string[] } }).__awPublicationClipboard.calls)).toEqual([]);
  const url = await (await openPublicationCreator(page)).inputValue();
  expect(await page.evaluate(() => (window as typeof window & { __awPublicationClipboard: { calls: string[] } }).__awPublicationClipboard.calls)).toEqual([]);
  await page.locator("#demo-publication-link-copy").click();
  expect(await page.evaluate(() => (window as typeof window & { __awPublicationClipboard: { calls: string[] } }).__awPublicationClipboard.calls)).toEqual([url]);
  await expect(page.locator("#demo-publication-link-panel").getByRole("status")).toContainText(/copie en cours/i);
  await expect(page.getByText("Lien copié.", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { __awResolvePublicationClipboard: () => void }).__awResolvePublicationClipboard());
  await expect(page.locator("#demo-publication-link-panel").getByRole("status")).toContainText(/copié/i);
  expect(await page.evaluate(() => (window as typeof window & { __awPublicationClipboard: { settled: boolean } }).__awPublicationClipboard.settled)).toBe(true);
});

for (const mode of ["missing", "denied"] as const) {
  test(`${mode} clipboard access selects the full URL for manual copy`, async ({ page, context }) => {
    await installClipboardStub(context, mode);
    await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
    await openAcceptedDetail(page);
    await openPublicationCreator(page);
    await page.locator("#demo-publication-link-copy").click();
    await expect(page.locator("#demo-publication-link-panel").getByRole("status")).toContainText(/sélectionné|copi.*manuellement/i);
    const selected = await page.locator("#demo-publication-link-url").evaluate((input) => {
      const field = input as HTMLInputElement;
      return field.selectionStart === 0 && field.selectionEnd === field.value.length && document.activeElement === field;
    });
    expect(selected).toBe(true);
  });
}

for (const invalidation of ["close", "navigation", "replacement"] as const) {
  test(`a deferred clipboard completion cannot report success after ${invalidation}`, async ({ page, context }) => {
    await installClipboardStub(context, "deferred");
    await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
    await openAcceptedDetail(page);
    await openPublicationCreator(page);
    await page.locator("#demo-publication-link-copy").click();
    if (invalidation === "close") {
      await page.locator("#demo-publication-link-close").click();
      await expect(page.locator("#demo-publication-link-start")).toBeFocused();
    } else if (invalidation === "navigation") {
      await page.getByRole("button", { name: "Recherche", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
    } else {
      await page.evaluate((listingId) => { window.location.hash = `detail/${listingId}`; }, publicationIds.second);
      await expect(page.locator("#demo-publication-link-start")).toBeVisible();
    }
    await page.evaluate(() => (window as typeof window & { __awResolvePublicationClipboard: () => void }).__awResolvePublicationClipboard());
    await expect(page.getByText("Lien copié.", { exact: true })).toHaveCount(0);
  });
}

test("the inline creator order, keyboard flow, touch targets and WCAG 2.2 AA remain valid", async ({ page }) => {
  await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
  await openAcceptedDetail(page);
  const order = await page.locator(".demo-detail").evaluate((detail) => {
    const snapshot = detail.querySelector(".demo-detail-snapshot");
    const creator = detail.querySelector("#demo-publication-link-start");
    const evidence = detail.querySelector(".demo-evidence");
    if (!snapshot || !creator || !evidence) throw new Error("Expected detail snapshot, creator and evidence");
    return Boolean(snapshot.compareDocumentPosition(creator) & Node.DOCUMENT_POSITION_FOLLOWING)
      && Boolean(creator.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await page.locator("#demo-publication-link-start").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demo-publication-link-url")).toBeFocused();
  const targets = await page.locator("#demo-publication-link-panel button, #demo-publication-link-panel input").evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  }));
  expect(targets.every((target) => target.height >= 44 && target.width >= 44)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

test("publication creator stays readable across the bounded viewport and theme matrix", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.goto(`/demo?publication-link-visual=${width}-${theme}#detail/${publicationIds.max}`);
      await page.getByLabel("Apparence").selectOption(theme);
      await expect(page.locator("#demo-publication-link-start")).toBeVisible();
      const field = await openPublicationCreator(page);
      await expect(field).toHaveValue(new RegExp(`#detail/${publicationIds.max}$`, "u"));
      await capture(page, testInfo, `demo-publication-link-${width}-${theme}-${browserName}.png`);
    }
  }
});

test("reduced motion and 200 percent platform or Verdana text keep the publication creator operable", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
  for (const font of ["platform", "Verdana"] as const) {
    await page.goto(`/demo?publication-link-text=${font.toLowerCase()}#detail/${publicationIds.first}`);
    if (font === "Verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await openPublicationCreator(page);
    await expectNoHorizontalOverflow(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await capture(page, testInfo, `demo-publication-link-390-light-text-200-${browserName}-${font.toLowerCase()}.png`);
    await page.locator("#demo-publication-link-close").click();
    await expect(page.locator("#demo-publication-link-start")).toBeFocused();
  }
});

test("creator feedback reaches the next animation-frame callback within 100ms under the Chromium mobile lab profile", async ({ browser, browserName, context, page }, testInfo) => {
  if (browserName !== "chromium") {
    await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
    await openAcceptedDetail(page);
    await openPublicationCreator(page);
    return;
  }
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await interceptDetails(page, (route, listingId) => fulfillJson(route, acceptedDetail(listingId)));
  await openAcceptedDetail(page);
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.locator("#demo-publication-link-start").evaluate((button) => {
    button.addEventListener("click", () => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (document.querySelector("#demo-publication-link-url") === null) return;
        observer.disconnect();
        requestAnimationFrame(() => {
          Object.defineProperty(window, "__awPublicationCreateDuration", { configurable: true, value: performance.now() - started });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  });
  await page.locator("#demo-publication-link-start").click();
  await page.waitForFunction(() => typeof (window as typeof window & { __awPublicationCreateDuration?: number }).__awPublicationCreateDuration === "number");
  const durationMs = await page.evaluate(() => (window as typeof window & { __awPublicationCreateDuration: number }).__awPublicationCreateDuration);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const report = {
    browserVersion: browser.version(),
    budgetMaxMs: 100,
    caveat: "Bounded synthetic Chromium lab measurement under 4x CPU slowdown, from click to creator DOM state to the next animation-frame callback. Clipboard and OS permission latency are excluded; this is not physical paint, production INP or physical-device evidence.",
    collectedAt: new Date().toISOString(),
    host: { architecture: arch(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
    profile: { cpuSlowdownMultiplier: 4, viewport: { width: 390, height: 844 } },
    sample: { durationMs, operation: "create" },
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await testInfo.attach("demo-publication-link-feedback-performance.json", { body: Buffer.from(serialized), contentType: "application/json" });
  if (process.env.AW_SCREENSHOT_DIR) {
    await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
    await writeFile(path.join(process.env.AW_SCREENSHOT_DIR, "demo-publication-link-feedback-performance.json"), serialized);
  }
  expect(durationMs).toBeLessThanOrEqual(100);
});
