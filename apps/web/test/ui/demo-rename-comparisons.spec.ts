import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { mockDemoCatalog } from "./demo-v2-fixtures";

const key = "auto-world.demo.saved-comparisons.v1";
const searchKey = "auto-world.demo.saved-searches.v1";
const favoriteKey = "auto-world.demo.favorites.v1";
const entry = (name: string, index = 0) => ({ name, fragment: `#comparison-link/v1/${encodeURIComponent(JSON.stringify([`lst_rename-${index}-b`, `lst_rename-${index}-a`]))}` });
const bytes = (comparisons = [entry("Duo du week-end"), entry("Famille", 1)]) => JSON.stringify({ schemaVersion: 1, comparisons });

async function seed(context: BrowserContext, comparisons = [entry("Duo du week-end"), entry("Famille", 1)]) {
  await context.addInitScript(({ storageKey, value }) => {
    if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, value);
  }, { storageKey: key, value: bytes(comparisons) });
}

async function ready(page: Page) {
  await mockDemoCatalog(page);
  await page.goto("/demo#saved");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await expect(page.locator("#demo-saved-comparison-rename-0")).toBeEnabled();
}

async function edit(page: Page, index = 0) {
  await page.locator(`#demo-saved-comparison-rename-${index}`).click();
  await expect(page.locator("#demo-rename-comparison-name")).toBeFocused();
}

async function submit(page: Page, name: string) {
  await page.getByLabel("Nouveau nom", { exact: true }).fill(name);
  await page.locator(".demo-rename-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
}

async function readBytes(page: Page) { return page.evaluate((storageKey) => localStorage.getItem(storageKey), key); }

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
  const field = await page.locator("#demo-rename-comparison-name").boundingBox();
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
  await page.evaluate(({ search, favorite }) => {
    localStorage.setItem(search, '{"schemaVersion":2,"future":true}');
    localStorage.setItem(favorite, '{"schemaVersion":2,"future":true}');
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => { throw new Error("Rename must never copy"); } } });
  }, { search: searchKey, favorite: favoriteKey });
  await edit(page, 1);
  expect(await page.getByLabel("Nouveau nom", { exact: true }).inputValue()).toBe("Famille");
  expect(await page.locator("#demo-rename-comparison-name").evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 7]);
  await submit(page, "  E\u0301lectriques  ");
  await expect(page.locator("#demo-saved-comparison-rename-1")).toBeFocused();
  expect(await readBytes(page)).toBe(bytes([entry("Duo du week-end"), entry("Électriques", 1)]));
  expect(await page.evaluate(({ search, favorite }) => [localStorage.getItem(search), localStorage.getItem(favorite)], { search: searchKey, favorite: favoriteKey })).toEqual(['{"schemaVersion":2,"future":true}', '{"schemaVersion":2,"future":true}']);
  expect(network).toEqual([]);
  await page.reload();
  await expect(page.locator("#demo-saved-comparison-name-1")).toHaveText("Électriques");
});

test("same normalized name performs no storage write; duplicate labels and full lists remain editable", async ({ page, context }) => {
  const comparisons = Array.from({ length: 10 }, (_, index) => entry(`Choix ${index}`, index));
  await seed(context, comparisons);
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
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { renameWrites: string[] }).renameWrites)).toEqual([]);
  await edit(page);
  await submit(page, "Choix 1");
  expect(await readBytes(page)).toBe(bytes([entry("Choix 1"), ...comparisons.slice(1)]));
  await expect(page.locator(".demo-saved-comparison")).toHaveCount(10);
});

test("invalid names, cancel and Escape preserve bytes and there is only one editor", async ({ page, context }) => {
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
  await expect(page.locator("#demo-saved-comparison-rename-0")).toBeFocused();
  await edit(page);
  await page.getByLabel("Nouveau nom", { exact: true }).fill("Brouillon");
  await page.locator("#demo-saved-comparison-rename-1").click();
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(1);
  await expect(page.getByLabel("Nouveau nom", { exact: true })).toHaveValue("Famille");
  await page.locator(".demo-rename-comparison-form").getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.locator("#demo-saved-comparison-rename-1")).toBeFocused();
  expect(await readBytes(page)).toBe(original);
});

