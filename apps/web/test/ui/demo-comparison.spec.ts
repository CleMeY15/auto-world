import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseDemoSearchResponseV2 } from "@auto-world/demo-search-contract";
import { descriptionFields, mockDemoCatalog, fulfillJson, v2Envelope, v2Error, v2Response } from "./demo-v2-fixtures";

function publication(index: number, observedAt: string, options: { missing?: boolean; mixed?: boolean; conflict?: boolean } = {}) {
  const priceId = `ev_${String(index * 10 + 1).padStart(64, "0")}`;
  const mileageId = `ev_${String(index * 10 + 2).padStart(64, "0")}`;
  const price = { amountMinor: 3_200_000 + index, currency: options.mixed ? "USD" : "EUR" };
  const mileage = { amount: index === 1 ? 0 : 24_000 + index, unit: options.mixed ? "mi" : "km" };
  return {
    listingId: `lst_compare-${index}`,
    availability: "active",
    price: options.missing ? { status: "unavailable" } : { status: "observed", value: price, evidenceId: priceId },
    mileage: { status: "observed", value: mileage, evidenceId: mileageId },
    evidence: [
      ...(options.conflict ? [{ evidenceId: `ev_${String(index * 10).padStart(64, "0")}`, field: "price", observedAt: new Date(Date.parse(observedAt) - 1000).toISOString(), confidenceBps: 5000, value: { ...price, amountMinor: 1 } }] : []),
      ...(options.missing ? [] : [{ evidenceId: priceId, field: "price", observedAt, confidenceBps: 8800, value: price }]),
      { evidenceId: mileageId, field: "mileage", observedAt, confidenceBps: 9200, value: mileage },
    ],
    ...descriptionFields(index, { unavailable: options.missing, contradictory: options.conflict }),
  };
}

async function search(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
}

async function openComparison(page: Page, count = 2) {
  for (let index = 0; index < count; index += 1) await page.locator(`#demo-result-compare-${index}`).click();
  await page.locator("#demo-comparison-open").click();
  await expect(page.getByRole("heading", { name: "Comparer", exact: true })).toBeFocused();
}

async function fixture(page: Page, options: { state?: "partial" | "stale"; hostile?: boolean; catalogFailure?: boolean } = {}) {
  const dataAsOf = new Date(Date.now() - (options.state === "stale" ? 120_000 : 0)).toISOString();
  if (options.catalogFailure) await page.route("**/api/demo/v2/catalog", (route) => fulfillJson(route, v2Error("read_unavailable"), 503));
  else await mockDemoCatalog(page);
  const results = [1, 2, 3, 4].map((index) => publication(index, dataAsOf, options.hostile ? { missing: index === 1, mixed: index === 2, conflict: index === 3 } : {}));
  const data = v2Response(results, { dataAsOf, state: options.state });
  expect(parseDemoSearchResponseV2(data, new Date().toISOString())).toMatchObject({ success: true });
  let calls = 0;
  await page.route("**/api/demo/v2/search", async (route) => { calls += 1; await fulfillJson(route, v2Envelope(data)); });
  await page.goto("/demo");
  await search(page);
  return { calls: () => calls, data };
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = process.env.AW_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  // Inspect a painted layout after viewport, theme, font or selection changes.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>("main > *, .demo-comparison-scroll, .demo-comparison-remove")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.right > document.documentElement.clientWidth + 0.5 ? [{ className: element.className, right: bounds.right }] : [];
    }),
  }));
  expect(layout, JSON.stringify(layout)).toEqual({ viewport: layout.viewport, document: layout.viewport, overflowing: [] });
  const colors = await page.locator("body, h1, .demo-comparison-table tbody th, .demo-comparison-table td").evaluateAll((elements) => elements.map((element) => ({
    element: element.tagName, color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
    token: getComputedStyle(element).getPropertyValue("--aw-color-text"),
  })));
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(audit.violations, JSON.stringify({ capture: name, colors, violations: audit.violations })).toEqual([]);
  const targets = await page.locator("main button, main select").evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width >= 44 && bounds.height >= 44 && element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1;
  }));
  expect(targets.every(Boolean)).toBe(true);
  await page.screenshot({ path: directory ? path.join(directory, name) : testInfo.outputPath(name), fullPage: true, scale: "css" });
}

