import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import path from "node:path";

import {
  demoFixtureVersion,
  descriptionFields,
  fulfillJson,
  mockDemoCatalog,
  v2Envelope,
  v2Error,
  v2Response,
} from "./demo-v2-fixtures";

const savedComparisonsKey = "auto-world.demo.saved-comparisons.v1";
const savedSearchesKey = "auto-world.demo.saved-searches.v1";
const favoritesKey = "auto-world.demo.favorites.v1";
const fragmentPrefix = "#comparison-link/v1/";
const comparisonIds = ["lst_saved-comparison-01", "lst_saved-comparison-02", "lst_saved-comparison-03"] as const;

type Availability = "active" | "withdrawn" | "deleted" | "missing";

function comparisonHash(ids: readonly string[] = comparisonIds.slice(0, 2)) {
  return `${fragmentPrefix}${encodeURIComponent(JSON.stringify(ids))}`;
}

function storedComparison(name: string, ids: readonly string[] = comparisonIds.slice(0, 2)) {
  return { name, fragment: comparisonHash(ids) };
}

function storedBytes(comparisons: readonly ReturnType<typeof storedComparison>[]) {
  return JSON.stringify({ schemaVersion: 1, comparisons });
}

async function seedSavedComparisons(context: BrowserContext, comparisons: readonly ReturnType<typeof storedComparison>[]) {
  await context.addInitScript(
    ({ key, bytes }) => localStorage.setItem(key, bytes),
    { key: savedComparisonsKey, bytes: storedBytes(comparisons) },
  );
}

function publication(
  listingId: string,
  index: number,
  observedAt: string,
  options: { readonly availability?: Availability; readonly priceMinor?: number } = {},
) {
  const priceId = `ev_${String(index * 10 + 1).padStart(64, "0")}`;
  const mileageId = `ev_${String(index * 10 + 2).padStart(64, "0")}`;
  const price = { amountMinor: options.priceMinor ?? 3_100_000 + index, currency: "EUR" };
  const mileage = { amount: 41_000 + index, unit: "km" };
  return {
    listingId,
    availability: options.availability ?? "active",
    price: { status: "observed", value: price, evidenceId: priceId },
    mileage: { status: "observed", value: mileage, evidenceId: mileageId },
    evidence: [
      { evidenceId: priceId, field: "price", observedAt, confidenceBps: 9_000, value: price },
      { evidenceId: mileageId, field: "mileage", observedAt, confidenceBps: 8_500, value: mileage },
    ],
    ...descriptionFields(index),
  };
}

function detailEnvelope(
  listingId: string,
  index: number,
  options: {
    readonly availability?: Availability;
    readonly fixtureVersion?: string;
    readonly priceMinor?: number;
  } = {},
) {
  const dataAsOf = new Date().toISOString();
  return v2Envelope(v2Response(
    [publication(listingId, index, dataAsOf, options)],
    { dataAsOf, fixture: options.fixtureVersion, total: 1 },
  ));
}

async function waitUntilReady(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
}

async function routeAcceptedResults(page: Page) {
  const observedAt = new Date().toISOString();
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", (route) => fulfillJson(route, v2Envelope(v2Response(
    comparisonIds.map((listingId, index) => publication(listingId, index + 1, observedAt)),
    { dataAsOf: observedAt },
  ))));
}

async function openAcceptedComparison(page: Page, count = 2) {
  await routeAcceptedResults(page);
  await page.goto("/demo");
  await waitUntilReady(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  for (let index = 0; index < count; index += 1) await page.locator(`#demo-result-compare-${index}`).click();
  await page.locator("#demo-comparison-open").click();
  await expect(page.getByRole("heading", { name: "Comparer", exact: true })).toBeFocused();
}

async function saveCurrentComparison(page: Page, name: string) {
  await page.locator("#demo-save-comparison-start").click();
  const field = page.getByLabel("Nom de la comparaison");
  await expect(field).toBeFocused();
  await field.fill(name);
  await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
}

async function openSavedList(page: Page) {
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await expect(page.locator("#demo-saved-comparisons-title")).toBeVisible();
}

async function openReceivedComparison(page: Page, ids: readonly string[] = comparisonIds.slice(0, 2)) {
  await page.goto(`/demo${comparisonHash(ids)}`);
  await waitUntilReady(page);
  await expect(page.getByRole("heading", { name: "Comparaison reçue", exact: true })).toBeFocused();
  await expect(page.locator("#demo-comparison-link-load")).toBeVisible();
}

async function routeSuccessfulDetails(
  page: Page,
  ids: readonly string[] = comparisonIds.slice(0, 2),
  options: { readonly fixtureVersion?: string; readonly priceMinor?: number } = {},
) {
  await mockDemoCatalog(page);
  const calls: string[] = [];
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    calls.push(listingId);
    return fulfillJson(route, detailEnvelope(listingId, ids.indexOf(listingId) + 1, options));
  });
  return calls;
}

