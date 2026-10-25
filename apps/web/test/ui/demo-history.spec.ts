import AxeBuilder from "@axe-core/playwright";
import { parseDemoSearchResponseV2 } from "@auto-world/demo-search-contract";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import path from "node:path";
import { demoCatalog, descriptionFields, descriptionValue, fulfillJson, mockDemoCatalog, v2Envelope, v2Error, v2Response } from "./demo-v2-fixtures";

type Availability = "active" | "withdrawn" | "deleted" | "missing";
type ProjectionState = "complete" | "partial" | "stale";
type PriceEvidence = {
  readonly confidenceBps: number;
  readonly evidenceId: string;
  readonly field: "price";
  readonly observedAt: string;
  readonly value: { readonly amountMinor: number; readonly currency: "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "KRW" };
};
type MileageEvidence = {
  readonly confidenceBps: number;
  readonly evidenceId: string;
  readonly field: "mileage";
  readonly observedAt: string;
  readonly value: { readonly amount: number; readonly unit: "km" | "mi" };
};
type Evidence = PriceEvidence | MileageEvidence;

function evidenceId(value: number) {
  return `ev_${value.toString(16).padStart(64, "0")}`;
}

function publication(
  listingId: string,
  evidence: readonly Evidence[],
  options: {
    readonly availability?: Availability;
    readonly description?: Parameters<typeof descriptionFields>[1];
  } = {},
) {
  const selectedPrice = evidence.filter((item): item is PriceEvidence => item.field === "price").at(-1);
  const selectedMileage = evidence.filter((item): item is MileageEvidence => item.field === "mileage").at(-1);
  return {
    listingId,
    availability: options.availability ?? "active",
    price: selectedPrice === undefined
      ? { status: "unavailable" as const }
      : { status: "observed" as const, value: selectedPrice.value, evidenceId: selectedPrice.evidenceId },
    mileage: selectedMileage === undefined
      ? { status: "unavailable" as const }
      : { status: "observed" as const, value: selectedMileage.value, evidenceId: selectedMileage.evidenceId },
    evidence,
    ...descriptionFields(1, options.description),
  };
}

function historicalPublication(listingId = "lst_history-01", availability: Availability = "active") {
  const earlierPriceId = evidenceId(1);
  const selectedPriceId = evidenceId(2);
  const mileageId = evidenceId(3);
  return publication(listingId, [
      { evidenceId: earlierPriceId, field: "price", observedAt: "2026-10-13T08:00:00.000Z", confidenceBps: 8_750, value: { amountMinor: 3_300_000, currency: "EUR" } },
      { evidenceId: selectedPriceId, field: "price", observedAt: "2026-10-14T08:00:00.000Z", confidenceBps: 9_125, value: { amountMinor: 3_250_000, currency: "EUR" } },
      { evidenceId: mileageId, field: "mileage", observedAt: "2026-10-14T08:00:00.000Z", confidenceBps: 9_000, value: { amount: 28_500, unit: "km" } },
    ], { availability });
}

function validResponse(results: readonly unknown[], state: ProjectionState = "complete") {
  const receivedAt = new Date().toISOString();
  const dataAsOf = state === "stale" ? new Date(Date.parse(receivedAt) - 120_000).toISOString() : receivedAt;
  const data = v2Response(results, { dataAsOf, state: state === "complete" ? undefined : state, total: results.length });
  expect(parseDemoSearchResponseV2(data, receivedAt)).toMatchObject({ success: true });
  return data;
}

async function interceptDetail(
  page: Page,
  results: readonly unknown[] = [historicalPublication()],
  options: { readonly catalog?: "available" | "empty" | "unavailable"; readonly state?: ProjectionState } = {},
) {
  const data = validResponse(results, options.state);
  if (options.catalog === "unavailable") {
    await page.route("**/api/demo/v2/catalog", (route) => fulfillJson(route, v2Error("read_unavailable"), 503));
  } else if (options.catalog === "empty") {
    await page.route("**/api/demo/v2/catalog", (route) => fulfillJson(route, v2Envelope({ ...demoCatalog, taxonomyRelease: { ...demoCatalog.taxonomyRelease, attributions: [], makes: [], models: [] } })));
  } else {
    await mockDemoCatalog(page);
  }
  await page.route("**/api/demo/v2/listings/*", (route) => fulfillJson(route, v2Envelope(data)));
  return data;
}

async function expectDetailReady(page: Page) {
  await expect(page.getByRole("heading", { name: "Détail de la publication synthétique" })).toBeVisible();
  await expect(page.locator(".demo-detail .demo-evidence")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historique des observations" })).toBeVisible();
}

function price(index: number, observedAt: string, amountMinor: number, currency: PriceEvidence["value"]["currency"], confidenceBps = 9_000): PriceEvidence {
  return { evidenceId: evidenceId(index), field: "price", observedAt, confidenceBps, value: { amountMinor, currency } };
}

function mileage(index: number, observedAt: string, amount: number, unit: MileageEvidence["value"]["unit"], confidenceBps = 9_000): MileageEvidence {
  return { evidenceId: evidenceId(index), field: "mileage", observedAt, confidenceBps, value: { amount, unit } };
}

function historyField(page: Page, field: "price" | "mileage") {
  return page.locator(`.demo-history-field[data-history-field="${field}"]`);
}

async function openDirectDetail(page: Page, listingId = "lst_history-01", navigationKey?: string) {
  const query = navigationKey === undefined ? "" : `?history-navigation=${encodeURIComponent(navigationKey)}`;
  await page.goto(`/demo${query}#detail/${listingId}`);
  await expectDetailReady(page);
}

async function snapshotStorage(page: Page) {
  return page.evaluate(() => JSON.stringify(localStorage));
}

async function expectHistoryLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    clippedValueCount: Array.from(document.querySelectorAll<HTMLElement>("[data-observation-value], .demo-history-field time"))
      .filter((element) => element.scrollWidth > element.clientWidth + 1).length,
  }));
  expect(layout.documentWidth).toBe(layout.viewportWidth);
  expect(layout.clippedValueCount).toBe(0);
  const targets = await page.locator("details[data-history-disclosure] > summary").evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  }));
  expect(targets.every((target) => target.height >= 44 && target.width >= 44)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(audit.violations, JSON.stringify(audit.violations)).toEqual([]);
}

