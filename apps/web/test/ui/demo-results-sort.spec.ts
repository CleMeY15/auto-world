import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  demoMakeIds,
  demoModelIds,
  descriptionFields,
  fulfillJson,
  mockDemoCatalog,
  v2Envelope,
  v2Response,
  v3Envelope,
  v3Error,
} from "./demo-v2-fixtures";

const savedSearchKey = "auto-world.demo.saved-searches.v1";
const oldCursor = `cur_${"a".repeat(64)}`;
const sortedCursor = `cur_${"b".repeat(64)}`;
const sortValues = ["listing_asc", "price_asc", "price_desc", "mileage_asc", "mileage_desc"] as const;
type SortValue = (typeof sortValues)[number];
type SearchBody = Readonly<Record<string, unknown>> & { readonly cursor?: string; readonly sort?: SortValue };
type SubmittedSearch = { readonly version: 2 | 3; readonly body: SearchBody };

const acceptedQuery = {
  schemaVersion: 3,
  sort: "mileage_desc",
  text: "alpha modele",
  priceMaxMinor: 3_200_050,
  mileageMaxKm: 25_000.25,
  makeId: demoMakeIds.alpha,
  modelId: demoModelIds.alphaOne,
  firstRegistrationYear: 2022,
} as const;

function result(
  index: number,
  observedAt: string,
  options: {
    readonly currency?: string;
    readonly mileageUnit?: "km" | "mi";
    readonly priceUnavailable?: boolean;
    readonly mileageUnavailable?: boolean;
  } = {},
) {
  const priceEvidence = `ev_${String(index * 2 + 1).padStart(64, "0")}`;
  const mileageEvidence = `ev_${String(index * 2 + 2).padStart(64, "0")}`;
  const priceValue = { amountMinor: 2_000_000 + index * 101, currency: options.currency ?? "EUR" };
  const mileageValue = { amount: 12_000 + index * 0.25, unit: options.mileageUnit ?? "km" };
  return {
    listingId: `lst_results-sort-${String(index).padStart(2, "0")}`,
    availability: "active",
    price: options.priceUnavailable
      ? { status: "unavailable" }
      : { status: "observed", value: priceValue, evidenceId: priceEvidence },
    mileage: options.mileageUnavailable
      ? { status: "unavailable" }
      : { status: "observed", value: mileageValue, evidenceId: mileageEvidence },
    evidence: [
      ...(options.priceUnavailable ? [] : [{ evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 8_800, value: priceValue }]),
      ...(options.mileageUnavailable ? [] : [{ evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 9_200, value: mileageValue }]),
    ],
    ...descriptionFields(index * 2 - 1),
  } as const;
}

type HarnessOptions = {
  readonly firstCursor?: boolean;
  readonly sortedCursor?: boolean;
  readonly holdSort?: Promise<void>;
  readonly sortedResults?: readonly ReturnType<typeof result>[];
  readonly failSortedAttempts?: number;
  readonly responseFixture?: string;
};

async function installHarness(page: Page, options: HarnessOptions = {}) {
  await mockDemoCatalog(page);
  const submitted: SubmittedSearch[] = [];
  let sortedAttempts = 0;
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  const initialResults = [result(1, observedAt), result(2, observedAt)];
  const sortedResults = options.sortedResults ?? [result(3, observedAt), result(4, observedAt)];

  async function answer(route: Route, version: 2 | 3) {
    const body = route.request().postDataJSON() as SearchBody;
    submitted.push({ version, body });
    const isInitial = body.sort === acceptedQuery.sort && body.cursor === undefined;
    const isContinuation = body.cursor !== undefined;
    if (!isInitial && !isContinuation) {
      sortedAttempts += 1;
      if (options.holdSort !== undefined) await options.holdSort;
      if (sortedAttempts <= (options.failSortedAttempts ?? 0)) {
        await fulfillJson(route, version === 3 ? v3Error("read_unavailable") : { schemaVersion: 2, requestId: `req_${"c".repeat(32)}`, error: { code: "read_unavailable" } }, 503);
        return;
      }
    }

    const responseResults = isInitial ? initialResults : isContinuation ? [result(5, observedAt)] : sortedResults;
    const response = v2Response(responseResults, {
      dataAsOf: observedAt,
      total: isInitial ? initialResults.length + (options.firstCursor ? 1 : 0) : sortedResults.length + (options.sortedCursor ? 1 : 0),
      ...(isInitial && options.firstCursor ? { cursor: oldCursor } : {}),
      ...(!isInitial && !isContinuation && options.sortedCursor ? { cursor: sortedCursor } : {}),
      ...(options.responseFixture === undefined ? {} : { fixture: options.responseFixture }),
    });
    await fulfillJson(route, version === 3 ? v3Envelope(response) : v2Envelope(response));
  }

  await page.route("**/api/demo/v2/search", (route) => answer(route, 2));
  await page.route("**/api/demo/v3/search", (route) => answer(route, 3));
  return submitted;
}

