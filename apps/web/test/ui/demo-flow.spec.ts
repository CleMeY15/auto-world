import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
  } as const;
}

function wrapper(data: unknown) {
  return { schemaVersion: 1, requestId: `req_${"b".repeat(32)}`, data };
}

async function mockSinglePage(page: Page) {
  const observedAt = new Date().toISOString();
  await page.route("**/api/demo/search", async (route) => {
    const data = { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "ui-single-v1", dataAsOf: observedAt, state: "complete", totalCount: 1, results: [result(1, observedAt)] };
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
  let calls = 0;
  await page.route("**/api/demo/search", async (route) => { calls += 1; await route.abort(); });
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

test("search activity, active navigation and keyboard focus remain explicit", async ({ page }) => {
  let releaseSearch: (() => void) | undefined;
  const heldSearch = new Promise<void>((resolve) => { releaseSearch = resolve; });
  const observedAt = new Date().toISOString();
  await page.route("**/api/demo/search", async (route) => {
    await heldSearch;
    const data = { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "ui-held-v1", dataAsOf: observedAt, state: "complete", totalCount: 1, results: [result(1, observedAt)] };
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
  const observedAt = new Date().toISOString();
  await page.route("**/api/demo/search", async (route) => {
    const body = route.request().postDataJSON() as { cursor?: string };
    const data = body.cursor
      ? { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "ui-paging-v1", dataAsOf: observedAt, state: "partial", reason: "projection_incomplete", results: [result(2, observedAt)] }
      : { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "ui-paging-v1", dataAsOf: observedAt, state: "partial", reason: "projection_incomplete", results: [result(1, observedAt)], nextCursor: cursor };
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
