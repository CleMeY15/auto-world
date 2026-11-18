import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { descriptionFields, fulfillJson, mockDemoCatalog, v2Envelope, v2Error, v2Response } from "./demo-v2-fixtures";

const ids = ["lst_navigation-z", "lst_navigation-a", "lst_navigation-m"] as const;
const cursor = `cur_${"d".repeat(64)}`;
const query = { schemaVersion: 2, sort: "price_desc", priceMaxMinor: 4_000_000 };
const navigation = (page: Page) => page.getByRole("navigation", { name: "Annonces chargées" });
const previous = (page: Page) => navigation(page).getByRole("button", { name: "Annonce précédente" });
const next = (page: Page) => navigation(page).getByRole("button", { name: "Annonce suivante" });

async function installFixtures(page: Page, options: { single?: boolean; failSecondOnce?: boolean; holdSecond?: Promise<void> } = {}) {
  await mockDemoCatalog(page);
  const dataAsOf = new Date().toISOString();
  const results = ids.map((listingId, index) => {
    const value = { currency: "EUR", amountMinor: 3_000_000 - index * 50_000 };
    const evidenceId = `ev_${String(index + 1).padStart(64, "0")}`;
    return {
      listingId, availability: "active",
      price: { status: "observed", value, evidenceId },
      mileage: { status: "unavailable" },
      evidence: [{ evidenceId, field: "price", observedAt: dataAsOf, confidenceBps: 9000, value }],
      ...descriptionFields(index + 1),
    };
  });
  const searches: Record<string, unknown>[] = [];
  const details: string[] = [];
  await page.route("**/api/demo/v2/search", async (route) => {
    const body = route.request().postDataJSON();
    searches.push(body);
    const items = options.single ? results.slice(0, 1) : body.cursor === cursor ? results.slice(2) : results.slice(0, 2);
    await fulfillJson(route, v2Envelope(v2Response(items, {
      dataAsOf,
      total: options.single ? 1 : 3,
      ...(!body.cursor && !options.single ? { cursor } : {}),
    })));
  });
  await page.route("**/api/demo/v2/listings/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const firstAttempt = !details.includes(id);
    details.push(id);
    if (id === ids[1]) {
      await options.holdSecond;
      if (options.failSecondOnce && firstAttempt) return fulfillJson(route, v2Error("not_found"), 404);
    }
    const result = results.find((item) => item.listingId === id);
    if (!result) throw new Error(`Unexpected detail request: ${id}`);
    await fulfillJson(route, v2Envelope(v2Response([result], { dataAsOf })));
  });
  return { searches, details };
}

async function search(page: Page) {
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByLabel("Budget maximum (€)").fill("40000");
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await page.getByLabel("Trier les résultats").selectOption("price_desc");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
}

async function expectPosition(page: Page, index: number, count: number) {
  await expect(page).toHaveURL(new RegExp(`#detail/${ids[index]}$`, "u"));
  await expect(navigation(page)).toContainText(`Annonce ${index + 1} sur ${count}`);
  await expect(page.locator(".demo-detail")).toBeVisible();
}