async function expectNoPageOverflow(page: Page) {
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
  expect(report, JSON.stringify(report, null, 2)).toEqual({
    documentWidth: report.viewportWidth,
    offenders: [],
    viewportWidth: report.viewportWidth,
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expectNoPageOverflow(page);
  const file = process.env.AW_SCREENSHOT_DIR ? path.join(process.env.AW_SCREENSHOT_DIR, name) : testInfo.outputPath(name);
  if (process.env.AW_SCREENSHOT_DIR) await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

async function captureRecoveryMatrix(page: Page, testInfo: TestInfo, state: string, browserName: string) {
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      await capture(page, testInfo, `demo-saved-comparison-${state}-${width}-${theme}-${browserName}.png`);
    }
  }
}

test("two and three publication comparisons persist in insertion order across reload", async ({ page }) => {
  await openAcceptedComparison(page, 2);
  await saveCurrentComparison(page, "Duo du week-end");
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await page.locator("#demo-result-compare-2").click();
  await page.locator("#demo-comparison-open").click();
  await saveCurrentComparison(page, "Trois finalistes");

  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey))!)).toEqual({
    schemaVersion: 1,
    comparisons: [
      storedComparison("Duo du week-end", comparisonIds.slice(0, 2)),
      storedComparison("Trois finalistes", comparisonIds),
    ],
  });
  await openSavedList(page);
  await page.reload();
  await expect(page.locator(".demo-saved-comparison")).toHaveCount(2);
  await expect(page.locator(".demo-saved-comparison").nth(0)).toContainText("Duo du week-end");
  await expect(page.locator(".demo-saved-comparison").nth(1)).toContainText("Trois finalistes");
  await expect(page.locator(".demo-saved-comparison").nth(0)).toContainText(/2 publications/i);
  await expect(page.locator(".demo-saved-comparison").nth(1)).toContainText(/3 publications/i);
});

test("opening a saved comparison is read-only until explicit load and rereads current values", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("Prix à relire")]);
  await page.addInitScript(({ key }) => {
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === key) writes.push(value);
      return original.call(this, itemKey, value);
    };
    Object.defineProperty(window, "__awSavedComparisonWrites", { configurable: true, value: writes });
  }, { key: savedComparisonsKey });
  const calls = await routeSuccessfulDetails(page, comparisonIds.slice(0, 2), { priceMinor: 4_200_099 });
  let searches = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/demo/v2/search")) searches += 1; });
  await page.goto("/demo#saved");
  await page.evaluate(() => {
    (window as typeof window & { __awSavedComparisonWrites: string[] }).__awSavedComparisonWrites.length = 0;
  });
  const before = await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey);
  await page.locator("#demo-saved-comparison-open-0").click();
  await expect(page.getByRole("heading", { name: "Comparaison enregistrée", exact: true })).toBeFocused();
  expect(page.url()).toContain(comparisonHash());
  expect(calls).toEqual([]);
  expect(searches).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { __awSavedComparisonWrites: string[] }).__awSavedComparisonWrites)).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBe(before);
  expect(before).not.toContain("4200099");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Comparaison reçue", exact: true })).toBeFocused();
  await expect(page.locator("#demo-comparison-link-load")).toBeVisible();
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  expect(calls).toEqual([]);
  expect(searches).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { __awSavedComparisonWrites: string[] }).__awSavedComparisonWrites)).toEqual([]);

  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  expect(calls).toEqual(comparisonIds.slice(0, 2));
  await expect(page.locator('[data-comparison-field="price"]')).toContainText(/42.?000[,.]99/);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBe(before);
});

