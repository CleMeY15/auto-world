import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { demoFixtureVersion, demoMakeIds, demoModelIds, demoRelease, mockDemoCatalog } from "./demo-v2-fixtures";

const storageKey = "auto-world.demo.saved-searches.v1";

const exactCriteria = {
  query: {
    schemaVersion: 3,
    sort: "mileage_asc",
    priceMaxMinor: 4_500_099,
    mileageMaxKm: 80_000.5,
    makeId: demoMakeIds.alpha,
    modelId: demoModelIds.alphaOne,
    firstRegistrationYear: 2022,
    text: "etoile modele",
  },
  binding: { fixtureVersion: demoFixtureVersion, taxonomyRelease: demoRelease },
} as const;

const numericCriteria = {
  query: { schemaVersion: 2, sort: "price_desc", priceMaxMinor: 3_250_099, mileageMaxKm: 45_678.5 },
} as const;

type Criteria = typeof exactCriteria | typeof numericCriteria;

function entry(name: string, criteria: Criteria = numericCriteria) {
  return { name, criteria };
}

function bytes(searches: readonly ReturnType<typeof entry>[]) {
  return JSON.stringify({ schemaVersion: 2, searches });
}

async function seed(context: BrowserContext, searches: readonly ReturnType<typeof entry>[] = [entry("Famille", exactCriteria), entry("Budget", numericCriteria)]) {
  await context.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { key: storageKey, value: bytes(searches) });
}

async function ready(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.locator(".demo-saved-search")).not.toHaveCount(0);
}

function row(page: Page, name: string) {
  return page.locator(".demo-saved-search").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

function disclosure(page: Page, name: string) {
  return row(page, name).locator("details.demo-saved-search-disclosure");
}

async function open(page: Page, name: string) {
  const details = disclosure(page, name);
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  return details;
}

async function replace(page: Page, searches: readonly ReturnType<typeof entry>[]) {
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
  }, { key: storageKey, value: bytes(searches) });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page);
  const file = info.outputPath(name);
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
  await info.attach(name, { path: file, contentType: "image/png" });
}

test("saved criteria are collapsed by default and expose a contextual accessible name", async ({ page, context }) => {
  await seed(context);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);

  const details = disclosure(page, "Famille");
  const summary = details.locator("summary");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(summary).toHaveText("Voir les critères");
  await expect(summary).toHaveAccessibleName("Voir les critères Famille");
  await expect(details.locator(".demo-saved-search-criteria")).toBeHidden();
  await expect(row(page, "Famille").getByRole("button", { name: "Charger les critères", exact: true })).toBeVisible();
  await expect(row(page, "Famille").getByRole("button", { name: "Renommer", exact: true })).toBeVisible();
  await expect(row(page, "Famille").getByRole("button", { name: "Supprimer", exact: true })).toBeVisible();
});

test("opening a saved search preserves every exact V3 criterion and catalogue label", async ({ page, context }) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);
  const criteria = (await open(page, "Famille")).locator(".demo-saved-search-criteria");

  await expect(criteria).toContainText("Mots recherchésetoile modele");
  await expect(criteria).toContainText("Marque fictiveMarque Alpha fictive");
  await expect(criteria).toContainText("Modèle fictifModèle Alpha 1 fictif");
  await expect(criteria).toContainText("Première immatriculation fictive2022");
  await expect(criteria).toContainText("Budget maximum45000.99 €");
  await expect(criteria).toContainText("Kilométrage maximum80000.5 km");
  await expect(criteria).toContainText("TriKilométrage croissant (km d’abord)");
  await expect(criteria).not.toContainText(/make_ui_|model_ui_|taxcat_|taxrel_/u);
});

test("Enter and Space toggle native disclosure while retaining summary focus", async ({ page, context }) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);
  const details = disclosure(page, "Famille");
  const summary = details.locator("summary");

  await summary.focus();
  await summary.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
  await summary.press("Space");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
});

test("each saved row opens independently", async ({ page, context }) => {
  await seed(context);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);

  await open(page, "Famille");
  await expect(disclosure(page, "Budget")).not.toHaveAttribute("open", "");
  await disclosure(page, "Budget").locator("summary").click();
  await expect(disclosure(page, "Famille")).toHaveAttribute("open", "");
  await expect(disclosure(page, "Budget")).toHaveAttribute("open", "");
});

