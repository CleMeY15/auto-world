import {
  parseMakeId,
  parseModelId,
  parseTaxonomyRelease,
  parseTaxonomyReleaseReference,
  type MakeId,
  type ModelId,
  type TaxonomyReleaseReferenceV1,
} from "@auto-world/vehicle-taxonomy";
import type { ValidationIssue, ValidationResult } from "@auto-world/vehicle-schema";
import { DEMO_PAGE_SIZE, parseDemoResult, parseDemoSearchResponse } from "./parsers.js";
import type {
  DemoCatalogResponseV2,
  DemoDescriptionAttributionV2,
  DemoDescriptionEvidenceV2,
  DemoDescriptionFieldV2,
  DemoDescriptionValueV2,
  DemoResultV1,
  DemoResultV2,
  DemoSearchQueryV2,
  DemoSearchResponseV2,
  DemoSearchSort,
} from "./types.js";
import {
  deepFreeze,
  exactTimestamp,
  inspectArray,
  inspectObject,
  issue,
  literal,
  nonnegativeNumber,
  optional,
  publicResult,
  required,
  safeInteger,
  valid,
  type InternalResult,
} from "./validation.js";

const sorts = [
  "listing_asc",
  "price_asc",
  "price_desc",
  "mileage_asc",
  "mileage_desc",
] as const;
const cursorPattern = /^cur_[0-9a-f]{64}$/;
const descriptionEvidenceIdPattern = /^de_[0-9a-f]{64}$/;
const fixtureVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const fixtureRefPattern = /^[A-Za-z0-9._/-]{1,128}$/;

function parsePattern(input: unknown, pattern: RegExp, path: string): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", path);
  return pattern.test(input) ? valid(input) : issue("invalid_value", path);
}

function schemaVersion2(input: unknown, path: string): InternalResult<2> {
  if (typeof input !== "number") return issue("invalid_type", path);
  return input === 2 ? valid(2) : issue("unsupported_version", path);
}

function issueFromValidation(result: { readonly issues: readonly ValidationIssue[] }, path: string): InternalResult<never> {
  return issue(result.issues[0]?.code ?? "invalid_value", path);
}

function rebaseIssue(validationIssue: ValidationIssue, path: string): ValidationIssue {
  const suffix = validationIssue.path.startsWith("$")
    ? validationIssue.path.slice(1)
    : "";
  return { code: validationIssue.code, path: `${path}${suffix}` };
}

function parseMakeReference(input: unknown, path: string): InternalResult<MakeId> {
  const parsed = parseMakeId(input);
  return parsed.success ? valid(parsed.data) : issueFromValidation(parsed, path);
}

function parseModelReference(input: unknown, path: string): InternalResult<ModelId> {
  const parsed = parseModelId(input);
  return parsed.success ? valid(parsed.data) : issueFromValidation(parsed, path);
}

function parseReleaseReference(input: unknown, path: string): InternalResult<TaxonomyReleaseReferenceV1> {
  const parsed = parseTaxonomyReleaseReference(input);
  if (parsed.success) return valid(parsed.data);
  const first = parsed.issues[0];
  const suffix = first?.path.startsWith("release") === true
    ? first.path.slice("release".length)
    : "";
  return issue(first?.code ?? "invalid_value", `${path}${suffix}`);
}

function parseAttribution(input: unknown, path: string): InternalResult<DemoDescriptionAttributionV2> {
  const object = inspectObject(input, ["kind", "fixtureRef"], path);
  if (!object.ok) return object;
  const kindInput = required(object.value, "kind", path);
  if (!kindInput.ok) return kindInput;
  const kind = literal(kindInput.value, ["synthetic_fixture"] as const, `${path}.kind`);
  if (!kind.ok) return kind;
  const fixtureInput = required(object.value, "fixtureRef", path);
  if (!fixtureInput.ok) return fixtureInput;
  const fixtureRef = parsePattern(fixtureInput.value, fixtureRefPattern, `${path}.fixtureRef`);
  return fixtureRef.ok
    ? valid({ kind: "synthetic_fixture", fixtureRef: fixtureRef.value })
    : fixtureRef;
}

