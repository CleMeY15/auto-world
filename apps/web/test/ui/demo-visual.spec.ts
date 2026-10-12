import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0 || bounds.right <= viewportWidth + 0.5) return [];
      return [{
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${Array.from(element.classList).map((name) => `.${name}`).join("")}`,
        left: Math.round(bounds.left * 10) / 10,
        right: Math.round(bounds.right * 10) / 10,
        width: Math.round(bounds.width * 10) / 10,
        text: (element.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 80),
      }];
    });
    return { viewportWidth, documentWidth: document.documentElement.scrollWidth, offenders };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({ viewportWidth: report.viewportWidth, documentWidth: report.viewportWidth, offenders: [] });
}

test("the complete demo state matrix remains usable across required light and dark viewports", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "the visual matrix is captured once");
  test.setTimeout(180_000);
  const directory = process.env.AW_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  type Mode = "complete" | "empty" | "partial" | "stale" | "error" | "slow";
  let mode: Mode = "complete";
  let slowGate: Promise<void> = Promise.resolve();
  const requestId = `req_${"c".repeat(32)}`;
  const visualResult = (observedAt: string, availability: "active" | "withdrawn" = "active") => ({ listingId: "lst_visual-01", availability, price: { status: "observed", value: { amountMinor: 3250000, currency: "EUR" }, evidenceId: `ev_${"1".repeat(64)}` }, mileage: { status: "observed", value: { amount: 28500, unit: "km" }, evidenceId: `ev_${"3".repeat(64)}` }, evidence: [{ evidenceId: `ev_${"0".repeat(64)}`, field: "price", observedAt: new Date(Date.parse(observedAt) - 1000).toISOString(), confidenceBps: 7000, value: { amountMinor: 3100000, currency: "EUR" } }, { evidenceId: `ev_${"1".repeat(64)}`, field: "price", observedAt, confidenceBps: 9000, value: { amountMinor: 3250000, currency: "EUR" } }, { evidenceId: `ev_${"3".repeat(64)}`, field: "mileage", observedAt, confidenceBps: 8500, value: { amount: 28500, unit: "km" } }] });
  await page.route("**/api/demo/search", async (route) => {
    if (mode === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, requestId, error: { code: "read_unavailable" } }) });
    if (mode === "slow") await slowGate;
    const observedAt = mode === "stale" ? new Date(Date.now() - 61_000).toISOString() : new Date().toISOString();
    const results = mode === "empty" ? [] : [visualResult(observedAt)];
    const state = mode === "partial" ? "partial" : mode === "stale" ? "stale" : "complete";
    const data = { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: `ui-visual-${mode}-v1`, dataAsOf: observedAt, state, results, ...(state === "complete" ? { totalCount: results.length } : { reason: state === "partial" ? "projection_incomplete" : "projection_stale" }) };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, requestId, data }) });
  });
  await page.route("**/api/demo/listings/*", async (route) => {
    const observedAt = new Date().toISOString();
    const data = { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "ui-visual-detail-v1", dataAsOf: observedAt, state: "complete", totalCount: 1, results: [visualResult(observedAt, "withdrawn")] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, requestId, data }) });
  });
  async function capture(name: string, fullPage = true) {
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: directory ? path.join(directory, name) : testInfo.outputPath(name), fullPage, scale: "css" });
  }
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      mode = "complete";
      await page.goto("/demo");
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
      await page.getByLabel("Apparence").selectOption(theme);
      const targets = await page.locator("button, input, select, a").evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).visibility !== "hidden").map((element) => { const bounds = element.getBoundingClientRect(); return { height: bounds.height, width: bounds.width }; }));
      expect(targets.every((target) => target.height >= 44 && target.width >= 44)).toBe(true);
      await capture(`demo-${width}-${theme}-search.png`, false);
      await page.getByRole("button", { name: "Rechercher", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
      await capture(`demo-${width}-${theme}-results.png`);
      const card = page.locator(".demo-result-card").first();
      await card.getByRole("button", { name: "Ajouter aux favoris" }).click();
      await card.getByRole("button", { name: "Voir le détail" }).click();
      await expect(page.getByText(/se contredisent/)).toBeVisible();
      await capture(`demo-${width}-${theme}-detail-withdrawn-contradictory.png`);
      await page.getByRole("button", { name: /Favoris \(1\)/ }).click();
      await expect(page.getByText("Favori synthétique 1")).toBeVisible();
      await capture(`demo-${width}-${theme}-saved.png`);

      for (const recovery of ["empty", "partial", "stale", "error"] as const) {
        mode = recovery;
        await page.goto("/demo");
        await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
        await page.getByLabel("Apparence").selectOption(theme);
        await page.getByRole("button", { name: "Rechercher", exact: true }).click();
        if (recovery === "error") await expect(page.getByText("Recherche indisponible")).toBeVisible();
        else await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
        await capture(`demo-${width}-${theme}-${recovery}.png`);
      }
      if (width === 390) {
        mode = "slow";
        let releaseSlow: (() => void) | undefined;
        slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
        await page.goto("/demo"); await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true"); await page.getByLabel("Apparence").selectOption(theme);
        await page.getByRole("button", { name: "Rechercher", exact: true }).click();
        await expect(page.getByRole("button", { name: "Recherche…", exact: true })).toBeVisible();
        await expect(page.getByText(/plus de temps que prévu/)).toBeVisible();
        await capture(`demo-${width}-${theme}-slow.png`);
        releaseSlow?.();
        await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
        await page.evaluate(() => localStorage.setItem("auto-world.demo.favorites.v1", "{broken"));
        await page.goto("/demo#saved"); await page.reload(); await expect(page.getByText(/favoris enregistrés sont illisibles/)).toBeVisible(); await page.getByLabel("Apparence").selectOption(theme);
        await capture(`demo-${width}-${theme}-storage-corrupt.png`);
      }
    }
  }
});

test("reduced motion and 200 percent text keep the demo operable", async ({ page, browserName }, testInfo) => {
  const observedAt = new Date().toISOString();
  const directory = process.env.AW_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const priceEvidence = `ev_${"4".repeat(64)}`;
  const mileageEvidence = `ev_${"5".repeat(64)}`;
  const result = { listingId: "lst_text-01", availability: "active", price: { status: "observed", value: { amountMinor: 3250000, currency: "EUR" }, evidenceId: priceEvidence }, mileage: { status: "observed", value: { amount: 28500, unit: "km" }, evidenceId: mileageEvidence }, evidence: [{ evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 9000, value: { amountMinor: 3250000, currency: "EUR" } }, { evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 8500, value: { amount: 28500, unit: "km" } }] };
  await page.route("**/api/demo/search", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, requestId: `req_${"d".repeat(32)}`, data: { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "ui-text-v1", dataAsOf: observedAt, state: "complete", totalCount: 1, results: [result] } }) }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  async function captureTextState(name: string) {
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    const targets = await page.locator("main button, main input, main select").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        height: bounds.height,
        width: bounds.width,
        contentFits: element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1,
      };
    }));
    expect(targets.every((target) => target.height >= 44 && target.width >= 44 && target.contentFits)).toBe(true);
    await page.screenshot({ path: directory ? path.join(directory, name) : testInfo.outputPath(name), fullPage: true, scale: "css" });
  }
  await captureTextState(`demo-390-light-text-200-${browserName}-search.png`);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats synthétiques" })).toBeVisible();
  await captureTextState(`demo-390-light-text-200-${browserName}-results.png`);
});