test("real API comparison is ephemeral, bounded, local and returns to unchanged results", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) api.push(request.url()); });
  await page.goto("/demo");
  await search(page);
  while (await page.locator(".demo-result-card").count() < 3) {
    const previous = await page.locator(".demo-result-card").count();
    await page.getByRole("button", { name: "Charger plus", exact: true }).click();
    await expect.poll(() => page.locator(".demo-result-card").count()).toBeGreaterThan(previous);
  }
  const count = await page.locator(".demo-result-card").count();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  const calls = api.length;
  await page.locator("#demo-result-compare-0").click();
  await expect(page.locator("#demo-comparison-open")).toBeDisabled();
  await page.locator("#demo-result-compare-1").click();
  await page.locator("#demo-result-compare-2").click();
  if (count > 3) await expect(page.locator("#demo-result-compare-3")).toBeDisabled();
  await page.locator("#demo-comparison-open").click();
  await expect(page.locator("h1")).toHaveText("Comparer");
  await expect(page.locator("h1")).toBeFocused();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#demo-comparison-open")).toBeFocused();
  await page.locator("#demo-comparison-open").click();
  await expect(page.getByText(/non actualisées automatiquement/)).toBeVisible();
  await page.locator("#demo-comparison-remove-1").click();
  await expect(page.locator("#demo-comparison-remove-2")).toBeFocused();
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await expect(page.locator("#demo-comparison-open")).toBeFocused();
  await expect(page.locator(".demo-result-card")).toHaveCount(count);
  await expect(page.locator("#demo-result-compare-0")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#demo-result-compare-1")).toHaveAttribute("aria-pressed", "false");
  expect(api.length).toBe(calls);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  await page.locator("#demo-comparison-open").click();
  await page.reload();
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText("Comparer");
});

test("capacity, keyboard removal and below-minimum selection remain manageable", async ({ page }) => {
  const source = await fixture(page);
  await expect(page.locator("#demo-result-compare-0")).toHaveAccessibleName("Comparer — Publication synthétique 01");
  await expect(page.locator("#demo-result-compare-1")).toHaveAccessibleName("Comparer — Publication synthétique 02");
  await openComparison(page, 3);
  expect(await page.locator("tr[data-comparison-field]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-comparison-field")))).toEqual(["availability", "price", "mileage", "make", "model", "firstRegistrationYear"]);
  await expect(page.locator(".demo-comparison-meta").filter({ hasText: "Marque, modèle et année" })).toHaveCount(3);
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await expect(page.locator("#demo-result-compare-3")).toBeDisabled();
  await expect(page.locator("#demo-result-compare-0")).toBeEnabled();
  await expect(page.locator("#demo-result-compare-0")).toHaveAccessibleName("Retirer de la comparaison — Publication synthétique 01");
  await page.locator("#demo-comparison-open").click();
  await page.locator("#demo-comparison-remove-0").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demo-comparison-remove-1")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demo-comparison-remove-2")).toBeFocused();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await expect(page.locator('[data-comparison-field="price"]')).not.toContainText("Identique");
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toBeFocused();
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  expect(source.calls()).toBe(1);
});

test("unknown, incompatible, conflicting and offline observations are not invented", async ({ page, context }, testInfo) => {
  await fixture(page, { state: "stale", hostile: true });
  await openComparison(page, 3);
  await expect(page.locator('[data-comparison-field="price"]')).toContainText(/incompl/i);
  await expect(page.locator('[data-comparison-field="mileage"]')).toContainText(/Non comparable/i);
  await expect(page.locator('[data-comparison-field="availability"]')).toContainText("Publication active");
  await expect(page.locator("main")).toContainText(/historiques?/);
  await expect(page.locator("main")).toContainText(/ancien/);
  await context.setOffline(true);
  await expect(page.locator("main")).toContainText(/hors connexion/i);
  await capture(page, testInfo, `compare-hostile-${testInfo.project.name}.png`);
  await context.setOffline(false);
});

test("unavailable catalogue hides identity but not numeric comparison", async ({ page }) => {
  await fixture(page, { catalogFailure: true });
  await openComparison(page);
  await expect(page.locator('[data-comparison-field="make"]')).toContainText(/incompl/i);
  await expect(page.locator('[data-comparison-field="price"]')).toContainText("Différences");
  await expect(page.locator("main")).not.toContainText("make_ui_");
  await expect(page.locator("main")).not.toContainText("taxrel_");
});