async function captureHistory(page: Page, testInfo: TestInfo, name: string) {
  await expectHistoryLayout(page);
  const directory = process.env.AW_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  await page.screenshot({ path: directory ? path.join(directory, name) : testInfo.outputPath(name), fullPage: true, scale: "css" });
}

async function cpuThrottle(context: BrowserContext, page: Page) {
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return client;
}

test("dated historical variation is not a contradiction", async ({ page }) => {
  await interceptDetail(page);
  await openDirectDetail(page);
  await expect(page.getByText(/se contredisent/i)).toHaveCount(0);
});

test("selected observations stay visible and other observations retain reverse received order", async ({ page }) => {
  const tied = "2026-10-14T08:00:00.123Z";
  const result = publication("lst_history-order", [
    price(10, "2026-10-13T08:00:00.000Z", 3_400_000, "EUR", 9_999),
    mileage(11, "2026-10-13T08:00:00.000Z", 31_000, "km"),
    price(12, tied, 3_300_000, "EUR", 1),
    price(13, tied, 3_250_000, "EUR", 5_000),
    mileage(14, tied, 30_500, "km"),
  ]);
  await interceptDetail(page, [result]);
  await openDirectDetail(page, result.listingId);

  const priceHistory = historyField(page, "price");
  await expect(priceHistory.getByRole("heading", { name: "Prix observé" })).toBeVisible();
  await expect(priceHistory.locator(".demo-history-selected")).toContainText("Observation affichée");
  await expect(priceHistory.locator(".demo-history-selected [data-observation-value]")).toContainText(/32[\s\u00a0\u202f]?500,00\s*EUR/u);
  await expect(historyField(page, "mileage").locator(".demo-history-selected [data-observation-value]")).toContainText(/30[\s\u00a0\u202f]?500\s*km/u);
  await expect(priceHistory.locator("summary")).toHaveAccessibleName(/Historique du prix \(2 autres observations\)/i);
  await expect(historyField(page, "mileage").locator("summary")).toHaveAccessibleName(/Historique du kilométrage \(1 autre observation\)/i);
  await priceHistory.locator("summary").click();
  const retained = priceHistory.locator(".demo-history-list [data-observation-value]");
  await expect(retained).toHaveCount(2);
  const values = (await retained.allTextContents()).map((value) => value.replace(/[\s\u00a0\u202f]/gu, ""));
  expect(values[0]).toContain("33000,00EUR");
  expect(values[1]).toContain("34000,00EUR");
  await expect(priceHistory).toContainText(/même instant/i);
  await expect(priceHistory).toContainText("Observation conservée");
});

