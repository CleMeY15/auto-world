/* global document, localStorage, window */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium, webkit, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const WEB_URL = "http://127.0.0.1:3111/demo";
const ALLOWED_ORIGIN = "http://127.0.0.1:3111";
const WCAG_TAGS = Object.freeze(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]);
const OFFLINE_SENTINELS = Object.freeze({
  "auto-world.demo.favorites.v1": "offline-favorites-sentinel",
  "auto-world.demo.saved-searches.v1": "offline-searches-sentinel",
  "auto-world.demo.saved-comparisons.v1": "offline-comparisons-sentinel",
});
const PROTOTYPE_KEYS = Object.freeze({
  favorites: "auto-world.prototype.favorites.v1",
  searches: "auto-world.prototype.saved-searches.v1",
  comparisons: "auto-world.prototype.saved-comparisons.v1",
});

function screenshotName(engine, state) {
  return `prototype-web-${engine}-${state}.png`;
}

async function capture(page, directory, engine, state, screenshots) {
  const name = screenshotName(engine, state);
  await page.screenshot({ path: path.join(directory, name), fullPage: true, scale: "css" });
  screenshots.push(name);
}

async function audit(page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  if (result.violations.length) {
    console.error(JSON.stringify({ event: "prototype_web_accessibility_failed", violations: result.violations.map(({ id, impact, nodes }) =>
      ({ id, impact, targets: nodes.map(({ target }) => target) })) }));
  }
  expect(result.violations).toEqual([]);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
}

async function assertSentinels(page) {
  const values = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(OFFLINE_SENTINELS));
  expect(values).toEqual(OFFLINE_SENTINELS);
}

async function prototypeStorageSummary(page) {
  return page.evaluate((keys) => {
    const read = (key) => {
      const source = localStorage.getItem(key);
      if (source === null) return 0;
      const value = JSON.parse(source);
      if (Array.isArray(value.listingIds)) return value.listingIds.length;
      if (Array.isArray(value.searches)) return value.searches.length;
      if (Array.isArray(value.comparisons)) return value.comparisons.length;
      return -1;
    };
    return { favorites: read(keys.favorites), searches: read(keys.searches), comparisons: read(keys.comparisons) };
  }, PROTOTYPE_KEYS);
}

async function selectPrototypeFilters(page) {
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await page.getByLabel("Budget maximum (€)").fill("40000");
  await page.getByLabel("Kilométrage maximum (km)").fill("200000");
  await page.getByLabel("Année de première immatriculation fictive").fill("2016");
  await page.getByLabel("Marque fictive").selectOption({ label: "Marque A fictive" });
  await page.getByLabel("Modèle fictif").selectOption({ label: "Modèle A1 fictif" });
  await page.getByLabel("Trier les résultats").selectOption("price_asc");
}

async function submitSearch(page) {
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
}

async function saveInitialLists(page) {
  const cards = page.locator(".demo-result-card");
  await expect(cards).toHaveCount(40);
  await cards.nth(0).getByRole("button", { name: "Ajouter aux favoris" }).click();
  await cards.nth(0).getByRole("button", { name: /^Comparer —/u }).click();
  await cards.nth(1).getByRole("button", { name: /^Comparer —/u }).click();

  await page.locator("#demo-save-search-start").click();
  await page.getByLabel("Nom de la recherche").fill("Prototype persistant");
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();

  await cards.nth(0).getByRole("button", { name: "Voir le détail" }).click();
  await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historique des observations" })).toBeVisible();
  await expect(page.getByText("Déclaration issue d’une fixture synthétique, non vérifiée comme fait automobile.")).toBeVisible();
}

