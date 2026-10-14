import type { Page, Route } from "@playwright/test";

export const demoRequestId = `req_${"c".repeat(32)}`;
export const demoFixtureVersion = "ui-description-v2";
export const demoRelease = { catalogId: "taxcat_ui_fixture", releaseId: "taxrel_ui_fixture_v1", revision: 1 } as const;
export const demoMakeIds = { alpha: "make_ui_alpha", beta: "make_ui_beta" } as const;
export const demoModelIds = { alphaOne: "model_ui_alpha_one", alphaTwo: "model_ui_alpha_two", betaOne: "model_ui_beta_one" } as const;

export const demoCatalog = {
  schemaVersion: 2,
  dataMode: "synthetic",
  fixtureVersion: demoFixtureVersion,
  taxonomyRelease: {
    schemaVersion: 1,
    ...demoRelease,
    releasedAt: "2026-10-12T08:00:00.000Z",
    dataMode: "synthetic",
    attributions: [{ attributionId: "taxattr_ui_fixture", kind: "synthetic_fixture", fixtureRef: "ui/descriptions" }],
    makes: [
      { makeId: demoMakeIds.alpha, primaryName: { value: "Marque Alpha fictive", attributionId: "taxattr_ui_fixture" }, aliases: [] },
      { makeId: demoMakeIds.beta, primaryName: { value: "Marque Bêta fictive", attributionId: "taxattr_ui_fixture" }, aliases: [] },
    ],
    models: [
      { modelId: demoModelIds.alphaOne, makeId: demoMakeIds.alpha, primaryName: { value: "Modèle Alpha 1 fictif", attributionId: "taxattr_ui_fixture" }, aliases: [] },
      { modelId: demoModelIds.alphaTwo, makeId: demoMakeIds.alpha, primaryName: { value: "Modèle Alpha 2 fictif", attributionId: "taxattr_ui_fixture" }, aliases: [] },
      { modelId: demoModelIds.betaOne, makeId: demoMakeIds.beta, primaryName: { value: "Modèle Bêta 1 fictif", attributionId: "taxattr_ui_fixture" }, aliases: [] },
    ],
  },
} as const;

export function descriptionValue(index = 1, overrides: Record<string, unknown> = {}) {
  const beta = index % 2 === 0;
  return {
    release: demoRelease,
    makeId: beta ? demoMakeIds.beta : demoMakeIds.alpha,
    modelId: beta ? demoModelIds.betaOne : demoModelIds.alphaOne,
    firstRegistrationYear: beta ? 2021 : 2022,
    attribution: { kind: "synthetic_fixture", fixtureRef: "ui/descriptions" },
    ...overrides,
  };
}

export function descriptionFields(index = 1, options: { readonly unavailable?: boolean; readonly contradictory?: boolean } = {}) {
  if (options.unavailable) return { description: { status: "unavailable" }, descriptionEvidence: [] };
  const currentId = `de_${String(index * 10 + 2).padStart(64, "0")}`;
  const current = descriptionValue(index);
  const history = options.contradictory ? [{ evidenceId: `de_${String(index * 10 + 1).padStart(64, "0")}`, capturedAt: "2026-10-11T08:00:00.000Z", value: descriptionValue(index, { firstRegistrationYear: 2020 }) }] : [];
  return {
    description: { status: "authored_synthetic", value: current, evidenceId: currentId },
    descriptionEvidence: [...history, { evidenceId: currentId, capturedAt: "2026-10-12T08:00:00.000Z", value: current }],
  };
}

export function v2Envelope(data: unknown, requestId = demoRequestId) { return { schemaVersion: 2, requestId, data }; }
export function v2Error(code: string, requestId = demoRequestId) { return { schemaVersion: 2, requestId, error: { code } }; }
export function v2Response(results: readonly unknown[], options: { readonly state?: "complete" | "partial" | "stale"; readonly dataAsOf?: string; readonly cursor?: string; readonly fixture?: string; readonly total?: number } = {}) {
  const state = options.state ?? "complete";
  const common = { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: options.fixture ?? demoFixtureVersion, taxonomyRelease: demoRelease, dataAsOf: options.dataAsOf ?? new Date().toISOString(), results, ...(options.cursor ? { nextCursor: options.cursor } : {}) };
  return state === "complete" ? { ...common, state, totalCount: options.total ?? results.length } : state === "partial" ? { ...common, state, reason: "projection_incomplete" } : { ...common, state, reason: "projection_stale" };
}

export async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function mockDemoCatalog(page: Page, options: { readonly failFirst?: boolean; readonly delayMs?: number } = {}) {
  let calls = 0;
  await page.route("**/api/demo/v2/catalog", async (route) => {
    calls += 1;
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.failFirst && calls === 1) return fulfillJson(route, v2Error("read_unavailable"), 503);
    return fulfillJson(route, v2Envelope(demoCatalog));
  });
  return () => calls;
}
