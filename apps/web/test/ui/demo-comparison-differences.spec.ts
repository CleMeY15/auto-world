import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import path from "node:path";
import { parseDemoSearchResponseV2 } from "@auto-world/demo-search-contract";

import {
  descriptionFields,
  descriptionValue,
  fulfillJson,
  mockDemoCatalog,
  v2Envelope,
  v2Response,
} from "./demo-v2-fixtures";

const listingIds = ["lst_differences-01", "lst_differences-02", "lst_differences-03"] as const;

type PublicationOptions = {
  readonly descriptionIndex?: number;
  readonly firstRegistrationYear?: number;
  readonly mileageAmount?: number;
  readonly mileageUnit?: "km" | "mi";
  readonly missingDescription?: boolean;
  readonly missingPrice?: boolean;
  readonly priceAmountMinor?: number;
  readonly priceCurrency?: "EUR" | "USD";
};

function authoredDescription(publicationIndex: number, valueIndex: number, firstRegistrationYear?: number) {
  const fields = descriptionFields(publicationIndex);
  if (fields.description.status === "unavailable") return fields;
  const value = descriptionValue(valueIndex, firstRegistrationYear === undefined ? {} : { firstRegistrationYear });
  return {
    description: {
      ...fields.description,
      value,
    },
    descriptionEvidence: fields.descriptionEvidence.map((evidence) => ({
      ...evidence,
      value,
    })),
  };
}

function publication(listingId: string, index: number, observedAt: string, options: PublicationOptions = {}) {
  const priceId = `ev_${String(index * 10 + 1).padStart(64, "0")}`;
  const mileageId = `ev_${String(index * 10 + 2).padStart(64, "0")}`;
  const price = {
    amountMinor: options.priceAmountMinor ?? 3_200_000 + index,
    currency: options.priceCurrency ?? "EUR",
  };
  const mileage = {
    amount: options.mileageAmount ?? 24_000 + index,
    unit: options.mileageUnit ?? "km",
  };
  return {
    listingId,
    availability: "active",
    price: options.missingPrice
      ? { status: "unavailable" }
      : { status: "observed", value: price, evidenceId: priceId },
    mileage: { status: "observed", value: mileage, evidenceId: mileageId },
    evidence: [
      ...(options.missingPrice ? [] : [{
        evidenceId: priceId,
        field: "price",
        observedAt,
        confidenceBps: 8_800,
        value: price,
      }]),
      { evidenceId: mileageId, field: "mileage", observedAt, confidenceBps: 9_200, value: mileage },
    ],
    ...(options.missingDescription
      ? descriptionFields(index, { unavailable: true })
      : authoredDescription(index, options.descriptionIndex ?? index, options.firstRegistrationYear)),
  };
}

function normalResults(observedAt: string) {
  return [
    publication(listingIds[0], 1, observedAt),
    publication(listingIds[1], 2, observedAt),
  ];
}

function equalResults(observedAt: string) {
  const common = {
    descriptionIndex: 1,
    mileageAmount: 24_001,
    priceAmountMinor: 3_200_001,
  } as const;
  return [
    publication(listingIds[0], 1, observedAt, common),
    publication(listingIds[1], 2, observedAt, common),
  ];
}

function recomputingResults(observedAt: string) {
  const first = { descriptionIndex: 1, mileageAmount: 24_001, priceAmountMinor: 3_200_001 } as const;
  return [
    publication(listingIds[0], 1, observedAt, first),
    publication(listingIds[1], 2, observedAt),
    publication(listingIds[2], 3, observedAt, first),
  ];
}

function comparisonHash(ids: readonly string[] = listingIds.slice(0, 2)) {
  return `#comparison-link/v1/${encodeURIComponent(JSON.stringify(ids))}`;
}

async function waitUntilReady(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
}

async function routeSearch(page: Page, results: readonly unknown[]) {
  const dataAsOf = new Date().toISOString();
  const data = v2Response(results, { dataAsOf });
  expect(parseDemoSearchResponseV2(data, new Date().toISOString())).toMatchObject({ success: true });
  await mockDemoCatalog(page);
  let calls = 0;
  await page.route("**/api/demo/v2/search", async (route) => {
    calls += 1;
    await fulfillJson(route, v2Envelope(data));
  });
  return () => calls;
}

