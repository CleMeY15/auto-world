import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { demoFixtureVersion, demoMakeIds, demoModelIds, demoRelease, mockDemoCatalog } from "./demo-v2-fixtures";

const key = "auto-world.demo.saved-searches.v1";
const comparisonKey = "auto-world.demo.saved-comparisons.v1";
const favoriteKey = "auto-world.demo.favorites.v1";
const comparisonEntry = (name: string, index = 0) => ({ name, fragment: `#comparison-link/v1/${encodeURIComponent(JSON.stringify([`lst_search-rename-${index}-b`, `lst_search-rename-${index}-a`]))}` });
const numericCriteria = { query: { schemaVersion: 2, sort: "price_desc", priceMaxMinor: 3_250_099, mileageMaxKm: 45_678.5 } } as const;
const identityCriteria = {
  query: {
    schemaVersion: 3,
    sort: "mileage_asc",
    priceMaxMinor: 4_500_000,
    mileageMaxKm: 80_000,
    makeId: demoMakeIds.alpha,
    modelId: demoModelIds.alphaOne,
    firstRegistrationYear: 2022,
    text: "etoile modele",
  },
  binding: { fixtureVersion: demoFixtureVersion, taxonomyRelease: demoRelease },
} as const;
type StoredCriteria = {
  readonly query: Readonly<Record<string, unknown>>;
  readonly binding?: Readonly<Record<string, unknown>>;
};
const entry = (name: string, criteria: StoredCriteria = numericCriteria) => ({ name, criteria });
const initial = [entry("Budget quotidien"), entry("Famille", identityCriteria)] as const;
const bytes = (searches: readonly ReturnType<typeof entry>[] = initial) => JSON.stringify({ schemaVersion: 2, searches });

async function seed(context: BrowserContext, searches: readonly ReturnType<typeof entry>[] = initial) {
  await context.addInitScript(({ storageKey, value }) => {
    if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, value);
  }, { storageKey: key, value: bytes(searches) });
}

async function seedComparisons(context: BrowserContext) {
  await context.addInitScript(({ storageKey, value }) => {
    if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, value);
  }, { storageKey: comparisonKey, value: JSON.stringify({ schemaVersion: 1, comparisons: [comparisonEntry("Duo")] }) });
}

async function ready(page: Page) {
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.locator("#demo-saved-search-rename-0")).toBeEnabled();
}

async function edit(page: Page, index = 0) {
  await page.locator(`#demo-saved-search-rename-${index}`).click();
  await expect(page.locator("#demo-rename-search-name")).toBeFocused();
}

async function submit(page: Page, name: string) {
  await page.getByLabel("Nouveau nom", { exact: true }).fill(name);
  await page.locator(".demo-rename-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
}

async function readBytes(page: Page) {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}

async function replace(page: Page, value: string | null, event = true) {
  await page.evaluate(({ storageKey, replacement, dispatch }) => {
    if (replacement === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, replacement);
    if (dispatch) window.dispatchEvent(new StorageEvent("storage", { key: storageKey, storageArea: localStorage, newValue: replacement }));
  }, { storageKey: key, replacement: value, dispatch: event });
}

async function fit(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  const field = await page.locator("#demo-rename-search-name").boundingBox();
  expect(field).not.toBeNull();
  expect(field!.width).toBeGreaterThan(44);
  expect(field!.x).toBeGreaterThanOrEqual(0);
  expect(field!.x + field!.width).toBeLessThanOrEqual(dimensions.viewport);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await fit(page);
  const file = info.outputPath(name);
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
  await info.attach(name, { path: file, contentType: "image/png" });
}

test("rename changes only a normalized name at its existing position and survives reload", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  const network: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/") && pathname !== "/api/demo/v2/catalog") network.push(request.method() + request.url());
  });
  await page.evaluate(({ comparison, favorite }) => {
    localStorage.setItem(comparison, '{"schemaVersion":2,"future":true}');
    localStorage.setItem(favorite, '{"schemaVersion":2,"future":true}');
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => { throw new Error("Rename must never copy"); } } });
  }, { comparison: comparisonKey, favorite: favoriteKey });
  await edit(page, 1);
  await expect(page.getByLabel("Nouveau nom", { exact: true })).toHaveValue("Famille");
  expect(await page.locator("#demo-rename-search-name").evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 7]);
  await submit(page, "  E\u0301lectriques  ");
  await expect(page.locator("#demo-saved-search-rename-1")).toBeFocused();
  expect(await readBytes(page)).toBe(bytes([entry("Budget quotidien"), entry("Électriques", identityCriteria)]));
  expect(await page.evaluate(({ comparison, favorite }) => [localStorage.getItem(comparison), localStorage.getItem(favorite)], { comparison: comparisonKey, favorite: favoriteKey })).toEqual(['{"schemaVersion":2,"future":true}', '{"schemaVersion":2,"future":true}']);
  expect(network).toEqual([]);
  await page.reload();
  await expect(page.locator("#demo-saved-search-name-1")).toHaveText("Électriques");
  await page.locator("#demo-saved-search-criteria-toggle-1").click();
  await expect(page.locator(".demo-saved-search").nth(1)).toContainText("etoile modele");
  await expect(page.locator(".demo-saved-search").nth(1)).toContainText("45000");
});