test("a received comparison can be saved only after its complete compatible bundle is ready", async ({ page }) => {
  await routeSuccessfulDetails(page);
  await openReceivedComparison(page);
  await expect(page.locator("#demo-save-comparison-start")).toHaveCount(0);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await expect(page.locator("#demo-save-comparison-start")).toBeVisible();
  await saveCurrentComparison(page, "Comparaison reçue prête");
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey))!)).toEqual({
    schemaVersion: 1,
    comparisons: [storedComparison("Comparaison reçue prête")],
  });
});

test("changing the local selection destroys a stale save form", async ({ page }) => {
  await openAcceptedComparison(page, 2);
  await page.locator("#demo-save-comparison-start").click();
  await page.getByLabel("Nom de la comparaison").fill("Sélection devenue ancienne");
  await page.locator("#demo-comparison-remove-1").click();
  await expect(page.locator(".demo-save-comparison-form")).toHaveCount(0);
  await expect(page.locator("#demo-save-comparison-start")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
});

test("navigation destroys a stale save form without a late submission", async ({ page }) => {
  await openAcceptedComparison(page, 2);
  await page.locator("#demo-save-comparison-start").click();
  await page.getByLabel("Nom de la comparaison").fill("Brouillon abandonné");
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await expect(page.locator(".demo-save-comparison-form")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
});

for (const transition of ["local-navigation", "local-selection", "received-navigation", "received-reread", "received-reset"] as const) {
  test(`same-task ${transition} invalidates a pending comparison save`, async ({ page }) => {
    if (transition.startsWith("received")) {
      await routeSuccessfulDetails(page);
      await openReceivedComparison(page);
      await page.locator("#demo-comparison-link-load").click();
      await expect(page.locator(".demo-comparison-table")).toBeVisible();
    } else {
      await openAcceptedComparison(page, 3);
    }
    await page.locator("#demo-save-comparison-start").click();
    await page.getByLabel("Nom de la comparaison").fill("Intention devenue obsolète");
    await page.evaluate((change) => {
      const form = document.querySelector<HTMLFormElement>(".demo-save-comparison-form");
      if (!form) throw new Error("Expected the pending comparison form");
      if (change.endsWith("navigation")) window.location.hash = "#saved";
      else if (change === "received-reset") window.dispatchEvent(new HashChangeEvent("hashchange"));
      else {
        const selector = change === "local-selection" ? "#demo-comparison-remove-2" : "#demo-comparison-link-reread";
        const control = document.querySelector<HTMLButtonElement>(selector);
        if (!control) throw new Error(`Expected transition control ${selector}`);
        control.click();
      }
      form.requestSubmit();
    }, transition);
    expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
    await expect(page.locator(".demo-announcement")).not.toContainText("Comparaison enregistrée sur cet appareil.");
  });
}

test("cancelling the save form returns focus to its stable trigger", async ({ page }) => {
  await openAcceptedComparison(page, 2);
  await page.locator("#demo-save-comparison-start").click();
  await page.getByLabel("Nom de la comparaison").fill("Brouillon annulé");
  await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.locator("#demo-save-comparison-start")).toBeFocused();
  await expect(page.locator(".demo-save-comparison-form")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
});

test("an invalid comparison name keeps focus and writes nothing", async ({ page }) => {
  await openAcceptedComparison(page);
  await page.locator("#demo-save-comparison-start").click();
  await page.getByLabel("Nom de la comparaison").fill("   ");
  await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByLabel("Nom de la comparaison")).toBeFocused();
  await expect(page.locator(".demo-save-comparison-form")).toContainText(/1 à 60|caractères de contrôle/i);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
});

test("duplicate comparison identity is rejected independently from its name", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("Déjà enregistrée")]);
  await openAcceptedComparison(page);
  await expect(page.locator(".demo-save-comparison-form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /voir la comparaison enregistrée/i })).toBeVisible();
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey))!).comparisons).toHaveLength(1);
});