async function openLocalComparison(page: Page, results: readonly unknown[], count = 2) {
  const calls = await routeSearch(page, results);
  await page.goto("/demo");
  await waitUntilReady(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  for (let index = 0; index < count; index += 1) await page.locator(`#demo-result-compare-${index}`).click();
  await page.locator("#demo-comparison-open").click();
  await expect(page.getByRole("heading", { name: "Comparer", exact: true })).toBeFocused();
  return calls;
}

async function routeReceivedDetails(page: Page, results: readonly ReturnType<typeof publication>[]) {
  await mockDemoCatalog(page);
  const calls: string[] = [];
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    const listingId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const result = results.find((candidate) => candidate.listingId === listingId);
    calls.push(listingId);
    if (result === undefined) throw new Error(`Missing received comparison fixture for ${listingId}`);
    const dataAsOf = new Date().toISOString();
    const data = v2Response([result], { dataAsOf });
    expect(parseDemoSearchResponseV2(data, new Date().toISOString())).toMatchObject({ success: true });
    await fulfillJson(route, v2Envelope(data));
  });
  return calls;
}

async function openReceivedComparison(page: Page, results: readonly ReturnType<typeof publication>[]) {
  const calls = await routeReceivedDetails(page, results);
  await page.goto(`/demo${comparisonHash(results.map((result) => result.listingId))}`);
  await waitUntilReady(page);
  await page.locator("#demo-comparison-link-load").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  return calls;
}

function differencesCheckbox(page: Page) {
  return page.getByRole("checkbox", { name: "Différences uniquement", exact: true });
}

function comparisonRows(page: Page) {
  return page.locator("tr[data-comparison-field]");
}

async function expectRowFields(page: Page, expected: readonly string[]) {
  await expect.poll(() => comparisonRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-comparison-field")))).toEqual(expected);
}

async function expectNoPageOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (element.closest(".demo-comparison-scroll") && !element.classList.contains("demo-comparison-scroll")) return [];
      if (bounds.width === 0 || bounds.height === 0 || bounds.right <= viewportWidth + 0.5) return [];
      return [{ element: element.tagName, id: element.id, right: Math.round(bounds.right * 10) / 10 }];
    });
    return { documentWidth: document.documentElement.scrollWidth, offenders, viewportWidth };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({ documentWidth: report.viewportWidth, offenders: [], viewportWidth: report.viewportWidth });
}

async function captureAccessibleState(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expectNoPageOverflow(page);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(audit.violations, JSON.stringify({ name, violations: audit.violations }, null, 2)).toEqual([]);
  const target = await page.locator(".demo-comparison-filter").evaluate((label) => {
    const bounds = label.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  });
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  const directory = process.env.AW_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: directory ? path.join(directory, name) : testInfo.outputPath(name),
    fullPage: true,
    scale: "css",
  });
}

test("local filtering hides only equal rows and has no network, URL or storage side effect", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/demo/")) requests.push(request.url());
  });
  const observedAt = new Date().toISOString();
  const searchCalls = await openLocalComparison(page, normalResults(observedAt));
  const checkbox = differencesCheckbox(page);
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toHaveAttribute("aria-describedby", "demo-comparison-filter-help");
  await expect(page.locator("#demo-comparison-filter-help")).toContainText(/incomplètes ou non comparables restent visibles/i);
  await expect(page.locator(".demo-comparison-count")).toHaveAttribute("role", "status");
  await expect(page.locator(".demo-comparison-count")).toHaveAttribute("aria-atomic", "true");
  await expectRowFields(page, ["availability", "price", "mileage", "make", "model", "firstRegistrationYear"]);
  await expect(page.locator(".demo-comparison-count")).toHaveText("6 critères affichés sur 6");
  expect(await comparisonRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-comparison-status")))).toEqual(["same", "different", "different", "different", "different", "different"]);

  const url = page.url();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  const requestCount = requests.length;
  const labelClick = await page.locator(".demo-comparison-filter").evaluate((label) => {
    const labelBounds = label.getBoundingClientRect();
    const inputBounds = label.querySelector("input")!.getBoundingClientRect();
    return {
      x: inputBounds.right - labelBounds.left + 4,
      y: labelBounds.height / 2,
    };
  });
  await page.locator(".demo-comparison-filter").click({ position: labelClick });
  await expect(checkbox).toBeChecked();
  await expectRowFields(page, ["price", "mileage", "make", "model", "firstRegistrationYear"]);
  await expect(page.locator(".demo-comparison-count")).toHaveText("5 critères affichés sur 6");
  await expect(page.locator(".demo-comparison-availability")).toHaveCount(2);
  await expect(page.locator(".demo-comparison-availability")).toHaveText(["Publication active", "Publication active"]);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  expect(requests).toHaveLength(requestCount);
  expect(searchCalls()).toBe(1);

  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expect(comparisonRows(page)).toHaveCount(6);
});