test("loaded pages keep server order, card focus, comparison, sort and accepted criteria", async ({ page }) => {
  const { searches, details } = await installFixtures(page);
  await search(page);
  await page.locator("#demo-result-open-1").click();
  await expectPosition(page, 1, 2);
  await expect(next(page)).toBeDisabled();
  expect(searches).toEqual([query]);

  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await expect(page.locator("#demo-result-open-1")).toBeFocused();
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(3);
  await page.locator("#demo-result-compare-0").click();
  await page.locator("#demo-result-open-0").click();
  await expectPosition(page, 0, 3);
  await expect(previous(page)).toBeDisabled();
  await next(page).focus();
  await page.keyboard.press("Enter");
  await expectPosition(page, 1, 3);
  await next(page).click();
  await expectPosition(page, 2, 3);
  await expect(next(page)).toBeDisabled();
  await previous(page).click();
  await expectPosition(page, 1, 3);
  await page.goBack();
  await expectPosition(page, 2, 3);
  await page.goForward();
  await expectPosition(page, 1, 3);
  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await expect(page.locator("#demo-result-open-1")).toBeFocused();
  await expect(page.locator("#demo-result-open-1")).toBeInViewport();
  await expect(page.locator("#demo-result-compare-0")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Trier ces résultats")).toHaveValue("price_desc");
  await expect(page.getByRole("button", { name: "Retirer le budget maximum" })).toBeVisible();
  await expect(page.locator(".demo-result-card")).toHaveCount(3);
  expect(searches).toEqual([query, { ...query, cursor }]);
  expect(details).toEqual([ids[1], ids[0], ids[1], ids[2], ids[1], ids[2], ids[1]]);
});

test("opening a favorite with a matching ID or a direct link has no search traversal", async ({ page }) => {
  await installFixtures(page);
  await search(page);
  await page.locator("#demo-result-open-0").click();
  await expectPosition(page, 0, 2);
  await page.getByRole("button", { name: "Ajouter aux favoris" }).click();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await page.getByRole("button", { name: "Voir le détail" }).click();
  await expect(page.locator(".demo-detail")).toBeVisible();
  await expect(navigation(page)).toHaveCount(0);
  await page.goto(`/demo#detail/${ids[1]}`);
  await expect(page.locator(".demo-detail")).toContainText("Marque Bêta fictive");
  await expect(navigation(page)).toHaveCount(0);
});

test("a single result keeps its detail and return action without a pager", async ({ page }) => {
  const { searches } = await installFixtures(page, { single: true });
  await search(page);
  await page.locator("#demo-result-open-0").click();
  await expect(page.locator(".demo-detail")).toBeVisible();
  await expect(navigation(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await expect(page.locator("#demo-result-open-0")).toBeFocused();
  expect(searches).toEqual([query]);
});

test("a missing neighbor clears old content and a retry reads the same publication", async ({ page }) => {
  const { searches, details } = await installFixtures(page, { failSecondOnce: true });
  await search(page);
  await page.locator("#demo-result-open-0").click();
  await expectPosition(page, 0, 2);
  await next(page).click();
  await expect(page.getByText("Publication non disponible", { exact: true })).toBeVisible();
  await expect(navigation(page)).toContainText("Annonce 2 sur 2");
  await expect(page.locator(".demo-detail")).toHaveCount(0);
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expectPosition(page, 1, 2);
  await expect(page.locator(".demo-detail")).toContainText("Marque Bêta fictive");
  expect(details).toEqual([ids[0], ids[1], ids[1]]);
  expect(searches).toEqual([query]);
});

test("a delayed detail cannot populate a newer destination", async ({ page }) => {
  let release!: () => void;
  const holdSecond = new Promise<void>((resolve) => { release = resolve; });
  const { details } = await installFixtures(page, { holdSecond });
  await search(page);
  await page.locator("#demo-result-open-0").click();
  await expectPosition(page, 0, 2);
  try {
    await next(page).click();
    await expect(page.getByText("Chargement du détail synthétique…", { exact: true })).toBeVisible();
    await expect(page.locator(".demo-detail")).toHaveCount(0);
    await expect.poll(() => [...details]).toEqual([ids[0], ids[1]]);
    await previous(page).click();
    await expectPosition(page, 0, 2);
  } finally {
    release();
  }
  await expect(page.locator(".demo-detail")).toContainText("Marque Alpha fictive");
  await expect(navigation(page)).toContainText("Annonce 1 sur 2");
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const file = process.env.AW_SCREENSHOT_DIR ? path.join(process.env.AW_SCREENSHOT_DIR, name) : testInfo.outputPath(name);
  if (process.env.AW_SCREENSHOT_DIR) await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

test("detail traversal remains readable with keyboard focus at mobile, desktop and enlarged text", async ({ page, browserName }, testInfo) => {
  test.setTimeout(120_000);
  await installFixtures(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await search(page);
  await page.getByRole("button", { name: "Charger plus" }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(3);
  await page.locator("#demo-result-open-1").click();
  await expectPosition(page, 1, 3);
  // WebKit may release the history entry wrapper while the same detail is still open.
  await page.requestGC();
  for (const view of [
    { width: 320, height: 780, theme: "light", size: "100%" },
    { width: 390, height: 844, theme: "dark", size: "200%" },
    { width: 768, height: 1024, theme: "light", size: "100%" },
    { width: 1440, height: 900, theme: "dark", size: "100%" },
  ] as const) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.getByLabel("Apparence").selectOption(view.theme);
    await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, view.size);
    await previous(page).focus();
    await page.keyboard.press("Tab");
    await expect(next(page)).toBeFocused();
    const box = await navigation(page).evaluate((nav) => {
      const viewport = document.documentElement.clientWidth;
      const controls = [...nav.querySelectorAll("button")].map((button) => {
        const bounds = button.getBoundingClientRect();
        return bounds.width >= 44 && bounds.height >= 44 && bounds.left >= 0 && bounds.right <= viewport + 1
          && button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1;
      });
      return { overflow: document.documentElement.scrollWidth - viewport, controls };
    });
    expect(box).toEqual({ overflow: 0, controls: [true, true] });
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await capture(page, testInfo, `loaded-navigation-${view.width}-${view.theme}-${view.size.slice(0, -1)}-${browserName}.png`);
  }
});

test("offline neighbor has a recovery path that preserves the loaded result set", async ({ page, context }) => {
  const { searches } = await installFixtures(page);
  await search(page);
  await page.locator("#demo-result-open-0").click();
  await expectPosition(page, 0, 2);
  // Intercept the neighbor separately because a fulfilled fixture can bypass offline emulation.
  const offlineRoute = `**/api/demo/v2/listings/${ids[1]}`;
  await page.route(offlineRoute, (route) => route.abort("internetdisconnected"));
  await context.setOffline(true);
  await next(page).click();
  await expect(page.getByText(/Reconnectez-vous pour charger ce détail/)).toBeVisible();
  await expect(navigation(page)).toContainText("Annonce 2 sur 2");
  await expect(page.locator(".demo-detail")).toHaveCount(0);
  await context.setOffline(false);
  await page.unroute(offlineRoute);
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expectPosition(page, 1, 2);
  expect(searches).toEqual([query]);
});

test("the neighbor position responds within the local action budget", async ({ page, context, browserName }, testInfo) => {
  await installFixtures(page);
  await search(page);
  await page.locator("#demo-result-open-0").click();
  await expectPosition(page, 0, 2);
  const session = browserName === "chromium" ? await context.newCDPSession(page) : undefined;
  const samples: number[] = [];
  try {
    if (session) await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (const index of [1, 0, 1, 0, 1]) {
      const control = index === 1 ? next(page) : previous(page);
      const elapsed = await control.evaluate(async (button, position) => {
        const nav = button.closest("nav");
        if (!nav) throw new Error("No navigation for the loaded position");
        const rendered = new Promise<void>((resolve) => {
          const observer = new MutationObserver(() => {
            if (!nav.textContent?.includes(position)) return;
            observer.disconnect();
            requestAnimationFrame(() => resolve());
          });
          observer.observe(nav, { childList: true, characterData: true, subtree: true });
        });
        const start = performance.now();
        (button as HTMLButtonElement).click();
        await rendered;
        return performance.now() - start;
      }, `Annonce ${index + 1} sur 2`);
      samples.push(elapsed);
      await expectPosition(page, index, 2);
    }
  } finally {
    await session?.detach();
  }
  await testInfo.attach("loaded-listing-navigation-feedback.json", {
    body: Buffer.from(JSON.stringify({
      browserName, cpuSlowdown: session ? 4 : 1, samplesMs: samples, budgetMs: 100,
      measurement: "Activation to next frame after visible position update, independent of the detail request",
    })),
    contentType: "application/json",
  });
  expect(Math.max(...samples)).toBeLessThanOrEqual(100);
});

test("legacy fragment history keeps traversal while a standalone detail has no result origin", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined }));
  await installFixtures(page);
  await search(page);
  await page.locator("#demo-result-open-0").click();
  await expect(navigation(page)).toContainText("Annonce 1 sur 2");
  await next(page).click();
  await expect(navigation(page)).toContainText("Annonce 2 sur 2");
  await page.goBack();
  await expect(navigation(page)).toContainText("Annonce 1 sur 2");
  await page.goForward();
  await expect(navigation(page)).toContainText("Annonce 2 sur 2");
  await page.evaluate((id) => { window.location.hash = `#detail/${id}`; }, ids[1]);
  await expect(page.locator(".demo-detail")).toBeVisible();
  await expect(navigation(page)).toHaveCount(0);
});