async function fillAcceptedCriteria(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByLabel("Recherche par mots").fill("Modèle Alpha");
  await page.getByLabel("Budget maximum (€)").fill("32000.50");
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await page.getByLabel("Kilométrage maximum (km)").fill("25000.25");
  await page.getByLabel("Année de première immatriculation fictive").fill("2022");
  await page.getByLabel("Marque fictive").selectOption(demoMakeIds.alpha);
  await page.getByLabel("Modèle fictif").selectOption(demoModelIds.alphaOne);
  await page.getByLabel("Trier les résultats").selectOption(acceptedQuery.sort);
}

async function openResults(page: Page, options: HarnessOptions = {}) {
  const submitted = await installHarness(page, options);
  await page.goto("/demo");
  await fillAcceptedCriteria(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  expect(submitted[0]).toEqual({ version: 3, body: acceptedQuery });
  return submitted;
}

async function applySort(page: Page, sort: SortValue) {
  await page.locator("#demo-results-sort").selectOption(sort);
  await page.locator("#demo-results-sort-apply").click();
}

function decodeSharedUrl(value: string) {
  const hash = new URL(value).hash;
  const prefix = hash.startsWith("#search-link/v2/") ? "#search-link/v2/" : "#search-link/v1/";
  expect(hash.startsWith("#search-link/v1/") || hash.startsWith("#search-link/v2/")).toBe(true);
  return JSON.parse(decodeURIComponent(hash.slice(prefix.length))) as { readonly query: SearchBody };
}

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0 || bounds.right <= viewportWidth + 0.5) return [];
      return [{ element: element.tagName.toLowerCase(), right: Math.round(bounds.right * 10) / 10 }];
    });
    return { documentWidth: document.documentElement.scrollWidth, offenders, viewportWidth };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({ documentWidth: report.viewportWidth, offenders: [], viewportWidth: report.viewportWidth });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  const file = process.env.AW_SCREENSHOT_DIR ? path.join(process.env.AW_SCREENSHOT_DIR, name) : testInfo.outputPath(name);
  if (process.env.AW_SCREENSHOT_DIR) await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
}

async function expectWrappedTextInsideBox(page: Page, selector: string) {
  const report = await page.locator(selector).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const textRects = Array.from(range.getClientRects()).map((rect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    }));
    return {
      bounds: { bottom: bounds.bottom, left: bounds.left, right: bounds.right, top: bounds.top },
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      textRects,
    };
  });
  expect(report.textRects.length).toBeGreaterThan(0);
  expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth + 1);
  expect(report.scrollHeight).toBeLessThanOrEqual(report.clientHeight + 1);
  expect(report.textRects.every((rect) => (
    rect.left >= report.bounds.left - 0.5
    && rect.right <= report.bounds.right + 0.5
    && rect.top >= report.bounds.top - 0.5
    && rect.bottom <= report.bounds.bottom + 0.5
  ))).toBe(true);
}

