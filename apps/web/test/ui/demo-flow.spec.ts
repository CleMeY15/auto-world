import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { demoFixtureVersion, demoRelease, descriptionFields, mockDemoCatalog, v2Envelope, v2Response } from "./demo-v2-fixtures";

const cursor = `cur_${"a".repeat(64)}`;

function result(index: number, observedAt: string) {
  const suffix = String(index).padStart(2, "0");
  const priceEvidence = `ev_${String(index * 2 + 1).padStart(64, "0")}`;
  const mileageEvidence = `ev_${String(index * 2 + 2).padStart(64, "0")}`;
  return {
    listingId: `lst_demo-${suffix}`,
    availability: "active",
    price: { status: "observed", value: { amountMinor: 3200000 + index * 100000, currency: "EUR" }, evidenceId: priceEvidence },
    mileage: { status: "observed", value: { amount: 24000 + index * 1000, unit: "km" }, evidenceId: mileageEvidence },
    evidence: [
      { evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 8800, value: { amountMinor: 3200000 + index * 100000, currency: "EUR" } },
      { evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 9200, value: { amount: 24000 + index * 1000, unit: "km" } },
    ],
    ...descriptionFields(index),
  } as const;
}

function wrapper(data: unknown) {
  return v2Envelope(data, `req_${"b".repeat(32)}`);
}

async function mockSinglePage(page: Page) {
  const observedAt = new Date().toISOString();
  await page.route("**/api/demo/v2/search", async (route) => {
    const data = v2Response([result(1, observedAt)], { dataAsOf: observedAt, total: 1 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wrapper(data)) });
  });
}

async function submitDefaultSearch(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
}

test("the real local API supports search, detail, persisted favorite, removal and undo", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url()); });
  await page.goto("/demo");
  await expect(page.getByText("Données entièrement synthétiques. Aucun véhicule à vendre.")).toBeVisible();
  await submitDefaultSearch(page);
  const cards = page.locator(".demo-result-card");
  await expect(cards.first()).toBeVisible();
  await cards.first().getByRole("button", { name: "Ajouter aux favoris" }).click();
  await expect(page.getByRole("button", { name: /Favoris \(1\)/ })).toBeVisible();
  await cards.first().getByRole("button", { name: "Voir le détail" }).click();
  await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observations disponibles" })).toBeVisible();
  await page.getByRole("button", { name: /Favoris \(1\)/ }).click();
  await expect(page.getByRole("heading", { name: "Favoris synthétiques" })).toBeVisible();
  await expect(page.getByText("Favori synthétique 1")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Favori synthétique 1")).toBeVisible();
  await page.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(page.getByText("Un favori vient d’être retiré.")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Favori synthétique 1")).toBeVisible();
  expect(external).toEqual([]);
});

test("unsupported free text stays editable and never calls the search route", async ({ page }) => {
  await mockDemoCatalog(page);
  let calls = 0;
  await page.route("**/api/demo/v2/search", async (route) => { calls += 1; await route.abort(); });
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  const input = page.getByLabel("Recherche libre");
  await input.fill("un véhicule précis");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/n’est pas encore prise en charge/)).toBeVisible();
  expect(calls).toBe(0);
});

test("real catalog filters reach the API and preserve criteria after detail navigation", async ({ page }) => {
  const seedReply = await page.request.post("/api/demo/v2/search", { data: { schemaVersion: 2, sort: "listing_asc" } });
  expect(seedReply.status()).toBe(200);
  const seed = (await seedReply.json()).data.results.find((item: { description: { status: string } }) => item.description.status === "authored_synthetic");
  expect(seed).toBeDefined();
  const { makeId, modelId, firstRegistrationYear } = seed.description.value;
  await page.goto("/demo");
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await expect(page.getByLabel("Marque fictive")).toBeEnabled();
  await page.getByLabel("Marque fictive").selectOption(makeId);
  await page.getByLabel("Modèle fictif").selectOption(modelId);
  await page.getByLabel("Année de première immatriculation fictive").fill(String(firstRegistrationYear));
  const replyPromise = page.waitForResponse((reply) => reply.url().endsWith("/api/demo/v2/search") && reply.request().method() === "POST");
  await submitDefaultSearch(page);
  const reply = await replyPromise;
  expect(reply.status()).toBe(200);
  const results = (await reply.json()).data.results;
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((item: typeof seed) => item.description.status === "authored_synthetic" && item.description.value.makeId === makeId && item.description.value.modelId === modelId && item.description.value.firstRegistrationYear === firstRegistrationYear)).toBe(true);
  await expect(page.locator(".demo-result-card")).toHaveCount(results.length);
  await expect(page.getByText(/^Critères appliqués :/)).toContainText(String(firstRegistrationYear));
  await page.locator(".demo-result-card").first().getByRole("button", { name: "Voir le détail" }).click();
  await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
  await expect(page.getByText("Description synthétique non disponible.")).toHaveCount(0);
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await page.getByRole("button", { name: "Modifier les critères", exact: true }).click();
  await expect(page.getByLabel("Marque fictive")).toHaveValue(makeId);
  await expect(page.getByLabel("Modèle fictif")).toHaveValue(modelId);
  await expect(page.getByLabel("Année de première immatriculation fictive")).toHaveValue(String(firstRegistrationYear));
});

