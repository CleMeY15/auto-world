import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, totalmem } from "node:os";
import path from "node:path";

import {
  demoCatalog,
  demoFixtureVersion,
  demoMakeIds,
  demoModelIds,
  demoRelease,
  fulfillJson,
  mockDemoCatalog,
  v2Envelope,
  v2Error,
  v2Response,
} from "./demo-v2-fixtures";

const savedSearchKey = "auto-world.demo.saved-searches.v1";
const favoritesKey = "auto-world.demo.favorites.v1";
const fragmentPrefix = "#search-link/v1/";

type SearchQuery = {
  readonly schemaVersion: 2;
  readonly sort: "listing_asc" | "price_asc" | "price_desc" | "mileage_asc" | "mileage_desc";
  readonly priceMaxMinor?: number;
  readonly mileageMaxKm?: number;
  readonly makeId?: string;
  readonly modelId?: string;
  readonly firstRegistrationYear?: number;
};
type SubmittedQuery = SearchQuery & { readonly cursor?: string };

type SharedCriteria = {
  readonly query: SearchQuery;
  readonly binding?: {
    readonly fixtureVersion: string;
    readonly taxonomyRelease: {
      readonly catalogId: string;
      readonly releaseId: string;
      readonly revision: number;
    };
  };
};

const numericCriteria: SharedCriteria = {
  query: {
    schemaVersion: 2,
    sort: "price_desc",
    priceMaxMinor: 3_050_099,
    mileageMaxKm: 0.0000001,
    firstRegistrationYear: 2022,
  },
};

const identityCriteria: SharedCriteria = {
  query: {
    ...numericCriteria.query,
    makeId: demoMakeIds.alpha,
    modelId: demoModelIds.alphaOne,
  },
  binding: { fixtureVersion: demoFixtureVersion, taxonomyRelease: demoRelease },
};

function sharedHash(criteria: SharedCriteria) {
  return `${fragmentPrefix}${encodeURIComponent(JSON.stringify(criteria))}`;
}

function decodeSharedUrl(value: string): SharedCriteria {
  const hash = new URL(value).hash;
  expect(hash.startsWith(fragmentPrefix)).toBe(true);
  return JSON.parse(decodeURIComponent(hash.slice(fragmentPrefix.length))) as SharedCriteria;
}

async function waitUntilReady(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
}

function syntheticSearchLinkResult(index: number, observedAt: string) {
  const priceEvidence = `ev_${String(index * 2 - 1).padStart(64, "0")}`;
  const mileageEvidence = `ev_${String(index * 2).padStart(64, "0")}`;
  return {
    listingId: `lst_search-link-${String(index).padStart(2, "0")}`,
    availability: "active",
    price: { status: "observed", value: { amountMinor: 3_050_000 + index, currency: "EUR" }, evidenceId: priceEvidence },
    mileage: { status: "observed", value: { amount: 42_000 + index, unit: "km" }, evidenceId: mileageEvidence },
    evidence: [
      { evidenceId: priceEvidence, field: "price", observedAt, confidenceBps: 9_000, value: { amountMinor: 3_050_000 + index, currency: "EUR" } },
      { evidenceId: mileageEvidence, field: "mileage", observedAt, confidenceBps: 8_500, value: { amount: 42_000 + index, unit: "km" } },
    ],
    description: { status: "unavailable" },
    descriptionEvidence: [],
  };
}

async function fulfillAcceptedSearch(route: Route, options: { readonly state?: "complete" | "partial" | "stale"; readonly cursor?: string } = {}) {
  const state = options.state ?? "complete";
  const dataAsOf = state === "stale" ? new Date(Date.now() - 120_000).toISOString() : new Date().toISOString();
  const results = options.cursor === undefined ? [] : [syntheticSearchLinkResult(1, dataAsOf)];
  await fulfillJson(route, v2Envelope(v2Response(results, { state, dataAsOf, cursor: options.cursor, total: options.cursor === undefined ? 0 : 2 })));
}