test("a price-only difference announces exactly one visible criterion", async ({ page }) => {
  const observedAt = new Date().toISOString();
  const common = {
    descriptionIndex: 1,
    mileageAmount: 24_001,
  } as const;
  const results = [
    publication(listingIds[0], 1, observedAt, { ...common, priceAmountMinor: 3_200_001 }),
    publication(listingIds[1], 2, observedAt, { ...common, priceAmountMinor: 3_200_002 }),
  ];
  await openLocalComparison(page, results);
  await differencesCheckbox(page).check();
  await expectRowFields(page, ["price"]);
  await expect(page.locator('[data-comparison-field="price"]')).toHaveAttribute("data-comparison-status", "different");
  await expect(page.locator(".demo-comparison-count")).toHaveText("1 critère affiché sur 6");
});

test("an all-equal comparison keeps its headers, explains the empty view and restores every row", async ({ page, browserName }, testInfo) => {
  const observedAt = new Date().toISOString();
  await openLocalComparison(page, equalResults(observedAt));
  const checkbox = differencesCheckbox(page);
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(comparisonRows(page)).toHaveCount(0);
  await expect(page.locator(".demo-comparison-table thead th")).toHaveCount(3);
  await expect(page.getByText("Aucune différence entre les critères renseignés.", { exact: false })).toBeVisible();
  await expect(page.getByText(/ne signifie pas qu.il s.agit du même véhicule/i)).toBeVisible();
  await expect(page.locator(".demo-comparison-count")).toHaveText("0 critères affichés sur 6");
  await captureAccessibleState(page, testInfo, `compare-differences-equal-${browserName}.png`);
  await checkbox.uncheck();
  await expectRowFields(page, ["availability", "price", "mileage", "make", "model", "firstRegistrationYear"]);
});

test("incomplete and incompatible values remain visible with their distinct statuses", async ({ page, browserName }, testInfo) => {
  const observedAt = new Date().toISOString();
  const results = [
    publication(listingIds[0], 1, observedAt, { missingDescription: true, missingPrice: true }),
    publication(listingIds[1], 2, observedAt, { mileageUnit: "mi", priceCurrency: "USD" }),
  ];
  await openLocalComparison(page, results);
  await differencesCheckbox(page).check();
  await expectRowFields(page, ["price", "mileage", "make", "model", "firstRegistrationYear"]);
  await expect(page.locator('[data-comparison-field="price"]')).toHaveAttribute("data-comparison-status", "incomplete");
  await expect(page.locator('[data-comparison-field="mileage"]')).toHaveAttribute("data-comparison-status", "incompatible");
  for (const field of ["make", "model", "firstRegistrationYear"]) {
    await expect(page.locator(`[data-comparison-field="${field}"]`)).toHaveAttribute("data-comparison-status", "incomplete");
  }
  await expect(page.locator(".demo-comparison-table")).toContainText(/Incomplet/);
  await expect(page.locator(".demo-comparison-table")).toContainText(/Non comparable/);
  await expect(page.getByText("Aucune différence entre les critères renseignés.", { exact: false })).toHaveCount(0);
  await captureAccessibleState(page, testInfo, `compare-differences-unknown-${browserName}.png`);
});

test("provenance moves to the last visible authored row when an equal year is hidden", async ({ page }) => {
  const observedAt = new Date().toISOString();
  const common = { firstRegistrationYear: 2022, mileageAmount: 24_001, priceAmountMinor: 3_200_001 } as const;
  const results = [
    publication(listingIds[0], 1, observedAt, { ...common, descriptionIndex: 1 }),
    publication(listingIds[1], 2, observedAt, { ...common, descriptionIndex: 2 }),
  ];
  await openLocalComparison(page, results);
  await differencesCheckbox(page).check();
  await expectRowFields(page, ["make", "model"]);
  await expect(page.locator('[data-comparison-field="make"] .demo-comparison-meta')).toHaveCount(0);
  const provenance = page.locator('[data-comparison-field="model"] .demo-comparison-meta');
  await expect(provenance).toHaveCount(2);
  await expect(provenance).toContainText([/fixture synthétique, non vérifiée/i, /fixture synthétique, non vérifiée/i]);
});