test("toggling criteria performs no storage, clipboard, API, navigation or announcement side effect", async ({ page, context }) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);
  const before = await page.evaluate((key) => ({ bytes: localStorage.getItem(key), hash: location.hash, announcement: document.querySelector(".demo-announcement")?.textContent ?? "" }), storageKey);
  const requests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as typeof window & { disclosureWrites: string[]; disclosureCopies: number }).disclosureWrites = [];
    (window as typeof window & { disclosureWrites: string[]; disclosureCopies: number }).disclosureCopies = 0;
    Storage.prototype.setItem = function (key, value) {
      (window as typeof window & { disclosureWrites: string[] }).disclosureWrites.push(key);
      return original.call(this, key, value);
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => { (window as typeof window & { disclosureCopies: number }).disclosureCopies += 1; } } });
  });

  await disclosure(page, "Famille").locator("summary").click();
  await disclosure(page, "Famille").locator("summary").click();
  const after = await page.evaluate((key) => ({
    bytes: localStorage.getItem(key),
    hash: location.hash,
    announcement: document.querySelector(".demo-announcement")?.textContent ?? "",
    writes: (window as typeof window & { disclosureWrites: string[] }).disclosureWrites,
    copies: (window as typeof window & { disclosureCopies: number }).disclosureCopies,
  }), storageKey);
  expect(after).toEqual({ ...before, writes: [], copies: 0 });
  expect(requests).toEqual([]);
});

test("catalogue pending and mismatch warnings stay visible outside collapsed criteria", async ({ page, context }) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/catalog", async (route) => {
    await held;
    await route.abort();
  });
  await page.goto("/demo#saved");
  await ready(page);
  const savedRow = row(page, "Famille");
  const pending = savedRow.getByRole("status", { name: "" }).filter({ hasText: "Vérification de la marque et du modèle enregistrés…" });
  await expect(pending).toBeVisible();
  await expect(disclosure(page, "Famille")).not.toHaveAttribute("open", "");
  expect(await pending.evaluate((node) => node.closest("details"))).toBeNull();
  release?.();
  await expect(savedRow.getByText("La marque ou le modèle de cette recherche n’est plus disponible dans le catalogue validé.")).toBeVisible();
  expect(await savedRow.getByText("La marque ou le modèle de cette recherche n’est plus disponible dans le catalogue validé.").evaluate((node) => node.closest("details"))).toBeNull();
});

test("criteria inspection remains available offline, in disabled demo and for a read-only snapshot", async ({ page, context }, info) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);
  await context.setOffline(true);
  await open(page, "Famille");
  await context.setOffline(false);

  const disabled = String(info.config.metadata.demoDisabledBaseURL);
  await page.goto(`${disabled}/demo#saved`);
  await ready(page);
  await open(page, "Famille");
  await expect(row(page, "Famille").locator("#demo-saved-search-load-0")).toBeDisabled();

  await page.evaluate(({ key }) => {
    const value = '{"schemaVersion":3,"searches":[],"future":true}';
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
  }, { key: storageKey });
  await expect(row(page, "Famille").getByRole("button", { name: "Renommer", exact: true })).toBeDisabled();
  await expect(disclosure(page, "Famille")).toHaveAttribute("open", "");
});

test("an open row follows criteria identity through rename and reorder", async ({ page, context }) => {
  await seed(context);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);
  await open(page, "Famille");

  await row(page, "Famille").getByRole("button", { name: "Renommer", exact: true }).click();
  await page.getByLabel("Nouveau nom", { exact: true }).fill("Électriques");
  await page.locator(".demo-rename-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(disclosure(page, "Électriques")).toHaveAttribute("open", "");
  await replace(page, [entry("Budget", numericCriteria), entry("Électriques", exactCriteria)]);
  await expect(disclosure(page, "Électriques")).toHaveAttribute("open", "");
  await expect(disclosure(page, "Budget")).not.toHaveAttribute("open", "");
});