test("same normalized name performs no write while duplicate labels and full lists remain editable", async ({ page, context }) => {
  const searches = Array.from({ length: 10 }, (_, index) => entry(`Choix ${index}`, { query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: index } }));
  await seed(context, searches);
  await ready(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as typeof window & { renameWrites: string[] }).renameWrites = [];
    Storage.prototype.setItem = function (storageKey, value) {
      (window as typeof window & { renameWrites: string[] }).renameWrites.push(storageKey);
      return original.call(this, storageKey, value);
    };
  });
  await edit(page);
  await submit(page, "  Choix 0  ");
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { renameWrites: string[] }).renameWrites)).toEqual([]);
  await edit(page);
  await submit(page, "Choix 1");
  await expect(page.locator(".demo-saved-search")).toHaveCount(10);
  await expect(page.locator("#demo-saved-search-name-0")).toHaveText("Choix 1");
  await expect(page.locator("#demo-saved-search-name-1")).toHaveText("Choix 1");
});

test("invalid names, cancel and Escape preserve bytes and allow only one editor", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  const original = await readBytes(page);
  await edit(page);
  for (const invalid of ["", " ", "x".repeat(61), "\u202eNom"]) {
    await submit(page, invalid);
    await expect(page.getByLabel("Nouveau nom", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Nouveau nom", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(await readBytes(page)).toBe(original);
  }
  await page.getByLabel("Nouveau nom", { exact: true }).press("Escape");
  await expect(page.locator("#demo-saved-search-rename-0")).toBeFocused();
  await edit(page);
  await page.getByLabel("Nouveau nom", { exact: true }).fill("Brouillon");
  await page.locator("#demo-saved-search-rename-1").click();
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(1);
  await expect(page.getByLabel("Nouveau nom", { exact: true })).toHaveValue("Famille");
  await page.locator(".demo-rename-search-form").getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.locator("#demo-saved-search-rename-1")).toBeFocused();
  expect(await readBytes(page)).toBe(original);
});

test("navigation discards drafts and same-turn obsolete submits cannot write", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await edit(page);
  await page.getByLabel("Nouveau nom", { exact: true }).fill("Obsolète");
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>(".demo-rename-search-form")!;
    window.location.hash = "#search";
    form.requestSubmit();
  });
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
  expect(await readBytes(page)).toBe(bytes());
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await edit(page);
  await expect(page.getByLabel("Nouveau nom", { exact: true })).toHaveValue("Budget quotidien");
});

test("unseen writes and cross-tab replacements cancel stale intent without resurrecting data", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await edit(page);
  await page.getByLabel("Nouveau nom", { exact: true }).fill("Obsolète");
  const external = bytes([entry("Autre onglet", identityCriteria)]);
  await replace(page, external, false);
  await page.locator(".demo-rename-search-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
  expect(await readBytes(page)).toBe(external);
  await expect(page.locator("#demo-saved-search-name-0")).toHaveText("Autre onglet");

  const other = await context.newPage();
  await mockDemoCatalog(other);
  await other.goto("/demo#saved");
  await edit(page);
  const reordered = bytes([entry("Budget quotidien"), entry("Autre onglet", identityCriteria)]);
  await replace(other, reordered, false);
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
  await expect(page.locator("#demo-saved-search-rename-1")).toBeFocused();
  expect(await readBytes(page)).toBe(reordered);
  await other.close();
});