test("native disclosures support keyboard toggles without requests or storage writes", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) apiRequests.push(request.url()); });
  await interceptDetail(page);
  await openDirectDetail(page);
  const summary = historyField(page, "price").locator('details[data-history-disclosure="price"] > summary');
  await expect(summary).toHaveAccessibleName(/Historique du prix \(1 autre observation\)/i);
  await summary.focus();
  const requestCount = apiRequests.length;
  const storage = await snapshotStorage(page);

  await page.keyboard.press("Enter");
  await expect(summary.locator("..")).toHaveJSProperty("open", true);
  await expect(summary).toBeFocused();
  await expect(summary).not.toHaveAttribute("aria-expanded");
  await page.keyboard.press("Space");
  await expect(summary.locator("..")).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();
  expect(apiRequests).toHaveLength(requestCount);
  expect(await snapshotStorage(page)).toEqual(storage);
});

test("a replacement detail closes disclosure state and presents the replacement selection", async ({ page }) => {
  const first = historicalPublication("lst_history-first");
  const second = publication("lst_history-second", [
    price(20, "2026-10-13T08:00:00.000Z", 4_100_000, "USD"),
    price(21, "2026-10-14T08:00:00.000Z", 4_000_000, "USD"),
    mileage(22, "2026-10-14T08:00:00.000Z", 10_000, "mi"),
  ]);
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const selected = route.request().url().endsWith(first.listingId) ? first : second;
    return fulfillJson(route, v2Envelope(validResponse([selected])));
  });
  await openDirectDetail(page, first.listingId);
  const firstDisclosure = historyField(page, "price").locator('details[data-history-disclosure="price"]');
  await firstDisclosure.locator("summary").click();
  await expect(firstDisclosure).toHaveJSProperty("open", true);
  await page.evaluate((listingId) => { window.location.hash = `#detail/${listingId}`; }, second.listingId);
  await expectDetailReady(page);
  const replacement = historyField(page, "price");
  await expect(replacement.locator("details")).toHaveJSProperty("open", false);
  await expect(replacement.locator(".demo-history-selected [data-observation-value]")).toContainText(/40[\s\u00a0\u202f]?000,00\s*USD/u);
});

test("the 256-record boundary exposes every retained observation without truncation", async ({ page }) => {
  const first = Date.parse("2026-10-13T08:00:00.000Z");
  const evidence = Array.from({ length: 256 }, (_, index) => price(1_000 + index, new Date(first + index).toISOString(), 1_000_000 + index, "EUR", index % 10_001));
  const result = publication("lst_history-boundary", evidence);
  await interceptDetail(page, [result]);
  await openDirectDetail(page, result.listingId);
  const priceHistory = historyField(page, "price");
  await expect(priceHistory.locator("summary")).toHaveAccessibleName(/255 autres observations/i);
  await priceHistory.locator("summary").click();
  await expect(priceHistory.locator(".demo-history-selected")).toHaveCount(1);
  await expect(priceHistory.getByRole("list", { name: "Autres observations de prix" }).getByRole("listitem")).toHaveCount(255);
  await expect(priceHistory).not.toContainText(/tronqu|charger plus/i);
});

test("a field with one observation has no empty disclosure", async ({ page }) => {
  const result = publication("lst_history-single", [
    price(30, "2026-10-14T08:00:00.000Z", 2_500_000, "EUR"),
    mileage(31, "2026-10-14T08:00:00.000Z", 20_000, "km"),
  ]);
  await interceptDetail(page, [result]);
  await openDirectDetail(page, result.listingId);
  await expect(historyField(page, "price").locator(".demo-history-selected")).toHaveCount(1);
  await expect(historyField(page, "price").locator("details")).toHaveCount(0);
  await expect(historyField(page, "mileage").locator("details")).toHaveCount(0);
});

test("missing observation fields render intentional local empty states", async ({ page }) => {
  const result = publication("lst_history-empty", []);
  await interceptDetail(page, [result]);
  await openDirectDetail(page, result.listingId);
  await expect(historyField(page, "price")).toContainText(/Prix non disponible.*Aucune observation de prix/is);
  await expect(historyField(page, "mileage")).toContainText(/Kilométrage non disponible.*Aucune observation de kilométrage/is);
  await expect(page.locator("details[data-history-disclosure]")).toHaveCount(0);
});