function parseDescriptionValue(input: unknown, path: string): InternalResult<DemoDescriptionValueV2> {
  const object = inspectObject(
    input,
    ["release", "makeId", "modelId", "firstRegistrationYear", "attribution"],
    path,
  );
  if (!object.ok) return object;
  const releaseInput = required(object.value, "release", path);
  if (!releaseInput.ok) return releaseInput;
  const release = parseReleaseReference(releaseInput.value, `${path}.release`);
  if (!release.ok) return release;
  const makeInput = required(object.value, "makeId", path);
  if (!makeInput.ok) return makeInput;
  const makeId = parseMakeReference(makeInput.value, `${path}.makeId`);
  if (!makeId.ok) return makeId;
  const modelInput = required(object.value, "modelId", path);
  if (!modelInput.ok) return modelInput;
  const modelId = parseModelReference(modelInput.value, `${path}.modelId`);
  if (!modelId.ok) return modelId;
  const yearInput = required(object.value, "firstRegistrationYear", path);
  if (!yearInput.ok) return yearInput;
  const firstRegistrationYear = safeInteger(yearInput.value, `${path}.firstRegistrationYear`, 9999);
  if (!firstRegistrationYear.ok) return firstRegistrationYear;
  if (firstRegistrationYear.value < 1886) {
    return issue("invalid_value", `${path}.firstRegistrationYear`);
  }
  const attributionInput = required(object.value, "attribution", path);
  if (!attributionInput.ok) return attributionInput;
  const attribution = parseAttribution(attributionInput.value, `${path}.attribution`);
  if (!attribution.ok) return attribution;
  return valid(deepFreeze({
    release: release.value,
    makeId: makeId.value,
    modelId: modelId.value,
    firstRegistrationYear: firstRegistrationYear.value,
    attribution: attribution.value,
  }));
}

function equalRelease(left: TaxonomyReleaseReferenceV1, right: TaxonomyReleaseReferenceV1): boolean {
  return left.catalogId === right.catalogId &&
    left.releaseId === right.releaseId &&
    left.revision === right.revision;
}

function equalDescription(left: DemoDescriptionValueV2, right: DemoDescriptionValueV2): boolean {
  return equalRelease(left.release, right.release) &&
    left.makeId === right.makeId &&
    left.modelId === right.modelId &&
    left.firstRegistrationYear === right.firstRegistrationYear &&
    left.attribution.kind === right.attribution.kind &&
    left.attribution.fixtureRef === right.attribution.fixtureRef;
}

function parseDescriptionEvidence(input: unknown, path: string): InternalResult<DemoDescriptionEvidenceV2> {
  const object = inspectObject(input, ["evidenceId", "capturedAt", "value"], path);
  if (!object.ok) return object;
  const idInput = required(object.value, "evidenceId", path);
  if (!idInput.ok) return idInput;
  const evidenceId = parsePattern(idInput.value, descriptionEvidenceIdPattern, `${path}.evidenceId`);
  if (!evidenceId.ok) return evidenceId;
  const capturedInput = required(object.value, "capturedAt", path);
  if (!capturedInput.ok) return capturedInput;
  const capturedAt = exactTimestamp(capturedInput.value, `${path}.capturedAt`);
  if (!capturedAt.ok) return capturedAt;
  const valueInput = required(object.value, "value", path);
  if (!valueInput.ok) return valueInput;
  const value = parseDescriptionValue(valueInput.value, `${path}.value`);
  return value.ok
    ? valid(deepFreeze({ evidenceId: evidenceId.value, capturedAt: capturedAt.value, value: value.value }))
    : value;
}

function parseDescriptionEvidenceCollection(
  input: unknown,
  path: string,
): InternalResult<readonly DemoDescriptionEvidenceV2[]> {
  const array = inspectArray(input, path, 256);
  if (!array.ok) return array;
  const evidence: DemoDescriptionEvidenceV2[] = [];
  const ids = new Set<string>();
  let previousTime: string | undefined;
  for (let index = 0; index < array.value.length; index += 1) {
    const parsed = parseDescriptionEvidence(array.value[index], `${path}[${index}]`);
    if (!parsed.ok) return parsed;
    if (ids.has(parsed.value.evidenceId)) {
      return issue("duplicate_id", `${path}[${index}].evidenceId`);
    }
    if (previousTime !== undefined && parsed.value.capturedAt < previousTime) {
      return issue("invalid_value", `${path}[${index}].capturedAt`);
    }
    ids.add(parsed.value.evidenceId);
    previousTime = parsed.value.capturedAt;
    evidence.push(parsed.value);
  }
  return valid(evidence);
}

