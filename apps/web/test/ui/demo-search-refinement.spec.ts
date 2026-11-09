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
} from "./demo-v2-fixtures";

type SearchBody = Readonly<Record<string, unknown>> & { readonly cursor?: string };
type SubmittedSearch = { readonly version: 2 | 3; readonly body: SearchBody };

const nextCursor = `cur_${"e".repeat(64)}`;
const expectedAcceptedQuery = {
  schemaVersion: 3,
  sort: "mileage_desc",
  text: "alpha modele",
  priceMaxMinor: 3_200_050,
  mileageMaxKm: 25_000.25,
  makeId: demoMakeIds.alpha,
  modelId: demoModelIds.alphaOne,
  firstRegistrationYear: 2022,
} as const;

function result(index: number, observedAt: string) {
  const suffix = String(index).padStart(2, "0");
  const priceEvidence = `ev_${String(index * 2 + 1).padStart(64, "0")}`;
  const mileageEvidence = `ev_${String(index * 2 + 2).padStart(64, "0")}`;
  return {
    listingId: `lst_refinement-${suffix}`,
    availability: "active",
    price: { status: "observed", value: { amountMinor: 3_100_000 + index * 10_000, currency: "EUR" }, evidenceId: priceEvidence },
    mileage: { status: "observed", value: { amount: 24_000 - index * 1_000, unit: "km" }, evidenceId: mileageEvidence },
    evidence: [
      { evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 8_800, value: { amountMinor: 3_100_000 + index * 10_000, currency: "EUR" } },
      { evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 9_200, value: { amount: 24_000 - index * 1_000, unit: "km" } },
    ],
    ...descriptionFields(index * 2 - 1),
  } as const;
}

async function installSearchFixtures(page: Page, options: { readonly cursor?: boolean; readonly holdContinuation?: Promise<void>; readonly empty?: boolean; readonly responseFixture?: string } = {}) {
  await mockDemoCatalog(page);
  const submitted: SubmittedSearch[] = [];
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  async function answer(route: Route, version: 2 | 3) {
    const body = route.request().postDataJSON() as SearchBody;
    submitted.push({ version, body });
    if (body.cursor !== undefined && options.holdContinuation !== undefined) await options.holdContinuation;
    const results = options.empty ? [] : [result(body.cursor === undefined ? 1 : 2, observedAt)];
    const response = v2Response(results, {
      dataAsOf: observedAt,
      ...(options.responseFixture === undefined ? {} : { fixture: options.responseFixture }),
      total: options.empty ? 0 : options.cursor ? 2 : 1,
      cursor: body.cursor === undefined && options.cursor ? nextCursor : undefined,
    });
    await fulfillJson(route, version === 3 ? v3Envelope(response) : v2Envelope(response));
  }
  await page.route("**/api/demo/v2/search", (route) => answer(route, 2));
  await page.route("**/api/demo/v3/search", (route) => answer(route, 3));
  return submitted;
}

async function fillAllCriteria(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByLabel("Recherche par mots").fill("Modèle Alpha");
  await page.getByLabel("Budget maximum (€)").fill("32000.50");
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await page.getByLabel("Kilométrage maximum (km)").fill("25000.25");
  await page.getByLabel("Année de première immatriculation fictive").fill("2022");
  await page.getByLabel("Marque fictive").selectOption(demoMakeIds.alpha);
  await page.getByLabel("Modèle fictif").selectOption(demoModelIds.alphaOne);
  await page.getByLabel("Trier les résultats").selectOption("mileage_desc");
}

