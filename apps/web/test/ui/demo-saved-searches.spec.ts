import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { demoFixtureVersion, demoMakeIds, demoModelIds, demoRelease, mockDemoCatalog, v2Envelope, v2Response } from "./demo-v2-fixtures";

const savedSearchKey = "auto-world.demo.saved-searches.v1";

type StoredQuery = {
  readonly schemaVersion: 2;
  readonly sort: "listing_asc" | "price_asc" | "price_desc" | "mileage_asc" | "mileage_desc";
  readonly priceMaxMinor?: number;
  readonly mileageMaxKm?: number;
  readonly makeId?: string;
  readonly modelId?: string;
  readonly firstRegistrationYear?: number;
};

function storedSearch(name: string, query: StoredQuery, fixtureVersion = demoFixtureVersion) {
  const hasIdentity = query.makeId !== undefined || query.modelId !== undefined;
  return {
    name,
    criteria: {
      query,
      ...(hasIdentity ? { binding: { fixtureVersion, taxonomyRelease: demoRelease } } : {}),
    },
  };
}

function storedBytes(searches: readonly ReturnType<typeof storedSearch>[]) {
  return JSON.stringify({ schemaVersion: 1, searches });
}

async function seedSavedSearches(context: BrowserContext, searches: readonly ReturnType<typeof storedSearch>[]) {
  await context.addInitScript(({ key, bytes }) => localStorage.setItem(key, bytes), { key: savedSearchKey, bytes: storedBytes(searches) });
}

async function waitUntilReady(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
}

async function submitSearch(page: Page) {
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
}

async function saveAcceptedSearch(page: Page, name: string) {
  await page.locator("#demo-save-search-start").click();
  const field = page.getByLabel("Nom de la recherche");
  await expect(field).toBeFocused();
  await field.fill(name);
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
}

function syntheticResult(index: number, observedAt: string, priceMinor = 3_200_000) {
  const priceEvidence = `ev_${String(index * 2 + 1).padStart(64, "0")}`;
  const mileageEvidence = `ev_${String(index * 2 + 2).padStart(64, "0")}`;
  return {
    listingId: `lst_saved-search-${String(index).padStart(2, "0")}`,
    availability: "active",
    price: { status: "observed", value: { amountMinor: priceMinor, currency: "EUR" }, evidenceId: priceEvidence },
    mileage: { status: "observed", value: { amount: 28_500, unit: "km" }, evidenceId: mileageEvidence },
    evidence: [
      { evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 9_000, value: { amountMinor: priceMinor, currency: "EUR" } },
      { evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 8_500, value: { amount: 28_500, unit: "km" } },
    ],
    description: { status: "unavailable" },
    descriptionEvidence: [],
  } as const;
}

async function fulfillSearch(route: Route, priceMinor = 3_200_000) {
  const observedAt = new Date().toISOString();
  const result = syntheticResult(1, observedAt, priceMinor);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(v2Envelope(v2Response([result], { dataAsOf: observedAt, total: 1 }))),
  });
}

