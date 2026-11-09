/* global document, localStorage, MutationObserver, window */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { normalizeDemoSearchText } from "../../packages/demo-search-contract/dist/index.js";

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

async function verifyResultsSort(page, initialQuery, metrics) {
  const isSearchResponse = (response) => new URL(response.url()).origin === ALLOWED_ORIGIN
    && new URL(response.url()).pathname === "/api/demo/v2/search" && response.request().method() === "POST";
  const requests = [];
  const record = (request) => { if (new URL(request.url()).pathname === "/api/demo/v2/search") requests.push(request.postDataJSON()); };
  page.on("request", record);
  try {
    await page.locator("#demo-results-sort").selectOption("mileage_desc");
    expect(requests).toEqual([]);
    await expect(page.locator(".demo-result-card")).toHaveCount(40);
    const sortedResponsePromise = page.waitForResponse(isSearchResponse);
    await page.locator("#demo-results-sort-apply").click();
    const sortedResponse = await sortedResponsePromise;
    expect(sortedResponse.status()).toBe(200);
    const sortedQuery = { ...initialQuery, sort: "mileage_desc" };
    expect(sortedResponse.request().postDataJSON()).toEqual(sortedQuery);
    expect(sortedQuery.cursor).toBeUndefined();
    const sorted = (await sortedResponse.json()).data;
    await expect(page.locator(".demo-result-card")).toHaveCount(20);
    await expect(page.locator("#demo-screen-title")).toBeFocused();
    expect(sorted.results).toHaveLength(20);
    expect(typeof sorted.nextCursor).toBe("string");
    expect(sorted.nextCursor.length).toBeGreaterThan(0);
    const pageResponsePromise = page.waitForResponse(isSearchResponse);
    await page.locator("#demo-load-more").click();
    const pageResponse = await pageResponsePromise;
    expect(pageResponse.status()).toBe(200);
    expect(pageResponse.request().postDataJSON()).toEqual({ ...sortedQuery, cursor: sorted.nextCursor });
    const continuation = (await pageResponse.json()).data;
    const expected = [...sorted.results, ...continuation.results];
    expect(expected).toHaveLength(40);
    await expect(page.locator(".demo-result-card")).toHaveCount(40);
    // Check every rendered mileage in server order, not a client-sorted expectation.
    const displayed = await page.locator(".demo-result-card .demo-facts > div:last-child dd").allTextContents();
    expect(displayed.map((value) => value.replace(/\s/gu, "").replace(",", "."))).toEqual(expected.map((result) => {
      expect(result.mileage.status).toBe("observed");
      return `${result.mileage.value.amount}${result.mileage.value.unit}`;
    }));
    expect(requests).toHaveLength(2);
    metrics.resultsSortEngines += 1;
  } finally { page.off("request", record); }
}

async function submitSearchWithEnvelope(page, pathName, outerVersion, expectedText, metrics, measureFeedback = false) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === ALLOWED_ORIGIN && url.pathname === pathName && response.request().method() === "POST";
  });
  if (measureFeedback) {
    const feedbackMs = await page.getByRole("button", { name: "Rechercher", exact: true }).evaluate((button) =>
      new Promise((resolve, reject) => {
        const startedAt = window.performance.now();
        const timeout = window.setTimeout(() => { observer.disconnect(); reject(new Error("keyword_search_feedback_timeout")); }, 500);
        const observer = new MutationObserver(() => {
          if (button.textContent?.includes("Recherche…")) {
            window.clearTimeout(timeout);
            observer.disconnect();
            resolve(window.performance.now() - startedAt);
          }
        });
        observer.observe(button, { childList: true, subtree: true, characterData: true });
        button.click();
      }));
    expect(feedbackMs).toBeLessThanOrEqual(100);
    metrics.keywordFeedbackMs.push(feedbackMs);
  } else {
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  }
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const requestBody = response.request().postDataJSON();
  expect(requestBody.schemaVersion).toBe(outerVersion);
  if (expectedText === undefined) expect(requestBody.text).toBeUndefined();
  else expect(requestBody.text).toBe(expectedText);
  const envelope = await response.json();
  expect(envelope.schemaVersion).toBe(outerVersion);
  expect(envelope.data.schemaVersion).toBe(2);
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
}

async function assertKeywordSummary(page, canonicalText) {
  const row = page.locator(".demo-saved-search-criteria").filter({ hasText: "Mots recherchés" }).first();
  await expect(row.getByText("Mots recherchés", { exact: true })).toBeVisible();
  await expect(row.getByText(canonicalText, { exact: true })).toBeVisible();
}

