import { completeResponse, demoResult } from "./fixtures.mjs";

export const TAXONOMY_RELEASE_REFERENCE = {
  catalogId: "taxcat_aw_fixture",
  releaseId: "taxrel_aw_fixture_v1",
  revision: 1,
};

export const MAKE_ID = "make_aw_fixture_alpha";
export const MODEL_ID = "model_aw_fixture_alpha_one";
export const DESCRIPTION_EVIDENCE_ID = `de_${"d".repeat(64)}`;

export function descriptionValue(overrides = {}) {
  return {
    release: { ...TAXONOMY_RELEASE_REFERENCE },
    makeId: MAKE_ID,
    modelId: MODEL_ID,
    firstRegistrationYear: 2024,
    attribution: {
      kind: "synthetic_fixture",
      fixtureRef: "synthetic-search-v2/description.json",
    },
    ...overrides,
  };
}

export function demoResultV2(overrides = {}) {
  const value = descriptionValue();
  return {
    ...demoResult(),
    description: {
      status: "authored_synthetic",
      value,
      evidenceId: DESCRIPTION_EVIDENCE_ID,
    },
    descriptionEvidence: [
      {
        evidenceId: DESCRIPTION_EVIDENCE_ID,
        capturedAt: "2026-09-06T11:57:00.000Z",
        value: descriptionValue(),
      },
    ],
    ...overrides,
  };
}

export function completeResponseV2(overrides = {}) {
  const v1 = completeResponse();
  return {
    ...v1,
    schemaVersion: 2,
    taxonomyRelease: { ...TAXONOMY_RELEASE_REFERENCE },
    results: [demoResultV2()],
    ...overrides,
  };
}

export function taxonomyRelease() {
  return {
    schemaVersion: 1,
    ...TAXONOMY_RELEASE_REFERENCE,
    releasedAt: "2026-09-01T00:00:00.000Z",
    dataMode: "synthetic",
    attributions: [
      {
        attributionId: "taxattr_aw_fixture",
        kind: "synthetic_fixture",
        fixtureRef: "synthetic-search-v2/taxonomy.json",
      },
    ],
    makes: [
      {
        makeId: MAKE_ID,
        primaryName: {
          value: "AW Fixture Alpha",
          attributionId: "taxattr_aw_fixture",
        },
        aliases: [],
      },
    ],
    models: [
      {
        modelId: MODEL_ID,
        makeId: MAKE_ID,
        primaryName: {
          value: "AW Fixture Alpha One",
          attributionId: "taxattr_aw_fixture",
        },
        aliases: [],
      },
    ],
  };
}

export function catalogResponse(overrides = {}) {
  return {
    schemaVersion: 2,
    dataMode: "synthetic",
    fixtureVersion: "synthetic-search-v2",
    taxonomyRelease: taxonomyRelease(),
    ...overrides,
  };
}