test("an accepted real search persists across reload, restores editable criteria without searching, then submits explicitly", async ({ page }) => {
  const submitted: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/demo/v2/search") && request.method() === "POST") submitted.push(request.postDataJSON());
  });
  await page.goto("/demo");
  await waitUntilReady(page);
  await page.getByLabel("Budget maximum (€)").fill("90071992547409.91");
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await page.getByLabel("Kilométrage maximum (km)").fill("0.0000001");
  await page.getByLabel("Trier les résultats").selectOption("price_desc");
  await submitSearch(page);
  const localOnlyDisclosure = page.locator("#demo-save-search-limit");
  await expect(localOnlyDisclosure).toHaveText("Uniquement dans ce navigateur. Aucun compte ni alerte.");
  expect(await localOnlyDisclosure.evaluate((disclosure) => {
    const trigger = document.querySelector("#demo-save-search-start");
    if (trigger === null) throw new Error("Expected the save-search trigger");
    return Boolean(disclosure.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await saveAcceptedSearch(page, "Très grand budget");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toContain("Très grand budget");

  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.reload();
  const row = page.locator(".demo-saved-search").filter({ hasText: "Très grand budget" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("90071992547409.91");
  await expect(row).toContainText("0.0000001");
  const searchesBeforeRestore = submitted.length;
  await row.getByRole("button", { name: "Charger les critères", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("90071992547409.91");
  await expect(page.getByLabel("Kilométrage maximum (km)")).toHaveValue("0.0000001");
  await expect(page.getByLabel("Trier les résultats")).toHaveValue("price_desc");
  expect(submitted).toHaveLength(searchesBeforeRestore);
  await submitSearch(page);
  expect(submitted).toHaveLength(searchesBeforeRestore + 1);
});

test("an honestly stale accepted response can still be saved and restored without a background search", async ({ page }) => {
  const oldDataAsOf = new Date(Date.now() - 120_000).toISOString();
  let searchCalls = 0;
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    searchCalls += 1;
    const response = v2Response([syntheticResult(1, oldDataAsOf)], { state: "stale", dataAsOf: oldDataAsOf });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v2Envelope(response)) });
  });
  await page.goto("/demo");
  await submitSearch(page);
  await expect(page.getByText(/instant de démonstration est ancien/i)).toBeVisible();
  await saveAcceptedSearch(page, "Projection ancienne");
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.locator(".demo-saved-search").getByRole("button", { name: "Charger les critères", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  await expect(page.locator(".demo-announcement")).toContainText("Les critères de « Projection ancienne » sont prêts.");
  expect(searchCalls).toBe(1);
});

test("saving after pagination keeps the first accepted cursorless criteria", async ({ page }) => {
  let calls = 0;
  const cursor = `cur_${"a".repeat(64)}`;
  const observedAt = new Date().toISOString();
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    calls += 1;
    const response = calls === 1
      ? v2Response([syntheticResult(1, observedAt)], { dataAsOf: observedAt, cursor, total: 2 })
      : v2Response([syntheticResult(2, observedAt)], { dataAsOf: observedAt, total: 2 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v2Envelope(response)) });
  });
  await page.goto("/demo");
  await submitSearch(page);
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.getByRole("button", { name: "Charger plus" })).toHaveCount(0);
  await saveAcceptedSearch(page, "Sans curseur");
  const persisted = await page.evaluate((key) => localStorage.getItem(key), savedSearchKey);
  expect(persisted).not.toContain("cursor");
  expect(JSON.parse(persisted!).searches[0].criteria.query).toEqual({ schemaVersion: 2, sort: "listing_asc" });
});

test("an edited but unsubmitted draft never replaces the accepted criteria", async ({ page }) => {
  await page.goto("/demo");
  await submitSearch(page);
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByLabel("Budget maximum (€)").fill("12345.67");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await saveAcceptedSearch(page, "Critères acceptés");
  const persisted = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), savedSearchKey))!);
  expect(persisted.searches[0].criteria.query.priceMaxMinor).toBeUndefined();
});

test("an invalid saved-search name keeps focus on the labelled field", async ({ page }) => {
  await page.goto("/demo");
  await submitSearch(page);
  await page.locator("#demo-save-search-start").click();
  await page.getByLabel("Nom de la recherche").fill("   ");
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Choisissez un nom de 1 à 60 caractères, sans caractères de contrôle.")).toBeVisible();
  await expect(page.getByLabel("Nom de la recherche")).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBeNull();
});