function parseDescriptionField(input: unknown, path: string): InternalResult<DemoDescriptionFieldV2> {
  const initial = inspectObject(input, ["status", "value", "evidenceId"], path);
  if (!initial.ok) return initial;
  const statusInput = required(initial.value, "status", path);
  if (!statusInput.ok) return statusInput;
  const status = literal(
    statusInput.value,
    ["unavailable", "authored_synthetic"] as const,
    `${path}.status`,
  );
  if (!status.ok) return status;
  if (status.value === "unavailable") {
    const exact = inspectObject(input, ["status"], path);
    return exact.ok ? valid({ status: "unavailable" }) : exact;
  }
  const valueInput = required(initial.value, "value", path);
  if (!valueInput.ok) return valueInput;
  const value = parseDescriptionValue(valueInput.value, `${path}.value`);
  if (!value.ok) return value;
  const idInput = required(initial.value, "evidenceId", path);
  if (!idInput.ok) return idInput;
  const evidenceId = parsePattern(idInput.value, descriptionEvidenceIdPattern, `${path}.evidenceId`);
  return evidenceId.ok
    ? valid(deepFreeze({ status: "authored_synthetic", value: value.value, evidenceId: evidenceId.value }))
    : evidenceId;
}

function parseResultInternal(input: unknown, path: string): InternalResult<DemoResultV2> {
  const object = inspectObject(
    input,
    ["listingId", "availability", "price", "mileage", "evidence", "description", "descriptionEvidence"],
    path,
  );
  if (!object.ok) return object;
  const baseInput: Record<string, unknown> = {};
  for (const key of ["listingId", "availability", "price", "mileage", "evidence"] as const) {
    if (Object.hasOwn(object.value, key)) baseInput[key] = object.value[key];
  }
  const base = parseDemoResult(baseInput);
  if (!base.success) return { ok: false, issue: rebaseIssue(base.issues[0]!, path) };
  const descriptionInput = required(object.value, "description", path);
  if (!descriptionInput.ok) return descriptionInput;
  const description = parseDescriptionField(descriptionInput.value, `${path}.description`);
  if (!description.ok) return description;
  const evidenceInput = required(object.value, "descriptionEvidence", path);
  if (!evidenceInput.ok) return evidenceInput;
  const descriptionEvidence = parseDescriptionEvidenceCollection(
    evidenceInput.value,
    `${path}.descriptionEvidence`,
  );
  if (!descriptionEvidence.ok) return descriptionEvidence;
  if (description.value.status === "authored_synthetic") {
    const selectedDescription = description.value;
    const selected = descriptionEvidence.value.find(
      (item) => item.evidenceId === selectedDescription.evidenceId,
    );
    if (selected === undefined || !equalDescription(selected.value, selectedDescription.value)) {
      return issue("invalid_value", `${path}.description`);
    }
  }
  return valid(deepFreeze({
    ...base.data,
    description: description.value,
    descriptionEvidence: [...descriptionEvidence.value],
  }));
}