test("removed targets fall back to the heading and external changes never steal unrelated focus", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await edit(page);
  await replace(page, bytes([entry("Famille", identityCriteria)]));
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
  await expect(page.locator("#demo-saved-searches-title")).toBeFocused();
  await edit(page);
  await page.getByLabel("Apparence").focus();
  await replace(page, bytes([entry("Changement distant", identityCriteria)]));
  await expect(page.getByLabel("Apparence")).toBeFocused();
});

test("rename retains deletion undo and invalidates an older reset confirmation", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await page.locator("#demo-saved-search-remove-1").click();
  await edit(page);
  await submit(page, "Nouveau budget");
  await page.locator("#demo-saved-search-undo").click();
  expect(await readBytes(page)).toBe(bytes([entry("Nouveau budget"), entry("Famille", identityCriteria)]));
  await page.locator("#demo-saved-search-reset-start").click();
  await edit(page);
  await submit(page, "Dernier budget");
  await expect(page.locator("#demo-saved-search-reset-confirm")).toHaveCount(0);
});

test("future and corrupt replacements cancel editing without changing protected bytes", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  for (const protectedBytes of ['{"schemaVersion":3,"searches":[],"future":true}', "{bad"]) {
    await replace(page, bytes());
    await edit(page);
    await replace(page, protectedBytes);
    await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
    await expect(page.locator("#demo-saved-search-rename-0")).toBeDisabled();
    expect(await readBytes(page)).toBe(protectedBytes);
  }
});

for (const failure of ["QuotaExceededError", "SecurityError"] as const) {
  test(`write failure ${failure} keeps the renamed search in session and preserves bytes`, async ({ page, context }) => {
    await seed(context);
    await ready(page);
    const original = await readBytes(page);
    await page.evaluate(({ storageKey, failureName }) => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === storageKey) throw new DOMException("unavailable", failureName);
        return originalSet.call(this, name, value);
      };
    }, { storageKey: key, failureName: failure });
    await edit(page);
    await submit(page, "Nom de session");
    await expect(page.locator("#demo-saved-search-name-0")).toHaveText("Nom de session");
    await expect(page.locator("main")).toContainText("session");
    expect(await readBytes(page)).toBe(original);
    await edit(page);
    await submit(page, "Encore local");
    await expect(page.locator("#demo-saved-search-name-0")).toHaveText("Encore local");
  });
}

test("offline and disabled-demo rename stay local without API traffic", async ({ page, context }, info) => {
  await seed(context);
  await ready(page);
  await context.setOffline(true);
  await edit(page);
  await submit(page, "Hors ligne");
  expect(await readBytes(page)).toBe(bytes([entry("Hors ligne"), entry("Famille", identityCriteria)]));
  await context.setOffline(false);
  const calls: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) calls.push(request.url()); });
  const disabled = String(info.config.metadata.demoDisabledBaseURL);
  await page.goto(`${disabled}/demo#saved`);
  await expect(page.locator("#demo-saved-search-rename-0")).toBeEnabled();
  await edit(page);
  await submit(page, "Démo inactive");
  await expect(page.locator("#demo-saved-search-name-0")).toHaveText("Démo inactive");
  expect(calls).toEqual([]);
});

test("the newest editor wins both shared-focus races between searches and comparisons", async ({ page, context }) => {
  await seed(context);
  await seedComparisons(context);
  await ready(page);
  await page.evaluate(() => {
    document.getElementById("demo-saved-comparison-rename-0")!.click();
    document.getElementById("demo-saved-search-rename-0")!.click();
  });
  await expect(page.locator("#demo-rename-search-name")).toBeFocused();
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);

  await page.evaluate(() => {
    document.getElementById("demo-saved-search-rename-0")!.click();
    document.getElementById("demo-saved-comparison-rename-0")!.click();
  });
  await expect(page.locator("#demo-rename-comparison-name")).toBeFocused();
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
});

