import "./guard.mjs";

import { parseTaxonomyRelease } from "@auto-world/vehicle-taxonomy";

const candidate = {
  schemaVersion: 1,
  catalogId: "taxcat_demo_description",
  releaseId: "taxrel_demo_description_1",
  revision: 1,
  releasedAt: "2026-10-14T00:00:00.000Z",
  dataMode: "synthetic",
  attributions: [
    {
      attributionId: "taxattr_demo_description",
      kind: "synthetic_fixture",
      fixtureRef: "connectors/synthetic/demo/taxonomy/description-v1",
    },
  ],
  makes: [
    {
      makeId: "make_aurora_fictive",
      primaryName: { value: "Marque A fictive", attributionId: "taxattr_demo_description" },
      aliases: [],
    },
    {
      makeId: "make_boreal_fictive",
      primaryName: { value: "Marque B fictive", attributionId: "taxattr_demo_description" },
      aliases: [],
    },
  ],
  models: [
    {
      modelId: "model_aurora_a1_fictif",
      makeId: "make_aurora_fictive",
      primaryName: { value: "Modèle A1 fictif", attributionId: "taxattr_demo_description" },
      aliases: [],
    },
    {
      modelId: "model_aurora_a2_fictif",
      makeId: "make_aurora_fictive",
      primaryName: { value: "Modèle A2 fictif", attributionId: "taxattr_demo_description" },
      aliases: [],
    },
    {
      modelId: "model_boreal_b1_fictif",
      makeId: "make_boreal_fictive",
      primaryName: { value: "Modèle B1 fictif", attributionId: "taxattr_demo_description" },
      aliases: [],
    },
    {
      modelId: "model_boreal_b2_fictif",
      makeId: "make_boreal_fictive",
      primaryName: { value: "Modèle B2 fictif", attributionId: "taxattr_demo_description" },
      aliases: [],
    },
  ],
};

const parsed = parseTaxonomyRelease(candidate);
if (!parsed.success) throw new Error("synthetic_description_taxonomy_invalid");

export const SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE = parsed.data;
export const SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE = Object.freeze({
  catalogId: parsed.data.catalogId,
  releaseId: parsed.data.releaseId,
  revision: parsed.data.revision,
});