function parseQueryInternal(input: unknown): InternalResult<DemoSearchQueryV2> {
  const object = inspectObject(
    input,
    ["schemaVersion", "sort", "priceMaxMinor", "mileageMaxKm", "makeId", "modelId", "firstRegistrationYear", "cursor"],
    "$",
  );
  if (!object.ok) return object;
  const versionInput = required(object.value, "schemaVersion", "$");
  if (!versionInput.ok) return versionInput;
  const version = schemaVersion2(versionInput.value, "$.schemaVersion");
  if (!version.ok) return version;
  const sortInput = required(object.value, "sort", "$");
  if (!sortInput.ok) return sortInput;
  const sort = literal<DemoSearchSort>(sortInput.value, sorts, "$.sort");
  if (!sort.ok) return sort;
  const result: {
    schemaVersion: 2;
    sort: DemoSearchSort;
    priceMaxMinor?: number;
    mileageMaxKm?: number;
    makeId?: MakeId;
    modelId?: ModelId;
    firstRegistrationYear?: number;
    cursor?: string;
  } = { schemaVersion: 2, sort: sort.value };
  const priceInput = optional(object.value, "priceMaxMinor");
  if (priceInput.present) {
    const price = safeInteger(priceInput.value, "$.priceMaxMinor");
    if (!price.ok) return price;
    result.priceMaxMinor = price.value;
  }
  const mileageInput = optional(object.value, "mileageMaxKm");
  if (mileageInput.present) {
    const mileage = nonnegativeNumber(mileageInput.value, "$.mileageMaxKm");
    if (!mileage.ok) return mileage;
    result.mileageMaxKm = mileage.value;
  }
  const makeInput = optional(object.value, "makeId");
  if (makeInput.present) {
    const makeId = parseMakeReference(makeInput.value, "$.makeId");
    if (!makeId.ok) return makeId;
    result.makeId = makeId.value;
  }
  const modelInput = optional(object.value, "modelId");
  if (modelInput.present) {
    if (!makeInput.present) return issue("missing_field", "$.makeId");
    const modelId = parseModelReference(modelInput.value, "$.modelId");
    if (!modelId.ok) return modelId;
    result.modelId = modelId.value;
  }
  const yearInput = optional(object.value, "firstRegistrationYear");
  if (yearInput.present) {
    const year = safeInteger(yearInput.value, "$.firstRegistrationYear", 9999);
    if (!year.ok) return year;
    if (year.value < 1886) return issue("invalid_value", "$.firstRegistrationYear");
    result.firstRegistrationYear = year.value;
  }
  const cursorInput = optional(object.value, "cursor");
  if (cursorInput.present) {
    const cursor = parsePattern(cursorInput.value, cursorPattern, "$.cursor");
    if (!cursor.ok) return cursor;
    result.cursor = cursor.value;
  }
  return valid(deepFreeze(result));
}

function baseResult(result: DemoResultV2): DemoResultV1 {
  return {
    listingId: result.listingId,
    availability: result.availability,
    price: result.price,
    mileage: result.mileage,
    evidence: result.evidence,
  };
}

function parseResponseInternal(input: unknown, asOf: unknown): InternalResult<DemoSearchResponseV2> {
  const object = inspectObject(
    input,
    ["schemaVersion", "dataMode", "fixtureVersion", "taxonomyRelease", "dataAsOf", "state", "results", "nextCursor", "totalCount", "reason"],
    "$",
  );
  if (!object.ok) return object;
  const versionInput = required(object.value, "schemaVersion", "$");
  if (!versionInput.ok) return versionInput;
  const version = schemaVersion2(versionInput.value, "$.schemaVersion");
  if (!version.ok) return version;
  const releaseInput = required(object.value, "taxonomyRelease", "$");
  if (!releaseInput.ok) return releaseInput;
  const taxonomyRelease = parseReleaseReference(releaseInput.value, "$.taxonomyRelease");
  if (!taxonomyRelease.ok) return taxonomyRelease;
  const resultsInput = required(object.value, "results", "$");
  if (!resultsInput.ok) return resultsInput;
  const resultsArray = inspectArray(resultsInput.value, "$.results", DEMO_PAGE_SIZE);
  if (!resultsArray.ok) return resultsArray;
  const results: DemoResultV2[] = [];
  for (let index = 0; index < resultsArray.value.length; index += 1) {
    const parsed = parseResultInternal(resultsArray.value[index], `$.results[${index}]`);
    if (!parsed.ok) return parsed;
    results.push(parsed.value);
  }
  const baseResponseInput: Record<string, unknown> = { schemaVersion: 1 };
  for (const key of ["dataMode", "fixtureVersion", "dataAsOf", "state"] as const) {
    if (Object.hasOwn(object.value, key)) baseResponseInput[key] = object.value[key];
  }
  baseResponseInput.results = results.map(baseResult);
  for (const key of ["nextCursor", "totalCount", "reason"] as const) {
    if (Object.hasOwn(object.value, key)) baseResponseInput[key] = object.value[key];
  }
  const base = parseDemoSearchResponse(baseResponseInput, asOf);
  if (!base.success) return { ok: false, issue: base.issues[0]! };

  const pageEvidenceIds = new Set<string>();
  let pageEvidenceCount = 0;
  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    const result = results[resultIndex]!;
    if (
      result.description.status === "authored_synthetic" &&
      !equalRelease(result.description.value.release, taxonomyRelease.value)
    ) {
      return issue("invalid_value", `$.results[${resultIndex}].description.value.release`);
    }
    for (let evidenceIndex = 0; evidenceIndex < result.descriptionEvidence.length; evidenceIndex += 1) {
      const evidence = result.descriptionEvidence[evidenceIndex]!;
      if (!equalRelease(evidence.value.release, taxonomyRelease.value)) {
        return issue(
          "invalid_value",
          `$.results[${resultIndex}].descriptionEvidence[${evidenceIndex}].value.release`,
        );
      }
      pageEvidenceCount += 1;
      if (pageEvidenceCount > 256) return issue("invalid_value", "$.results");
      if (pageEvidenceIds.has(evidence.evidenceId)) {
        return issue("duplicate_id", `$.results[${resultIndex}].descriptionEvidence[${evidenceIndex}].evidenceId`);
      }
      if (evidence.capturedAt > base.data.dataAsOf) {
        return issue("invalid_value", `$.results[${resultIndex}].descriptionEvidence[${evidenceIndex}].capturedAt`);
      }
      pageEvidenceIds.add(evidence.evidenceId);
    }
  }

  const common = {
    schemaVersion: 2 as const,
    dataMode: "synthetic" as const,
    fixtureVersion: base.data.fixtureVersion,
    taxonomyRelease: taxonomyRelease.value,
    dataAsOf: base.data.dataAsOf,
    results: [...results],
    ...(base.data.nextCursor === undefined ? {} : { nextCursor: base.data.nextCursor }),
  };
  if (base.data.state === "complete") {
    return valid(deepFreeze({ ...common, state: "complete", totalCount: base.data.totalCount }));
  }
  if (base.data.state === "partial") {
    return valid(deepFreeze({ ...common, state: "partial", reason: "projection_incomplete" }));
  }
  return valid(deepFreeze({ ...common, state: "stale", reason: "projection_stale" }));
}

