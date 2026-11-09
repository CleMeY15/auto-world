import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { descriptionFields, mockDemoCatalog, v2Envelope, v2Response, v3Envelope, v3Error } from "./demo-v2-fixtures";

const savedSearchKey = "auto-world.demo.saved-searches.v1";
const maximumCanonicalText = "aaaaaaaaaaaaaa bbbbbbbbbbbbbb cccccccccccccc dddddddddddddd eeeeeeeeeeeeee ffffffffffffff gggggggggggggg hhhhhhhhhhhhhh";

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0 || bounds.right <= viewportWidth + 0.5) return [];
      return [{ selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`, right: Math.round(bounds.right * 10) / 10 }];
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

function keywordResult(observedAt: string) {
  const priceEvidence = `ev_${"1".padStart(64, "0")}`;
  const mileageEvidence = `ev_${"2".padStart(64, "0")}`;
  return {
    listingId: "lst_keyword-alpha",
    availability: "active",
    price: { status: "observed", value: { amountMinor: 3_200_000, currency: "EUR" }, evidenceId: priceEvidence },
    mileage: { status: "observed", value: { amount: 24_000, unit: "km" }, evidenceId: mileageEvidence },
    evidence: [
      { evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 8_800, value: { amountMinor: 3_200_000, currency: "EUR" } },
      { evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 9_200, value: { amount: 24_000, unit: "km" } },
    ],
    ...descriptionFields(1),
  } as const;
}

test("keyword search uses V3 explicitly and survives detail, save and shared-link restoration", async ({ page }) => {
  await mockDemoCatalog(page);
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  const result = keywordResult(observedAt);
  const submitted: unknown[] = [];
  let v2Searches = 0;
  await page.route("**/api/demo/v2/search", async (route) => { v2Searches += 1; await route.abort(); });
  await page.route("**/api/demo/v3/search", async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v3Envelope(v2Response([result], { dataAsOf: observedAt, total: 1 }))) });
  });
  await page.route("**/api/demo/v2/listings/lst_keyword-alpha", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v2Envelope(v2Response([result], { dataAsOf: observedAt, total: 1 }))) });
  });

  await page.goto("/demo");
  const text = page.getByLabel("Recherche par mots");
  await text.fill("Modèle   Alpha");
  await expect.poll(() => submitted.length).toBe(0);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  expect(submitted).toEqual([{ schemaVersion: 3, sort: "listing_asc", text: "alpha modele" }]);
  expect(v2Searches).toBe(0);
  await expect(page.getByText(/Mots : alpha modele/u)).toBeVisible();
  await page.getByRole("button", { name: "Voir le détail" }).click();
  await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await expect(page.getByText(/Mots : alpha modele/u)).toBeVisible();

  await page.locator("#demo-save-search-start").click();
  await page.getByLabel("Nom de la recherche").fill("Alpha");
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  const persisted = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), savedSearchKey);
  expect(persisted.schemaVersion).toBe(2);
  expect(persisted.searches[0].criteria.query).toEqual({ schemaVersion: 3, sort: "listing_asc", text: "alpha modele" });

  await page.locator("#demo-search-link-start").click();
  const sharedUrl = await page.locator("#demo-search-link-url").inputValue();
  expect(new URL(sharedUrl).hash).toMatch(/^#search-link\/v2\//u);
  const beforeRestore = submitted.length;
  await page.goto(sharedUrl);
  await expect(page.getByRole("heading", { name: "Recherche reçue" })).toBeVisible();
  await expect(page.getByText("alpha modele", { exact: true })).toBeVisible();
  expect(submitted.length).toBe(beforeRestore);
  await page.locator("#demo-search-link-load").click();
  await expect(text).toHaveValue("alpha modele");
  expect(submitted.length).toBe(beforeRestore);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect.poll(() => submitted.length).toBe(beforeRestore + 1);
  expect((submitted.at(-1) as { schemaVersion: number }).schemaVersion).toBe(3);

  const violations = await new AxeBuilder({ page }).analyze();
  expect(violations.violations).toEqual([]);
});

test("the real local API searches a current primary model label through V3", async ({ page }) => {
  const catalogReply = await page.request.get("/api/demo/v2/catalog");
  expect(catalogReply.status()).toBe(200);
  const catalog = await catalogReply.json() as { data: { taxonomyRelease: { models: Array<{ modelId: string; primaryName: { value: string } }> } } };
  const seedReply = await page.request.post("/api/demo/v2/search", { data: { schemaVersion: 2, sort: "listing_asc" } });
  expect(seedReply.status()).toBe(200);
  const seed = await seedReply.json() as { data: { results: Array<{ description: { status: string; value?: { modelId: string } } }> } };
  const currentModelId = seed.data.results.find((item) => item.description.status === "authored_synthetic")?.description.value?.modelId;
  const modelLabel = catalog.data.taxonomyRelease.models.find((model) => model.modelId === currentModelId)?.primaryName.value;
  expect(modelLabel).toBeTruthy();
  await page.goto("/demo");
  await page.getByLabel("Recherche par mots").fill(modelLabel!);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/demo/v3/search") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const request = response.request().postDataJSON() as { schemaVersion: number; text: string };
  expect(request.schemaVersion).toBe(3);
  expect(request.text.length).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await expect(page.locator(".demo-result-card").first()).toBeVisible();
});

test("blank keyword input remains on V2 and invalid text never reaches either route", async ({ page }) => {
  await mockDemoCatalog(page);
  let v2Calls = 0;
  let v3Calls = 0;
  await page.route("**/api/demo/v2/search", async (route) => { v2Calls += 1; await route.abort(); });
  await page.route("**/api/demo/v3/search", async (route) => { v3Calls += 1; await route.abort(); });
  await page.goto("/demo");
  const text = page.getByLabel("Recherche par mots");
  await text.fill("***");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(text).toBeFocused();
  await expect(text).toHaveAttribute("aria-invalid", "true");
  expect(v2Calls).toBe(0);
  expect(v3Calls).toBe(0);
  await text.fill("   ");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect.poll(() => v2Calls).toBe(1);
  expect(v3Calls).toBe(0);
});

test("keyword zero-result and offline retry states preserve the accepted words", async ({ page }) => {
  await mockDemoCatalog(page);
  let mode: "offline" | "empty" | "success" = "offline";
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  await page.route("**/api/demo/v3/search", async (route) => {
    if (mode === "offline") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify(v3Error("read_unavailable")) });
    const results = mode === "empty" ? [] : [keywordResult(observedAt)];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v3Envelope(v2Response(results, { dataAsOf: observedAt, total: results.length }))) });
  });
  await page.goto("/demo");
  await page.getByLabel("Recherche par mots").fill("Modèle Alpha");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Recherche indisponible" })).toBeVisible();
  mode = "success";
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByText(/Mots : alpha modele/u)).toBeVisible();
  mode = "empty";
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByText("Aucun résultat synthétique", { exact: true })).toBeVisible();
  await expect(page.getByText(/Mots : alpha modele/u)).toBeVisible();
});

test("long canonical words remain readable across the viewport and theme matrix", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  await mockDemoCatalog(page);
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  await page.route("**/api/demo/v3/search", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v3Envelope(v2Response([keywordResult(observedAt)], { dataAsOf: observedAt, total: 1 }))) });
  });
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.goto(`/demo?keyword-visual=${width}-${theme}`);
      await page.getByLabel("Apparence").selectOption(theme);
      await page.getByLabel("Recherche par mots").fill(maximumCanonicalText);
      if (theme === "light" && (width === 390 || width === 1440)) {
        await capture(page, testInfo, `demo-keyword-input-${width}-${browserName}.png`);
      }
      await page.getByRole("button", { name: "Rechercher", exact: true }).click();
      await expect(page.getByText(`Mots : ${maximumCanonicalText}`, { exact: false })).toBeVisible();
      await capture(page, testInfo, `demo-keyword-${width}-${theme}-${browserName}.png`);
    }
  }
});

test("200 percent platform and Verdana text preserve keyword input and summary", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockDemoCatalog(page);
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  await page.route("**/api/demo/v3/search", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v3Envelope(v2Response([keywordResult(observedAt)], { dataAsOf: observedAt, total: 1 }))) });
  });
  for (const font of ["platform", "Verdana"] as const) {
    await page.goto(`/demo?keyword-text=${font}`);
    if (font === "Verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.getByLabel("Recherche par mots").fill(maximumCanonicalText);
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(page.getByText(`Mots : ${maximumCanonicalText}`, { exact: false })).toBeVisible();
    await capture(page, testInfo, `demo-keyword-390-light-text-200-${browserName}-${font.toLowerCase()}.png`);
  }
});