test("replacement, navigation and reload reset disclosure to collapsed", async ({ page, context }) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);
  await open(page, "Famille");

  await replace(page, [entry("Famille", numericCriteria)]);
  await expect(disclosure(page, "Famille")).not.toHaveAttribute("open", "");
  await open(page, "Famille");
  await page.getByRole("button", { name: "Recherche", exact: true }).click();
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await expect(disclosure(page, "Famille")).not.toHaveAttribute("open", "");
  await open(page, "Famille");
  await page.reload();
  await expect(disclosure(page, "Famille")).not.toHaveAttribute("open", "");
});

test("loading criteria remains explicit and never submits a search", async ({ page, context }) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  const searchRequests: string[] = [];
  page.on("request", (request) => { if (/^\/api\/demo\/v[23]\/search$/u.test(new URL(request.url()).pathname)) searchRequests.push(request.url()); });
  await page.goto("/demo#saved");
  await ready(page);
  await open(page, "Famille");
  await row(page, "Famille").getByRole("button", { name: "Charger les critères", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  await expect(page.getByLabel("Recherche par mots")).toHaveValue("etoile modele");
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("45000.99");
  expect(searchRequests).toEqual([]);
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toHaveCount(0);
});

test("collapsed and expanded criteria pass the required viewport, theme, accessibility and target matrix", async ({ page, context, browserName }, info) => {
  test.setTimeout(180_000);
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);

  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      const details = disclosure(page, "Famille");
      if ((await details.getAttribute("open")) !== null) await details.locator("summary").click();
      await capture(page, info, `saved-criteria-${width}-${theme}-${browserName}-collapsed.png`);
      await details.locator("summary").click();
      await capture(page, info, `saved-criteria-${width}-${theme}-${browserName}-expanded.png`);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      const target = await details.locator("summary").boundingBox();
      expect(target).not.toBeNull();
      expect(target!.height).toBeGreaterThanOrEqual(44);
      expect(target!.width).toBeGreaterThanOrEqual(44);
    }
  }
});

test("200 percent platform and Verdana text remain usable with reduced motion", async ({ page, context, browserName }, info) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const font of ["platform", "verdana"] as const) {
    await page.goto("/demo#saved");
    await ready(page);
    await page.setViewportSize({ width: 390, height: 844 });
    if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await open(page, "Famille");
    await capture(page, info, `saved-criteria-200-${font}-${browserName}.png`);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
});

test("toggle feedback meets the Chromium 4x budget and records a separate WebKit baseline", async ({ page, context, browserName }, info) => {
  await seed(context, [entry("Famille", exactCriteria)]);
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await ready(page);
  const client = browserName === "chromium" ? await context.newCDPSession(page) : undefined;
  if (client) await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const samples: number[] = [];
  try {
    for (let index = 0; index < 5; index += 1) {
      await disclosure(page, "Famille").locator("summary").evaluate((summary) => {
        summary.addEventListener("click", () => {
          const started = performance.now();
          requestAnimationFrame(() => { (window as typeof window & { disclosureMs: number }).disclosureMs = performance.now() - started; });
        }, { once: true });
      });
      await disclosure(page, "Famille").locator("summary").click();
      await page.waitForFunction(() => typeof (window as typeof window & { disclosureMs?: number }).disclosureMs === "number");
      samples.push(await page.evaluate(() => {
        const host = window as typeof window & { disclosureMs?: number };
        const value = host.disclosureMs!;
        delete host.disclosureMs;
        return value;
      }));
    }
  } finally {
    if (client) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  expect(samples).toHaveLength(5);
  expect(Math.max(...samples)).toBeLessThanOrEqual(100);
  const profile = browserName === "chromium" ? "chromium-4x-cpu" : "webkit-unthrottled-baseline";
  const file = info.outputPath(`saved-criteria-performance-${browserName}.json`);
  await writeFile(file, JSON.stringify({ samples, budgetMaxMs: 100, profile, browserVersion: context.browser()?.version(), caveat: "Local native disclosure click to next animation frame; not physical paint or network latency." }, null, 2));
  await info.attach(`saved-criteria-performance-${browserName}.json`, { path: file, contentType: "application/json" });
});
