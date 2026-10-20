import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import path from "node:path";

import {
  demoFixtureVersion,
  demoRelease,
  descriptionFields,
  fulfillJson,
  mockDemoCatalog,
  v2Envelope,
  v2Error,
  v2Response,
} from "./demo-v2-fixtures";

const favoritesKey = "auto-world.demo.favorites.v1";
const savedSearchesKey = "auto-world.demo.saved-searches.v1";
const fragmentPrefix = "#comparison-link/v1/";
const comparisonIds = ["lst_comparison-link-01", "lst_comparison-link-02", "lst_comparison-link-03"] as const;

type Availability = "active" | "withdrawn" | "deleted" | "missing";
type DetailState = "complete" | "partial" | "stale";

function comparisonHash(ids: readonly string[] = comparisonIds.slice(0, 2)) {
  return `${fragmentPrefix}${encodeURIComponent(JSON.stringify(ids))}`;
}

function decodeComparisonUrl(value: string): readonly string[] {
  const hash = new URL(value).hash;
  expect(hash.startsWith(fragmentPrefix)).toBe(true);
  return JSON.parse(decodeURIComponent(hash.slice(fragmentPrefix.length))) as readonly string[];
}

function publication(listingId: string, index: number, observedAt: string, availability: Availability = "active", historyConflict = false) {
  const priceId = `ev_${String(index * 10 + 1).padStart(64, "0")}`;
  const mileageId = `ev_${String(index * 10 + 2).padStart(64, "0")}`;
  const price = { amountMinor: 3_100_000 + index, currency: "EUR" };
  const mileage = { amount: 41_000 + index, unit: "km" };
  return {
    listingId,
    availability,
    price: { status: "observed", value: price, evidenceId: priceId },
    mileage: { status: "observed", value: mileage, evidenceId: mileageId },
    evidence: [
      ...(historyConflict ? [{ evidenceId: `ev_${String(index * 10).padStart(64, "0")}`, field: "price", observedAt: new Date(Date.parse(observedAt) - 1_000).toISOString(), confidenceBps: 5_000, value: { ...price, amountMinor: 1 } }] : []),
      { evidenceId: priceId, field: "price", observedAt, confidenceBps: 9_000, value: price },
      { evidenceId: mileageId, field: "mileage", observedAt, confidenceBps: 8_500, value: mileage },
    ],
    ...descriptionFields(index, { contradictory: historyConflict }),
  };
}

function recentSameMinuteInstants(): readonly [string, string] {
  const now = new Date();
  const minute = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes());
  if (now.getUTCSeconds() >= 5) {
    return [new Date(minute + (now.getUTCSeconds() - 4) * 1_000 + 125).toISOString(), new Date(minute + (now.getUTCSeconds() - 2) * 1_000 + 875).toISOString()];
  }
  return [new Date(minute - 4_000 + 125).toISOString(), new Date(minute - 2_000 + 875).toISOString()];
}

function detailEnvelope(listingId: string, index: number, options: {
  readonly availability?: Availability;
  readonly dataAsOf?: string;
  readonly fixtureVersion?: string;
  readonly historyConflict?: boolean;
  readonly state?: DetailState;
  readonly taxonomyRelease?: { readonly catalogId: string; readonly releaseId: string; readonly revision: number };
} = {}) {
  const state = options.state ?? "complete";
  const dataAsOf = options.dataAsOf ?? new Date().toISOString();
  const requestedRelease = options.taxonomyRelease ?? demoRelease;
  const original = publication(listingId, index, dataAsOf, options.availability, options.historyConflict);
  const item = requestedRelease === demoRelease || original.description.status === "unavailable" ? original : {
    ...original,
    description: { ...original.description, value: { ...original.description.value, release: requestedRelease } },
    descriptionEvidence: original.descriptionEvidence.map((evidence) => ({ ...evidence, value: { ...evidence.value, release: requestedRelease } })),
  };
  const response = v2Response([item], {
    dataAsOf,
    fixture: options.fixtureVersion,
    state,
    total: 1,
  });
  return v2Envelope({ ...response, taxonomyRelease: requestedRelease });
}