test("cancelling the saved-search form returns focus to its trigger", async ({ page }) => {
  await page.goto("/demo");
  await submitSearch(page);
  await page.locator("#demo-save-search-start").click();
  await page.getByLabel("Nom de la recherche").fill("Brouillon");
  await page.locator("#demo-save-search-cancel").click();
  await expect(page.locator("#demo-save-search-start")).toBeFocused();
  await expect(page.locator(".demo-save-search-form")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBeNull();
});

test("a sixty-code-point name with emoji and markup-like text renders only as escaped text", async ({ page }) => {
  const name = `<b>${"🚗".repeat(57)}`;
  expect([...name]).toHaveLength(60);
  await page.goto("/demo");
  await submitSearch(page);
  await saveAcceptedSearch(page, name);
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  const row = page.locator(".demo-saved-search");
  await expect(row.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(row.locator("b")).toHaveCount(0);
});

test("duplicate criteria are rejected independently from their name", async ({ page, context }) => {
  await seedSavedSearches(context, [storedSearch("Déjà là", { schemaVersion: 2, sort: "listing_asc" })]);
  await page.goto("/demo");
  await submitSearch(page);
  const destination = page.getByRole("button", { name: "Voir la recherche enregistrée" });
  await expect(destination).toBeVisible();
  await expect(page.locator(".demo-save-search-form")).toHaveCount(0);
  await destination.click();
  await expect(page.locator(".demo-saved-search").filter({ hasText: "Déjà là" })).toBeVisible();
});

test("the eleventh saved search is rejected with a management action", async ({ page, context }) => {
  const full = Array.from({ length: 10 }, (_, index) => storedSearch(`Recherche ${index + 1}`, { schemaVersion: 2, sort: "listing_asc", priceMaxMinor: 10_000 + index }));
  await seedSavedSearches(context, full);
  await page.goto("/demo");
  await submitSearch(page);
  await expect(page.getByText("Vous avez atteint la limite de 10 recherches enregistrées.")).toBeVisible();
  const management = page.getByRole("button", { name: "Gérer les recherches" });
  await expect(management).toBeVisible();
  await expect(page.locator(".demo-save-search-form")).toHaveCount(0);
  await management.click();
  await expect(page.getByRole("heading", { name: "Recherches enregistrées (10 sur 10)" })).toBeVisible();
});

test("removing and undoing one search restores keyboard focus to its row", async ({ page, context }) => {
  await seedSavedSearches(context, [storedSearch("Trajet quotidien", { schemaVersion: 2, sort: "mileage_asc", mileageMaxKm: 45_000 })]);
  await page.goto("/demo#saved");
  const row = page.locator(".demo-saved-search").filter({ hasText: "Trajet quotidien" });
  await row.getByRole("button", { name: "Supprimer", exact: true }).click();
  const undo = page.locator("#demo-saved-search-undo");
  await expect(undo).toBeFocused();
  await expect(page.getByText("Une recherche enregistrée vient d’être supprimée.")).toBeVisible();
  await undo.click();
  await expect(page.locator(".demo-saved-search").filter({ hasText: "Trajet quotidien" }).getByRole("button", { name: "Supprimer", exact: true })).toBeFocused();
});

test("catalogue mismatch requires explicit identity omission and never exposes raw identifiers", async ({ page, context }) => {
  await seedSavedSearches(context, [storedSearch("Identité ancienne", {
    schemaVersion: 2,
    sort: "mileage_desc",
    priceMaxMinor: 4_500_000,
    mileageMaxKm: 60_000,
    makeId: demoMakeIds.alpha,
    modelId: demoModelIds.alphaOne,
    firstRegistrationYear: 2022,
  }, "old-fixture")]);
  await mockDemoCatalog(page);
  let searchCalls = 0;
  await page.route("**/api/demo/v2/search", async (route) => { searchCalls += 1; await route.abort(); });
  await page.goto("/demo#saved");
  await expect(page.getByText("La marque ou le modèle de cette recherche n’est plus disponible dans le catalogue validé.")).toBeVisible();
  await expect(page.getByText(/make_ui_|model_ui_|taxcat_|taxrel_/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Charger les critères", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Charger sans marque ni modèle", exact: true }).click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("45000");
  await expect(page.getByLabel("Kilométrage maximum (km)")).toHaveValue("60000");
  await expect(page.getByLabel("Marque fictive")).toHaveValue("");
  await expect(page.getByLabel("Modèle fictif")).toHaveValue("");
  await expect(page.getByLabel("Année de première immatriculation fictive")).toHaveValue("2022");
  await expect(page.getByLabel("Trier les résultats")).toHaveValue("mileage_desc");
  expect(searchCalls).toBe(0);
});

test("numeric-only saved criteria remain restorable while offline without submitting", async ({ page, context }) => {
  await seedSavedSearches(context, [storedSearch("Hors connexion", {
    schemaVersion: 2,
    sort: "mileage_asc",
    priceMaxMinor: 3_050_099,
    mileageMaxKm: 42_000.5,
    firstRegistrationYear: 2020,
  })]);
  let searchCalls = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/demo/v2/search")) searchCalls += 1; });
  await page.goto("/demo#saved");
  await expect(page.locator(".demo-saved-search").filter({ hasText: "Hors connexion" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Charger les critères", exact: true }).click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30500.99");
  await expect(page.getByLabel("Kilométrage maximum (km)")).toHaveValue("42000.5");
  await expect(page.getByLabel("Année de première immatriculation fictive")).toHaveValue("2020");
  await expect(page.getByLabel("Trier les résultats")).toHaveValue("mileage_asc");
  expect(searchCalls).toBe(0);
});

test("real cross-tab replacement and clear reconcile the visible saved-search list", async ({ page, context }) => {
  await page.goto("/demo#saved");
  await waitUntilReady(page);
  const writer = await context.newPage();
  await writer.goto("/demo#saved");
  const bytes = storedBytes([storedSearch("Écrite ailleurs", { schemaVersion: 2, sort: "price_asc", priceMaxMinor: 2_500_000 })]);
  await writer.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: savedSearchKey, value: bytes });
  await expect(page.locator(".demo-saved-search").filter({ hasText: "Écrite ailleurs" })).toBeVisible();
  await writer.evaluate((key) => localStorage.removeItem(key), savedSearchKey);
  await expect(page.locator(".demo-saved-search")).toHaveCount(0);
});

test("corrupt saved-search bytes are preserved until explicit reset", async ({ page }) => {
  await page.addInitScript(({ key }) => {
    if (sessionStorage.getItem("aw-saved-corrupt-seeded") === null) {
      localStorage.setItem(key, "{broken");
      sessionStorage.setItem("aw-saved-corrupt-seeded", "1");
    }
  }, { key: savedSearchKey });
  await page.goto("/demo#saved");
  await expect(page.getByText(/recherches enregistrées.*illisibles/i)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Aucun élément enregistré" })).toHaveCount(0);
  await expect(page.locator(".demo-section-empty")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBe("{broken");
  await page.locator("#demo-saved-search-reset-start").click();
  await page.locator("#demo-saved-search-reset-confirm").click();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBeNull();
});

test("a cross-tab corruption change invalidates the old reset confirmation before preserving the new bytes", async ({ page, context }) => {
  const corruptA = "{corrupt-a";
  const corruptB = "{corrupt-b";
  await page.addInitScript(({ key, bytes }) => localStorage.setItem(key, bytes), { key: savedSearchKey, bytes: corruptA });
  await page.goto("/demo#saved");
  await expect(page.getByText(/recherches enregistrées.*illisibles/i)).toBeVisible();
  await page.locator("#demo-saved-search-reset-start").click();
  await expect(page.locator("#demo-saved-search-reset-confirm")).toBeFocused();

  const writer = await context.newPage();
  await writer.goto("/demo#saved");
  await writer.evaluate(({ key, bytes }) => localStorage.setItem(key, bytes), { key: savedSearchKey, bytes: corruptB });
  await expect(page.locator("#demo-saved-search-reset-confirm")).toHaveCount(0);
  await expect(page.locator("#demo-saved-search-reset-start")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBe(corruptB);

  await page.locator("#demo-saved-search-reset-start").click();
  await page.locator("#demo-saved-search-reset-confirm").click();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBeNull();
});

test("future saved-search bytes remain read-only and cannot be reset", async ({ page }) => {
  const future = JSON.stringify({ schemaVersion: 2, searches: [] });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: savedSearchKey, value: future });
  await page.goto("/demo#saved");
  await expect(page.getByText(/version plus récente/i)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Aucun élément enregistré" })).toHaveCount(0);
  await expect(page.locator(".demo-section-empty")).toHaveCount(0);
  await expect(page.locator("#demo-saved-search-reset-start")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBe(future);
});

test("denied local storage keeps the saved-search interface in truthful session mode", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { throw new DOMException("denied", "SecurityError"); },
  }));
  await page.goto("/demo#saved");
  await expect(page.getByText("Le stockage local est inaccessible. Les recherches ajoutées restent limitées à cette session.", { exact: true })).toBeVisible();
});

test("quota failure retains the newly saved search for this session without overwriting persistent bytes", async ({ page }) => {
  await page.addInitScript(({ key }) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === key) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, itemKey, value);
    };
  }, { key: savedSearchKey });
  await page.goto("/demo");
  await submitSearch(page);
  await saveAcceptedSearch(page, "Session seulement");
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await expect(page.locator(".demo-saved-search").filter({ hasText: "Session seulement" })).toBeVisible();
  await expect(page.getByText("L’enregistrement local est plein. Les recherches ajoutées restent limitées à cette session.", { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), savedSearchKey)).toBeNull();
});