async function inspectSavedSearchCriteria(page) {
  const row = page.locator(".demo-saved-search").first();
  const details = row.locator(".demo-saved-search-disclosure");
  const summary = details.locator("summary");
  const criteria = details.locator(".demo-saved-search-criteria");
  const before = await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), Object.values(PROTOTYPE_KEYS));
  const beforeUrl = page.url();
  const requests = [];
  const recordRequest = (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); };
  page.on("request", recordRequest);
  try {
    await expect(details).toHaveJSProperty("open", false);
    await expect(criteria).toBeHidden();
    await expect(row.locator("#demo-saved-search-load-0")).toBeVisible();
    await summary.focus();
    await summary.press("Enter");
    await expect(criteria).toBeVisible();
    await expect(summary).toBeFocused();
    await summary.press("Space");
    await expect(criteria).toBeHidden();
    await summary.press("Enter");
    await expect(criteria).toBeVisible();
    await expect(summary).toBeFocused();
    expect(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), Object.values(PROTOTYPE_KEYS))).toEqual(before);
    expect(page.url()).toBe(beforeUrl);
    expect(requests).toEqual([]);
  } finally { page.off("request", recordRequest); }
}

async function verifySearchRefinement(page, evidenceDirectory, engine, searchRequests, metrics, canonicalText) {
  const before = searchRequests.length;
  const originalCards = await page.locator(".demo-result-card").allTextContents();
  await page.locator("#demo-remove-text").click();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  await expect(page.getByLabel("Recherche par mots")).toHaveValue("");
  await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
  await audit(page); metrics.axeAudits += 1;
  await capture(page, evidenceDirectory, engine, "phone-refinement-prepared", metrics.screenshots);
  expect(searchRequests.length).toBe(before);
  await page.locator("#demo-refinement-cancel").click();
  await expect(page.locator("#demo-remove-text")).toBeFocused();
  await expect(page.locator(".demo-result-card")).toHaveCount(40);
  expect(await page.locator(".demo-result-card").allTextContents()).toEqual(originalCards);
  expect(searchRequests.length).toBe(before);

  await page.locator("#demo-remove-text").click();
  const nextRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/demo/v2/search" && request.method() === "POST");
  await submitSearchWithEnvelope(page, "/api/demo/v2/search", 2, undefined, metrics);
  expect((await nextRequest).postDataJSON()).toEqual({ schemaVersion: 2, sort: "listing_asc" });
  expect(searchRequests.length).toBe(before + 1);
  await expect(page.locator(".demo-result-card")).toHaveCount(20);
  await expect(page.locator("#demo-remove-text")).toHaveCount(0);

  // Leave the existing keyword/save/restart journey on its original query.
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await expect(page.getByLabel("Recherche par mots")).toHaveValue("");
  await page.getByLabel("Recherche par mots").fill(canonicalText);
  await submitSearchWithEnvelope(page, "/api/demo/v3/search", 3, canonicalText, metrics);
  await page.locator("#demo-load-more").click();
  await expect(page.locator(".demo-result-card")).toHaveCount(40);
  metrics.refinementEngines += 1;
}

async function verifyKeywordShare(page, evidenceDirectory, engine, searchRequests, metrics, modelName, canonicalText) {
  const beforeCreate = searchRequests.length;
  await page.locator("#demo-search-link-start").click();
  const sharedUrl = await page.locator("#demo-search-link-url").inputValue();
  expect(sharedUrl).toContain("#search-link/v2/");
  expect(searchRequests.length).toBe(beforeCreate);
  await capture(page, evidenceDirectory, engine, "phone-keyword-link", metrics.screenshots);

  await page.goto(sharedUrl, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Recherche reçue" })).toBeVisible();
  await assertKeywordSummary(page, canonicalText);
  await assertNoHorizontalOverflow(page);
  await audit(page);
  metrics.axeAudits += 1;
  await page.waitForTimeout(250);
  expect(searchRequests.length).toBe(beforeCreate);
  await capture(page, evidenceDirectory, engine, "phone-keyword-link-review", metrics.screenshots);

  await page.locator("#demo-search-link-load").click();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await expect(page.getByLabel("Recherche par mots")).toHaveValue(canonicalText);
  await page.waitForTimeout(250);
  expect(searchRequests.length).toBe(beforeCreate);
  await submitSearchWithEnvelope(page, "/api/demo/v3/search", 3, canonicalText, metrics);
  expect(searchRequests.length).toBe(beforeCreate + 1);
  await expect(page.locator(".demo-result-card")).toHaveCount(20);
  await expect(page.locator(".demo-result-card").filter({ hasText: modelName })).toHaveCount(20);
  await page.locator("#demo-load-more").click();
  await expect(page.locator(".demo-result-card")).toHaveCount(40);
  await expect(page.locator(".demo-result-card").filter({ hasText: modelName })).toHaveCount(40);
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

async function renameSearch(page, name) {
  const before = await page.evaluate((keys) => Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, localStorage.getItem(value)])), PROTOTYPE_KEYS);
  const calls = [];
  const recordRequest = (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.url()); };
  page.on("request", recordRequest);
  try {
    await page.locator("#demo-saved-search-rename-0").click();
    await page.getByLabel("Nouveau nom", { exact: true }).fill(name);
    await page.locator(".demo-rename-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.locator("#demo-saved-search-name-0")).toHaveText(name);
    await expect(page.locator("#demo-saved-search-rename-0")).toBeFocused();
    const after = await page.evaluate((keys) => Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, localStorage.getItem(value)])), PROTOTYPE_KEYS);
    const expected = JSON.parse(before.searches);
    expected.searches[0].name = name;
    expect(JSON.parse(after.searches)).toEqual(expected);
    expect(after.favorites).toBe(before.favorites);
    expect(after.comparisons).toBe(before.comparisons);
    expect(calls).toEqual([]);
  } finally { page.off("request", recordRequest); }
}