test("history preserves exact typed values, supported currency codes, UTC timestamps and basis points", async ({ page }) => {
  const start = Date.parse("2026-10-13T08:00:00.000Z");
  const result = publication("lst_history-exact", [
    price(40, new Date(start).toISOString(), 1, "USD", 0),
    price(41, new Date(start + 1).toISOString(), 2, "GBP", 1),
    price(42, new Date(start + 2).toISOString(), 3, "CHF", 9_999),
    price(43, new Date(start + 3).toISOString(), 4, "JPY", 10_000),
    price(44, new Date(start + 4).toISOString(), 5, "KRW", 8_001),
    mileage(45, new Date(start + 5).toISOString(), Number.MIN_VALUE, "km", 1),
    mileage(46, new Date(start + 6).toISOString(), Number.MAX_SAFE_INTEGER, "mi", 9_999),
    price(47, "2026-10-13T08:00:00.123Z", Number.MAX_SAFE_INTEGER, "EUR", 9_999),
  ]);
  await interceptDetail(page, [result]);
  await openDirectDetail(page, result.listingId);
  for (const field of ["price", "mileage"] as const) {
    const container = historyField(page, field);
    await container.locator("summary").click();
  }
  const ledger = page.locator(".demo-history-field");
  const text = (await ledger.allInnerTexts()).join(" ").replace(/[\s\u00a0\u202f]/gu, "");
  for (const currency of ["EUR", "USD", "GBP", "CHF", "JPY", "KRW"]) expect(text).toContain(currency);
  expect(text).toContain("90071992547409,91EUR");
  expect(text).toMatch(/(?:5e-324|4[,.]9406564584124654e-324)km/iu);
  expect(text).toContain("9007199254740991mi");
  expect(text).toMatch(/0(?:[,.]00)?%/u);
  expect(text).toMatch(/0[,.]01\s*%/u);
  expect(text).toMatch(/99[,.]99\s*%/u);
  expect(text).toMatch(/100(?:[,.]00)?\s*%/u);
  const exactTime = page.locator('time[datetime="2026-10-13T08:00:00.123Z"]');
  await expect(exactTime).toBeVisible();
  await expect(exactTime).toContainText(/08:00:00[,.]123.*UTC/i);
  await expect(page.locator(".demo-evidence")).toContainText(/aucune conversion|sans conversion|ne sont pas compar/i);
  await expect(page.getByText(/score de confiance/i)).toHaveCount(0);
});

test("detail snapshots state their point-in-time completeness and stay visible offline", async ({ page, context }) => {
  const expected: Record<ProjectionState, RegExp> = {
    complete: /complet|instant|observation/i,
    partial: /partiel/i,
    stale: /ancien|périm|stale/i,
  };
  for (const state of ["complete", "partial", "stale"] as const) {
    await page.unrouteAll({ behavior: "wait" });
    const data = await interceptDetail(page, [historicalPublication()], { state });
    await openDirectDetail(page, "lst_history-01", `snapshot-${state}`);
    const snapshot = page.locator(".demo-detail-snapshot");
    await expect(snapshot).toContainText(expected[state]);
    await expect(snapshot.locator("time")).toHaveAttribute("datetime", data.dataAsOf);
  }
  await context.setOffline(true);
  await expect(page.locator(".demo-detail-snapshot")).toBeVisible();
  await expect(page.locator("main")).toContainText(/hors connexion/i);
  await expect(historyField(page, "price").locator(".demo-history-selected")).toBeVisible();
  await context.setOffline(false);
});

test("slow detail loading resolves to usable history", async ({ page }) => {
  const data = validResponse([historicalPublication()]);
  await mockDemoCatalog(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    await gate;
    await fulfillJson(route, v2Envelope(data));
  });
  await page.goto("/demo#detail/lst_history-01");
  await expect(page.getByText(/Chargement du détail synthétique/i)).toBeVisible();
  release();
  await expectDetailReady(page);
});

test("detail errors retry without losing the requested publication", async ({ page }) => {
  const data = validResponse([historicalPublication()]);
  await mockDemoCatalog(page);
  let calls = 0;
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    calls += 1;
    if (calls === 1) return fulfillJson(route, v2Error("read_unavailable"), 503);
    return fulfillJson(route, v2Envelope(data));
  });
  await page.goto("/demo#detail/lst_history-01");
  await expect(page.getByText("Détail indisponible", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expectDetailReady(page);
  expect(calls).toBe(2);
});