test("removal recomputes differences and below two entries forces the full disabled view", async ({ page }) => {
  const observedAt = new Date().toISOString();
  await openLocalComparison(page, recomputingResults(observedAt), 3);
  const checkbox = differencesCheckbox(page);
  await checkbox.check();
  await expect(comparisonRows(page)).toHaveCount(5);
  await page.locator("#demo-comparison-remove-1").click();
  await expect(checkbox).toBeChecked();
  await expect(comparisonRows(page)).toHaveCount(0);
  await expect(page.getByText("Aucune différence entre les critères renseignés.", { exact: false })).toBeVisible();
  await page.locator("#demo-comparison-remove-2").click();
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  await expect(comparisonRows(page)).toHaveCount(6);
  expect(await comparisonRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-comparison-status")))).toEqual([
    "insufficient",
    "insufficient",
    "insufficient",
    "insufficient",
    "insufficient",
    "insufficient",
  ]);
});

test("leaving and reopening a local comparison resets the filter to the full table", async ({ page }) => {
  const observedAt = new Date().toISOString();
  await openLocalComparison(page, normalResults(observedAt));
  await differencesCheckbox(page).check();
  await expect(comparisonRows(page)).toHaveCount(5);
  await page.getByRole("button", { name: "Retour aux résultats", exact: true }).click();
  await page.locator("#demo-comparison-open").click();
  await expect(differencesCheckbox(page)).not.toBeChecked();
  await expect(comparisonRows(page)).toHaveCount(6);
});

test("a received comparison filters locally and explicit reread resets the full view", async ({ page, browserName }, testInfo) => {
  const observedAt = new Date().toISOString();
  const results = normalResults(observedAt);
  const calls = await openReceivedComparison(page, results);
  const checkbox = differencesCheckbox(page);
  const url = page.url();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  const callsBeforeFilter = calls.length;
  await checkbox.check();
  await expect(comparisonRows(page)).toHaveCount(5);
  expect(calls).toHaveLength(callsBeforeFilter);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  await captureAccessibleState(page, testInfo, `compare-differences-received-${browserName}.png`);

  await page.locator("#demo-comparison-link-reread").click();
  await expect(page.locator(".demo-comparison-table")).toBeVisible();
  await expect.poll(() => calls.length).toBe(callsBeforeFilter + 2);
  await expect(differencesCheckbox(page)).not.toBeChecked();
  await expect(comparisonRows(page)).toHaveCount(6);
});

test("an all-equal received comparison keeps context while the filtered body is empty", async ({ page }) => {
  const observedAt = new Date().toISOString();
  await openReceivedComparison(page, equalResults(observedAt));
  await differencesCheckbox(page).check();
  await expect(comparisonRows(page)).toHaveCount(0);
  await expect(page.locator(".demo-comparison-table thead th")).toHaveCount(3);
  await expect(page.locator(".demo-comparison-availability")).toHaveText(["Publication active", "Publication active"]);
  await expect(page.getByText("Aucune différence entre les critères renseignés.", { exact: false })).toBeVisible();
});

test("a received comparison never filters out missing or mixed-unit values", async ({ page }) => {
  const observedAt = new Date().toISOString();
  const results = [
    publication(listingIds[0], 1, observedAt, { missingDescription: true, missingPrice: true }),
    publication(listingIds[1], 2, observedAt, { mileageUnit: "mi", priceCurrency: "USD" }),
  ];
  await openReceivedComparison(page, results);
  await differencesCheckbox(page).check();
  await expectRowFields(page, ["price", "mileage", "make", "model", "firstRegistrationYear"]);
  await expect(page.locator('[data-comparison-field="price"]')).toHaveAttribute("data-comparison-status", "incomplete");
  await expect(page.locator('[data-comparison-field="mileage"]')).toHaveAttribute("data-comparison-status", "incompatible");
});

test("a received comparison keeps authored provenance on its last visible authored difference", async ({ page }) => {
  const observedAt = new Date().toISOString();
  const common = { firstRegistrationYear: 2022, mileageAmount: 24_001, priceAmountMinor: 3_200_001 } as const;
  const results = [
    publication(listingIds[0], 1, observedAt, { ...common, descriptionIndex: 1 }),
    publication(listingIds[1], 2, observedAt, { ...common, descriptionIndex: 2 }),
  ];
  await openReceivedComparison(page, results);
  await differencesCheckbox(page).check();
  await expectRowFields(page, ["make", "model"]);
  await expect(page.locator('[data-comparison-field="make"] .demo-comparison-meta')).toHaveCount(0);
  await expect(page.locator('[data-comparison-field="model"] .demo-comparison-meta')).toHaveCount(2);
});