async function openAcceptedResults(page: Page, options: { readonly state?: "complete" | "partial" | "stale"; readonly cursor?: string } = {}) {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", (route) => fulfillAcceptedSearch(route, options));
  await page.goto("/demo");
  await waitUntilReady(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
}

async function openLinkCreator(page: Page) {
  await page.locator("#demo-search-link-start").click();
  await expect(page.locator("#demo-search-link-url")).toBeVisible();
  await expect(page.locator("#demo-search-link-url")).toHaveAttribute("readonly", "");
}

async function expectSharedReview(page: Page) {
  await expect(page.getByRole("heading", { name: "Recherche reçue", exact: true })).toBeVisible();
  await expect(page.locator("#demo-search-link-load")).toBeVisible();
}

async function storageSnapshot(page: Page) {
  return page.evaluate(({ saved, favorites }) => ({
    favorites: localStorage.getItem(favorites),
    saved: localStorage.getItem(saved),
  }), { saved: savedSearchKey, favorites: favoritesKey });
}

async function installClipboardStub(context: BrowserContext, mode: "success" | "denied" | "missing" | "deferred") {
  await context.addInitScript((selectedMode) => {
    const state = { calls: [] as string[], settled: false };
    Object.defineProperty(window, "__awClipboard", { configurable: true, value: state });
    if (selectedMode === "missing") {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      return;
    }
    let resolveDeferred: (() => void) | undefined;
    const deferred = selectedMode === "deferred" ? new Promise<void>((resolve) => { resolveDeferred = resolve; }) : undefined;
    Object.defineProperty(window, "__awResolveClipboard", { configurable: true, value: () => resolveDeferred?.() });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          state.calls.push(value);
          if (selectedMode === "denied") throw new DOMException("denied", "NotAllowedError");
          if (deferred) await deferred;
          state.settled = true;
        },
      },
    });
  }, mode);
}

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0 || bounds.right <= viewportWidth + 0.5) return [];
      return [{
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${Array.from(element.classList).map((name) => `.${name}`).join("")}`,
        right: Math.round(bounds.right * 10) / 10,
        text: (element.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 80),
      }];
    });
    return { documentWidth: document.documentElement.scrollWidth, offenders, viewportWidth };
  });
  expect(report, JSON.stringify(report, null, 2)).toEqual({ documentWidth: report.viewportWidth, offenders: [], viewportWidth: report.viewportWidth });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page);
  const file = process.env.AW_SCREENSHOT_DIR ? path.join(process.env.AW_SCREENSHOT_DIR, name) : testInfo.outputPath(name);
  if (process.env.AW_SCREENSHOT_DIR) await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: file, fullPage: true, scale: "css" });
}

test("a real accepted search roundtrips through a fresh shared review before an explicit edited search", async ({ page, context }) => {
  await installClipboardStub(context, "success");
  const catalogResponse = await page.request.get("/api/demo/v2/catalog");
  expect(catalogResponse.status()).toBe(200);
  const catalogPayload = await catalogResponse.json() as {
    readonly data: {
      readonly fixtureVersion: string;
      readonly taxonomyRelease: {
        readonly catalogId: string;
        readonly releaseId: string;
        readonly revision: number;
        readonly makes: ReadonlyArray<{ readonly makeId: string }>;
        readonly models: ReadonlyArray<{ readonly makeId: string; readonly modelId: string }>;
      };
    };
  };
  const actualModel = catalogPayload.data.taxonomyRelease.models.find((model) => catalogPayload.data.taxonomyRelease.makes.some((make) => make.makeId === model.makeId));
  expect(actualModel, "The real catalogue must contain a model with its parent make").toBeDefined();
  const actualCriteria: SharedCriteria = {
    query: {
      ...numericCriteria.query,
      makeId: actualModel!.makeId,
      modelId: actualModel!.modelId,
    },
    binding: {
      fixtureVersion: catalogPayload.data.fixtureVersion,
      taxonomyRelease: {
        catalogId: catalogPayload.data.taxonomyRelease.catalogId,
        releaseId: catalogPayload.data.taxonomyRelease.releaseId,
        revision: catalogPayload.data.taxonomyRelease.revision,
      },
    },
  };
  const submitted: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/demo/v2/search") && request.method() === "POST") submitted.push(request.postDataJSON());
  });
  await page.goto("/demo");
  await waitUntilReady(page);
  await page.getByLabel("Budget maximum (€)").fill("30500.99");
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await page.getByLabel("Kilométrage maximum (km)").fill("0.0000001");
  await page.getByLabel("Année de première immatriculation fictive").fill("2022");
  await page.getByLabel("Marque fictive").selectOption(actualModel!.makeId);
  await page.getByLabel("Modèle fictif").selectOption(actualModel!.modelId);
  await page.getByLabel("Trier les résultats").selectOption("price_desc");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
  await openLinkCreator(page);
  const url = await page.locator("#demo-search-link-url").inputValue();
  expect(new URL(url).pathname).toBe("/demo");
  expect(new URL(url).search).toBe("");
  expect(decodeSharedUrl(url)).toEqual(actualCriteria);

  const fresh = await context.newPage();
  const freshPosts: unknown[] = [];
  fresh.on("request", (request) => {
    if (request.url().endsWith("/api/demo/v2/search") && request.method() === "POST") freshPosts.push(request.postDataJSON());
  });
  await fresh.goto(url);
  await expectSharedReview(fresh);
  expect(freshPosts).toEqual([]);
  await fresh.locator("#demo-search-link-load").click();
  await expect(fresh.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  await expect(fresh.getByLabel("Budget maximum (€)")).toHaveValue("30500.99");
  await expect(fresh.getByLabel("Kilométrage maximum (km)")).toHaveValue("0.0000001");
  await expect(fresh.getByLabel("Marque fictive")).toHaveValue(actualModel!.makeId);
  await expect(fresh.getByLabel("Modèle fictif")).toHaveValue(actualModel!.modelId);
  expect(freshPosts).toEqual([]);
  await fresh.getByLabel("Budget maximum (€)").fill("31000");
  await fresh.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect.poll(() => freshPosts.length).toBe(1);
  expect(freshPosts[0]).toEqual({ ...actualCriteria.query, priceMaxMinor: 3_100_000 });
  expect(submitted[0]).toEqual(actualCriteria.query);
});

test("link creation uses accepted first-page criteria instead of a later draft or cursor", async ({ page }) => {
  const cursor = `cur_${"a".repeat(64)}`;
  await openAcceptedResults(page, { cursor });
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByLabel("Budget maximum (€)").fill("12345.67");
  await page.goBack();
  await openLinkCreator(page);
  const criteria = decodeSharedUrl(await page.locator("#demo-search-link-url").inputValue());
  expect(criteria.query).toEqual({ schemaVersion: 2, sort: "listing_asc" });
  expect(JSON.stringify(criteria)).not.toContain("cursor");
  expect(JSON.stringify(criteria)).not.toContain("12345.67");
});

for (const state of ["complete", "partial", "stale"] as const) {
  test(`an accepted ${state} zero-valued search remains shareable`, async ({ page }) => {
    await mockDemoCatalog(page);
    await page.route("**/api/demo/v2/search", (route) => fulfillAcceptedSearch(route, { state }));
    await page.goto("/demo");
    await waitUntilReady(page);
    await page.getByLabel("Budget maximum (€)").fill("0");
    await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("0");
    await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
    await page.getByLabel("Kilométrage maximum (km)").fill("0");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
    await openLinkCreator(page);
    const url = await page.locator("#demo-search-link-url").inputValue();
    expect(decodeSharedUrl(url).query).toEqual({
      mileageMaxKm: 0,
      priceMaxMinor: 0,
      schemaVersion: 2,
      sort: "listing_asc",
    });
    if (state === "complete") {
      await page.goto(url);
      await expect(page.getByText("0 €", { exact: true })).toBeVisible();
      await expect(page.getByText("0 km", { exact: true })).toBeVisible();
    }
  });
}

test("credential-bearing entry never exposes credentials in the created link", async ({ page }) => {
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", (route) => fulfillAcceptedSearch(route));
  await page.goto("/demo");
  const credentialUrl = new URL(page.url());
  credentialUrl.username = "synthetic-user";
  credentialUrl.password = "synthetic-password";
  await page.addInitScript(() => {
    // Test boundary only: browsers reject relative fetches from credentialed documents.
    // Resolve only this fixture's demo API strings against the credential-free origin so
    // the accepted-results prerequisite can exercise real link creation after browser normalization.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && input.startsWith("/api/demo/")) {
        return nativeFetch(new URL(input, window.location.origin), init);
      }
      return nativeFetch(input, init);
    }) as typeof window.fetch;
  });
  await page.goto(credentialUrl.href);
  expect(page.url()).toContain("synthetic-user:synthetic-password@");
  // Both engines expose a credential-free document href even though the
  // navigation URL retains userinfo. The builder's rejection is unit-tested.
  const initialDocumentUrl = new URL(await page.evaluate(() => window.location.href));
  expect(initialDocumentUrl.username).toBe("");
  expect(initialDocumentUrl.password).toBe("");
  await waitUntilReady(page);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator("#demo-search-link-start")).toBeVisible();
  const sanitizedDocumentUrl = new URL(await page.evaluate(() => window.location.href));
  expect(sanitizedDocumentUrl.username).toBe("");
  expect(sanitizedDocumentUrl.password).toBe("");
  await page.locator("#demo-search-link-start").click();
  const generated = new URL(await page.locator("#demo-search-link-url").inputValue());
  expect(generated.username).toBe("");
  expect(generated.password).toBe("");
  expect(generated.pathname).toBe("/demo");
  await expect(page.locator("main")).not.toContainText("synthetic-user");
  await expect(page.locator("main")).not.toContainText("synthetic-password");
});

test("pending replacement removes the old create-link action", async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    calls += 1;
    if (calls === 2) await gate;
    await fulfillAcceptedSearch(route);
  });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator("#demo-search-link-start")).toBeVisible();
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator("#demo-search-link-start")).toHaveCount(0);
  release();
  await expect(page.locator("#demo-search-link-start")).toBeVisible();
});

test("successful clipboard write reports success only after the write resolves", async ({ page, context }) => {
  await installClipboardStub(context, "success");
  await openAcceptedResults(page);
  await openLinkCreator(page);
  const url = await page.locator("#demo-search-link-url").inputValue();
  await page.locator("#demo-search-link-copy").click();
  await expect(page.locator(".demo-search-link-status")).toContainText(/copié/i);
  expect(await page.evaluate(() => (window as typeof window & { __awClipboard: { calls: string[] } }).__awClipboard.calls)).toEqual([url]);
});

for (const mode of ["denied", "missing"] as const) {
  test(`${mode} clipboard access selects the URL and offers manual copy`, async ({ page, context }) => {
    await installClipboardStub(context, mode);
    await openAcceptedResults(page);
    await openLinkCreator(page);
    await page.locator("#demo-search-link-copy").click();
    await expect(page.locator(".demo-search-link-status")).toContainText(/sélectionné|copi.*manuellement/i);
    const selected = await page.locator("#demo-search-link-url").evaluate((input) => {
      const field = input as HTMLInputElement;
      return field.selectionStart === 0 && field.selectionEnd === field.value.length && document.activeElement === field;
    });
    expect(selected).toBe(true);
  });
}

test("a deferred clipboard completion cannot announce success after the creator closes", async ({ page, context }) => {
  await installClipboardStub(context, "deferred");
  await openAcceptedResults(page);
  await openLinkCreator(page);
  await page.locator("#demo-search-link-copy").click();
  await page.locator("#demo-search-link-close").click();
  await expect(page.locator("#demo-search-link-start")).toBeFocused();
  await page.evaluate(() => (window as typeof window & { __awResolveClipboard: () => void }).__awResolveClipboard());
  await expect(page.locator(".demo-search-link-status")).toHaveCount(0);
});

test("a deferred clipboard completion cannot announce success after navigation unmounts the creator", async ({ page, context }) => {
  await installClipboardStub(context, "deferred");
  await openAcceptedResults(page);
  await openLinkCreator(page);
  await page.locator("#demo-search-link-copy").click();
  await page.evaluate((hash) => { window.location.hash = hash; }, sharedHash(numericCriteria));
  await expectSharedReview(page);
  await page.evaluate(() => (window as typeof window & { __awResolveClipboard: () => void }).__awResolveClipboard());
  await expect(page.locator(".demo-search-link-status")).toHaveCount(0);
  await expect(page.getByText("Lien copié.", { exact: true })).toHaveCount(0);
});

test("ignoring a link preserves the edited draft and accepted result snapshot", async ({ page }) => {
  const cursor = `cur_${"b".repeat(64)}`;
  await openAcceptedResults(page, { cursor });
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Modifier les critères" }).click();
  await page.getByLabel("Budget maximum (€)").fill("12345.67");
  await page.evaluate((hash) => { window.location.hash = hash; }, sharedHash(numericCriteria));
  await expectSharedReview(page);
  await page.getByRole("button", { name: "Ignorer le lien", exact: true }).click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("12345.67");
  await page.evaluate(() => { window.location.hash = "#results"; });
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  await expect(page.locator("#demo-search-link-start")).toBeVisible();
});

test("shared-route interruption preserves the accepted pagination cursor for an exact retry", async ({ page }) => {
  const cursor = `cur_${"c".repeat(64)}`;
  // Stay fresh without requiring the runner and browser clocks to agree to the millisecond.
  const observedAt = new Date(Date.now() - 5_000).toISOString();
  const submitted: SubmittedQuery[] = [];
  let calls = 0;
  let releaseOldPage!: () => void;
  let oldPageSettled!: () => void;
  const oldPageGate = new Promise<void>((resolve) => { releaseOldPage = resolve; });
  const oldPageDone = new Promise<void>((resolve) => { oldPageSettled = resolve; });
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    calls += 1;
    submitted.push(route.request().postDataJSON() as SubmittedQuery);
    if (calls === 1) {
      await fulfillJson(route, v2Envelope(v2Response([syntheticSearchLinkResult(1, observedAt)], { dataAsOf: observedAt, cursor, total: 2 })));
      return;
    }
    if (calls === 2) {
      await oldPageGate;
      await fulfillJson(route, v2Envelope(v2Response([syntheticSearchLinkResult(2, observedAt)], { dataAsOf: observedAt, total: 2 }))).catch(() => {});
      oldPageSettled();
      return;
    }
    await fulfillJson(route, v2Envelope(v2Response([syntheticSearchLinkResult(2, observedAt)], { dataAsOf: observedAt, total: 2 })));
  });

  await page.goto("/demo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Charger plus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Chargement…", exact: true })).toBeVisible();
  await page.evaluate((hash) => { window.location.hash = hash; }, sharedHash(numericCriteria));
  await expectSharedReview(page);
  await page.getByRole("button", { name: "Ignorer le lien", exact: true }).click();
  await page.evaluate(() => { window.location.hash = "#results"; });
  await expect(page.locator(".demo-result-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Charger plus", exact: true }).click();
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
  expect(submitted[1]?.cursor).toBe(cursor);
  expect(submitted[2]?.cursor).toBe(cursor);
  releaseOldPage();
  await oldPageDone;
  await expect(page.locator(".demo-result-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Charger plus", exact: true })).toHaveCount(0);
});

test("Back, Forward and reload preserve deterministic shared-link review without applying criteria", async ({ page }) => {
  const first = sharedHash(numericCriteria);
  const second = sharedHash({ query: { schemaVersion: 2, sort: "mileage_asc", mileageMaxKm: 42_000 } });
  let posts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/demo/v2/search") && request.method() === "POST") posts += 1; });
  await page.goto(`/demo${first}`);
  await expectSharedReview(page);
  await expect(page.getByText("30500.99 €", { exact: true })).toBeVisible();
  await page.evaluate((hash) => { window.location.hash = hash; }, second);
  await expect(page.getByText("42000 km", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("30500.99 €", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByText("42000 km", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("42000 km", { exact: true })).toBeVisible();
  expect(posts).toBe(0);
});

test("identity load stays disabled while its catalogue compatibility is pending", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/demo/v2/catalog", async (route) => { await gate; await fulfillJson(route, v2Envelope(demoCatalog)); });
  await page.goto(`/demo${sharedHash(identityCriteria)}`);
  await expect(page.getByRole("heading", { name: "Recherche reçue" })).toBeVisible();
  await expect(page.locator("#demo-search-link-load")).toBeDisabled();
  await expect(page.getByText(/vérification de la marque et du modèle/i)).toBeVisible();
  release();
  await expect(page.locator("#demo-search-link-load")).toBeEnabled();
});

test("catalogue failure requires explicit identity omission while preserving numeric criteria", async ({ page }) => {
  await page.route("**/api/demo/v2/catalog", (route) => fulfillJson(route, v2Error("read_unavailable"), 503));
  let posts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/demo/v2/search") && request.method() === "POST") posts += 1; });
  await page.goto(`/demo${sharedHash(identityCriteria)}`);
  await expect(page.locator("#demo-search-link-load")).toHaveText("Charger sans marque ni modèle");
  await page.locator("#demo-search-link-load").click();
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30500.99");
  await expect(page.getByLabel("Kilométrage maximum (km)")).toHaveValue("0.0000001");
  await expect(page.getByLabel("Marque fictive")).toHaveValue("");
  await expect(page.getByLabel("Modèle fictif")).toHaveValue("");
  expect(posts).toBe(0);
});

test("fixture, release and model-parent mismatches never expose identifiers and require explicit identity omission", async ({ page }) => {
  await mockDemoCatalog(page);
  const mismatches: readonly SharedCriteria[] = [
    { ...identityCriteria, binding: { fixtureVersion: "old-fixture", taxonomyRelease: demoRelease } },
    { ...identityCriteria, binding: { fixtureVersion: demoFixtureVersion, taxonomyRelease: { ...demoRelease, revision: demoRelease.revision + 1 } } },
    {
      ...identityCriteria,
      query: { ...identityCriteria.query, modelId: demoModelIds.betaOne },
    },
  ];
  for (const mismatched of mismatches) {
    await page.goto(`/demo${sharedHash(mismatched)}`);
    await expect(page.getByText(/marque et le modèle.*pas disponibles|catalogue de cette démo/i)).toBeVisible();
    await expect(page.getByText(/make_ui_|model_ui_|taxcat_|taxrel_/i)).toHaveCount(0);
    await expect(page.locator("#demo-search-link-load")).toHaveText("Charger sans marque ni modèle");
  }
});

test("numeric-only criteria load while the catalogue is offline without submitting", async ({ page, context }) => {
  await page.route("**/api/demo/v2/catalog", (route) => route.abort("internetdisconnected"));
  let posts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/demo/v2/search") && request.method() === "POST") posts += 1; });
  await page.goto(`/demo${sharedHash(numericCriteria)}`);
  await expectSharedReview(page);
  await context.setOffline(true);
  await page.locator("#demo-search-link-load").click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30500.99");
  await expect(page.getByLabel("Kilométrage maximum (km)")).toHaveValue("0.0000001");
  expect(posts).toBe(0);
});

test("a late old search cannot replace a shared review screen", async ({ page }) => {
  let release!: () => void;
  let settled!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = new Promise<void>((resolve) => { settled = resolve; });
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    await gate;
    await fulfillAcceptedSearch(route).catch(() => {});
    settled();
  });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recherche…", exact: true })).toBeVisible();
  await page.evaluate((hash) => { window.location.hash = hash; }, sharedHash(numericCriteria));
  await expectSharedReview(page);
  release();
  await done;
  await expect(page.getByRole("heading", { name: "Recherche reçue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toHaveCount(0);
});

test("explicit shared load aborts a late old search before it can steal loaded criteria", async ({ page }) => {
  let release!: () => void;
  let settled!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = new Promise<void>((resolve) => { settled = resolve; });
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", async (route) => {
    await gate;
    await fulfillAcceptedSearch(route).catch(() => {});
    settled();
  });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await page.evaluate((hash) => { window.location.hash = hash; }, sharedHash(numericCriteria));
  await expectSharedReview(page);
  await page.locator("#demo-search-link-load").click();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30500.99");
  release();
  await done;
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30500.99");
  await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toHaveCount(0);
});

for (const [label, hash, safeCopy] of [
  ["malformed", "#search-link/v1/%E0%A4%A", /invalide ou incomplet/i],
  ["future", `#search-link/v2/${encodeURIComponent(JSON.stringify(numericCriteria))}`, /version non prise en charge/i],
  ["oversized", `#search-link/v1/${"x".repeat(4_097)}`, /invalide ou incomplet/i],
] as const) {
  test(`${label} links show fixed safe recovery copy without echoing hostile bytes`, async ({ page }) => {
    await page.goto(`/demo${hash}`);
    await expect(page.getByRole("heading", { name: "Recherche reçue", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Lien indisponible" })).toBeVisible();
    await expect(page.getByText(safeCopy)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ignorer le lien", exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("%E0%A4%A");
    await expect(page.locator("main")).not.toContainText("x".repeat(80));
    await page.getByRole("button", { name: "Ignorer le lien", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeVisible();
  });
}

test("opening, loading and creating links leave browser storage unchanged", async ({ page }) => {
  await page.addInitScript(({ saved, favorites }) => {
    localStorage.setItem(saved, JSON.stringify({ schemaVersion: 1, searches: [] }));
    localStorage.setItem(favorites, JSON.stringify({ schemaVersion: 1, listingIds: [] }));
    const writes: Array<{ key: string; storage: "local" | "session" }> = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      writes.push({ key, storage: this === localStorage ? "local" : "session" });
      return original.call(this, key, value);
    };
    Object.defineProperty(window, "__awStorageWrites", { configurable: true, value: writes });
  }, { saved: savedSearchKey, favorites: favoritesKey });
  await page.goto(`/demo${sharedHash(numericCriteria)}`);
  const before = await storageSnapshot(page);
  await page.locator("#demo-search-link-load").click();
  expect(await storageSnapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await expect(page.locator("#demo-search-link-start")).toBeVisible();
  await openLinkCreator(page);
  expect(await storageSnapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as typeof window & { __awStorageWrites: unknown[] }).__awStorageWrites)).toEqual([]);
});

test("link flows make no external network request", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") external.push(request.url());
  });
  await page.goto(`/demo${sharedHash(numericCriteria)}`);
  await page.locator("#demo-search-link-load").click();
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await openLinkCreator(page);
  expect(external).toEqual([]);
});

test("a disabled runtime ignores incoming links and performs zero demo API requests", async ({ page }, testInfo) => {
  const disabledBase = (testInfo.config.metadata as { readonly demoDisabledBaseURL?: unknown }).demoDisabledBaseURL;
  if (typeof disabledBase !== "string") throw new Error("demoDisabledBaseURL metadata is required");
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/demo/")) requests.push(request.url()); });
  await page.goto(`${disabledBase}/demo${sharedHash(identityCriteria)}`);
  await waitUntilReady(page);
  await expect(page.getByRole("heading", { name: "Recherche reçue" })).toHaveCount(0);
  await expect(page.locator("#demo-search-link-load")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("shared-link controls meet keyboard, focus, touch target and WCAG 2.2 AA checks", async ({ page }) => {
  await page.goto(`/demo${sharedHash(numericCriteria)}`);
  await expectSharedReview(page);
  await page.locator("#demo-search-link-load").focus();
  await expect(page.locator("#demo-search-link-load")).toBeFocused();
  const focus = await page.locator("#demo-search-link-load").evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focus.outlineStyle).not.toBe("none");
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  const targets = await page.locator("main button, main input, main select").evaluateAll((elements) => elements
    .filter((element) => getComputedStyle(element).visibility !== "hidden")
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width };
    }));
  expect(targets.every((target) => target.height >= 44 && target.width >= 44)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

test("keyboard Tab and Enter load shared criteria without submitting a search", async ({ page }) => {
  let posts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/demo/v2/search") && request.method() === "POST") posts += 1; });
  await page.goto(`/demo${sharedHash(numericCriteria)}`);
  await expectSharedReview(page);
  await expect(page.getByRole("heading", { name: "Recherche reçue" })).toBeFocused();
  let reachedLoad = false;
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    reachedLoad = await page.locator("#demo-search-link-load").evaluate((element) => document.activeElement === element);
    if (reachedLoad) break;
  }
  expect(reachedLoad).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  await expect(page.getByLabel("Budget maximum (€)")).toHaveValue("30500.99");
  expect(posts).toBe(0);
});

test("create and shared review remain readable in the bounded viewport and theme matrix", async ({ page, browserName }, testInfo) => {
  test.setTimeout(180_000);
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", (route) => fulfillAcceptedSearch(route));
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.goto(`/demo?search-link-visual=${width}-${theme}`);
      await page.getByLabel("Apparence").selectOption(theme);
      await page.getByRole("button", { name: "Rechercher", exact: true }).click();
      await openLinkCreator(page);
      await capture(page, testInfo, `demo-search-link-${width}-${theme}-${browserName}-create.png`);
      await page.goto(`/demo?search-link-visual=${width}-${theme}${sharedHash(identityCriteria)}`);
      await page.getByLabel("Apparence").selectOption(theme);
      await expectSharedReview(page);
      await capture(page, testInfo, `demo-search-link-${width}-${theme}-${browserName}-received.png`);
    }
  }
});