test("the eleventh saved comparison is rejected with a management action", async ({ page, context }) => {
  const full = Array.from({ length: 10 }, (_, index) => storedComparison(`Comparaison ${index + 1}`, [
    `lst_full-${String(index).padStart(2, "0")}-a`,
    `lst_full-${String(index).padStart(2, "0")}-b`,
  ]));
  await seedSavedComparisons(context, full);
  await openAcceptedComparison(page);
  await expect(page.getByText(/limite de 10 comparaisons/i)).toBeVisible();
  await expect(page.locator(".demo-save-comparison-form")).toHaveCount(0);
  await page.getByRole("button", { name: /gérer les comparaisons/i }).click();
  await expect(page.locator("#demo-saved-comparisons-title")).toContainText("10 sur 10");
});

test("a synchronous double submit stores one comparison", async ({ page }) => {
  await openAcceptedComparison(page);
  await page.locator("#demo-save-comparison-start").click();
  await page.getByLabel("Nom de la comparaison").fill("Une seule fois");
  await page.locator(".demo-save-comparison-form").evaluate((form) => {
    const submitter = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }));
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }));
  });
  await expect.poll(async () => {
    const bytes = await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey);
    return bytes === null ? 0 : JSON.parse(bytes).comparisons.length;
  }).toBe(1);
});

test("comparison management never changes saved-search or favorite bytes", async ({ page, context }) => {
  const searches = JSON.stringify({ schemaVersion: 1, searches: [{ name: "Intacte", criteria: { query: { schemaVersion: 2, sort: "listing_asc" } } }] });
  const favorites = JSON.stringify({ schemaVersion: 1, listingIds: ["lst_favorite-intact"] });
  await context.addInitScript(({ searchesKey, searchesBytes, favoritesKey: favoriteKey, favoriteBytes }) => {
    localStorage.setItem(searchesKey, searchesBytes);
    localStorage.setItem(favoriteKey, favoriteBytes);
  }, { searchesKey: savedSearchesKey, searchesBytes: searches, favoritesKey, favoriteBytes: favorites });
  await openAcceptedComparison(page);
  await saveCurrentComparison(page, "Isolée");
  await openSavedList(page);
  await page.locator("#demo-saved-comparison-remove-0").click();
  await page.locator("#demo-saved-comparison-undo").click();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchesKey)).toBe(searches);
  expect(await page.evaluate((key) => localStorage.getItem(key), favoritesKey)).toBe(favorites);
});

test("filtering, selection and comparison-link creation do not create saved-comparison bytes", async ({ page }) => {
  await openAcceptedComparison(page);
  await page.locator("#demo-comparison-link-start").click();
  await expect(page.locator("#demo-comparison-link-url")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
});

test("the global empty state appears only when all three local collections are empty", async ({ page, context, browserName }, testInfo) => {
  await seedSavedComparisons(context, [storedComparison("Empêche l’état vide")]);
  await page.goto("/demo#saved");
  await expect(page.getByRole("status").filter({ hasText: "Aucun élément enregistré" })).toHaveCount(0);
  await page.locator("#demo-saved-comparison-remove-0").click();
  await expect(page.getByRole("status").filter({ hasText: "Aucun élément enregistré" })).toBeVisible();
  await captureRecoveryMatrix(page, testInfo, "empty", browserName);
});

test("deletion and undo restore the row and keyboard focus independently", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("À restaurer")]);
  await page.goto("/demo#saved");
  await page.locator("#demo-saved-comparison-remove-0").click();
  await expect(page.locator("#demo-saved-comparison-undo")).toBeFocused();
  await page.locator("#demo-saved-comparison-undo").click();
  await expect(page.locator("#demo-saved-comparison-remove-0")).toBeFocused();
  await expect(page.locator(".demo-saved-comparison")).toContainText("À restaurer");
});

test("a cross-tab replacement invalidates stale undo authority", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("Supprimée ici")]);
  await page.goto("/demo#saved");
  await page.locator("#demo-saved-comparison-remove-0").click();
  await expect(page.locator("#demo-saved-comparison-undo")).toBeVisible();
  const writer = await context.newPage();
  await writer.goto("/demo#saved");
  const replacement = storedBytes([storedComparison("Écrite ailleurs", comparisonIds.slice(1, 3))]);
  await writer.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: savedComparisonsKey, value: replacement });
  await expect(page.locator("#demo-saved-comparison-undo")).toHaveCount(0);
  await expect(page.locator(".demo-saved-comparison")).toContainText("Écrite ailleurs");
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBe(replacement);
});

