import { expect, test, type Page, type Route } from "@playwright/test";

const favoriteKey = "auto-world.demo.favorites.v1";
const nextCursor = (value: string) => `cur_${value.repeat(64)}`;
const requestId = `req_${"e".repeat(32)}`;

function evidenceId(value: number) { return `ev_${String(value).padStart(64, "0")}`; }
function listing(index: number, observedAt: string, availability: "active" | "withdrawn" | "deleted" | "missing" = "active", contradictory = false) {
  const latestPrice = evidenceId(index * 10 + 2);
  const mileage = evidenceId(index * 10 + 3);
  return {
    listingId: `lst_state-${String(index).padStart(2, "0")}`,
    availability,
    price: { status: "observed", value: { amountMinor: 2500000 + index * 100000, currency: "EUR" }, evidenceId: latestPrice },
    mileage: { status: "observed", value: { amount: 20000 + index * 1000, unit: "km" }, evidenceId: mileage },
    evidence: [
      ...(contradictory ? [{ evidenceId: evidenceId(index * 10 + 1), field: "price", observedAt: new Date(Date.parse(observedAt) - 1000).toISOString(), confidenceBps: 7000, value: { amountMinor: 2300000 + index * 100000, currency: "EUR" } }] : []),
      { evidenceId: latestPrice, field: "price", observedAt, confidenceBps: 9000, value: { amountMinor: 2500000 + index * 100000, currency: "EUR" } },
      { evidenceId: mileage, field: "mileage", observedAt, confidenceBps: 8500, value: { amount: 20000 + index * 1000, unit: "km" } },
    ],
  };
}
function response(results: readonly unknown[], options: { readonly state?: "complete" | "partial" | "stale"; readonly dataAsOf?: string; readonly cursor?: string; readonly fixture?: string; readonly total?: number } = {}) {
  const state = options.state ?? "complete";
  const common = { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: options.fixture ?? "ui-states-v1", dataAsOf: options.dataAsOf ?? new Date().toISOString(), results, ...(options.cursor ? { nextCursor: options.cursor } : {}) };
  const data = state === "complete" ? { ...common, state, totalCount: options.total ?? results.length } : state === "partial" ? { ...common, state, reason: "projection_incomplete" } : { ...common, state, reason: "projection_stale" };
  return { schemaVersion: 1, requestId, data };
}
async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
async function ready(page: Page) {
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
}
async function search(page: Page) {
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
}

test("detail exposes withdrawal and contradictory observations, then restores scroll, filters and trigger focus", async ({ page }) => {
  const at = new Date().toISOString();
  const results = Array.from({ length: 8 }, (_, index) => listing(index + 1, at));
  await page.route("**/api/demo/search", (route) => fulfill(route, response(results)));
  await page.route("**/api/demo/listings/*", (route) => fulfill(route, response([listing(6, at, "withdrawn", true)], { total: 1 })));
  await ready(page);
  await page.getByLabel("Budget maximum (€)").fill("50000");
  await search(page);
  const trigger = page.locator("#demo-result-open-5");
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(page.getByText("Publication retirée", { exact: true })).toBeVisible();
  await expect(page.getByText(/se contredisent/)).toBeVisible();
  await page.goBack();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("50000");
});

test("direct detail hash handles a missing publication without exposing an identifier", async ({ page }) => {
  await page.route("**/api/demo/listings/*", (route) => fulfill(route, { schemaVersion: 1, requestId, error: { code: "not_found" } }, 404));
  await page.goto("/demo#detail/lst_state-42");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.getByText("Publication non disponible", { exact: true })).toBeVisible();
  await expect(page.getByText("lst_state-42")).toHaveCount(0);
});

test("empty, partial, stale, slow and closed error states remain explicit", async ({ page }) => {
  let mode: "empty" | "partial" | "stale" | "slow" | "error" = "empty";
  await page.route("**/api/demo/search", async (route) => {
    if (mode === "error") return fulfill(route, { schemaVersion: 1, requestId, error: { code: "read_unavailable" } }, 503);
    if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 850));
    const dataAsOf = mode === "stale" ? new Date(Date.now() - 61_000).toISOString() : new Date().toISOString();
    const items = mode === "empty" ? [] : [listing(1, dataAsOf)];
    await fulfill(route, response(items, { state: mode === "partial" ? "partial" : mode === "stale" ? "stale" : "complete", dataAsOf }));
  });
  await ready(page);
  await search(page);
  await expect(page.getByText("Aucun résultat synthétique")).toBeVisible();
  await page.getByRole("button", { name: "Ajuster les critères" }).click();
  mode = "partial"; await search(page); await expect(page.getByText(/projection est partielle/)).toBeVisible();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  mode = "stale"; await search(page); await expect(page.getByText(/instant de démonstration est ancien/)).toBeVisible();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  mode = "slow"; await page.getByRole("button", { name: "Rechercher", exact: true }).click(); await expect(page.getByText(/plus de temps que prévu/)).toBeVisible(); await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  mode = "error"; await page.getByRole("button", { name: "Rechercher", exact: true }).click(); await expect(page.getByText("Recherche indisponible")).toBeVisible();
});