test("selecting a sort is local and abandoning Results restores the accepted sort", async ({ page }) => {
  const submitted = await openResults(page);
  const selector = page.getByLabel("Trier ces résultats");
  await expect(selector.locator("option")).toHaveCount(5);
  expect(await selector.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toEqual(sortValues);
  await selector.selectOption("price_asc");
  await expect(page.locator("#demo-results-sort-apply")).toBeEnabled();
  expect(submitted).toHaveLength(1);
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await expect(selector).toHaveValue(acceptedQuery.sort);
  expect(submitted).toHaveLength(1);
});

test("the full applied and locally chosen sort labels stay distinct until submission", async ({ page }) => {
  const submitted = await openResults(page);
  await expect(page.locator("#demo-results-sort-applied")).toHaveText("Tri appliqué : Kilométrage décroissant (km d’abord)");
  await expect(page.locator("#demo-results-sort-chosen")).toHaveCount(0);
  await page.getByLabel("Trier ces résultats").selectOption("price_asc");
  await expect(page.locator("#demo-results-sort-applied")).toHaveText("Tri appliqué : Kilométrage décroissant (km d’abord)");
  await expect(page.locator("#demo-results-sort-chosen")).toHaveText("Tri choisi : Prix croissant (EUR d’abord)");
  expect(submitted).toHaveLength(1);
});

test("submitting clones accepted V3 criteria, ignores the unsent draft and resets comparison", async ({ page }) => {
  const submitted = await openResults(page);
  await page.locator("#demo-result-compare-0").click();
  await page.locator("#demo-result-compare-1").click();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByLabel("Recherche par mots").fill("brouillon non soumis");
  await page.getByLabel("Budget maximum (€)").fill("12345.67");
  await page.goBack();
  await applySort(page, "price_desc");
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeFocused();
  expect(submitted[1]).toEqual({ version: 3, body: { ...acceptedQuery, sort: "price_desc" } });
  expect(Object.hasOwn(submitted[1]!.body, "cursor")).toBe(false);
  await expect(page.getByText("0 publication sur 3 sélectionnée.")).toBeVisible();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await expect(page.getByLabel("Recherche par mots")).toHaveValue("brouillon non soumis");
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("12345.67");
  await expect(page.getByLabel("Trier les résultats")).toHaveValue("price_desc");
});

test("submitting the accepted sort is disabled and sends no request", async ({ page }) => {
  const submitted = await openResults(page);
  await expect(page.locator("#demo-results-sort")).toHaveValue(acceptedQuery.sort);
  await expect(page.locator("#demo-results-sort-apply")).toBeDisabled();
  expect(submitted).toHaveLength(1);
});

test("the server response remains authoritative for mixed currencies, units and unknowns", async ({ page }) => {
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  const submitted = await openResults(page, {
    sortedResults: [
      result(8, observedAt, { currency: "USD", mileageUnit: "mi" }),
      result(9, observedAt, { priceUnavailable: true, mileageUnavailable: true }),
      result(7, observedAt, { currency: "EUR", mileageUnit: "km" }),
    ],
  });
  await applySort(page, "price_asc");
  const cards = page.locator(".demo-result-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("$");
  await expect(cards.nth(0)).toContainText("mi");
  await expect(cards.nth(1)).toContainText("Prix non disponible");
  await expect(cards.nth(1)).toContainText("Kilométrage non disponible");
  await expect(cards.nth(2)).toContainText("€");
  await expect(cards.nth(2)).toContainText("km");
  expect(submitted[1]?.body.sort).toBe("price_asc");
});

test("pagination after sorting uses only the new query and cursor", async ({ page }) => {
  const submitted = await openResults(page, { firstCursor: true, sortedCursor: true });
  await applySort(page, "listing_asc");
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(3);
  expect(submitted[1]?.body).toEqual({ ...acceptedQuery, sort: "listing_asc" });
  expect(submitted[2]?.body).toEqual({ ...acceptedQuery, sort: "listing_asc", cursor: sortedCursor });
  expect(submitted[2]?.body.cursor).not.toBe(oldCursor);
});

test("successful sorting refreshes saved and shared accepted criteria", async ({ page }) => {
  await openResults(page);
  await applySort(page, "price_desc");
  await page.locator("#demo-save-search-start").click();
  await page.getByLabel("Nom de la recherche").fill("Tri récent");
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  const persisted = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), savedSearchKey))!);
  expect(persisted.searches[0].criteria.query).toEqual({ ...acceptedQuery, sort: "price_desc" });
  await page.locator("#demo-search-link-start").click();
  expect(decodeSharedUrl(await page.locator("#demo-search-link-url").inputValue()).query).toEqual({ ...acceptedQuery, sort: "price_desc" });
});

test("pending sorting hides old actionable results and guards overlap", async ({ page, browserName }, testInfo) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const submitted = await openResults(page, { holdSort: held });
  await page.locator("#demo-results-sort").selectOption("price_desc");
  await page.locator("#demo-results-sort-apply").click();
  await expect(page.getByText("Application du tri…")).toBeVisible();
  await expect(page.locator(".demo-result-card")).toHaveCount(0);
  await expect(page.locator("#demo-results-sort-apply")).toHaveCount(0);
  expect(submitted).toHaveLength(2);
  await capture(page, testInfo, `demo-results-sort-pending-390-light-${browserName}.png`);
  release();
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
  expect(submitted).toHaveLength(2);
});

test("failed sorting exposes a focused retry and repeats the same cursorless query", async ({ page, browserName }, testInfo) => {
  const submitted = await openResults(page, { failSortedAttempts: 1 });
  await applySort(page, "mileage_asc");
  await expect(page.getByText("Tri indisponible", { exact: true })).toBeVisible();
  await expect(page.locator(".demo-result-card")).toHaveCount(0);
  await expect(page.locator("#demo-results-sort-retry")).toBeFocused();
  await capture(page, testInfo, `demo-results-sort-error-390-light-${browserName}.png`);
  await page.locator("#demo-results-sort-retry").click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeFocused();
  expect(submitted[1]?.body).toEqual({ ...acceptedQuery, sort: "mileage_asc" });
  expect(submitted[2]?.body).toEqual(submitted[1]?.body);
  expect(Object.hasOwn(submitted[2]!.body, "cursor")).toBe(false);
});