async function waitUntilReady(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
}

async function openAcceptedComparison(page: Page, count = 2) {
  const observedAt = new Date().toISOString();
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", (route) => fulfillJson(route, v2Envelope(v2Response(
    comparisonIds.map((listingId, index) => publication(listingId, index + 1, observedAt)),
    { dataAsOf: observedAt },
  ))));
  await page.goto("/demo");
  await waitUntilReady(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  for (let index = 0; index < count; index += 1) await page.locator(`#demo-result-compare-${index}`).click();
  await page.locator("#demo-comparison-open").click();
  await expect(page.getByRole("heading", { name: "Comparer", exact: true })).toBeFocused();
}

async function openComparisonCreator(page: Page) {
  await page.locator("#demo-comparison-link-start").click();
  const field = page.locator("#demo-comparison-link-url");
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("readonly", "");
  await expect(field).toBeFocused();
  return field;
}

async function openReceivedComparison(page: Page, ids: readonly string[] = comparisonIds.slice(0, 2)) {
  await page.goto(`/demo${comparisonHash(ids)}`);
  await waitUntilReady(page);
  await expect(page.getByRole("heading", { name: "Comparaison reçue", exact: true })).toBeFocused();
  await expect(page.locator("#demo-comparison-link-load")).toBeVisible();
}

async function routeSuccessfulDetails(page: Page, ids: readonly string[] = comparisonIds.slice(0, 2), options: Parameters<typeof detailEnvelope>[2] = {}) {
  await mockDemoCatalog(page);
  const calls: string[] = [];
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    calls.push(listingId);
    return fulfillJson(route, detailEnvelope(listingId, ids.indexOf(listingId) + 1, options));
  });
  return calls;
}