test("a 404 remains unavailable without claiming withdrawal or deletion", async ({ page }) => {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => fulfillJson(route, v2Error("not_found"), 404));
  await page.goto("/demo#detail/lst_history-404");
  const panel = page.locator(".demo-state");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/indisponible|introuvable/i);
  await expect(panel).not.toContainText(/retir|supprim|effac|withdraw|delet/i);
});

test("successful ended details retain their exact status, snapshot and history", async ({ page }) => {
  await mockDemoCatalog(page);
  const statuses: Record<Exclude<Availability, "active">, string> = {
    withdrawn: "Publication retirée",
    deleted: "Publication supprimée",
    missing: "Publication introuvable",
  };
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const availability = (Object.keys(statuses) as Array<Exclude<Availability, "active">>).find((value) => route.request().url().endsWith(value)) ?? "missing";
    return fulfillJson(route, v2Envelope(validResponse([historicalPublication(`lst_history-${availability}`, availability)])));
  });
  for (const availability of Object.keys(statuses) as Array<Exclude<Availability, "active">>) {
    await page.goto(`/demo#detail/lst_history-${availability}`);
    await expectDetailReady(page);
    await expect(page.getByText(statuses[availability], { exact: true })).toBeVisible();
    await expect(page.locator(".demo-detail-snapshot time")).toBeVisible();
    await expect(historyField(page, "price").locator(".demo-history-selected")).toBeVisible();
  }
});

test("retained authored declarations stay separate when the current description is unavailable", async ({ page }) => {
  const base = historicalPublication("lst_history-declaration");
  const result = {
    ...base,
    description: { status: "unavailable" as const },
    descriptionEvidence: [
      { evidenceId: `de_${"7".repeat(64)}`, capturedAt: "2026-10-11T08:00:00.000Z", value: descriptionValue(1, { firstRegistrationYear: 2020 }) },
      { evidenceId: `de_${"8".repeat(64)}`, capturedAt: "2026-10-12T08:00:00.000Z", value: descriptionValue(1, { firstRegistrationYear: 2022 }) },
    ],
  };
  await interceptDetail(page, [result]);
  await openDirectDetail(page, result.listingId);
  await expect(page.getByText("Description synthétique non disponible.")).toBeVisible();
  const declarations = page.locator(".demo-description-history");
  await expect(declarations).toContainText(/déclarations synthétiques/i);
  await expect(declarations).toContainText(/plusieurs déclarations|déclarations.*différ/i);
  await expect(declarations).not.toContainText(/se contredisent|confiance de l’observation/i);
  await expect(page.getByText(/ev_|de_|fixtureRef|ui\/descriptions/i)).toHaveCount(0);
});

test("an unavailable catalogue withholds labels and year while retaining authored declarations", async ({ page }) => {
  const base = historicalPublication("lst_history-catalog");
  const result = { ...base, ...descriptionFields(1, { contradictory: true }) };
  await interceptDetail(page, [result], { catalog: "unavailable" });
  await openDirectDetail(page, result.listingId);
  const declarations = page.locator(".demo-description-history");
  await expect(declarations.locator("li")).toHaveCount(2);
  await expect(declarations).toContainText(/libellés indisponibles/i);
  await expect(declarations).not.toContainText(/Marque Alpha|Modèle Alpha|2020|2022/);
  await expect(page.getByText(/make_ui_|model_ui_|taxrel_/i)).toHaveCount(0);
});

test("the actual API flow opens, expands, collapses and returns to unchanged results", async ({ page }) => {
  const seed = await page.request.post("/api/demo/v2/search", { data: { schemaVersion: 2, sort: "listing_asc" } });
  expect(seed.status()).toBe(200);
  const payload = await seed.json() as { data: { results: Array<{ evidence: readonly Evidence[]; listingId: string }> } };
  const resultIndex = payload.data.results.findIndex((item) => item.evidence.filter((evidence) => evidence.field === "price").length > 1 || item.evidence.filter((evidence) => evidence.field === "mileage").length > 1);
  expect(resultIndex, "The accepted actual fixture must contain retained observation history").toBeGreaterThanOrEqual(0);

  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  const cardsBefore = await page.locator(".demo-result-card").count();
  const trigger = page.locator(`#demo-result-open-${resultIndex}`);
  await trigger.click();
  await expectDetailReady(page);
  const disclosure = page.locator("details[data-history-disclosure]").first();
  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveJSProperty("open", true);
  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveJSProperty("open", false);
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".demo-result-card")).toHaveCount(cardsBefore);
});