async function openAllCriteriaResults(page: Page, options: Parameters<typeof installSearchFixtures>[1] = {}) {
  const submitted = await installSearchFixtures(page, options);
  await page.goto("/demo");
  await fillAllCriteria(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  expect(submitted[0]).toEqual({ version: 3, body: expectedAcceptedQuery });
  return submitted;
}

async function expectPreparedValues(page: Page, removed: keyof typeof expectedAcceptedQuery) {
  const values = {
    text: removed === "text" ? "" : "alpha modele",
    priceMaxMinor: removed === "priceMaxMinor" ? "" : "32000.50",
    mileageMaxKm: removed === "mileageMaxKm" ? "" : "25000.25",
    makeId: removed === "makeId" ? "" : demoMakeIds.alpha,
    modelId: removed === "makeId" || removed === "modelId" ? "" : demoModelIds.alphaOne,
    firstRegistrationYear: removed === "firstRegistrationYear" ? "" : "2022",
  };
  await expect(page.getByLabel("Recherche par mots")).toHaveValue(values.text);
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue(values.priceMaxMinor);
  await expect(page.getByLabel("Kilométrage maximum (km)")).toHaveValue(values.mileageMaxKm);
  await expect(page.getByLabel("Marque fictive")).toHaveValue(values.makeId);
  await expect(page.getByLabel("Modèle fictif")).toHaveValue(values.modelId);
  await expect(page.getByLabel("Année de première immatriculation fictive")).toHaveValue(values.firstRegistrationYear);
  await expect(page.getByLabel("Trier les résultats")).toHaveValue("mileage_desc");
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

for (const criterion of ["text", "makeId", "modelId", "firstRegistrationYear", "priceMaxMinor", "mileageMaxKm"] as const) {
  test(`removing ${criterion} prepares the accepted criteria without a search request`, async ({ page }) => {
    const submitted = await openAllCriteriaResults(page);
    if (criterion === "makeId") await expect(page.locator("#demo-remove-makeId")).toHaveAccessibleName("Retirer la marque et le modèle");
    await page.locator(`#demo-remove-${criterion}`).click();
    await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
    await expectPreparedValues(page, criterion);
    if (criterion === "makeId") await expect(page.locator(".demo-announcement")).toContainText("La marque et son modèle ont été retirés.");
    expect(submitted).toHaveLength(1);
  });
}

test("submitting a prepared text removal sends one cursorless V2 query", async ({ page }) => {
  const submitted = await openAllCriteriaResults(page, { cursor: true });
  await page.locator("#demo-remove-text").click();
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect.poll(() => submitted.length).toBe(2);
  const expectedV2Query = {
    sort: expectedAcceptedQuery.sort,
    priceMaxMinor: expectedAcceptedQuery.priceMaxMinor,
    mileageMaxKm: expectedAcceptedQuery.mileageMaxKm,
    makeId: expectedAcceptedQuery.makeId,
    modelId: expectedAcceptedQuery.modelId,
    firstRegistrationYear: expectedAcceptedQuery.firstRegistrationYear,
  };
  expect(submitted[1]).toEqual({
    version: 2,
    body: {
      ...expectedV2Query,
      schemaVersion: 2,
    },
  });
  expect(Object.hasOwn(submitted[1]!.body, "text")).toBe(false);
  expect(Object.hasOwn(submitted[1]!.body, "cursor")).toBe(false);
});

test("cancelling restores the prior unsent draft and unchanged accepted results", async ({ page }) => {
  const submitted = await openAllCriteriaResults(page);
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByLabel("Recherche par mots").fill("Brouillon libre");
  await page.getByLabel("Budget maximum (€)").fill("12345.67");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await page.locator("#demo-remove-mileageMaxKm").click();
  await expect(page.getByLabel("Recherche par mots")).toHaveValue("alpha modele");
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("32000.50");
  await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
  await page.locator("#demo-refinement-cancel").click();
  await expect(page.locator("#demo-remove-mileageMaxKm")).toBeFocused();
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  expect(submitted).toHaveLength(1);
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await expect(page.getByLabel("Recherche par mots")).toHaveValue("Brouillon libre");
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("12345.67");
});

test("cancelling preserves the accepted pagination cursor", async ({ page }) => {
  const submitted = await openAllCriteriaResults(page, { cursor: true });
  await page.locator("#demo-remove-priceMaxMinor").click();
  await page.locator("#demo-refinement-cancel").click();
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
  expect(submitted[1]?.body.cursor).toBe(nextCursor);
  expect(submitted[1]?.body).toMatchObject(expectedAcceptedQuery);
});

test("editing a prepared form invalidates cancellation before it can overwrite the edit", async ({ page }) => {
  const submitted = await openAllCriteriaResults(page);
  await page.locator("#demo-remove-priceMaxMinor").click();
  await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
  await page.getByLabel("Budget maximum (€)").fill("21000");
  await expect(page.locator("#demo-refinement-cancel")).toHaveCount(0);
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("21000");
  expect(submitted).toHaveLength(1);
});

test("resetting a prepared form invalidates cancellation", async ({ page }) => {
  const submitted = await openAllCriteriaResults(page);
  await page.locator("#demo-remove-modelId").click();
  await page.getByRole("button", { name: "Réinitialiser les critères" }).click();
  await expect(page.locator("#demo-refinement-cancel")).toHaveCount(0);
  await expect(page.getByLabel("Marque fictive")).toHaveValue("");
  expect(submitted).toHaveLength(1);
});

test("leaving Search invalidates cancellation", async ({ page }) => {
  await openAllCriteriaResults(page);
  await page.locator("#demo-remove-firstRegistrationYear").click();
  await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.getByRole("button", { name: "Recherche", exact: true }).click();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await expect(page.locator("#demo-refinement-cancel")).toHaveCount(0);
});

test("browser history cannot resurrect stale cancellation", async ({ page }) => {
  await openAllCriteriaResults(page);
  await page.locator("#demo-remove-firstRegistrationYear").click();
  await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await expect(page.locator("#demo-refinement-cancel")).toHaveCount(0);
});

test("a rapid route change cannot preserve the initial refinement transition", async ({ page }) => {
  const submitted = await openAllCriteriaResults(page);
  await page.evaluate(() => {
    document.getElementById("demo-remove-priceMaxMinor")?.click();
    window.location.hash = "#saved";
  });
  await expect(page.getByRole("heading", { name: "Mes listes" })).toBeVisible();
  await page.evaluate(() => { window.location.hash = "#search"; });
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  await expect(page.locator("#demo-refinement-cancel")).toHaveCount(0);
  expect(submitted).toHaveLength(1);
});

test("a mismatching catalogue disables retained-identity removals without exposing identifiers", async ({ page }) => {
  await openAllCriteriaResults(page, { responseFixture: "refinement-old-fixture" });
  await expect(page.locator("#demo-remove-makeId")).toBeEnabled();
  for (const criterion of ["text", "modelId", "firstRegistrationYear", "priceMaxMinor", "mileageMaxKm"] as const) {
    await expect(page.locator(`#demo-remove-${criterion}`)).toBeDisabled();
  }
  await expect(page.getByText(/catalogue actuel/u)).toBeVisible();
  await expect(page.getByText(/make_ui_|model_ui_|taxcat_|taxrel_/u)).toHaveCount(0);
  await page.locator("#demo-remove-makeId").click();
  await expect(page.getByLabel("Marque fictive")).toHaveValue("");
  await expect(page.getByLabel("Modèle fictif")).toHaveValue("");
});

test("a catalogue authority change invalidates cancellation", async ({ page }) => {
  await mockDemoCatalog(page, { failFirst: true });
  const submitted: SearchBody[] = [];
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  await page.route("**/api/demo/v2/search", async (route) => {
    submitted.push(route.request().postDataJSON() as SearchBody);
    await fulfillJson(route, v2Envelope(v2Response([result(1, observedAt)], { dataAsOf: observedAt, total: 1 })));
  });
  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "Réessayer les libellés" })).toBeVisible();
  await page.getByLabel("Budget maximum (€)").fill("32000.50");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await page.locator("#demo-remove-priceMaxMinor").click();
  await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
  await page.getByRole("button", { name: "Réessayer les libellés" }).click();
  await expect(page.getByRole("button", { name: "Réessayer les libellés" })).toHaveCount(0);
  await expect(page.locator("#demo-refinement-cancel")).toHaveCount(0);
  expect(submitted).toHaveLength(1);
});