async function installClipboardStub(context: BrowserContext, mode: "success" | "denied" | "missing" | "deferred") {
  await context.addInitScript((selectedMode) => {
    const state = { calls: [] as string[], settled: false };
    Object.defineProperty(window, "__awComparisonClipboard", { configurable: true, value: state });
    if (selectedMode === "missing") {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      return;
    }
    let resolveDeferred: (() => void) | undefined;
    const deferred = selectedMode === "deferred" ? new Promise<void>((resolve) => { resolveDeferred = resolve; }) : undefined;
    Object.defineProperty(window, "__awResolveComparisonClipboard", { configurable: true, value: () => resolveDeferred?.() });
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
      if (element.closest(".demo-comparison-scroll") && !element.classList.contains("demo-comparison-scroll")) return [];
      if (bounds.width === 0 || bounds.height === 0 || bounds.right <= viewportWidth + 0.5) return [];
      return [{ selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`, right: Math.round(bounds.right * 10) / 10 }];
    });
    return { documentWidth: document.documentElement.scrollWidth, offenders, viewportWidth };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({ documentWidth: report.viewportWidth, offenders: [], viewportWidth: report.viewportWidth });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expectNoHorizontalOverflow(page);
  const file = process.env.AW_SCREENSHOT_DIR ? path.join(process.env.AW_SCREENSHOT_DIR, name) : testInfo.outputPath(name);
  if (process.env.AW_SCREENSHOT_DIR) await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
}

test("accepted two and three publication comparisons expose an ordered current-runtime pointer", async ({ page, browserName }, testInfo) => {
  await openAcceptedComparison(page, 2);
  await expect(page.locator("#demo-comparison-link-start")).toBeVisible();
  const url = await (await openComparisonCreator(page)).inputValue();
  expect(decodeComparisonUrl(url)).toEqual(comparisonIds.slice(0, 2));
  const parsed = new URL(url);
  expect(parsed.pathname).toBe("/demo");
  expect(parsed.search).toBe("");
  await expect(page.locator("#demo-comparison-link-panel")).toContainText(/ne fige|valeurs actuelles|réexamin/i);
  await expect(page.locator("#demo-comparison-link-panel")).toContainText(/ordinateur|local/i);
  await capture(page, testInfo, `demo-comparison-link-creator-2-${browserName}.png`);
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await page.locator("#demo-result-compare-2").click();
  await page.locator("#demo-comparison-open").click();
  expect(decodeComparisonUrl(await (await openComparisonCreator(page)).inputValue())).toEqual(comparisonIds);
  await capture(page, testInfo, `demo-comparison-link-creator-3-${browserName}.png`);
});

test("comparison pointer creation stays unavailable below two accepted publications", async ({ page }) => {
  await openAcceptedComparison(page, 2);
  await page.locator("#demo-comparison-remove-1").click();
  await expect(page.locator("#demo-comparison-link-start")).toHaveCount(0);
});

test("comparison pointer copy reports success only after the clipboard write resolves", async ({ page, context }) => {
  await installClipboardStub(context, "deferred");
  await openAcceptedComparison(page);
  const url = await (await openComparisonCreator(page)).inputValue();
  await page.locator("#demo-comparison-link-copy").click();
  expect(await page.evaluate(() => (window as typeof window & { __awComparisonClipboard: { calls: string[] } }).__awComparisonClipboard.calls)).toEqual([url]);
  await expect(page.locator("#demo-comparison-link-panel").getByRole("status")).toContainText(/copie en cours/i);
  await expect(page.getByText("Lien copié.", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { __awResolveComparisonClipboard: () => void }).__awResolveComparisonClipboard());
  await expect(page.locator("#demo-comparison-link-panel").getByRole("status")).toContainText(/copié/i);
});

for (const mode of ["missing", "denied"] as const) {
  test(`${mode} comparison clipboard access selects the full URL for manual copy`, async ({ page, context }) => {
    await installClipboardStub(context, mode);
    await openAcceptedComparison(page);
    await openComparisonCreator(page);
    await page.locator("#demo-comparison-link-copy").click();
    await expect(page.locator("#demo-comparison-link-panel").getByRole("status")).toContainText(/sélectionné|copi.*manuellement/i);
    expect(await page.locator("#demo-comparison-link-url").evaluate((input) => {
      const field = input as HTMLInputElement;
      return field.selectionStart === 0 && field.selectionEnd === field.value.length && document.activeElement === field;
    })).toBe(true);
  });
}

for (const invalidation of ["close", "navigation", "selection replacement"] as const) {
  test(`a deferred comparison clipboard completion cannot repaint after ${invalidation}`, async ({ page, context }) => {
    await installClipboardStub(context, "deferred");
    await openAcceptedComparison(page);
    await openComparisonCreator(page);
    await page.locator("#demo-comparison-link-copy").click();
    if (invalidation === "close") {
      await page.locator("#demo-comparison-link-close").click();
      await expect(page.locator("#demo-comparison-link-start")).toBeFocused();
    } else if (invalidation === "navigation") {
      await page.evaluate((hash) => { window.location.hash = hash; }, comparisonHash());
      await expect(page.getByRole("heading", { name: "Comparaison reçue" })).toBeVisible();
    } else {
      await page.locator("#demo-comparison-remove-1").click();
      await expect(page.locator("#demo-comparison-link-start")).toHaveCount(0);
    }
    await page.evaluate(() => (window as typeof window & { __awResolveComparisonClipboard: () => void }).__awResolveComparisonClipboard());
    await expect(page.getByText("Lien copié.", { exact: true })).toHaveCount(0);
  });
}

test("opening a comparison pointer has no detail, search or storage side effect before explicit load", async ({ page, browserName }, testInfo) => {
  await page.addInitScript(({ favorites, saved }) => {
    localStorage.setItem(favorites, JSON.stringify({ schemaVersion: 1, listingIds: [] }));
    localStorage.setItem(saved, JSON.stringify({ schemaVersion: 1, searches: [] }));
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { writes.push(key); return original.call(this, key, value); };
    Object.defineProperty(window, "__awComparisonStorageWrites", { configurable: true, value: writes });
  }, { favorites: favoritesKey, saved: savedSearchesKey });
  const requests: Array<{ method: string; pathname: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/demo/")) requests.push({ method: request.method(), pathname: url.pathname });
  });
  await mockDemoCatalog(page);
  await openReceivedComparison(page);
  expect(requests.filter(({ pathname }) => pathname.includes("/listings/") || pathname.endsWith("/search"))).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __awComparisonStorageWrites: string[] }).__awComparisonStorageWrites)).toEqual([]);
  await expect(page.locator('[data-comparison-slot="0"]')).toHaveAttribute("data-status", "idle");
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator("#demo-received-comparison")).toContainText(/références de publications synthétiques, sans identifier de véhicules réels/i);
  const idleMetadataStartsBelowLabel = await page.locator('[data-comparison-slot="0"]').evaluate((slot) => {
    const label = slot.querySelector("strong")?.getBoundingClientRect();
    const metadata = slot.querySelector(".demo-comparison-meta")?.getBoundingClientRect();
    return label !== undefined && metadata !== undefined && metadata.top >= label.bottom;
  });
  expect(idleMetadataStartsBelowLabel).toBe(true);
  await capture(page, testInfo, `demo-comparison-link-received-idle-${browserName}.png`);
});

test("explicit load reads every requested publication concurrently and renders only the complete bundle", async ({ page, browserName }, testInfo) => {
  await mockDemoCatalog(page);
  let active = 0;
  let maximumActive = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    calls.push(listingId);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await gate;
    active -= 1;
    await fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1));
  });
  await openReceivedComparison(page, comparisonIds);
  await page.locator("#demo-comparison-link-load").click();
  await expect.poll(() => calls.length).toBe(3);
  await expect(page.locator('[data-comparison-slot][data-status="loading"]')).toHaveCount(3);
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await capture(page, testInfo, `demo-comparison-link-loading-3-${browserName}.png`);
  release();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  expect(calls).toEqual(comparisonIds);
  expect(maximumActive).toBe(3);
});

test("received comparison preserves distinct same-minute response instants and projection states per column", async ({ page }) => {
  const [firstInstant, secondInstant] = recentSameMinuteInstants();
  const staleInstant = new Date(Date.now() - 120_000).toISOString();
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const second = listingId === comparisonIds[1];
    const third = listingId === comparisonIds[2];
    return fulfillJson(route, detailEnvelope(listingId, third ? 3 : second ? 2 : 1, {
      dataAsOf: third ? staleInstant : second ? secondInstant : firstInstant,
      state: third ? "stale" : second ? "partial" : "complete",
    }));
  });
  await openReceivedComparison(page, comparisonIds);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  const firstSlot = page.locator('[data-comparison-slot="0"]');
  const secondSlot = page.locator('[data-comparison-slot="1"]');
  const thirdSlot = page.locator('[data-comparison-slot="2"]');
  await expect(firstSlot.locator("time")).toHaveAttribute("datetime", firstInstant);
  await expect(secondSlot.locator("time")).toHaveAttribute("datetime", secondInstant);
  await expect(thirdSlot.locator("time")).toHaveAttribute("datetime", staleInstant);
  const firstText = await firstSlot.locator("time").innerText();
  const secondText = await secondSlot.locator("time").innerText();
  expect(firstText).toMatch(/:\d{2}[,.]\d{3}/u);
  expect(secondText).toMatch(/:\d{2}[,.]\d{3}/u);
  expect(firstText).not.toBe(secondText);
  await expect(firstSlot).toContainText(/complète/i);
  await expect(secondSlot).toContainText(/partielle/i);
  await expect(thirdSlot).toContainText(/ancienne/i);
  await expect(page.locator("#demo-received-comparison")).not.toContainText(/instant commun|même instant/i);
});

test("successful ended publications remain valid comparison columns", async ({ page }) => {
  await mockDemoCatalog(page);
  const states: readonly Availability[] = ["withdrawn", "deleted", "missing"];
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const index = comparisonIds.indexOf(listingId as typeof comparisonIds[number]);
    return fulfillJson(route, detailEnvelope(listingId, index + 1, { availability: states[index] }));
  });
  await openReceivedComparison(page, comparisonIds);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await expect(page.locator('[data-comparison-field="availability"]')).toContainText(/retirée/i);
  await expect(page.locator('[data-comparison-field="availability"]')).toContainText(/supprimée/i);
  await expect(page.locator('[data-comparison-field="availability"]')).toContainText(/introuvable/i);
});

test("one failed requested publication keeps every slot visible and retries the whole bundle", async ({ page, browserName }, testInfo) => {
  await mockDemoCatalog(page);
  let attempt = 0;
  const calls: string[] = [];
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    calls.push(listingId);
    if (attempt === 0 && listingId === comparisonIds[1]) return fulfillJson(route, v2Error("not_found"), 404);
    return fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1));
  });
  await openReceivedComparison(page, comparisonIds);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator('[data-comparison-slot="1"]')).toHaveAttribute("data-status", "error");
  await expect(page.locator("[data-comparison-slot]")).toHaveCount(3);
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await capture(page, testInfo, `demo-comparison-link-incomplete-404-${browserName}.png`);
  attempt += 1;
  await page.locator("#demo-comparison-link-reread").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  expect(calls).toEqual([...comparisonIds, ...comparisonIds]);
});

test("slow comparison reads expose stable skeleton feedback after 750ms", async ({ page }) => {
  await mockDemoCatalog(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    await gate;
    await fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1));
  });
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator("#demo-comparison-link-loading")).toBeVisible({ timeout: 2_000 });
  await expect(page.locator("#demo-comparison-link-loading")).toContainText(/lecture|chargement/i);
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  release();
  await expect(page.locator("#demo-comparison-link-loading")).toHaveCount(0);
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
});

test("comparison detail reads fail explicitly at the fixed fifteen-second deadline", async ({ page }) => {
  await page.clock.install();
  await mockDemoCatalog(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    await gate;
    await fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1)).catch(() => {});
  });
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await page.clock.fastForward(15_001);
  await expect(page.locator('[data-comparison-slot][data-status="error"]')).toHaveCount(2);
  await expect(page.locator("#demo-received-comparison")).toContainText("La lecture a dépassé le délai autorisé.");
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  release();
  await expect(page.locator('[data-comparison-slot][data-status="error"]')).toHaveCount(2);
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await page.unroute("**/api/demo/v2/listings/*");
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    return fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1));
  });
  await page.locator("#demo-comparison-link-reread").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
});

test("an initial offline comparison load keeps every slot recoverable by explicit reread", async ({ page, context }) => {
  await mockDemoCatalog(page);
  await openReceivedComparison(page);
  await context.setOffline(true);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator('[data-comparison-slot][data-status="error"]')).toHaveCount(2);
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator("#demo-received-comparison")).toContainText(/hors connexion|reconnect/i);
  await context.setOffline(false);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    return fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1));
  });
  await page.locator("#demo-comparison-link-reread").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
});

test("a mismatched detail response never substitutes another requested publication", async ({ page }) => {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const requested = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const returned = requested === comparisonIds[1] ? comparisonIds[0] : requested;
    return fulfillJson(route, detailEnvelope(returned, 1));
  });
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator('[data-comparison-slot="1"]')).toHaveAttribute("data-status", "error");
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator("#demo-received-comparison")).not.toContainText(comparisonIds[0]);
});

for (const mismatch of ["fixture", "release"] as const) {
  test(`mixed ${mismatch} responses suppress the table and ask for a complete reread`, async ({ page }) => {
    await mockDemoCatalog(page);
    await page.route("**/api/demo/v2/listings/*", (route) => {
      const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
      const second = listingId === comparisonIds[1];
      return fulfillJson(route, detailEnvelope(listingId, second ? 2 : 1, {
        fixtureVersion: second && mismatch === "fixture" ? "comparison-links-other" : demoFixtureVersion,
        taxonomyRelease: second && mismatch === "release" ? { ...demoRelease, revision: demoRelease.revision + 1 } : demoRelease,
      }));
    });
    await openReceivedComparison(page);
    await page.locator("#demo-comparison-link-load").click();
    await expect(page.locator("#demo-received-comparison")).toHaveAttribute("data-status", "incompatible");
    await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
    await expect(page.locator("#demo-comparison-link-reread")).toBeVisible();
    await expect(page.locator("main")).toContainText(/relire|relecture|ensemble cohérent/i);
  });
}

test("catalogue mismatch hides authored descriptions but preserves observed numeric comparison", async ({ page }) => {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    return fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1, { fixtureVersion: "comparison-links-catalog-mismatch" }));
  });
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await expect(page.locator('[data-comparison-field="price"]')).toContainText(/31.?000/);
  await expect(page.locator('[data-comparison-field="mileage"]')).toContainText(/41.?00/);
  await expect(page.locator('[data-comparison-field="make"]')).toContainText(/indisponible|incompl/i);
  await expect(page.locator("main")).not.toContainText("make_ui_");
});

test("received comparison retains the warning when observation or authored history varies", async ({ page }) => {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    return fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1, { historyConflict: listingId === comparisonIds[0] }));
  });
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await expect(page.locator("#demo-received-comparison")).toContainText(/plusieurs valeurs et déclarations|historiques?/i);
});

test("reread clears the accepted table before the replacement batch settles", async ({ page }) => {
  const calls = await routeSuccessfulDetails(page);
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.unroute("**/api/demo/v2/listings/*");
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    calls.push(listingId);
    await gate;
    await fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1));
  });
  await page.locator("#demo-comparison-link-reread").click();
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator('[data-comparison-slot][data-status="loading"]')).toHaveCount(2);
  release();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
});

test("a synchronous duplicate load click starts only one detail batch", async ({ page }) => {
  const calls = await routeSuccessfulDetails(page);
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  expect(calls).toEqual(comparisonIds.slice(0, 2));
});

test("hash replacement aborts an old detail batch and late responses cannot repaint the new screen", async ({ page }) => {
  await mockDemoCatalog(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    await gate;
    await fulfillJson(route, detailEnvelope(listingId, 1)).catch(() => {});
  });
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator('[data-comparison-slot][data-status="loading"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Retour à la recherche", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  release();
  await expect(page.locator("#demo-received-comparison")).toHaveCount(0);
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
});

test("comparison-link navigation cancels a pending source search before its late commit", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    await gate;
    const observedAt = new Date().toISOString();
    await fulfillJson(route, v2Envelope(v2Response([publication(comparisonIds[0], 1, observedAt)], { dataAsOf: observedAt }))).catch(() => {});
  });
  await page.goto("/demo");
  await waitUntilReady(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recherche…", exact: true })).toBeVisible();
  await page.evaluate((hash) => { window.location.hash = hash; }, comparisonHash());
  await expect(page.getByRole("heading", { name: "Comparaison reçue" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "Comparaison reçue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toHaveCount(0);
});

test("an accepted received table remains visible offline without automatic reread", async ({ page, context }) => {
  const calls = await routeSuccessfulDetails(page);
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator("#demo-received-comparison")).toContainText(/hors connexion/i);
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await context.setOffline(false);
  await page.waitForTimeout(100);
  expect(calls).toHaveLength(2);
});

test("back, forward and reload return to an unloaded received comparison", async ({ page }) => {
  await routeSuccessfulDetails(page);
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await page.getByRole("button", { name: "Retour à la recherche", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Comparaison reçue" })).toBeVisible();
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await page.goForward();
  await page.goBack();
  await page.reload();
  await expect(page.locator("#demo-comparison-link-load")).toBeVisible();
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
});

for (const [label, hash, safeCopy] of [
  ["malformed", "#comparison-link/v1/%E0%A4%A", /invalide ou incomplet/i],
  ["future", `#comparison-link/v2/${encodeURIComponent(JSON.stringify(comparisonIds.slice(0, 2)))}`, /version non prise en charge/i],
  ["oversized", `#comparison-link/v1/${"x".repeat(1_025)}`, /invalide ou incomplet/i],
] as const) {
  test(`${label} comparison links show fixed recovery without echoing or detail reads`, async ({ page, browserName }, testInfo) => {
    let details = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname.includes("/listings/")) details += 1; });
    await mockDemoCatalog(page);
    await page.goto(`/demo${hash}`);
    await expect(page.getByRole("heading", { name: "Comparaison reçue", exact: true })).toBeVisible();
    await expect(page.getByText(safeCopy)).toBeVisible();
    await expect(page.locator("main")).not.toContainText("%E0%A4%A");
    await expect(page.locator("main")).not.toContainText("x".repeat(80));
    expect(details).toBe(0);
    if (label !== "oversized") await capture(page, testInfo, `demo-comparison-link-${label}-${browserName}.png`);
  });
}

