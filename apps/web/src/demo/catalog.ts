import type {
  DemoCatalogResponseV2,
  DemoDescriptionValueV2,
  DemoSearchResponseV2,
  MakeId,
  ModelId,
  TaxonomyReleaseReferenceV1,
} from "@auto-world/demo-search-contract";

function sameRelease(left: TaxonomyReleaseReferenceV1, right: TaxonomyReleaseReferenceV1): boolean {
  return left.catalogId === right.catalogId && left.releaseId === right.releaseId && left.revision === right.revision;
}

export function catalogMatchesResponse(catalog: DemoCatalogResponseV2, response: DemoSearchResponseV2): boolean {
  return catalog.fixtureVersion === response.fixtureVersion && sameRelease(catalog.taxonomyRelease, response.taxonomyRelease);
}

export function matchingCatalog(catalog: DemoCatalogResponseV2 | undefined, response: DemoSearchResponseV2 | undefined): DemoCatalogResponseV2 | undefined {
  return catalog !== undefined && response !== undefined && catalogMatchesResponse(catalog, response) ? catalog : undefined;
}

export function modelsForMake(catalog: DemoCatalogResponseV2, makeId: string) {
  return catalog.taxonomyRelease.models.filter((model) => model.makeId === makeId);
}

export type ResolvedDescriptionV2 = {
  readonly makeLabel: string;
  readonly modelLabel: string;
  readonly firstRegistrationYear: number;
};

export function resolveDescription(catalog: DemoCatalogResponseV2 | undefined, value: DemoDescriptionValueV2): ResolvedDescriptionV2 | undefined {
  if (catalog === undefined || !sameRelease(catalog.taxonomyRelease, value.release)) return undefined;
  const attribution = catalog.taxonomyRelease.attributions.find((item) => item.kind === value.attribution.kind && item.fixtureRef === value.attribution.fixtureRef);
  if (attribution === undefined) return undefined;
  const make = catalog.taxonomyRelease.makes.find((item) => item.makeId === value.makeId);
  const model = catalog.taxonomyRelease.models.find((item) => item.modelId === value.modelId && item.makeId === value.makeId);
  if (make === undefined || model === undefined) return undefined;
  return Object.freeze({ makeLabel: make.primaryName.value, modelLabel: model.primaryName.value, firstRegistrationYear: value.firstRegistrationYear });
}

export function isKnownMake(catalog: DemoCatalogResponseV2, makeId: string): makeId is MakeId {
  return catalog.taxonomyRelease.makes.some((make) => make.makeId === makeId);
}

export function isKnownModel(catalog: DemoCatalogResponseV2, makeId: string, modelId: string): modelId is ModelId {
  return catalog.taxonomyRelease.models.some((model) => model.makeId === makeId && model.modelId === modelId);
}