test("a pending continuation disables every removal control", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await openAllCriteriaResults(page, { cursor: true, holdContinuation: held });
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.getByText("Chargement de la page suivante…")).toBeVisible();
  const controls = page.locator(".demo-criteria-actions button");
  await expect(controls).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await expect(controls.nth(index)).toBeDisabled();
  release();
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
});

test("an empty accepted result still offers a request-free criterion adjustment", async ({ page }) => {
  const submitted = await openAllCriteriaResults(page, { empty: true });
  await expect(page.getByText("Aucun résultat synthétique", { exact: true })).toBeVisible();
  await page.locator("#demo-remove-priceMaxMinor").click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("");
  expect(submitted).toHaveLength(1);
});

test("offline preparation and cancellation keep the accepted result usable without a request", async ({ page, context }) => {
  const submitted = await openAllCriteriaResults(page);
  await context.setOffline(true);
  await page.locator("#demo-remove-priceMaxMinor").click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("");
  await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
  await page.locator("#demo-refinement-cancel").click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  expect(submitted).toHaveLength(1);
  await context.setOffline(false);
});

test("remove and cancel feedback commit within 100 ms", async ({ page, context, browserName }, testInfo) => {
  const submitted = await openAllCriteriaResults(page);
  const client = browserName === "chromium" ? await context.newCDPSession(page) : undefined;
  const profile = browserName === "chromium"
    ? { cpuSlowdownMultiplier: 4, qualification: "Chromium CDP 4x CPU slowdown" }
    : { cpuSlowdownMultiplier: 1, qualification: "WebKit unthrottled; CDP CPU throttling is unavailable" };
  try {
    if (client !== undefined) await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const removeButton = page.locator("#demo-remove-priceMaxMinor");
    await removeButton.evaluate((button) => {
      button.addEventListener("click", () => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (window.location.hash !== "#search" || document.querySelector("#demo-refinement-cancel") === null) return;
          observer.disconnect();
          requestAnimationFrame(() => {
            (window as typeof window & { __awRefinementRemoveMs?: number }).__awRefinementRemoveMs = performance.now() - started;
          });
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }, { once: true });
    });
    await removeButton.click();
    await page.waitForFunction(() => typeof (window as typeof window & { __awRefinementRemoveMs?: number }).__awRefinementRemoveMs === "number");

    const cancelButton = page.locator("#demo-refinement-cancel");
    await cancelButton.evaluate((button) => {
      button.addEventListener("click", () => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (window.location.hash !== "#results" || document.querySelector("#demo-refinement-cancel") !== null) return;
          observer.disconnect();
          requestAnimationFrame(() => {
            (window as typeof window & { __awRefinementCancelMs?: number }).__awRefinementCancelMs = performance.now() - started;
          });
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }, { once: true });
    });
    await cancelButton.click();
    await page.waitForFunction(() => typeof (window as typeof window & { __awRefinementCancelMs?: number }).__awRefinementCancelMs === "number");
  } finally {
    if (client !== undefined) {
      await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await client.detach();
    }
  }

  const samples = await page.evaluate(() => ({
    cancelMs: (window as typeof window & { __awRefinementCancelMs: number }).__awRefinementCancelMs,
    removeMs: (window as typeof window & { __awRefinementRemoveMs: number }).__awRefinementRemoveMs,
  }));
  expect(samples.removeMs).toBeLessThanOrEqual(100);
  expect(samples.cancelMs).toBeLessThanOrEqual(100);
  expect(submitted).toHaveLength(1);
  const report = {
    browserName,
    browserVersion: context.browser()?.version(),
    budgetMaxMs: 100,
    caveat: "Local DOM feedback through the next animation frame; not a production INP or network-latency claim.",
    collectedAt: new Date().toISOString(),
    profile,
    samples,
  };
  await testInfo.attach("demo-search-refinement-performance.json", {
    body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    contentType: "application/json",
  });
});