test("comparison display preserves tiny mileage and exact safe-integer price cents", async ({ page }) => {
  await mockDemoCatalog(page);
  const now = new Date().toISOString();
  const results = [1, 2].map((index) => {
    const item = publication(index, now);
    const price = { amountMinor: Number.MAX_SAFE_INTEGER - (index - 1), currency: "EUR" };
    const mileage = { amount: index * 0.0000001, unit: "km" };
    return { ...item, price: { ...item.price, value: price }, mileage: { ...item.mileage, value: mileage }, evidence: item.evidence.map((evidence) => ({ ...evidence, value: evidence.field === "price" ? price : mileage })) };
  });
  const data = v2Response(results, { dataAsOf: now });
  expect(parseDemoSearchResponseV2(data, new Date().toISOString())).toMatchObject({ success: true });
  await page.route("**/api/demo/v2/search", (route) => fulfillJson(route, v2Envelope(data)));
  await page.goto("/demo"); await search(page); await openComparison(page);
  const price = (await page.locator('[data-comparison-field="price"]').innerText()).replace(/[\s\u00a0\u202f]/gu, "");
  expect(price).toContain("90071992547409,91");
  expect(price).toContain("90071992547409,90");
  const mileage = await page.locator('[data-comparison-field="mileage"]').innerText();
  expect(mileage).toMatch(/(?:1e-7|0[,.]0000001)/u);
  expect(mileage).toMatch(/(?:2e-7|0[,.]0000002)/u);
  expect(mileage).toContain("Différences");
});

test("first-page pending success and failure cannot carry old selected IDs", async ({ page }) => {
  await fixture(page, { state: "partial" });
  await page.locator("#demo-result-compare-0").click();
  await page.locator("#demo-result-compare-1").click();
  for (const failure of [true, false]) {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/demo/v2/search", async (route) => {
      await pending;
      if (failure) return fulfillJson(route, v2Error("read_unavailable"), 503);
      const now = new Date().toISOString();
      return fulfillJson(route, v2Envelope(v2Response([publication(1, now), publication(2, now)], { state: "partial", dataAsOf: now })));
    });
    await page.getByRole("button", { name: "Actualiser", exact: true }).click();
    await expect(page.locator("#demo-result-compare-0")).toBeDisabled();
    await expect(page.locator("#demo-result-compare-0")).toHaveAttribute("aria-pressed", "false");
    if (await page.locator("#demo-comparison-open").count()) await expect(page.locator("#demo-comparison-open")).toBeDisabled();
    release();
    await expect(page.locator("#demo-result-compare-0")).toBeEnabled();
    if (failure) await expect(page.getByText("Impossible de poursuivre la lecture")).toBeVisible();
    await expect(page.locator("#demo-result-compare-1")).toHaveAttribute("aria-pressed", "false");
    await openComparison(page);
    if (failure) await expect(page.locator("main")).toContainText(/actualis|lecture/i);
    await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  }
});