test("stale cancel, submit and external-invalidation focus callbacks cannot steal from a newer editor", async ({ page, context }) => {
  await seed(context);
  await seedComparisons(context);
  await ready(page);

  await edit(page);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>(".demo-rename-search-form button[type=button]")!.click();
    document.getElementById("demo-saved-comparison-rename-0")!.click();
  });
  await expect(page.locator("#demo-rename-comparison-name")).toBeFocused();

  await page.evaluate(() => {
    const input = document.getElementById("demo-rename-comparison-name") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Comparaison validée");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLFormElement>(".demo-rename-comparison-form")!.requestSubmit();
    document.getElementById("demo-saved-search-rename-0")!.click();
  });
  await expect(page.locator("#demo-rename-search-name")).toBeFocused();

  await page.evaluate(({ storageKey, replacement }) => {
    localStorage.setItem(storageKey, replacement);
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey, storageArea: localStorage, newValue: replacement }));
    document.getElementById("demo-saved-comparison-rename-0")!.click();
  }, { storageKey: key, replacement: bytes([entry("Externe", identityCriteria)]) });
  await expect(page.locator("#demo-rename-comparison-name")).toBeFocused();
  await expect(page.locator(".demo-rename-search-form")).toHaveCount(0);
});

test("inline editor is accessible across representative viewports and themes", async ({ page, context, browserName }, info) => {
  test.setTimeout(120_000);
  await seed(context);
  await ready(page);
  await page.locator("#demo-saved-search-rename-0").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Nouveau nom", { exact: true })).toBeFocused();
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      await capture(page, info, `rename-search-${width}-${theme}-${browserName}.png`);
    }
  }
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  const targets = await page.locator(".demo-saved-search button").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height };
  }));
  expect(targets.length).toBeGreaterThan(3);
  expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  await submit(page, "");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await capture(page, info, `rename-search-invalid-${browserName}.png`);
});

test("200 percent platform and Verdana text with reduced motion retain an operable editor", async ({ page, context, browserName }, info) => {
  await seed(context);
  for (const font of ["platform", "verdana"] as const) {
    await ready(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await edit(page);
    await capture(page, info, `rename-search-200-${font}-${browserName}.png`);
    await submit(page, `Accessible ${font}`);
    await expect(page.locator("#demo-saved-search-rename-0")).toBeFocused();
  }
});

test("rename feedback meets the Chromium 4x budget and records a separate WebKit baseline", async ({ page, context, browserName }, info) => {
  await seed(context);
  await ready(page);
  const client = browserName === "chromium" ? await context.newCDPSession(page) : undefined;
  if (client) await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const samples: number[] = [];
  try {
    for (let index = 0; index < 5; index += 1) {
      await edit(page);
      await page.locator(".demo-rename-search-form").evaluate((form) => {
        form.addEventListener("submit", () => {
          const start = performance.now();
          const observer = new MutationObserver(() => {
            if (document.querySelector(".demo-rename-search-form")) return;
            observer.disconnect();
            requestAnimationFrame(() => { (window as typeof window & { renameMs: number }).renameMs = performance.now() - start; });
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }, { once: true });
      });
      await submit(page, `Mesure ${index}`);
      await page.waitForFunction(() => typeof (window as typeof window & { renameMs?: number }).renameMs === "number");
      samples.push(await page.evaluate(() => {
        const host = window as typeof window & { renameMs?: number }; const value = host.renameMs!; delete host.renameMs; return value;
      }));
    }
  } finally {
    if (client) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  expect(samples).toHaveLength(5);
  expect(Math.max(...samples)).toBeLessThanOrEqual(100);
  const profile = browserName === "chromium" ? "chromium-4x-cpu" : "webkit-unthrottled-baseline";
  const file = info.outputPath(`rename-search-performance-${browserName}.json`);
  await writeFile(file, JSON.stringify({ samples, budgetMaxMs: 100, profile, browserVersion: context.browser()?.version(), caveat: "Local DOM feedback to next animation frame; not physical paint or network latency." }, null, 2));
  await info.attach(`rename-search-performance-${browserName}.json`, { path: file, contentType: "application/json" });
});