test("saved and direct detail routes expose the same selected history", async ({ page }) => {
  const result = historicalPublication();
  const data = validResponse([result]);
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", (route) => fulfillJson(route, v2Envelope(data)));
  await page.route("**/api/demo/v2/listings/*", (route) => fulfillJson(route, v2Envelope(data)));
  await page.goto("/demo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  const card = page.locator(".demo-result-card").first();
  await card.getByRole("button", { name: "Ajouter aux favoris" }).click();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.locator(".demo-saved-card").getByRole("button", { name: "Voir le détail", exact: true }).click();
  await expectDetailReady(page);
  const savedValue = await historyField(page, "price").locator(".demo-history-selected [data-observation-value]").innerText();
  await page.goto(`/demo?history-route=direct#detail/${result.listingId}`);
  await expectDetailReady(page);
  await expect(historyField(page, "price").locator(".demo-history-selected [data-observation-value]")).toHaveText(savedValue);
});

test("leaving a pending detail prevents late history from replacing the search screen", async ({ page }) => {
  const data = validResponse([historicalPublication()]);
  await mockDemoCatalog(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    await gate;
    await fulfillJson(route, v2Envelope(data));
  });
  await page.goto("/demo#detail/lst_history-01");
  await expect(page.getByText(/Chargement du détail synthétique/i)).toBeVisible();
  await page.getByRole("button", { name: "Recherche", exact: true }).click();
  release();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await expect(page.locator(".demo-detail")).toHaveCount(0);
});