function parseCatalogInternal(input: unknown): InternalResult<DemoCatalogResponseV2> {
  const object = inspectObject(input, ["schemaVersion", "dataMode", "fixtureVersion", "taxonomyRelease"], "$");
  if (!object.ok) return object;
  const versionInput = required(object.value, "schemaVersion", "$");
  if (!versionInput.ok) return versionInput;
  const version = schemaVersion2(versionInput.value, "$.schemaVersion");
  if (!version.ok) return version;
  const modeInput = required(object.value, "dataMode", "$");
  if (!modeInput.ok) return modeInput;
  const mode = literal(modeInput.value, ["synthetic"] as const, "$.dataMode");
  if (!mode.ok) return mode;
  const fixtureInput = required(object.value, "fixtureVersion", "$");
  if (!fixtureInput.ok) return fixtureInput;
  const fixtureVersion = parsePattern(fixtureInput.value, fixtureVersionPattern, "$.fixtureVersion");
  if (!fixtureVersion.ok) return fixtureVersion;
  const releaseInput = required(object.value, "taxonomyRelease", "$");
  if (!releaseInput.ok) return releaseInput;
  const taxonomyRelease = parseTaxonomyRelease(releaseInput.value);
  if (!taxonomyRelease.success) {
    const first = taxonomyRelease.issues[0];
    const suffix = first?.path.startsWith("release") === true
      ? first.path.slice("release".length)
      : "";
    return issue(first?.code ?? "invalid_value", `$.taxonomyRelease${suffix}`);
  }
  return valid(deepFreeze({
    schemaVersion: 2,
    dataMode: "synthetic",
    fixtureVersion: fixtureVersion.value,
    taxonomyRelease: taxonomyRelease.data,
  }));
}

export function parseDemoSearchQueryV2(input: unknown): ValidationResult<DemoSearchQueryV2> {
  return publicResult(parseQueryInternal(input));
}

export function parseDemoResultV2(input: unknown): ValidationResult<DemoResultV2> {
  return publicResult(parseResultInternal(input, "$"));
}

export function parseDemoSearchResponseV2(
  input: unknown,
  asOf: unknown,
): ValidationResult<DemoSearchResponseV2> {
  return publicResult(parseResponseInternal(input, asOf));
}

export function parseDemoCatalogResponseV2(input: unknown): ValidationResult<DemoCatalogResponseV2> {
  return publicResult(parseCatalogInternal(input));
}