test("a disabled runtime ignores comparison links and performs zero demo API requests", async ({ page }, testInfo) => {
  const disabledBase = (testInfo.config.metadata as { readonly demoDisabledBaseURL?: unknown }).demoDisabledBaseURL;
  if (typeof disabledBase !== "string") throw new Error("demoDisabledBaseURL metadata is required");
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) requests.push(request.url()); });
  await page.goto(`${disabledBase}/demo${comparisonHash()}`);
  await waitUntilReady(page);
  await expect(page.getByRole("heading", { name: "Comparaison reçue" })).toHaveCount(0);
  await expect(page.locator("#demo-comparison-link-load, #demo-comparison-link-start")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("received comparison controls meet keyboard, touch target and WCAG 2.2 AA requirements", async ({ page }) => {
  await routeSuccessfulDetails(page);
  await openReceivedComparison(page);
  let reachedLoad = false;
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    reachedLoad = await page.locator("#demo-comparison-link-load").evaluate((element) => document.activeElement === element);
    if (reachedLoad) break;
  }
  expect(reachedLoad).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  const targets = await page.locator("main button, main input, main select, .demo-comparison-scroll").evaluateAll((elements) => elements
    .filter((element) => getComputedStyle(element).visibility !== "hidden")
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width };
    }));
  expect(targets.every((target) => target.height >= 44 && target.width >= 44)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

test("received comparison remains readable across the required viewport and theme matrix", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  await routeSuccessfulDetails(page, comparisonIds);
  for (const count of [2, 3] as const) {
    await openReceivedComparison(page, comparisonIds.slice(0, count));
    await page.locator("#demo-comparison-link-load").click();
    await expect(page.locator(".demo-comparison-table")).toBeVisible();
    for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      for (const theme of ["light", "dark"] as const) {
        await page.getByLabel("Apparence").selectOption(theme);
        await expect(page.locator("html")).toHaveAttribute("data-aw-theme", theme);
        await capture(page, testInfo, `demo-comparison-link-${width}-${theme}-${count}-${browserName}.png`);
      }
      if (width === 320) {
        const region = page.locator(".demo-comparison-scroll");
        await region.focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
        await region.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
        const lastColumnReachable = await region.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          const last = node.querySelector("thead th:last-child")?.getBoundingClientRect();
          return last !== undefined && last.left < bounds.right && last.right <= bounds.right + 1;
        });
        expect(lastColumnReachable).toBe(true);
        await capture(page, testInfo, `demo-comparison-link-${width}-dark-${count}-${browserName}-last-column.png`);
        await region.evaluate((node) => { node.scrollLeft = 0; });
      }
    }
  }
});