test("reduced motion and 200 percent platform or Verdana text keep link flows operable", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockDemoCatalog(page);
  for (const font of ["platform", "Verdana"] as const) {
    await page.goto(`/demo${sharedHash(identityCriteria)}`);
    if (font === "Verdana") await page.addStyleTag({ content: ":root { --aw-font-family: Verdana, sans-serif; }" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expectSharedReview(page);
    await expectNoHorizontalOverflow(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const brokenHeadingWords = await page.getByRole("heading", { name: "Recherche reçue" }).evaluate((heading) => {
      const text = heading.firstChild;
      if (!(text instanceof Text)) throw new Error("Expected a plain shared-link heading");
      return Array.from(text.data.matchAll(/\S+/gu)).filter((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        return range.getClientRects().length > 1;
      }).map((word) => word[0]);
    });
    expect(brokenHeadingWords).toEqual([]);
    await capture(page, testInfo, `demo-search-link-390-light-text-200-${browserName}-${font.toLowerCase()}.png`);
    await page.locator("#demo-search-link-load").click();
    await expect(page.getByRole("heading", { name: "Explorer la démo" })).toBeFocused();
  }
});

test("create and load reach their required DOM state by the next animation-frame callback within 100ms under the Chromium mobile lab profile", async ({ browser, browserName, context, page }, testInfo) => {
  test.skip(browserName !== "chromium", "CDP CPU throttling is Chromium-only");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDemoCatalog(page);
  await page.route("**/api/demo/v2/search", (route) => fulfillAcceptedSearch(route));
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const samples: Array<{ durationMs: number; operation: "create" | "load" }> = [];

  await page.goto("/demo");
  await page.getByRole("button", { name: "Rechercher", exact: true }).click();
  await page.locator("#demo-search-link-start").evaluate((button) => {
    button.addEventListener("click", () => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (document.querySelector("#demo-search-link-url") === null) return;
        observer.disconnect();
        requestAnimationFrame(() => {
          Object.defineProperty(window, "__awCreateDuration", { configurable: true, value: performance.now() - started });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  });
  await page.locator("#demo-search-link-start").click();
  await page.waitForFunction(() => typeof (window as typeof window & { __awCreateDuration?: number }).__awCreateDuration === "number");
  samples.push({ durationMs: await page.evaluate(() => (window as typeof window & { __awCreateDuration: number }).__awCreateDuration), operation: "create" });

  await page.goto(`/demo${sharedHash(numericCriteria)}`);
  await page.locator("#demo-search-link-load").evaluate((button) => {
    button.addEventListener("click", () => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        const heading = document.querySelector("h1");
        if (heading?.textContent !== "Explorer la démo") return;
        observer.disconnect();
        requestAnimationFrame(() => {
          Object.defineProperty(window, "__awLoadDuration", { configurable: true, value: performance.now() - started });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  });
  await page.locator("#demo-search-link-load").click();
  await page.waitForFunction(() => typeof (window as typeof window & { __awLoadDuration?: number }).__awLoadDuration === "number");
  samples.push({ durationMs: await page.evaluate(() => (window as typeof window & { __awLoadDuration: number }).__awLoadDuration), operation: "load" });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const report = {
    browserVersion: browser.version(),
    budgetMaxMs: 100,
    caveat: "Bounded synthetic Chromium lab measurement under 4x CPU slowdown, from click to required DOM state to the next animation-frame callback; this is not proof of physical paint. Clipboard and OS permission latency are excluded. This is not production INP or physical-device evidence.",
    collectedAt: new Date().toISOString(),
    host: { architecture: arch(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
    profile: { cpuSlowdownMultiplier: 4, viewport: { width: 390, height: 844 } },
    samples,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await testInfo.attach("demo-search-link-feedback-performance.json", { body: Buffer.from(serialized), contentType: "application/json" });
  if (process.env.AW_SCREENSHOT_DIR) {
    await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
    await writeFile(path.join(process.env.AW_SCREENSHOT_DIR, "demo-search-link-feedback-performance.json"), serialized);
  }
  expect(Math.max(...samples.map((sample) => sample.durationMs))).toBeLessThanOrEqual(100);
});