test("navigation discards the draft and a same-event-loop obsolete submit cannot write", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await edit(page);
  await page.getByLabel("Nouveau nom", { exact: true }).fill("Obsolète");
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>(".demo-rename-comparison-form")!;
    window.location.hash = "#search";
    form.requestSubmit();
  });
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
  expect(await readBytes(page)).toBe(bytes());
  await page.getByRole("button", { name: "Enregistrés", exact: true }).click();
  await edit(page);
  await expect(page.getByLabel("Nouveau nom", { exact: true })).toHaveValue("Duo du week-end");
});

test("an unseen external write just before submit is preserved and does not resurrect the old target", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await edit(page);
  await page.getByLabel("Nouveau nom", { exact: true }).fill("Obsolète");
  const external = bytes([entry("Autre onglet", 3)]);
  await replace(page, external, false);
  await page.locator(".demo-rename-comparison-form").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
  expect(await readBytes(page)).toBe(external);
  await expect(page.locator("#demo-saved-comparison-name-0")).toHaveText("Autre onglet");
});

test("navigation cannot grant a new editor authority through a stale row before hashchange renders", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await edit(page);
  await page.evaluate(async () => {
    window.location.hash = "#search";
    document.getElementById("demo-saved-comparison-rename-1")!.click();
    await Promise.resolve();
    const input = document.getElementById("demo-rename-comparison-name") as HTMLInputElement | null;
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Interdit hors écran");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await Promise.resolve();
    document.querySelector<HTMLFormElement>(".demo-rename-comparison-form")?.requestSubmit();
  });
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
  expect(await readBytes(page)).toBe(bytes());
});

test("cross-tab replacement cancels editing and restores focus by fragment after reorder", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  const other = await context.newPage();
  await ready(other);
  await edit(page);
  const external = bytes([entry("Famille", 1), entry("Nom externe")]);
  await replace(other, external, false);
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
  await expect(page.locator("#demo-saved-comparison-rename-1")).toBeFocused();
  expect(await readBytes(page)).toBe(external);
  await other.close();
});

test("removed targets fall back to the section title and external changes do not steal unrelated focus", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await edit(page);
  await replace(page, bytes([entry("Famille", 1)]));
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
  await expect(page.locator("#demo-saved-comparisons-title")).toBeFocused();
  await edit(page);
  await page.getByLabel("Apparence").focus();
  await replace(page, bytes([entry("Changement distant", 1)]));
  await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
  await expect(page.getByLabel("Apparence")).toBeFocused();
});

test("rename retains deletion undo and invalidates an older reset confirmation", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await page.locator("#demo-saved-comparison-remove-1").click();
  await edit(page);
  await submit(page, "Nouveau duo");
  await page.locator("#demo-saved-comparison-undo").click();
  expect(await readBytes(page)).toBe(bytes([entry("Nouveau duo"), entry("Famille", 1)]));
  await page.locator("#demo-saved-comparison-reset-start").click();
  await edit(page);
  await submit(page, "Dernier duo");
  await expect(page.locator("#demo-saved-comparison-reset-confirm")).toHaveCount(0);
  expect(await readBytes(page)).toBe(bytes([entry("Dernier duo"), entry("Famille", 1)]));
});

test("future and corrupt replacements cancel editing without changing preserved bytes", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  for (const protectedBytes of ['{"schemaVersion":2,"future":true}', "{bad"]) {
    await replace(page, bytes());
    await edit(page);
    await replace(page, protectedBytes);
    await expect(page.locator(".demo-rename-comparison-form")).toHaveCount(0);
    await expect(page.locator("#demo-saved-comparison-rename-0")).toBeDisabled();
    expect(await readBytes(page)).toBe(protectedBytes);
  }
});