test("opening rereads the latest cross-tab fragment instead of stale visible intent", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("Ancienne")]);
  await page.goto("/demo#saved");
  const writer = await context.newPage();
  await writer.goto("/demo#saved");
  const current = storedBytes([storedComparison("Actuelle", comparisonIds.slice(1, 3))]);
  await writer.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: savedComparisonsKey, value: current });
  await expect(page.locator(".demo-saved-comparison")).toContainText("Actuelle");
  await page.locator("#demo-saved-comparison-open-0").click();
  expect(page.url()).toContain(comparisonHash(comparisonIds.slice(1, 3)));
});

test("opening rejects stale visible intent before a storage event is delivered", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("Ancienne")]);
  await page.goto("/demo#saved");
  await expect(page.locator(".demo-saved-comparison")).toContainText("Ancienne");
  const current = storedBytes([storedComparison("Actuelle", comparisonIds.slice(1, 3))]);
  // Same-document writes do not emit a storage event; the rendered row stays stale.
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: savedComparisonsKey, value: current });
  await page.locator("#demo-saved-comparison-open-0").click();
  expect(new URL(page.url()).hash).toBe("#saved");
  await expect(page.locator(".demo-announcement")).toContainText("a changé ou n’est plus disponible");
  await expect(page.locator(".demo-saved-comparison")).toContainText("Actuelle");
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBe(current);
});

test("corrupt comparison bytes are preserved until exact-byte confirmed reset", async ({ page, context, browserName }, testInfo) => {
  const corrupt = "{saved-comparison-broken";
  const searchBytes = JSON.stringify({ schemaVersion: 1, searches: [] });
  await context.addInitScript(({ key, bytes, searchKey, searches }) => {
    localStorage.setItem(key, bytes);
    localStorage.setItem(searchKey, searches);
  }, { key: savedComparisonsKey, bytes: corrupt, searchKey: savedSearchesKey, searches: searchBytes });
  await page.goto("/demo#saved");
  await expect(page.getByText(/comparaisons enregistrées.*illisibles/i)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBe(corrupt);
  await captureRecoveryMatrix(page, testInfo, "corrupt", browserName);
  await page.locator("#demo-saved-comparison-reset-start").click();
  await page.locator("#demo-saved-comparison-reset-confirm").click();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchesKey)).toBe(searchBytes);
});

test("cross-tab corruption replacement cancels the old reset confirmation", async ({ page, context }) => {
  await context.addInitScript(({ key }) => localStorage.setItem(key, "{corrupt-a"), { key: savedComparisonsKey });
  await page.goto("/demo#saved");
  await page.locator("#demo-saved-comparison-reset-start").click();
  await expect(page.locator("#demo-saved-comparison-reset-confirm")).toBeFocused();
  const writer = await context.newPage();
  await writer.goto("/demo#saved");
  await writer.evaluate((key) => localStorage.setItem(key, "{corrupt-b"), savedComparisonsKey);
  await expect(page.locator("#demo-saved-comparison-reset-confirm")).toHaveCount(0);
  await expect(page.locator("#demo-saved-comparison-reset-start")).toBeFocused();
  await expect(page.locator(".demo-announcement")).toContainText(/confirmation.*annulée/i);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBe("{corrupt-b");
});