test("pagination retains selection when the same snapshot degrades to stale", async ({ page }) => {
  await mockDemoCatalog(page);
  const now = new Date().toISOString();
  const cursor = `cur_${"d".repeat(64)}`;
  await page.route("**/api/demo/v2/search", (route) => {
    const more = Boolean(route.request().postDataJSON().cursor);
    return fulfillJson(route, v2Envelope(v2Response(more ? [publication(3, now)] : [publication(1, now), publication(2, now)], { dataAsOf: now, state: more ? "stale" : undefined, total: 3, cursor: more ? undefined : cursor })));
  });
  await page.goto("/demo"); await search(page);
  await page.locator("#demo-result-compare-0").click();
  await page.locator("#demo-result-compare-1").click();
  // The real parser requires an actually aged snapshot before accepting stale.
  await page.clock.setFixedTime(new Date(Date.parse(now) + 61_000));
  await page.getByRole("button", { name: "Charger plus", exact: true }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(3);
  await expect(page.locator("#demo-result-compare-0")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#demo-comparison-open").click();
  await expect(page.locator("main")).toContainText(/ancien/);
});

test("a non-active search publication is rejected before it can be selected", async ({ page }) => {
  await mockDemoCatalog(page);
  const now = new Date().toISOString();
  await page.route("**/api/demo/v2/search", (route) => fulfillJson(route, v2Envelope(v2Response([{ ...publication(1, now), availability: "withdrawn" }], { dataAsOf: now }))));
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByText("Recherche indisponible", { exact: true })).toBeVisible();
  await expect(page.locator('[id^="demo-result-compare-"]')).toHaveCount(0);
});

test("saved criteria restore and a new query clear comparison without implicit submission", async ({ page }) => {
  const source = await fixture(page);
  await page.locator("#demo-save-search-start").click();
  await page.getByLabel("Nom de la recherche").fill("Comparer plus tard");
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await openComparison(page);
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.getByRole("button", { name: "Charger les critères", exact: true }).click();
  expect(source.calls()).toBe(1);
  await page.evaluate(() => { window.location.hash = "#compare"; });
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  await page.getByRole("button", { name: "Recherche", exact: true }).click();
  await search(page);
  await expect(page.locator("#demo-result-compare-0")).toHaveAttribute("aria-pressed", "false");
  await openComparison(page);
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await page.getByRole("button", { name: "Modifier les critères", exact: true }).click();
  await page.getByLabel("Budget maximum (€)").fill("40000");
  await search(page);
  await expect(page.locator("#demo-result-compare-0")).toHaveAttribute("aria-pressed", "false");
});

test("disabled comparison deep link performs zero API requests", async ({ page }, testInfo) => {
  const calls: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) calls.push(request.url()); });
  await page.goto(`${testInfo.config.metadata.demoDisabledBaseURL}/demo#compare`);
  await expect(page.locator("h1")).toHaveText("Mes listes");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("detail navigation preserves selection and restoring criteria cancels a late refresh", async ({ page }) => {
  const source = await fixture(page, { state: "partial" });
  await page.route("**/api/demo/v2/listings/*", (route) => fulfillJson(route, v2Envelope(v2Response([source.data.results[0]], { dataAsOf: source.data.dataAsOf, state: "partial" }))));
  await page.locator("#demo-save-search-start").click();
  await page.getByLabel("Nom de la recherche").fill("Revenir");
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.locator("#demo-result-compare-0").click();
  await page.locator("#demo-result-compare-1").click();
  await page.locator("#demo-result-open-0").click();
  await expect(page.getByRole("heading", { name: "Historique des observations" })).toBeVisible();
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await expect(page.locator("#demo-result-compare-0")).toHaveAttribute("aria-pressed", "true");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/search", async (route) => { await pending; await fulfillJson(route, v2Envelope(source.data)); });
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(page.locator("#demo-result-compare-0")).toBeDisabled();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.getByRole("button", { name: "Charger les critères", exact: true }).click();
  release();
  await expect(page.locator("h1")).toHaveText("Explorer la démo");
  await page.evaluate(() => { window.location.hash = "#compare"; });
  await expect(page.locator("h1")).toHaveText("Comparer");
  await expect(page.locator(".demo-comparison-table")).toHaveCount(0);
});

test("comparison viewport matrix, keyboard scroll and enlarged text remain accessible", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  await fixture(page);
  await openComparison(page, 3);
  for (const count of [3, 2]) {
    if (count === 2) await page.locator("#demo-comparison-remove-2").click();
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.documentElement.style.removeProperty("--aw-font-family"); });
    for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      for (const theme of ["light", "dark"] as const) {
        await page.getByLabel("Apparence").selectOption(theme);
        await expect(page.locator("html")).toHaveAttribute("data-aw-theme", theme);
        await capture(page, testInfo, `compare-${width}-${theme}-${count}-${browserName}.png`);
        await page.locator(".demo-comparison-scroll").evaluate((node) => { node.scrollLeft = node.scrollWidth; });
        await capture(page, testInfo, `compare-${width}-${theme}-${count}-${browserName}-last-column.png`);
        await page.locator(".demo-comparison-scroll").evaluate((node) => { node.scrollLeft = 0; });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Apparence").selectOption("light");
    const region = page.locator(".demo-comparison-scroll");
    await region.focus();
    await expect(region).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    for (const font of ["platform", "Verdana"] as const) {
      if (font === "Verdana") await page.evaluate(() => { document.documentElement.style.setProperty("--aw-font-family", "Verdana, sans-serif"); });
      await region.evaluate((node) => { node.scrollLeft = 0; });
      await capture(page, testInfo, `compare-text-200-${count}-${browserName}-${font}.png`);
      const broken = await page.locator("h1").evaluate((heading) => {
        const text = heading.firstChild as Text;
        const range = document.createRange(); range.selectNodeContents(text);
        return range.getClientRects().length > 1;
      });
      expect(broken).toBe(false);
    }
  }
});