test("partial and stale results can refresh without losing visible context", async ({ page }) => {
  for (const initialState of ["partial", "stale"] as const) {
    const initialAt = initialState === "stale" ? new Date(Date.now() - 61_000).toISOString() : new Date().toISOString();
    let calls = 0;
    let releaseRefresh: (() => void) | undefined;
    const heldRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await page.unroute("**/api/demo/search");
    await page.route("**/api/demo/search", async (route) => {
      calls += 1;
      if (calls === 1) return fulfill(route, response([listing(1, initialAt)], { state: initialState, dataAsOf: initialAt }));
      await heldRefresh;
      const refreshedAt = new Date().toISOString();
      await fulfill(route, response([listing(2, refreshedAt)], { dataAsOf: refreshedAt, total: 1 }));
    });
    await ready(page); await search(page);
    await expect(page.locator(".demo-result-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Actualiser" }).click();
    await expect(page.getByRole("button", { name: "Actualisation…" })).toBeVisible();
    await expect(page.locator(".demo-result-card")).toHaveCount(1);
    await expect(page.getByText(/26.000,00/)).toBeVisible();
    releaseRefresh?.();
    await expect(page.getByText(/27.000,00/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeFocused();
  }
});

test("favorites explain corrupt, future and denied storage without overwriting it", async ({ page }) => {
  await page.addInitScript(({ key }) => {
    if (sessionStorage.getItem("aw-corrupt-seeded") === null) {
      localStorage.setItem(key, "{broken");
      sessionStorage.setItem("aw-corrupt-seeded", "1");
    }
  }, { key: favoriteKey });
  await ready(page);
  await page.getByRole("button", { name: /Favoris \(0\)/ }).click();
  await expect(page.getByText(/favoris enregistrés sont illisibles/)).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les favoris" }).click();
  await page.getByRole("button", { name: "Confirmer la réinitialisation" }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), favoriteKey)).toBeNull();

  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, listingIds: ["lst_future-01"] })), { key: favoriteKey });
  await page.reload();
  await expect(page.getByText(/version plus récente/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Réinitialiser les favoris" })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), favoriteKey)).toContain('"schemaVersion":2');

  const denied = await page.context().newPage();
  await denied.addInitScript(() => Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } }));
  await denied.goto("/demo#saved");
  await expect(denied.getByText(/stockage local est inaccessible/)).toBeVisible();
});

test("cross-tab reconciliation, removal, undo and confirmed reset preserve favorite truth", async ({ page }) => {
  const at = new Date().toISOString();
  await page.route("**/api/demo/listings/*", (route) => fulfill(route, response([listing(1, at)], { total: 1 })));
  await ready(page);
  await page.evaluate(({ key }) => {
    const value = JSON.stringify({ schemaVersion: 1, listingIds: ["lst_state-01"] });
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
  }, { key: favoriteKey });
  await expect(page.getByRole("button", { name: "Favoris (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Favoris (1)" }).click();
  await page.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Favori synthétique 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retirer", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Réinitialiser les favoris" }).click();
  await expect(page.getByRole("button", { name: "Confirmer la réinitialisation" })).toBeFocused();
  await page.getByRole("button", { name: "Conserver" }).click();
  await expect(page.getByRole("button", { name: "Réinitialiser les favoris" })).toBeFocused();
  await page.getByRole("button", { name: "Réinitialiser les favoris" }).click();
  await page.getByRole("button", { name: "Confirmer la réinitialisation" }).click();
  await expect(page.getByText("Aucun favori")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Favoris synthétiques" })).toBeFocused();
});