test("future comparison bytes stay read-only and cannot be reset", async ({ page, context, browserName }, testInfo) => {
  const future = JSON.stringify({ schemaVersion: 2, comparisons: [], futureData: "x".repeat(17_000) });
  await context.addInitScript(({ key, bytes }) => localStorage.setItem(key, bytes), { key: savedComparisonsKey, bytes: future });
  await page.goto("/demo#saved");
  await expect(page.getByText(/version plus récente/i)).toBeVisible();
  await expect(page.locator("#demo-saved-comparison-reset-start")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBe(future);
  await captureRecoveryMatrix(page, testInfo, "future", browserName);
});

test("denied local storage exposes truthful session-only comparison management", async ({ page, browserName }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { throw new DOMException("denied", "SecurityError"); },
  }));
  await page.goto("/demo#saved");
  await expect(page.getByText(/stockage local est inaccessible.*comparaisons.*session/i)).toBeVisible();
  await captureRecoveryMatrix(page, testInfo, "denied", browserName);
  await openAcceptedComparison(page);
  await saveCurrentComparison(page, "Session sans stockage");
  await openSavedList(page);
  await page.locator("#demo-saved-comparison-remove-0").click();
  await expect(page.locator("#demo-saved-comparison-undo")).toBeFocused();
  await page.locator("#demo-saved-comparison-undo").click();
  await expect(page.locator(".demo-saved-comparison")).toContainText("Session sans stockage");
  await expect(page.locator("#demo-saved-comparison-remove-0")).toBeFocused();
});

test("quota failure retains a saved comparison for the session without persistent bytes", async ({ page, browserName }, testInfo) => {
  await page.addInitScript(({ key }) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === key) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, itemKey, value);
    };
  }, { key: savedComparisonsKey });
  await openAcceptedComparison(page);
  await saveCurrentComparison(page, "Session seulement");
  await openSavedList(page);
  await expect(page.locator(".demo-saved-comparison")).toContainText("Session seulement");
  await expect(page.getByRole("note").filter({ hasText: "L’enregistrement local est plein. Les comparaisons ajoutées restent limitées à cette session." })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
  await captureRecoveryMatrix(page, testInfo, "quota", browserName);
  await page.locator("#demo-saved-comparison-remove-0").click();
  await expect(page.locator("#demo-saved-comparison-undo")).toBeFocused();
  await page.locator("#demo-saved-comparison-undo").click();
  await expect(page.locator(".demo-saved-comparison")).toContainText("Session seulement");
  await expect(page.locator("#demo-saved-comparison-remove-0")).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedComparisonsKey)).toBeNull();
});

test("offline saved-comparison management remains local and explicit load fails honestly", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("Hors connexion")]);
  await page.goto("/demo#saved");
  await context.setOffline(true);
  await page.locator("#demo-saved-comparison-open-0").click();
  await expect(page.locator("#demo-comparison-link-load")).toBeVisible();
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator('[data-comparison-slot][data-status="error"]')).toHaveCount(2);
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator("#demo-received-comparison")).toContainText(/hors connexion|reconnect/i);
  await context.setOffline(false);
});

test("disabled runtime manages saved comparisons with zero demo API requests", async ({ page, context }, testInfo) => {
  const disabledBase = (testInfo.config.metadata as { readonly demoDisabledBaseURL?: unknown }).demoDisabledBaseURL;
  if (typeof disabledBase !== "string") throw new Error("demoDisabledBaseURL metadata is required");
  await seedSavedComparisons(context, [storedComparison("Locale désactivée")]);
  const apiCalls: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) apiCalls.push(request.url()); });
  await page.goto(`${disabledBase}/demo#saved`);
  await expect(page.locator("#demo-saved-comparison-open-0")).toBeDisabled();
  await expect(page.getByText(/recherche et le détail sont désactivés/i)).toBeVisible();
  await page.locator("#demo-saved-comparison-remove-0").click();
  await page.locator("#demo-saved-comparison-undo").click();
  await expect(page.locator(".demo-saved-comparison")).toHaveCount(1);
  await page.locator("#demo-saved-comparison-reset-start").click();
  await page.locator("#demo-saved-comparison-reset-confirm").click();
  await expect(page.locator(".demo-saved-comparison")).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});

test("a missing detail keeps the whole saved comparison unavailable and retries all publications", async ({ page, context, browserName }, testInfo) => {
  await seedSavedComparisons(context, [storedComparison("Une référence absente")]);
  await mockDemoCatalog(page);
  let attempt = 0;
  const calls: string[] = [];
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    calls.push(listingId);
    if (attempt === 0 && listingId === comparisonIds[1]) return fulfillJson(route, v2Error("not_found"), 404);
    return fulfillJson(route, detailEnvelope(listingId, comparisonIds.indexOf(listingId as typeof comparisonIds[number]) + 1));
  });
  await page.goto("/demo#saved");
  await page.locator("#demo-saved-comparison-open-0").click();
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator('[data-comparison-slot="1"]')).toHaveAttribute("data-status", "error");
  await captureRecoveryMatrix(page, testInfo, "read-error", browserName);
  attempt += 1;
  await page.locator("#demo-comparison-link-reread").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  expect(calls).toEqual([...comparisonIds.slice(0, 2), ...comparisonIds.slice(0, 2)]);
});