for (const failure of ["QuotaExceededError", "SecurityError"] as const) {
  test(`write failure ${failure} keeps renamed label for the session and preserves disk bytes`, async ({ page, context }) => {
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
    await expect(page.locator("#demo-saved-comparison-name-0")).toHaveText("Nom de session");
    await expect(page.locator("main")).toContainText("session");
    expect(await readBytes(page)).toBe(original);
    await edit(page);
    await submit(page, "Encore local");
    await expect(page.locator("#demo-saved-comparison-name-0")).toHaveText("Encore local");
    expect(await readBytes(page)).toBe(original);
  });
}

test("offline rename works and disabled-demo arbitrary hashes allow local edit without API traffic", async ({ page, context }, info) => {
  await seed(context);
  await ready(page);
  await context.setOffline(true);
  await edit(page);
  await submit(page, "Hors ligne");
  expect(await readBytes(page)).toBe(bytes([entry("Hors ligne"), entry("Famille", 1)]));
  await context.setOffline(false);
  const calls: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) calls.push(request.url()); });
  const disabled = String(info.config.metadata.demoDisabledBaseURL);
  await page.goto(`${disabled}/demo#search`);
  await expect(page.locator("#demo-saved-comparison-rename-0")).toBeEnabled();
  await edit(page);
  await submit(page, "Démo inactive");
  await expect(page.locator("#demo-saved-comparison-name-0")).toHaveText("Démo inactive");
  expect(calls).toEqual([]);
});

test("inline editor is accessible at all representative viewports and themes", async ({ page, context, browserName }, info) => {
  test.setTimeout(120_000);
  await seed(context);
  await ready(page);
  await page.locator("#demo-saved-comparison-rename-0").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Nouveau nom", { exact: true })).toBeFocused();
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.getByLabel("Apparence").selectOption(theme);
      await capture(page, info, `rename-${width}-${theme}-${browserName}.png`);
    }
  }
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  const targets = await page.locator(".demo-saved-comparison button").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height };
  }));
  expect(targets.length).toBeGreaterThan(3);
  expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  await submit(page, "");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await capture(page, info, `rename-invalid-${browserName}.png`);
});

test("200 percent platform and Verdana text and reduced motion retain an operable editor", async ({ page, context, browserName }, info) => {
  await seed(context);
  for (const font of ["platform", "verdana"] as const) {
    await ready(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (font === "verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await edit(page);
    await capture(page, info, `rename-200-${font}-${browserName}.png`);
    await submit(page, `Accessible ${font}`);
    await expect(page.locator("#demo-saved-comparison-rename-0")).toBeFocused();
  }
});

test("rename feedback stays within 100ms across five Chromium 4x CPU samples", async ({ page, context, browserName }, info) => {
  test.skip(browserName !== "chromium", "Chromium CDP is required for the existing 4x CPU lab profile.");
  await seed(context);
  await ready(page);
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const samples: number[] = [];
  try {
    for (let index = 0; index < 5; index += 1) {
      await edit(page);
      await page.locator(".demo-rename-comparison-form").evaluate((form) => {
        form.addEventListener("submit", () => {
          const start = performance.now();
          const observer = new MutationObserver(() => {
            if (document.querySelector(".demo-rename-comparison-form")) return;
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
  } finally { await client.send("Emulation.setCPUThrottlingRate", { rate: 1 }); }
  expect(samples).toHaveLength(5);
  expect(Math.max(...samples)).toBeLessThanOrEqual(100);
  const file = info.outputPath("rename-performance.json");
  await writeFile(file, JSON.stringify({ samples, budgetMaxMs: 100, cpuSlowdownMultiplier: 4, browserVersion: context.browser()?.version(), caveat: "Local DOM feedback to next animation frame; not physical paint or network latency." }, null, 2));
  await info.attach("rename-performance.json", { path: file, contentType: "application/json" });
});