async function saveComparison(page) {
  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await page.locator("#demo-comparison-open").click();
  await expect(page.getByRole("heading", { name: "Comparer" })).toBeVisible();
  await page.locator("#demo-save-comparison-start").click();
  await page.getByLabel("Nom de la comparaison").fill("Duo persistant");
  await page.locator(".demo-save-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
}

async function renameComparison(page, name) {
  await page.locator("#demo-saved-comparison-rename-0").click();
  await page.getByLabel("Nouveau nom").fill(name);
  await page.locator(".demo-rename-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function openEngine(engine, launcher, evidenceDirectory, metrics) {
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", locale: "fr-FR" });
  const page = await context.newPage();
  const externalRequests = [];
  const searchRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== ALLOWED_ORIGIN) externalRequests.push(url.origin);
    if (url.origin === ALLOWED_ORIGIN && url.pathname === "/api/demo/v2/search" && request.method() === "POST") searchRequests.push(url.pathname);
  });
  try {
    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    await page.evaluate((sentinels) => { for (const [key, value] of Object.entries(sentinels)) localStorage.setItem(key, value); }, OFFLINE_SENTINELS);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
    await expect(page.getByText("Prototype local persistant", { exact: true })).toBeVisible();
    await expect(page.getByText("Prototype local persistant sur données entièrement synthétiques. Aucun véhicule à vendre.")).toBeVisible();
    await selectPrototypeFilters(page);
    await submitSearch(page);
    const initialResults = await page.locator(".demo-result-card").count();
    expect(initialResults).toBe(20);
    await page.locator("#demo-load-more").click();
    await expect(page.locator(".demo-result-card")).toHaveCount(40);
    const pagedResults = await page.locator(".demo-result-card").count();
    await capture(page, evidenceDirectory, engine, "phone-results", metrics.screenshots);
    await saveInitialLists(page);
    await capture(page, evidenceDirectory, engine, "phone-detail", metrics.screenshots);
    await audit(page);
    metrics.axeAudits += 1;
    await saveComparison(page);
    await capture(page, evidenceDirectory, engine, "phone-comparison", metrics.screenshots);
    await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mes listes" })).toBeVisible();
    await renameComparison(page, "Duo persistant renommé");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Duo persistant renommé" })).toBeVisible();
    expect(await prototypeStorageSummary(page)).toEqual({ favorites: 1, searches: 1, comparisons: 1 });
    await assertSentinels(page);
    await capture(page, evidenceDirectory, engine, "phone-saved", metrics.screenshots);

    await page.setViewportSize({ width: 1440, height: 900 });
    await audit(page);
    metrics.axeAudits += 1;
    await assertNoHorizontalOverflow(page);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await capture(page, evidenceDirectory, engine, "desktop-saved-focus", metrics.screenshots);
    await page.setViewportSize({ width: 390, height: 844 });
    // Exercise the new prototype disclosure itself, not only the offline suite.
    await page.evaluate(() => { window.location.hash = "#search"; });
    for (const [width, height, colorScheme, textScale] of [[320, 780, "light", "100%"],
      [768, 1024, "dark", "100%"], [320, 780, "dark", "200%"]]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, textScale);
      // Audit the settled viewport/media/text state, not WebKit's intermediate
      // rendering update. No retry, rule exclusion or assertion is removed.
      await page.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
      await expect(page.getByText("Prototype local persistant", { exact: true })).toBeVisible();
      await expect(page.getByText("Prototype local persistant sur données entièrement synthétiques. Aucun véhicule à vendre.")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await audit(page); metrics.axeAudits += 1;
      await capture(page, evidenceDirectory, engine, `disclosure-${width}-${colorScheme}-${textScale.replace("%", "")}`, metrics.screenshots);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; window.location.hash = "#saved"; });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(externalRequests).toEqual([]);
    metrics.engines += 1;
    metrics.initialResultCounts.push(initialResults);
    metrics.pagedResultCounts.push(pagedResults);
    return { engine, browser, context, page, externalRequests, searchRequests };
  } catch (error) {
    await capture(page, evidenceDirectory, engine, "failure", metrics.screenshots).catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

async function verifyUnavailableEngine(state, evidenceDirectory, metrics) {
  const { page, engine, externalRequests } = state;
  await page.evaluate(() => { window.location.hash = "#search"; });
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByText("Recherche indisponible", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toHaveCount(0);
  await capture(page, evidenceDirectory, engine, "phone-api-unavailable", metrics.screenshots);
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Duo persistant renommé" })).toBeVisible();
  await renameComparison(page, "Duo hors ligne");
  expect(await prototypeStorageSummary(page)).toEqual({ favorites: 1, searches: 1, comparisons: 1 });
  await assertSentinels(page);
  expect(externalRequests).toEqual([]);
  metrics.unavailableEngines += 1;
}

async function verifyRestoredEngine(state, metrics) {
  const { page, externalRequests, searchRequests } = state;
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Mes listes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Duo hors ligne" })).toBeVisible();
  expect(await prototypeStorageSummary(page)).toEqual({ favorites: 1, searches: 1, comparisons: 1 });

  const beforeLoad = searchRequests.length;
  await page.locator("#demo-saved-search-load-0").click();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(searchRequests.length).toBe(beforeLoad);
  await submitSearch(page);
  expect(searchRequests.length).toBe(beforeLoad + 1);

  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.locator("#demo-saved-comparison-open-0").click();
  await page.getByRole("button", { name: "Charger la comparaison" }).click();
  await expect(page.getByRole("button", { name: "Relire toutes les publications" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();

  await page.getByRole("button", { name: "Retour à mes listes" }).click();
  const favoriteDetail = page.locator(".demo-saved-list").getByRole("button", { name: "Voir le détail" }).first();
  await expect(favoriteDetail).toBeVisible();
  await favoriteDetail.click();
  await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historique des observations" })).toBeVisible();
  await assertSentinels(page);
  expect(externalRequests).toEqual([]);
  metrics.restoredEngines += 1;
}

export async function openBrowserJourneys(evidenceDirectory) {
  if (typeof evidenceDirectory !== "string" || evidenceDirectory.length === 0) throw new TypeError("prototype_web_evidence_directory_required");
  const directory = path.resolve(evidenceDirectory);
  await mkdir(directory, { recursive: true });
  const metrics = { engines: 0, axeAudits: 0, unavailableEngines: 0, restoredEngines: 0,
    initialResultCounts: [], pagedResultCounts: [], screenshots: [] };
  const states = [];
  let closed = false;
  try {
    for (const [engine, launcher] of [["chromium", chromium], ["webkit", webkit]]) {
      states.push(await openEngine(engine, launcher, directory, metrics));
    }
  } catch (error) {
    await Promise.allSettled(states.map(async ({ context, browser }) => { await context.close(); await browser.close(); }));
    throw error;
  }
  return Object.freeze({
    metrics,
    async verifyUnavailable() {
      if (closed) throw new Error("prototype_web_browser_closed");
      for (const state of states) await verifyUnavailableEngine(state, directory, metrics);
    },
    async verifyRestored() {
      if (closed) throw new Error("prototype_web_browser_closed");
      for (const state of states) await verifyRestoredEngine(state, metrics);
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled(states.map(async ({ context, browser }) => { await context.close(); await browser.close(); }));
    },
  });
}