test("mixed-fixture detail responses never render a partial saved comparison", async ({ page, context }) => {
  await seedSavedComparisons(context, [storedComparison("Fixtures incompatibles")]);
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const second = listingId === comparisonIds[1];
    return fulfillJson(route, detailEnvelope(listingId, second ? 2 : 1, {
      fixtureVersion: second ? "saved-comparison-other-fixture" : demoFixtureVersion,
    }));
  });
  await page.goto("/demo#saved");
  await page.locator("#demo-saved-comparison-open-0").click();
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator("#demo-received-comparison")).toHaveAttribute("data-status", "incompatible");
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator("#demo-comparison-link-reread")).toBeVisible();
});

test("save form, saved list and reopened review pass the required visual matrix", async ({ page, browserName }, testInfo) => {
  test.setTimeout(240_000);
  await openAcceptedComparison(page);
  await page.locator("#demo-save-comparison-start").click();
  await page.getByLabel("Nom de la comparaison").fill(`${"Comparaison très détaillée ".repeat(3)}`.slice(0, 60));
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      await capture(page, testInfo, `demo-saved-comparison-form-${width}-${theme}-${browserName}.png`);
    }
  }
  await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await openSavedList(page);
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      await capture(page, testInfo, `demo-saved-comparison-list-${width}-${theme}-${browserName}.png`);
    }
  }
  await page.locator("#demo-saved-comparison-open-0").click();
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      await capture(page, testInfo, `demo-saved-comparison-reopened-${width}-${theme}-${browserName}.png`);
    }
  }
});

test("200 percent platform and Verdana text with reduced motion keep the flow operable", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const font of ["platform", "verdana"] as const) {
    await page.goto("/demo");
    await page.evaluate((key) => localStorage.removeItem(key), savedComparisonsKey);
    await openAcceptedComparison(page);
    if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    if (await page.locator(".demo-save-comparison-form").count() === 0) await page.locator("#demo-save-comparison-start").click();
    await expect(page.getByLabel("Nom de la comparaison")).toBeFocused();
    await expectNoPageOverflow(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await capture(page, testInfo, `demo-saved-comparison-text-200-${font}-${browserName}.png`);
    await page.getByLabel("Nom de la comparaison").fill("Comparaison à retrouver");
    await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
    await openSavedList(page);
    await expect(page.locator(".demo-saved-comparison")).toContainText("Comparaison à retrouver");
    const brokenHeadingWords = await page.locator(".demo-section-heading h2").evaluateAll((headings) => headings.flatMap((heading) => {
      const text = heading.firstChild;
      if (!(text instanceof Text)) throw new Error("Expected plain section-heading text");
      return Array.from(text.data.matchAll(/\S+/gu)).filter((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        return range.getClientRects().length > 1;
      }).map((word) => word[0]);
    }));
    expect(brokenHeadingWords).toEqual([]);
    await capture(page, testInfo, `demo-saved-comparison-text-200-list-${font}-${browserName}.png`);
    await page.locator("#demo-saved-comparison-open-0").click();
    await expect(page.getByRole("heading", { name: "Comparaison enregistrée", exact: true })).toBeFocused();
    await capture(page, testInfo, `demo-saved-comparison-text-200-reopened-${font}-${browserName}.png`);
  }
});