test("offline sorting retries the same request after reconnecting", async ({ page, context }) => {
  const submitted = await openResults(page);
  await context.setOffline(true);
  await applySort(page, "price_asc");
  await expect(page.getByText("Tri indisponible", { exact: true })).toBeVisible();
  await expect(page.locator(".demo-result-card")).toHaveCount(0);
  await context.setOffline(false);
  await page.locator("#demo-results-sort-retry").click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeFocused();
  expect(submitted.at(-1)?.body).toEqual({ ...acceptedQuery, sort: "price_asc" });
});

test("a late sorted response cannot leave the newer Saved destination", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await openResults(page, { holdSort: held });
  await page.locator("#demo-results-sort").selectOption("price_desc");
  await page.locator("#demo-results-sort-apply").click();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mes listes" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "Mes listes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toHaveCount(0);
});

test("catalogue-incompatible accepted identity cannot be silently sorted", async ({ page }) => {
  const submitted = await openResults(page, { responseFixture: "older-results-sort-fixture" });
  await expect(page.getByLabel("Trier ces résultats")).toBeDisabled();
  await expect(page.getByText(/catalogue lié à ces résultats/u)).toBeVisible();
  await expect(page.getByText(/make_ui_|model_ui_|taxcat_|taxrel_/u)).toHaveCount(0);
  expect(submitted).toHaveLength(1);
});

test("sort draft feedback stays within 100 ms for five samples", async ({ page, context, browserName }, testInfo) => {
  await openResults(page);
  const client = browserName === "chromium" ? await context.newCDPSession(page) : undefined;
  const profile = browserName === "chromium"
    ? { cpuSlowdownMultiplier: 4, qualification: "Chromium CDP 4x CPU slowdown" }
    : { cpuSlowdownMultiplier: 1, qualification: "WebKit unthrottled; CDP CPU throttling is unavailable" };
  try {
    if (client !== undefined) await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const samples = await page.evaluate(async ({ acceptedSort, candidates }) => {
      const select = document.querySelector<HTMLSelectElement>("#demo-results-sort");
      const button = document.querySelector<HTMLButtonElement>("#demo-results-sort-apply");
      if (select === null || button === null) throw new Error("Expected Results sort controls");
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const values: number[] = [];
      for (const candidate of candidates) {
        select.value = acceptedSort;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();
        await nextFrame();
        const started = performance.now();
        select.value = candidate;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        while (button.disabled) await nextFrame();
        await nextFrame();
        values.push(performance.now() - started);
      }
      return values;
    }, { acceptedSort: acceptedQuery.sort, candidates: ["price_asc", "price_desc", "mileage_asc", "listing_asc", "price_asc"] });
    expect(samples).toHaveLength(5);
    expect(Math.max(...samples)).toBeLessThanOrEqual(100);
    await testInfo.attach("demo-results-sort-performance.json", {
      body: Buffer.from(`${JSON.stringify({ browserName, browserVersion: context.browser()?.version(), budgetMaxMs: 100, caveat: "Local sort-draft DOM feedback only; network search latency is excluded.", collectedAt: new Date().toISOString(), profile, samples }, null, 2)}\n`),
      contentType: "application/json",
    });
  } finally {
    if (client !== undefined) {
      await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await client.detach();
    }
  }
});

test("Results sorting remains accessible across the viewport and theme matrix", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  await installHarness(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.goto(`/demo?results-sort-visual=${width}-${theme}`);
      await page.getByLabel("Apparence").selectOption(theme);
      await fillAcceptedCriteria(page);
      await page.getByRole("button", { name: "Rechercher", exact: true }).click();
      const controls = page.locator("#demo-results-sort, #demo-results-sort-apply");
      await expect(controls).toHaveCount(2);
      const targets = await controls.evaluateAll((elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      }));
      expect(targets.every(({ height, width: targetWidth }) => height >= 44 && targetWidth >= 44)).toBe(true);
      await capture(page, testInfo, `demo-results-sort-${width}-${theme}-${browserName}.png`);
    }
  }
});

for (const font of ["platform", "verdana"] as const) {
  test(`200 percent ${font} text preserves Results sorting without overflow`, async ({ page, browserName }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installHarness(page);
    await page.goto(`/demo?results-sort-text=${font}`);
    if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await fillAcceptedCriteria(page);
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await page.getByLabel("Trier ces résultats").selectOption("price_asc");
    await expect(page.locator("#demo-results-sort-applied")).toHaveText("Tri appliqué : Kilométrage décroissant (km d’abord)");
    await expect(page.locator("#demo-results-sort-chosen")).toHaveText("Tri choisi : Prix croissant (EUR d’abord)");
    await expectWrappedTextInsideBox(page, "#demo-results-sort-applied");
    await expectWrappedTextInsideBox(page, "#demo-results-sort-chosen");
    await capture(page, testInfo, `demo-results-sort-390-light-text-200-${font}-${browserName}.png`);
  });
}