test("restoring saved criteria aborts a late search response before it can replace the form", async ({ page, context }) => {
  await seedSavedSearches(context, [storedSearch("Budget gardé", { schemaVersion: 2, sort: "price_asc", priceMaxMinor: 3_000_000 })]);
  let release: (() => void) | undefined;
  let settleLate: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const lateSettled = new Promise<void>((resolve) => { settleLate = resolve; });
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    await held;
    await fulfillSearch(route, 4_000_000).catch(() => {});
    settleLate?.();
  });
  await page.goto("/demo");
  await page.getByLabel("Budget maximum (€)").fill("40000");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recherche…", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.locator(".demo-saved-search").getByRole("button", { name: "Charger les critères", exact: true }).click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30000");
  release?.();
  await lateSettled;
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30000");
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toHaveCount(0);
});

test("disabled runtime manages local saved searches without any demo API request", async ({ page, context, request }, testInfo) => {
  const disabledBase = (testInfo.config.metadata as { readonly demoDisabledBaseURL?: unknown }).demoDisabledBaseURL;
  if (typeof disabledBase !== "string") throw new Error("demoDisabledBaseURL metadata is required");
  const serverRender = await request.get(`${disabledBase}/demo`);
  expect(serverRender.status()).toBe(200);
  const serverHtml = await serverRender.text();
  expect(serverHtml).toContain("Chargement des éléments enregistrés…");
  expect(serverHtml).not.toContain("Aucun élément enregistré");
  await seedSavedSearches(context, [storedSearch("Locale désactivée", { schemaVersion: 2, sort: "listing_asc", priceMaxMinor: 2_000_000 })]);
  let apiCalls = 0;
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) apiCalls += 1; });
  await page.goto(`${disabledBase}/demo#saved`);
  const row = page.locator(".demo-saved-search").filter({ hasText: "Locale désactivée" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Charger les critères", exact: true })).toBeDisabled();
  await row.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.locator("#demo-saved-search-undo").click();
  await expect(page.locator(".demo-saved-search").filter({ hasText: "Locale désactivée" })).toBeVisible();
  expect(apiCalls).toBe(0);
});

test("saved-search form and populated list pass WCAG automation with 44 pixel controls", async ({ page }) => {
  await page.goto("/demo");
  await submitSearch(page);
  await page.locator("#demo-save-search-start").click();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await expect(page.locator(".demo-save-search-form button, .demo-save-search-form input")).toHaveCount(3);
  const formTargets = await page.locator(".demo-save-search-form button, .demo-save-search-form input").evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  }));
  expect(formTargets.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  await page.getByLabel("Nom de la recherche").fill("Accessible");
  await page.locator(".demo-save-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  const rowTargets = await page.locator(".demo-saved-search button").evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  }));
  expect(rowTargets.length).toBeGreaterThanOrEqual(2);
  expect(rowTargets.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
});