async function openKeywordEngine(engine, browser, evidenceDirectory, metrics) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", locale: "fr-FR" });
  const page = await context.newPage();
  const externalRequests = [];
  const searchRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== ALLOWED_ORIGIN) externalRequests.push(url.origin);
    if (url.origin === ALLOWED_ORIGIN && (url.pathname === "/api/demo/v2/search" || url.pathname === "/api/demo/v3/search") && request.method() === "POST") searchRequests.push(url.pathname);
  });
  try {
    const catalogPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === ALLOWED_ORIGIN && url.pathname === "/api/demo/v2/catalog" && response.request().method() === "GET";
    });
    await page.goto(WEB_URL, { waitUntil: "networkidle" });
    const catalogResponse = await catalogPromise;
    expect(catalogResponse.status()).toBe(200);
    const catalogEnvelope = await catalogResponse.json();
    expect(catalogEnvelope.schemaVersion).toBe(2);
    expect(catalogEnvelope.data.schemaVersion).toBe(2);
    const model = catalogEnvelope.data.taxonomyRelease.models[0];
    const make = catalogEnvelope.data.taxonomyRelease.makes.find((candidate) => candidate.makeId === model.makeId);
    expect(make).toBeTruthy();
    const modelName = model.primaryName.value;
    const keywordInput = `${make.primaryName.value} ${modelName}`;
    const normalizedText = normalizeDemoSearchText(keywordInput);
    expect(normalizedText.success).toBe(true);
    const canonicalText = normalizedText.data;

    await expect(page.getByLabel("Recherche par mots")).toBeVisible();
    await submitSearchWithEnvelope(page, "/api/demo/v2/search", 2, undefined, metrics);
    expect(searchRequests.at(-1)).toBe("/api/demo/v2/search");
    await page.evaluate(() => { window.location.hash = "#search"; });
    await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();

    await page.getByLabel("Recherche par mots").fill(keywordInput);
    await submitSearchWithEnvelope(page, "/api/demo/v3/search", 3, canonicalText, metrics, true);
    expect(searchRequests.at(-1)).toBe("/api/demo/v3/search");
    await expect(page.locator(".demo-result-card")).toHaveCount(20);
    await expect(page.locator(".demo-result-card").filter({ hasText: modelName })).toHaveCount(20);
    await page.locator("#demo-load-more").click();
    await expect(page.locator(".demo-result-card")).toHaveCount(40);
    await expect(page.locator(".demo-result-card").filter({ hasText: modelName })).toHaveCount(40);
    metrics.keywordResultCounts.push(40);
    await capture(page, evidenceDirectory, engine, "phone-keyword-results", metrics.screenshots);
    await assertNoHorizontalOverflow(page);
    await audit(page);
    metrics.axeAudits += 1;

    await page.locator(".demo-result-card").first().getByRole("button", { name: "Voir le détail" }).click();
    await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
    await capture(page, evidenceDirectory, engine, "phone-keyword-detail", metrics.screenshots);
    await page.getByRole("button", { name: "Retour aux résultats" }).click();
    await expect(page.locator(".demo-result-card")).toHaveCount(40);

    await page.locator("#demo-save-search-start").click();
    await page.getByLabel("Nom de la recherche").fill("Recherche par mots persistante");
    await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
    await verifyKeywordShare(page, evidenceDirectory, engine, searchRequests, metrics, modelName, canonicalText);
    await verifySearchRefinement(page, evidenceDirectory, engine, searchRequests, metrics, canonicalText);

    await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recherche par mots persistante" })).toBeVisible();
    await inspectSavedSearchCriteria(page);
    await assertKeywordSummary(page, canonicalText);
    expect(await prototypeStorageSummary(page)).toEqual({ favorites: 0, searches: 1, comparisons: 0 });
    await capture(page, evidenceDirectory, engine, "phone-keyword-saved", metrics.screenshots);
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertNoHorizontalOverflow(page);
    await capture(page, evidenceDirectory, engine, "desktop-keyword-saved", metrics.screenshots);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Recherche par mots persistante" })).toBeVisible();
    await inspectSavedSearchCriteria(page);
    await assertKeywordSummary(page, canonicalText);
    expect(externalRequests).toEqual([]);
    metrics.keywordEngines += 1;
    return { context, page, externalRequests, searchRequests, canonicalText, modelName };
  } catch (error) {
    await capture(page, evidenceDirectory, engine, "keyword-failure", metrics.screenshots).catch(() => {});
    await context.close().catch(() => {});
    throw error;
  }
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
    const initialSearchPromise = page.waitForResponse((response) => new URL(response.url()).origin === ALLOWED_ORIGIN
      && new URL(response.url()).pathname === "/api/demo/v2/search" && response.request().method() === "POST");
    await submitSearch(page);
    const initialQuery = (await initialSearchPromise).request().postDataJSON();
    const initialResults = await page.locator(".demo-result-card").count();
    expect(initialResults).toBe(20);
    await page.locator("#demo-load-more").click();
    await expect(page.locator(".demo-result-card")).toHaveCount(40);
    const pagedResults = await page.locator(".demo-result-card").count();
    await verifyResultsSort(page, initialQuery, metrics);
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
    await renameSearch(page, "Recherche persistante renommée");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Duo persistant renommé" })).toBeVisible();
    await expect(page.locator("#demo-saved-search-name-0")).toHaveText("Recherche persistante renommée");
    metrics.searchRenameEngines += 1;
    expect(await prototypeStorageSummary(page)).toEqual({ favorites: 1, searches: 1, comparisons: 1 });
    await assertSentinels(page);
    await capture(page, evidenceDirectory, engine, "phone-saved", metrics.screenshots);
    await inspectSavedSearchCriteria(page);
    await capture(page, evidenceDirectory, engine, "phone-saved-criteria-open", metrics.screenshots);
    metrics.savedCriteriaEngines += 1;

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
    const keyword = await openKeywordEngine(engine, browser, evidenceDirectory, metrics);
    return { engine, browser, context, page, externalRequests, searchRequests, keyword };
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
  await renameSearch(page, "Recherche hors ligne");
  await inspectSavedSearchCriteria(page);
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
  await expect(page.locator("#demo-saved-search-name-0")).toHaveText("Recherche hors ligne");
  expect(await prototypeStorageSummary(page)).toEqual({ favorites: 1, searches: 1, comparisons: 1 });
  await inspectSavedSearchCriteria(page);

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

  const keywordPage = state.keyword.page;
  await keywordPage.reload({ waitUntil: "networkidle" });
  await expect(keywordPage.getByRole("heading", { name: "Recherche par mots persistante" })).toBeVisible();
  await inspectSavedSearchCriteria(keywordPage);
  await assertKeywordSummary(keywordPage, state.keyword.canonicalText);
  expect(await prototypeStorageSummary(keywordPage)).toEqual({ favorites: 0, searches: 1, comparisons: 0 });
  const beforeKeywordLoad = state.keyword.searchRequests.length;
  await keywordPage.locator("#demo-saved-search-load-0").click();
  await expect(keywordPage.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await expect(keywordPage.getByLabel("Recherche par mots")).toHaveValue(state.keyword.canonicalText);
  await keywordPage.waitForTimeout(250);
  expect(state.keyword.searchRequests.length).toBe(beforeKeywordLoad);
  await submitSearchWithEnvelope(keywordPage, "/api/demo/v3/search", 3, state.keyword.canonicalText, metrics);
  expect(state.keyword.searchRequests.length).toBe(beforeKeywordLoad + 1);
  await expect(keywordPage.locator(".demo-result-card")).toHaveCount(20);
  await expect(keywordPage.locator(".demo-result-card").filter({ hasText: state.keyword.modelName })).toHaveCount(20);
  expect(state.keyword.externalRequests).toEqual([]);
  metrics.keywordRestoredEngines += 1;
}

export async function openBrowserJourneys(evidenceDirectory) {
  if (typeof evidenceDirectory !== "string" || evidenceDirectory.length === 0) throw new TypeError("prototype_web_evidence_directory_required");
  const directory = path.resolve(evidenceDirectory);
  await mkdir(directory, { recursive: true });
  const metrics = { engines: 0, axeAudits: 0, unavailableEngines: 0, restoredEngines: 0,
    keywordEngines: 0, keywordRestoredEngines: 0, refinementEngines: 0, searchRenameEngines: 0, savedCriteriaEngines: 0, resultsSortEngines: 0, keywordFeedbackMs: [], keywordResultCounts: [],
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