test("first, middle and last pages append exactly once", async ({ page }) => {
  const at = new Date().toISOString();
  let pageNumber = 0;
  let releaseMiddle: (() => void) | undefined;
  const heldMiddle = new Promise<void>((resolve) => { releaseMiddle = resolve; });
  await page.route("**/api/demo/search", async (route) => {
    pageNumber += 1;
    if (pageNumber === 2) await heldMiddle;
    const cursor = pageNumber === 1 ? nextCursor("a") : pageNumber === 2 ? nextCursor("b") : undefined;
    await fulfill(route, response([listing(pageNumber, at)], { dataAsOf: at, cursor, total: 3 }));
  });
  await ready(page); await search(page);
  await page.getByRole("button", { name: "Charger plus" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demo-load-more")).toBeAttached();
  await expect(page.getByRole("button", { name: "Chargement…" })).toBeFocused();
  releaseMiddle?.();
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Charger plus" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".demo-result-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Charger plus" })).toHaveCount(0);
  await expect(page.locator("#demo-result-open-2")).toBeFocused();
});

test("a failed continuation preserves acquired results and retries the same cursor", async ({ page }) => {
  const at = new Date().toISOString();
  let attempt = 0;
  await page.route("**/api/demo/search", async (route) => {
    const body = route.request().postDataJSON() as { cursor?: string };
    if (!body.cursor) return fulfill(route, response([listing(1, at)], { dataAsOf: at, cursor: nextCursor("a"), total: 2 }));
    attempt += 1;
    if (attempt === 1) return fulfill(route, { schemaVersion: 1, requestId, error: { code: "read_unavailable" } }, 503);
    await fulfill(route, response([listing(2, at)], { dataAsOf: at, total: 2 }));
  });
  await ready(page); await search(page);
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Réessayer la page" }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
  expect(attempt).toBe(2);
});

test("changed snapshots and duplicate pages fail closed while keeping current results", async ({ page }) => {
  const at = new Date().toISOString();
  for (const mutant of ["changed", "duplicate"] as const) {
    let calls = 0;
    await page.unroute("**/api/demo/search");
    await page.route("**/api/demo/search", async (route) => {
      calls += 1;
      if (calls === 1) return fulfill(route, response([listing(1, at)], { dataAsOf: at, cursor: nextCursor("a"), total: 2 }));
      await fulfill(route, response([listing(mutant === "duplicate" ? 1 : 2, at)], { dataAsOf: at, fixture: mutant === "changed" ? "different-v2" : "ui-states-v1", total: 2 }));
    });
    await ready(page); await search(page);
    await page.getByRole("button", { name: "Charger plus" }).click();
    await expect(page.locator(".demo-result-card")).toHaveCount(1);
    await expect(page.getByText(/même instant de démonstration/)).toBeVisible();
  }
});

test("a late continuation cannot overwrite a newer filtered search", async ({ page }) => {
  const at = new Date().toISOString();
  let releasePage: (() => void) | undefined;
  const heldPage = new Promise<void>((resolve) => { releasePage = resolve; });
  let initialSearches = 0;
  await page.route("**/api/demo/search", async (route) => {
    const body = route.request().postDataJSON() as { cursor?: string; priceMaxMinor?: number };
    if (body.cursor) {
      await heldPage;
      await fulfill(route, response([listing(2, at)], { dataAsOf: at, total: 2 })).catch(() => {});
      return;
    }
    initialSearches += 1;
    if (initialSearches === 1) await fulfill(route, response([listing(1, at)], { dataAsOf: at, cursor: nextCursor("a"), total: 2 }));
    else await fulfill(route, response([listing(3, at)], { dataAsOf: at, fixture: "ui-new-query-v1", total: 1 }));
  });
  await ready(page); await search(page);
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.getByText("Chargement de la page suivante…")).toBeVisible();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByLabel("Budget maximum (€)").fill("30000");
  await search(page);
  await expect(page.getByText(/28.000,00/)).toBeVisible();
  releasePage?.();
  await page.waitForTimeout(100);
  await expect(page.getByText(/28.000,00/)).toBeVisible();
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
});

test("disabled runtime keeps Saved recovery local and performs no API request", async ({ page, request }, testInfo) => {
  const disabledBase = (testInfo.config.metadata as { readonly demoDisabledBaseURL?: unknown }).demoDisabledBaseURL;
  expect(typeof disabledBase).toBe("string");
  if (typeof disabledBase !== "string") throw new Error("demoDisabledBaseURL metadata is required");
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, listingIds: ["lst_state-01"] }));
  }, { key: favoriteKey });
  let apiCalls = 0;
  page.on("request", (browserRequest) => { if (browserRequest.url().includes("/api/demo/")) apiCalls += 1; });
  await page.goto(`${disabledBase}/demo#saved`);
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.getByText(/recherche et le détail sont désactivés/i)).toBeVisible();
  await expect(page.getByText("Favori synthétique 1")).toBeVisible();
  await expect(page.getByText("Détail non chargé dans cet état.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Voir le détail" })).toHaveCount(0);

  await page.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(page.getByText("Aucun favori")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Favori synthétique 1")).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les favoris" }).click();
  await page.getByRole("button", { name: "Confirmer la réinitialisation" }).click();
  await expect(page.getByText("Aucun favori")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), favoriteKey)).toBeNull();
  expect(apiCalls).toBe(0);

  const disabledProxy = await request.get(`${disabledBase}/api/demo/listings/lst_state-01`);
  expect(disabledProxy.status()).toBe(404);
  await expect(disabledProxy.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  expect(apiCalls).toBe(0);
});
