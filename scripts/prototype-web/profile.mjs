import { createHash } from "node:crypto";
import {
  inspectSyntheticDescriptionRaw,
  parseSyntheticDescriptionPageV2,
  SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST,
  SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE,
} from "../../connectors/synthetic/demo/index.mjs";

export const WEB_FIXTURE_VERSION = "synthetic-prototype-web-v2";
export const WEB_MAPPER_VERSION = "synthetic-prototype-web-mapper-v2";
export const WEB_SEED_INVOCATION = "prototype-web-seed-v2";
export const WEB_KEYWORD_QUERIES = Object.freeze({ broad: "modele", equivalent: " MODÈLE modele ", different: "fictif modele" });
const release = SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.taxonomyRelease;
const pageSize = 50;
const models = SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.models;
const attribution = SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.attributions[0];

// These authored fixtures are deterministic, not facts inferred from a real vehicle.
const pages = Object.freeze(Array.from({ length: 20 }, (_, ordinal) => {
  const items = Array.from({ length: pageSize }, (_, index) => {
    const number = ordinal * pageSize + index + 1;
    const model = models[(number - 1) % models.length];
    return { sourceListingId: `publication-prototype-web-${String(number).padStart(4, "0")}`,
      outcome: "active", observations: [
        { field: "price", value: { amountMinor: 800_000 + number * 2_500, currency: "EUR" }, confidenceBps: 9_000 },
        { field: "mileage", value: { amount: 10_000 + number * 125, unit: "km" }, confidenceBps: 9_000 },
      ],
      // Every tenth publication deliberately has no description: unavailable is a product state.
      ...(number % 10 === 0 ? {} : { description: { makeId: model.makeId, modelId: model.modelId,
        firstRegistrationYear: 2015 + number % 10,
        attribution: { kind: "synthetic_fixture", fixtureRef: attribution.fixtureRef } } }),
    };
  });
  const text = JSON.stringify({ schemaVersion: 2, taxonomyRelease: release, items });
  const bytes = Buffer.from(text, "utf8");
  const descriptor = Object.freeze({ name: `page-${String(ordinal + 1).padStart(4, "0")}.json`,
    byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
  inspectSyntheticDescriptionRaw(bytes, descriptor);
  return Object.freeze({ text, descriptor });
}));

const firstItem = JSON.parse(pages[0].text).items[0];
const deltaItems = {
  history: [{ ...firstItem, description: { ...firstItem.description, firstRegistrationYear: 2024 } }],
  omitted: [{ sourceListingId: firstItem.sourceListingId, outcome: "active", observations: firstItem.observations }],
  withdrawn: [{ sourceListingId: "publication-prototype-web-0002", outcome: "withdrawn" }],
};
const deltas = Object.freeze(Object.fromEntries(Object.entries(deltaItems).map(([name, items]) => {
  const text = JSON.stringify({ schemaVersion: 2, taxonomyRelease: release, items });
  const bytes = Buffer.from(text, "utf8");
  const descriptor = Object.freeze({ name: `delta-${name}.json`, byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex") });
  inspectSyntheticDescriptionRaw(bytes, descriptor);
  return [name, Object.freeze({ text, descriptor })];
})));

export const WEB_DESCRIPTORS = Object.freeze([...pages, ...Object.values(deltas)].map((page) => page.descriptor));
export const WEB_CATALOG = Object.freeze({ schemaVersion: 2, dataMode: "synthetic",
  fixtureVersion: WEB_FIXTURE_VERSION, taxonomyRelease: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE });

export function createWebSeedAdapter() {
  return adapterFor(pages);
}

export function createWebDeltaAdapter(name) {
  if (!Object.hasOwn(deltas, name)) throw new Error("prototype_web_delta_unknown");
  return adapterFor([deltas[name]]);
}

function adapterFor(selectedPages) {
  return Object.freeze({
    async fetchPage(input) {
      if (input.signal.aborted) return { success: false, failure: { kind: "cancelled" } };
      const page = selectedPages[input.pageOrdinal];
      if (!page || page.descriptor.byteLength > input.maxResponseBytes) return { success: false, failure: { kind: "terminal" } };
      return { success: true, page: { bytes: new globalThis.TextEncoder().encode(page.text),
        pageIdentity: `${WEB_FIXTURE_VERSION}:${page.descriptor.name}`,
        nextCursor: `${WEB_FIXTURE_VERSION}:${page.descriptor.name}`, complete: input.pageOrdinal === selectedPages.length - 1 } };
    },
    async mapPage(input) {
      if (input.signal.aborted) throw new Error("prototype_web_seed_cancelled");
      return parseSyntheticDescriptionPageV2(input.decoded).sdkDraft;
    },
  });
}

function descriptionEvidenceId(version) {
  const hash = createHash("sha256").update("aw-demo-description-evidence-v2\0");
  for (const value of [version.listingId, version.listingVersionId, version.runId,
    version.snapshotId, version.rawSha256, WEB_MAPPER_VERSION]) {
    const bytes = Buffer.from(value, "utf8");
    hash.update(`${bytes.byteLength}:`).update(bytes).update(Buffer.from([0]));
  }
  return `de_${hash.digest("hex")}`;
}

const ascii = (left, right) => left < right ? -1 : left > right ? 1 : 0;

// Search supplies only already-associated, bounded, byte-verified versions. Parse each
// page once here with the existing synthetic parser; never invoke the memory engine.
export function projectWebDescriptions(input, base) {
  const decoded = new Map();
  const versionsByListing = new Map();
  const descriptors = new Map(WEB_DESCRIPTORS.map((descriptor) => [descriptor.sha256, descriptor]));
  for (const version of input.versions) {
    const descriptor = descriptors.get(version.rawSha256);
    if (!descriptor) throw new Error("prototype_web_description_profile_invalid");
    let page = decoded.get(version.rawSha256);
    if (!page) {
      page = inspectSyntheticDescriptionRaw(version.rawBytes, descriptor);
      decoded.set(version.rawSha256, page);
    }
    const matches = page.descriptions.filter((entry) => entry.sourceListingId === version.sourceListingId);
    if (matches.length !== 1) throw new Error("prototype_web_description_association_invalid");
    const description = matches[0].description;
    const evidence = description ? Object.freeze({ evidenceId: descriptionEvidenceId(version), capturedAt: version.capturedAt,
      value: Object.freeze({ release, ...description }) }) : undefined;
    const group = versionsByListing.get(version.listingId) ?? [];
    group.push({ version, evidence });
    versionsByListing.set(version.listingId, group);
  }
  return Object.freeze(base.map((result) => {
    const versions = versionsByListing.get(result.listingId) ?? [];
    if (versions.length > 256) throw new Error("prototype_web_description_limit");
    versions.sort((left, right) => ascii(left.version.capturedAt, right.version.capturedAt)
      || ascii(left.version.listingVersionId, right.version.listingVersionId));
    const latest = versions.filter((entry) => entry.version.latest);
    if (versions.length > 0 && (latest.length !== 1 || latest[0] !== versions.at(-1))) {
      throw new Error("prototype_web_description_latest_invalid");
    }
    const current = latest[0]?.evidence;
    return Object.freeze({ ...result,
      description: current ? Object.freeze({ status: "authored_synthetic", value: current.value, evidenceId: current.evidenceId })
        : Object.freeze({ status: "unavailable" }),
      descriptionEvidence: Object.freeze(versions.flatMap((entry) => entry.evidence ? [entry.evidence] : [])),
    });
  }));
}

export const WEB_PROJECTION = Object.freeze({ fixtureVersion: WEB_FIXTURE_VERSION, catalog: WEB_CATALOG,
  mapperVersion: WEB_MAPPER_VERSION, descriptors: WEB_DESCRIPTORS, project: projectWebDescriptions });