test("form, list and reopened review meet keyboard, focus, touch-target and WCAG requirements", async ({ page }) => {
  await openAcceptedComparison(page);
  await page.locator("#demo-save-comparison-start").click();
  await expect(page.getByLabel("Nom de la comparaison")).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.getByLabel("Nom de la comparaison").fill("Accessible au clavier");
  await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await openSavedList(page);
  await page.locator("#demo-saved-comparison-remove-0").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demo-saved-comparison-undo")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demo-saved-comparison-remove-0")).toBeFocused();
  const targets = await page.locator(".demo-saved-comparison button, #demo-saved-comparison-undo").evaluateAll((elements) => elements
    .filter((element) => getComputedStyle(element).visibility !== "hidden")
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width };
    }));
  expect(targets.length).toBeGreaterThanOrEqual(2);
  expect(targets.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.locator("#demo-saved-comparison-open-0").click();
  await expect(page.getByRole("heading", { name: "Comparaison enregistrée", exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

async function measureFeedbackSamples(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await routeAcceptedResults(page);
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const saveMs: number[] = [];
  const openMs: number[] = [];
  try {
    for (let sample = 0; sample < 5; sample += 1) {
      await page.goto("/demo");
      await waitUntilReady(page);
      await page.getByRole("button", { name: "Rechercher", exact: true }).click();
      for (let index = 0; index < 2; index += 1) await page.locator(`#demo-result-compare-${index}`).click();
      await page.locator("#demo-comparison-open").click();
      await page.locator("#demo-save-comparison-start").click();
      await page.getByLabel("Nom de la comparaison").fill(`Mesure ${sample + 1}`);
      await page.locator(".demo-save-comparison-form").evaluate((form) => {
        form.addEventListener("submit", () => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (document.querySelector(".demo-save-comparison-form") !== null) return;
            observer.disconnect();
            requestAnimationFrame(() => {
              (window as typeof window & { __awSavedComparisonSaveMs?: number }).__awSavedComparisonSaveMs = performance.now() - started;
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }, { once: true });
      });
      await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
      await page.waitForFunction(() => typeof (window as typeof window & { __awSavedComparisonSaveMs?: number }).__awSavedComparisonSaveMs === "number");
      saveMs.push(await page.evaluate(() => (window as typeof window & { __awSavedComparisonSaveMs: number }).__awSavedComparisonSaveMs));

      await openSavedList(page);
      await page.locator("#demo-saved-comparison-open-0").evaluate((button) => {
        button.addEventListener("click", () => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (document.querySelector("#demo-comparison-link-load") === null) return;
            observer.disconnect();
            requestAnimationFrame(() => {
              (window as typeof window & { __awSavedComparisonOpenMs?: number }).__awSavedComparisonOpenMs = performance.now() - started;
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }, { once: true });
      });
      await page.locator("#demo-saved-comparison-open-0").click();
      await page.waitForFunction(() => typeof (window as typeof window & { __awSavedComparisonOpenMs?: number }).__awSavedComparisonOpenMs === "number");
      openMs.push(await page.evaluate(() => (window as typeof window & { __awSavedComparisonOpenMs: number }).__awSavedComparisonOpenMs));
      await page.evaluate((key) => localStorage.removeItem(key), savedComparisonsKey);
    }
  } finally {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await context.close();
  }
  return { openMs, saveMs };
}

test("save and open feedback stay within 100 ms across five Chromium 4x CPU samples", async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Chromium CDP is required for the bounded 4x CPU lab profile.");
  test.setTimeout(180_000);
  const samples = await measureFeedbackSamples(browser);
  expect(samples.saveMs).toHaveLength(5);
  expect(samples.openMs).toHaveLength(5);
  expect(Math.max(...samples.saveMs)).toBeLessThanOrEqual(100);
  expect(Math.max(...samples.openMs)).toBeLessThanOrEqual(100);
  const report = {
    browserVersion: browser.version(),
    budgetMaxMs: 100,
    caveat: "Bounded synthetic Chromium lab measurement under 4x CPU slowdown, from local click/submit to immediate DOM feedback and the next animation-frame callback. No network, OS or physical-paint latency claim.",
    collectedAt: new Date().toISOString(),
    host: { architecture: arch(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
    profile: { cpuSlowdownMultiplier: 4, sampleCount: 5, viewport: { width: 390, height: 844 } },
    samples,
  };
  const file = testInfo.outputPath("demo-saved-comparison-performance.json");
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await testInfo.attach("demo-saved-comparison-performance.json", { path: file, contentType: "application/json" });
});