test("reduced motion and 200 percent platform or Verdana text keep received comparison operable", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await routeSuccessfulDetails(page);
  await openReceivedComparison(page);
  await page.locator("#demo-comparison-link-load").click();
  for (const font of ["platform", "verdana"] as const) {
    if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const region = page.locator(".demo-comparison-scroll");
    await region.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    const titleFirstWordRects = await page.getByRole("heading", { name: "Comparaison reçue", exact: true }).evaluate((heading) => {
      const text = heading.firstChild;
      if (!(text instanceof Text)) throw new Error("Expected a text heading");
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, "Comparaison".length);
      return range.getClientRects().length;
    });
    expect(titleFirstWordRects).toBe(1);
    await capture(page, testInfo, `demo-comparison-link-390-light-text-200-${browserName}-${font}.png`);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  }
});

test("comparison create and load feedback reach the next animation frame within 100ms at 4x CPU", async ({ browser, browserName, context, page }, testInfo) => {
  if (browserName !== "chromium") {
    await openAcceptedComparison(page);
    await openComparisonCreator(page);
    return;
  }
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAcceptedComparison(page);
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.locator("#demo-comparison-link-start").evaluate((button) => {
    button.addEventListener("click", () => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (document.querySelector("#demo-comparison-link-url") === null) return;
        observer.disconnect();
        requestAnimationFrame(() => { Object.defineProperty(window, "__awComparisonCreateDuration", { configurable: true, value: performance.now() - started }); });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  });
  await page.locator("#demo-comparison-link-start").click();
  await page.waitForFunction(() => typeof (window as typeof window & { __awComparisonCreateDuration?: number }).__awComparisonCreateDuration === "number");
  const createMs = await page.evaluate(() => (window as typeof window & { __awComparisonCreateDuration: number }).__awComparisonCreateDuration);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await routeSuccessfulDetails(page);
  await page.goto(`/demo${comparisonHash()}`);
  await expect(page.locator("#demo-comparison-link-load")).toBeVisible();
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.locator("#demo-comparison-link-load").evaluate((button) => {
    button.addEventListener("click", () => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-comparison-slot][data-status="loading"]') === null) return;
        observer.disconnect();
        requestAnimationFrame(() => { Object.defineProperty(window, "__awComparisonLoadDuration", { configurable: true, value: performance.now() - started }); });
      });
      observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["data-status"] });
    }, { once: true });
  });
  await page.locator("#demo-comparison-link-load").click();
  await page.waitForFunction(() => typeof (window as typeof window & { __awComparisonLoadDuration?: number }).__awComparisonLoadDuration === "number");
  const loadMs = await page.evaluate(() => (window as typeof window & { __awComparisonLoadDuration: number }).__awComparisonLoadDuration);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(createMs).toBeLessThanOrEqual(100);
  expect(loadMs).toBeLessThanOrEqual(100);

  const report = {
    browserVersion: browser.version(),
    budgetMaxMs: 100,
    caveat: "Bounded synthetic Chromium lab measurement under 4x CPU slowdown, from click to immediate DOM feedback and the next animation-frame callback. Network, clipboard, OS permission and physical paint latency are excluded.",
    collectedAt: new Date().toISOString(),
    host: { architecture: arch(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
    profile: { cpuSlowdownMultiplier: 4, viewport: { width: 390, height: 844 } },
    samples: { createMs, loadMs },
  };
  const file = process.env.AW_SCREENSHOT_DIR
    ? path.join(process.env.AW_SCREENSHOT_DIR, "demo-comparison-link-performance.json")
    : testInfo.outputPath("demo-comparison-link-performance.json");
  if (process.env.AW_SCREENSHOT_DIR) await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
});