test("catalog bootstrap does not search and exact identity filters reset an incompatible model", async ({ page }) => {
  const catalogCalls = await mockDemoCatalog(page);
  const submitted: unknown[] = [];
  const observedAt = new Date().toISOString();
  await page.route("**/api/demo/v2/search", async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wrapper(v2Response([result(2, observedAt)], { dataAsOf: observedAt, total: 1 }))) });
  });
  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toBeVisible();
  await expect.poll(catalogCalls).toBe(1);
  expect(submitted).toEqual([]);
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  const make = page.getByLabel("Marque fictive");
  const model = page.getByLabel("Modèle fictif");
  await make.selectOption("make_ui_alpha");
  await model.selectOption("model_ui_alpha_two");
  await make.selectOption("make_ui_beta");
  await expect(model).toHaveValue("");
  await expect(page.locator(".demo-announcement")).toHaveText("Le modèle a été réinitialisé pour correspondre à la nouvelle marque.");
  await model.selectOption("model_ui_beta_one");
  await page.getByLabel("Année de première immatriculation fictive").fill("2021");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator(".demo-result-card").getByRole("heading", { name: "Marque Bêta fictive · Modèle Bêta 1 fictif", exact: true })).toBeVisible();
  expect(submitted).toEqual([{ schemaVersion: 2, sort: "listing_asc", makeId: "make_ui_beta", modelId: "model_ui_beta_one", firstRegistrationYear: 2021 }]);
});

test("search activity, active navigation and keyboard focus remain explicit", async ({ page }) => {
  await mockDemoCatalog(page);
  let releaseSearch: (() => void) | undefined;
  const heldSearch = new Promise<void>((resolve) => { releaseSearch = resolve; });
  const observedAt = new Date().toISOString();
  await page.route("**/api/demo/v2/search", async (route) => {
    await heldSearch;
    const data = v2Response([result(1, observedAt)], { dataAsOf: observedAt, total: 1 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wrapper(data)) });
  });
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.getByRole("button", { name: "Recherche", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /Favoris/ })).not.toHaveAttribute("aria-current", "page");
  await page.getByLabel("Recherche libre").focus();
  await page.keyboard.press("Tab");
  const budget = page.getByLabel("Budget maximum (€)");
  await expect(budget).toBeFocused();
  expect(await budget.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, offset: style.outlineOffset, kind: style.outlineStyle };
  })).toEqual({ width: "3px", offset: "2px", kind: "solid" });
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recherche…", exact: true })).toBeVisible();
  releaseSearch?.();
  await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
  await page.getByRole("button", { name: /Favoris \(0\)/ }).click();
  await expect(page.getByRole("button", { name: /Favoris \(0\)/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Recherche", exact: true })).not.toHaveAttribute("aria-current", "page");
});

test("contract-shaped mocked pages append in order and expose partial state honestly", async ({ page }) => {
  await mockDemoCatalog(page);
  const observedAt = new Date().toISOString();
  await page.route("**/api/demo/v2/search", async (route) => {
    const body = route.request().postDataJSON() as { cursor?: string };
    const data = body.cursor
      ? { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: demoFixtureVersion, taxonomyRelease: demoRelease, dataAsOf: observedAt, state: "partial", reason: "projection_incomplete", results: [result(2, observedAt)] }
      : { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: demoFixtureVersion, taxonomyRelease: demoRelease, dataAsOf: observedAt, state: "partial", reason: "projection_incomplete", results: [result(1, observedAt)], nextCursor: cursor };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wrapper(data)) });
  });
  await page.goto("/demo");
  await submitDefaultSearch(page);
  await expect(page.getByText("La projection est partielle.")).toBeVisible();
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Charger plus" })).toHaveCount(0);
});

test("offline failure preserves criteria and offers a retry", async ({ page, context }) => {
  await mockDemoCatalog(page);
  await page.goto("/demo");
  await page.getByLabel("Budget maximum (€)").fill("40000");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByText(/connexion est indisponible/)).toBeVisible();
  await context.setOffline(false);
  await mockSinglePage(page);
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
});

test("keyboard flow and the primary demo states pass WCAG 2.2 AA automation", async ({ page, browserName }) => {
  await mockDemoCatalog(page);
  await mockSinglePage(page);
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  if (browserName === "chromium") await page.keyboard.press("Tab");
  else await page.getByRole("link", { name: "Aller au contenu" }).focus();
  await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await submitDefaultSearch(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeFocused();
});