test("criterion controls remain accessible across the viewport and theme matrix", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  await installSearchFixtures(page);
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.goto(`/demo?refinement-visual=${width}-${theme}`);
      await page.getByLabel("Apparence").selectOption(theme);
      await fillAllCriteria(page);
      await page.getByRole("button", { name: "Rechercher", exact: true }).click();
      const controls = page.locator(".demo-criteria-actions button");
      await expect(controls).toHaveCount(6);
      const targets = await controls.evaluateAll((elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      }));
      expect(targets.every(({ height, width: targetWidth }) => height >= 44 && targetWidth >= 44)).toBe(true);
      if ((width === 390 && theme === "light") || (width === 1440 && theme === "dark")) {
        await capture(page, testInfo, `demo-refinement-${width}-${theme}-${browserName}.png`);
        await page.locator("#demo-remove-priceMaxMinor").click();
        await expect(page.locator("#demo-refinement-cancel")).toBeVisible();
        await capture(page, testInfo, `demo-refinement-prepared-${width}-${theme}-${browserName}.png`);
        await page.locator("#demo-refinement-cancel").click();
        await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
      } else {
        await expectNoHorizontalOverflow(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      }
    }
  }
});

test("200 percent Verdana text preserves criterion controls without overflow", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installSearchFixtures(page);
  await page.goto("/demo?refinement-text=verdana");
  await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await fillAllCriteria(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator(".demo-criteria-actions button")).toHaveCount(6);
  await capture(page, testInfo, `demo-refinement-390-light-text-200-${browserName}.png`);
});