test("filtered comparison remains accessible across viewport, theme and enlarged-text matrices", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  const observedAt = new Date().toISOString();
  await openLocalComparison(page, normalResults(observedAt));
  const checkbox = differencesCheckbox(page);
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-aw-theme", theme);
      await captureAccessibleState(page, testInfo, `compare-differences-${width}-${theme}-${browserName}.png`);
      if (width === 390) {
        await checkbox.focus();
        await page.keyboard.press("Space");
        await expect(checkbox).not.toBeChecked();
        await page.keyboard.press("Space");
        await expect(checkbox).toBeChecked();
        await expect(checkbox).toBeFocused();
        expect(await checkbox.evaluate((control) => control.matches(":focus-visible"))).toBe(true);
        await captureAccessibleState(page, testInfo, `compare-differences-focus-390-${theme}-${browserName}.png`);
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Apparence").selectOption("light");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  for (const font of ["platform", "Verdana"] as const) {
    if (font === "Verdana") {
      await page.evaluate(() => { document.documentElement.style.setProperty("--aw-font-family", "Verdana, sans-serif"); });
    } else {
      await page.evaluate(() => { document.documentElement.style.removeProperty("--aw-font-family"); });
    }
    await captureAccessibleState(page, testInfo, `compare-differences-text-200-${font}-${browserName}.png`);
  }
});

test("difference filtering commits feedback within 100 ms under 4x CPU slowdown", async ({ browser, browserName, context, page }, testInfo) => {
  test.skip(browserName !== "chromium", "CPU throttling is Chromium-only");
  test.setTimeout(180_000);
  const observedAt = new Date().toISOString();
  await routeSearch(page, recomputingResults(observedAt));
  const client = await context.newCDPSession(page);
  const samples: number[] = [];

  for (let index = 0; index < 5; index += 1) {
    await page.goto(`/demo?differences-performance-sample=${index + 1}`);
    await waitUntilReady(page);
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await page.locator("#demo-result-compare-0").click();
    await page.locator("#demo-result-compare-1").click();
    await page.locator("#demo-result-compare-2").click();
    await page.locator("#demo-comparison-open").click();
    const checkbox = differencesCheckbox(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await checkbox.evaluate((control) => {
      control.addEventListener("click", () => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          const rows = document.querySelectorAll("tr[data-comparison-field]");
          if (rows.length !== 5) return;
          observer.disconnect();
          requestAnimationFrame(() => {
            Object.defineProperty(window, "__awDifferenceFilterMs", {
              configurable: true,
              value: performance.now() - started,
            });
          });
        });
        observer.observe(document.querySelector(".demo-comparison-table tbody")!, { childList: true });
      }, { once: true });
    });
    await checkbox.click();
    await page.waitForFunction(() => typeof (window as typeof window & { __awDifferenceFilterMs?: number }).__awDifferenceFilterMs === "number");
    samples.push(await page.evaluate(() => (window as typeof window & { __awDifferenceFilterMs: number }).__awDifferenceFilterMs));
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }

  const report = {
    browserVersion: browser.version(),
    budgetMaxMs: 100,
    caveat: "Bounded Chromium lab measurement under 4x CPU slowdown, from the native checkbox click to filtered DOM feedback and the next animation frame. It is not a production INP claim.",
    collectedAt: new Date().toISOString(),
    host: { architecture: arch(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
    profile: { cpuSlowdownMultiplier: 4, viewport: { height: 844, width: 390 } },
    sampleCount: samples.length,
    samplesMs: samples,
    worstMs: Math.max(...samples),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await testInfo.attach("demo-comparison-differences-performance.json", {
    body: Buffer.from(serialized),
    contentType: "application/json",
  });
  if (process.env.AW_SCREENSHOT_DIR) {
    await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
    await writeFile(path.join(process.env.AW_SCREENSHOT_DIR, "demo-comparison-differences-performance.json"), serialized, "utf8");
  }
  expect(Math.max(...samples), "Every filtered-table update should commit by the next frame within 100 ms").toBeLessThanOrEqual(100);
});