test("a disabled deep link keeps history local and performs zero API requests", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) requests.push(request.url()); });
  await page.goto(`${testInfo.config.metadata.demoDisabledBaseURL}/demo#detail/lst_history-01`);
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.locator(".demo-history-field")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("history visual states fit representative viewports and themes", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  const empty = publication("lst_history-visual-empty", []);
  const hostile = publication("lst_history-visual-hostile", [
    price(60, "2026-10-13T08:00:00.000Z", 3_300_001, "USD", 1),
    mileage(61, "2026-10-13T08:00:00.000Z", 0.0000001, "km", 9_999),
    price(62, "2026-10-14T08:00:00.123Z", 3_250_002, "EUR", 10_000),
    mileage(63, "2026-10-14T08:00:00.123Z", Number.MAX_SAFE_INTEGER, "mi", 0),
  ]);
  let mode: "history" | "empty" | "hostile" = "history";
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/listings/*", (route) => {
    const selected = mode === "empty" ? empty : mode === "hostile" ? hostile : historicalPublication();
    return fulfillJson(route, v2Envelope(validResponse([selected])));
  });

  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      mode = "history";
      await page.goto(`/demo?history-visual=${width}-${theme}-history#detail/lst_history-01`);
      await page.getByLabel("Apparence").selectOption(theme);
      await expectDetailReady(page);
      await captureHistory(page, testInfo, `demo-history-${width}-${theme}-${browserName}-collapsed.png`);
      const disclosure = historyField(page, "price").locator("details");
      await disclosure.locator("summary").click();
      await expect(disclosure).toHaveJSProperty("open", true);
      await captureHistory(page, testInfo, `demo-history-${width}-${theme}-${browserName}-expanded.png`);

      if (width === 390) {
        mode = "empty";
        await page.goto(`/demo?history-visual=${width}-${theme}-empty#detail/lst_history-visual-empty`);
        await page.getByLabel("Apparence").selectOption(theme);
        await expectDetailReady(page);
        await captureHistory(page, testInfo, `demo-history-${width}-${theme}-${browserName}-empty.png`);
        mode = "hostile";
        await page.goto(`/demo?history-visual=${width}-${theme}-hostile#detail/lst_history-visual-hostile`);
        await page.getByLabel("Apparence").selectOption(theme);
        await expectDetailReady(page);
        for (const summary of await page.locator("details[data-history-disclosure] > summary").all()) await summary.click();
        await captureHistory(page, testInfo, `demo-history-${width}-${theme}-${browserName}-hostile.png`);
      }
    }
  }
});

test("reduced motion and 200 percent platform or Verdana text keep history operable", async ({ page, browserName }, testInfo) => {
  await interceptDetail(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const font of ["platform", "Verdana"] as const) {
    await page.goto(`/demo?history-text=${font.toLowerCase()}#detail/lst_history-01`);
    await expectDetailReady(page);
    if (font === "Verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const brokenHeadingWords = await page.locator("h1").evaluateAll((headings) => headings.flatMap((heading) => {
      const text = heading.firstChild;
      if (!(text instanceof Text)) throw new Error("Expected a plain detail heading");
      return Array.from(text.data.matchAll(/\S+/gu)).filter((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        return range.getClientRects().length > 1;
      }).map((word) => word[0]);
    }));
    expect(brokenHeadingWords).toEqual([]);
    const summary = historyField(page, "price").locator("summary");
    await summary.focus();
    await expect(summary).toBeFocused();
    const focus = await summary.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
    });
    expect(focus.outlineStyle).not.toBe("none");
    expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Enter");
    await expect(summary.locator("..")).toHaveJSProperty("open", true);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await captureHistory(page, testInfo, `demo-history-390-light-text-200-${browserName}-${font.toLowerCase()}.png`);
  }
});

test("256-record native disclosure feedback stays within 100ms under the Chromium mobile lab profile", async ({ page, context, browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "CDP CPU throttling is Chromium-only");
  test.setTimeout(120_000);
  const start = Date.parse("2026-10-13T08:00:00.000Z");
  const evidence = Array.from({ length: 256 }, (_, index) => price(2_000 + index, new Date(start + index).toISOString(), 2_000_000 + index, "EUR", 8_000 + (index % 2_001)));
  const result = publication("lst_history-performance", evidence);
  await interceptDetail(page, [result]);
  await page.setViewportSize({ width: 390, height: 844 });
  const client = await cpuThrottle(context, page);
  await openDirectDetail(page, result.listingId);
  const details = historyField(page, "price").locator('details[data-history-disclosure="price"]');
  const summary = details.locator("summary");
  await page.evaluate(() => { Object.defineProperty(window, "__awHistorySamples", { configurable: true, value: [] as number[] }); });
  const samples: Array<{ durationMs: number; operation: "collapse" | "expand"; sample: number }> = [];

  for (let index = 0; index < 10; index += 1) {
    const expectedOpen = index % 2 === 0;
    await summary.evaluate((element, expectation) => {
      const disclosure = element.parentElement as HTMLDetailsElement;
      element.addEventListener("click", () => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (disclosure.open !== expectation) return;
          observer.disconnect();
          requestAnimationFrame(() => {
            (window as typeof window & { __awHistorySamples: number[] }).__awHistorySamples.push(performance.now() - started);
          });
        });
        observer.observe(disclosure, { attributes: true, attributeFilter: ["open"] });
      }, { once: true });
    }, expectedOpen);
    await summary.click();
    await expect(details).toHaveJSProperty("open", expectedOpen);
    await page.waitForFunction((count) => (window as typeof window & { __awHistorySamples: number[] }).__awHistorySamples.length === count, index + 1);
    const durationMs = await page.evaluate(() => (window as typeof window & { __awHistorySamples: number[] }).__awHistorySamples.at(-1)!);
    samples.push({ durationMs, operation: expectedOpen ? "expand" : "collapse", sample: index + 1 });
  }
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const report = {
    browserVersion: browser.version(),
    budgetMaxMs: 100,
    caveat: "Bounded synthetic Chromium lab measurement under 4x CPU slowdown; event to native details open mutation to next rendered frame. This is not production INP or physical-device evidence.",
    collectedAt: new Date().toISOString(),
    host: { architecture: arch(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
    profile: { cpuSlowdownMultiplier: 4, evidenceRecords: 256, viewport: { width: 390, height: 844 } },
    samples,
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  await testInfo.attach("demo-history-native-disclosure-performance.json", { body: Buffer.from(serialized), contentType: "application/json" });
  if (process.env.AW_SCREENSHOT_DIR) {
    await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
    await writeFile(path.join(process.env.AW_SCREENSHOT_DIR, "demo-history-native-disclosure-performance.json"), serialized);
  }
  expect(Math.max(...samples.map((sample) => sample.durationMs)), "Every expand/collapse should paint within100ms").toBeLessThanOrEqual(100);
});
