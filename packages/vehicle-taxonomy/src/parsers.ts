import type { ValidationIssue, ValidationIssueCode, ValidationResult } from "@auto-world/vehicle-schema";
import type {
  MakeId, ModelId, TaxonomyAttributionId, TaxonomyAttributionV1, TaxonomyCatalogId,
  TaxonomyEntryReferenceV1, TaxonomyEntryResolutionResult, TaxonomyMakeLookupResult,
  TaxonomyMakeV1, TaxonomyModelLookupResult, TaxonomyModelV1, TaxonomyNameV1,
  TaxonomyReleaseId, TaxonomyReleaseReferenceV1, TaxonomyReleaseV1,
} from "./types.js";

type InternalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue };

const ID_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const FIXTURE_REF = /^[A-Za-z0-9._/-]{1,128}$/u;
const UTC_MILLISECONDS = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;

function hasForbiddenNameCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) return true;
  }
  return false;
}

const issue = (code: ValidationIssueCode, path: string): InternalResult<never> => ({
  ok: false,
  issue: Object.freeze({ code, path }),
});
const valid = <T>(value: T): InternalResult<T> => ({ ok: true, value });

function publicResult<T>(result: InternalResult<T>): ValidationResult<T> {
  return result.ok
    ? Object.freeze({ success: true as const, data: result.value })
    : Object.freeze({ success: false as const, issues: Object.freeze([result.issue]) });
}

function inspectObject(
  input: unknown,
  allowedKeys: readonly string[],
  path: string,
): InternalResult<Readonly<Record<string, unknown>>> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return issue("invalid_type", path);
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return issue("invalid_object", path);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const allowed = new Set(allowedKeys);
    const values: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !allowed.has(key)) return issue("unknown_key", path);
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        return issue("invalid_object", path);
      }
      values[key] = descriptor.value;
    }
    return valid(values);
  } catch {
    return issue("invalid_object", path);
  }
}

function field(object: Readonly<Record<string, unknown>>, key: string, path: string): InternalResult<unknown> {
  return Object.hasOwn(object, key) ? valid(object[key]) : issue("missing_field", `${path}.${key}`);
}

function inspectArray(input: unknown, path: string, maximum: number): InternalResult<readonly unknown[]> {
  try {
    if (typeof input !== "object" || input === null || !Array.isArray(input)) return issue("invalid_type", path);
    if (Object.getPrototypeOf(input) !== Array.prototype) return issue("invalid_object", path);
    const initialLengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (
      initialLengthDescriptor === undefined || !("value" in initialLengthDescriptor) ||
      typeof initialLengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(initialLengthDescriptor.value) || initialLengthDescriptor.value < 0
    ) return issue("invalid_object", path);
    const length = initialLengthDescriptor.value;
    if (length > maximum) return issue("invalid_value", path);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const lengthDescriptor: unknown = Reflect.get(descriptors, "length");
    if (
      typeof lengthDescriptor !== "object" || lengthDescriptor === null ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== length
    ) return issue("invalid_object", path);
    if (Reflect.ownKeys(descriptors).length !== length + 1) return issue("invalid_object", path);
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        return issue("invalid_object", path);
      }
      values.push(descriptor.value);
    }
    return valid(values);
  } catch {
    return issue("invalid_object", path);
  }
}

function parseId<T extends string>(input: unknown, prefix: string, path: string): InternalResult<T> {
  if (typeof input !== "string") return issue("invalid_type", path);
  const suffix = input.slice(prefix.length);
  const match = ID_SUFFIX.exec(suffix);
  if (
    !input.startsWith(prefix) || suffix.length < 1 || suffix.length > 64 ||
    match === null || match[0] !== suffix
  ) {
    return issue("invalid_value", path);
  }
  return valid(input as T);
}

function parseRevision(input: unknown, path: string): InternalResult<number> {
  if (typeof input !== "number") return issue("invalid_type", path);
  return Number.isSafeInteger(input) && input > 0 ? valid(input) : issue("invalid_value", path);
}

function parseReleasedAt(input: unknown, path: string): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", path);
  if (!UTC_MILLISECONDS.test(input) || input.startsWith("0000-")) return issue("invalid_value", path);
  const parsed = new Date(input);
  try {
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === input ? valid(input) : issue("invalid_value", path);
  } catch {
    return issue("invalid_value", path);
  }
}

function parseFixtureRef(input: unknown, path: string): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", path);
  return input.trim() === input && FIXTURE_REF.test(input) ? valid(input) : issue("invalid_value", path);
}

function parseName(input: unknown, path: string): InternalResult<TaxonomyNameV1> {
  const object = inspectObject(input, ["value", "attributionId"], path);
  if (!object.ok) return object;
  const valueInput = field(object.value, "value", path);
  if (!valueInput.ok) return valueInput;
  if (typeof valueInput.value !== "string") return issue("invalid_type", `${path}.value`);
  const value = valueInput.value;
  if (
    value.length < 1 || value.length > 80 || value.trim() !== value ||
    value.normalize("NFC") !== value || hasForbiddenNameCharacter(value)
  ) return issue("invalid_value", `${path}.value`);
  const attributionInput = field(object.value, "attributionId", path);
  if (!attributionInput.ok) return attributionInput;
  const attributionId = parseId<TaxonomyAttributionId>(attributionInput.value, "taxattr_", `${path}.attributionId`);
  if (!attributionId.ok) return attributionId;
  return valid(Object.freeze({ value, attributionId: attributionId.value }));
}

function parseAliases(input: unknown, primaryValue: string, path: string): InternalResult<readonly TaxonomyNameV1[]> {
  const array = inspectArray(input, path, 32);
  if (!array.ok) return array;
  const aliases: TaxonomyNameV1[] = [];
  let previous: string | undefined;
  for (let index = 0; index < array.value.length; index += 1) {
    const alias = parseName(array.value[index], `${path}[${index}]`);
    if (!alias.ok) return alias;
    if (alias.value.value === primaryValue || (previous !== undefined && alias.value.value <= previous)) {
      return issue("invalid_value", `${path}[${index}].value`);
    }
    previous = alias.value.value;
    aliases.push(alias.value);
  }
  return valid(Object.freeze(aliases));
}

function parseAttribution(input: unknown, path: string): InternalResult<TaxonomyAttributionV1> {
  const object = inspectObject(input, ["attributionId", "kind", "fixtureRef"], path);
  if (!object.ok) return object;
  const idInput = field(object.value, "attributionId", path);
  if (!idInput.ok) return idInput;
  const attributionId = parseId<TaxonomyAttributionId>(idInput.value, "taxattr_", `${path}.attributionId`);
  if (!attributionId.ok) return attributionId;
  const kindInput = field(object.value, "kind", path);
  if (!kindInput.ok) return kindInput;
  if (typeof kindInput.value !== "string") return issue("invalid_type", `${path}.kind`);
  if (kindInput.value !== "synthetic_fixture") return issue("invalid_value", `${path}.kind`);
  const fixtureInput = field(object.value, "fixtureRef", path);
  if (!fixtureInput.ok) return fixtureInput;
  const fixtureRef = parseFixtureRef(fixtureInput.value, `${path}.fixtureRef`);
  if (!fixtureRef.ok) return fixtureRef;
  return valid(Object.freeze({ attributionId: attributionId.value, kind: "synthetic_fixture", fixtureRef: fixtureRef.value }));
}

function parseMake(input: unknown, path: string): InternalResult<TaxonomyMakeV1> {
  const object = inspectObject(input, ["makeId", "primaryName", "aliases"], path);
  if (!object.ok) return object;
  const idInput = field(object.value, "makeId", path);
  if (!idInput.ok) return idInput;
  const makeId = parseId<MakeId>(idInput.value, "make_", `${path}.makeId`);
  if (!makeId.ok) return makeId;
  const primaryInput = field(object.value, "primaryName", path);
  if (!primaryInput.ok) return primaryInput;
  const primaryName = parseName(primaryInput.value, `${path}.primaryName`);
  if (!primaryName.ok) return primaryName;
  const aliasesInput = field(object.value, "aliases", path);
  if (!aliasesInput.ok) return aliasesInput;
  const aliases = parseAliases(aliasesInput.value, primaryName.value.value, `${path}.aliases`);
  if (!aliases.ok) return aliases;
  return valid(Object.freeze({ makeId: makeId.value, primaryName: primaryName.value, aliases: aliases.value }));
}

function parseModel(input: unknown, path: string): InternalResult<TaxonomyModelV1> {
  const object = inspectObject(input, ["modelId", "makeId", "primaryName", "aliases"], path);
  if (!object.ok) return object;
  const idInput = field(object.value, "modelId", path);
  if (!idInput.ok) return idInput;
  const modelId = parseId<ModelId>(idInput.value, "model_", `${path}.modelId`);
  if (!modelId.ok) return modelId;
  const makeInput = field(object.value, "makeId", path);
  if (!makeInput.ok) return makeInput;
  const makeId = parseId<MakeId>(makeInput.value, "make_", `${path}.makeId`);
  if (!makeId.ok) return makeId;
  const primaryInput = field(object.value, "primaryName", path);
  if (!primaryInput.ok) return primaryInput;
  const primaryName = parseName(primaryInput.value, `${path}.primaryName`);
  if (!primaryName.ok) return primaryName;
  const aliasesInput = field(object.value, "aliases", path);
  if (!aliasesInput.ok) return aliasesInput;
  const aliases = parseAliases(aliasesInput.value, primaryName.value.value, `${path}.aliases`);
  if (!aliases.ok) return aliases;
  return valid(Object.freeze({ modelId: modelId.value, makeId: makeId.value, primaryName: primaryName.value, aliases: aliases.value }));
}

function parseOrderedCollection<T>(
  input: unknown, path: string, maximum: number,
  parseItem: (input: unknown, path: string) => InternalResult<T>, getId: (item: T) => string,
): InternalResult<readonly T[]> {
  const array = inspectArray(input, path, maximum);
  if (!array.ok) return array;
  const items: T[] = [];
  let previous: string | undefined;
  for (let index = 0; index < array.value.length; index += 1) {
    const item = parseItem(array.value[index], `${path}[${index}]`);
    if (!item.ok) return item;
    const id = getId(item.value);
    if (previous === id) return issue("duplicate_id", `${path}[${index}]`);
    if (previous !== undefined && id < previous) return issue("invalid_value", `${path}[${index}]`);
    previous = id;
    items.push(item.value);
  }
  return valid(Object.freeze(items));
}

function parseReleaseReferenceInternal(input: unknown, path: string): InternalResult<TaxonomyReleaseReferenceV1> {
  const object = inspectObject(input, ["catalogId", "releaseId", "revision"], path);
  if (!object.ok) return object;
  const catalogInput = field(object.value, "catalogId", path);
  if (!catalogInput.ok) return catalogInput;
  const catalogId = parseId<TaxonomyCatalogId>(catalogInput.value, "taxcat_", `${path}.catalogId`);
  if (!catalogId.ok) return catalogId;
  const releaseInput = field(object.value, "releaseId", path);
  if (!releaseInput.ok) return releaseInput;
  const releaseId = parseId<TaxonomyReleaseId>(releaseInput.value, "taxrel_", `${path}.releaseId`);
  if (!releaseId.ok) return releaseId;
  const revisionInput = field(object.value, "revision", path);
  if (!revisionInput.ok) return revisionInput;
  const revision = parseRevision(revisionInput.value, `${path}.revision`);
  if (!revision.ok) return revision;
  return valid(Object.freeze({ catalogId: catalogId.value, releaseId: releaseId.value, revision: revision.value }));
}

export const parseTaxonomyCatalogId = (input: unknown): ValidationResult<TaxonomyCatalogId> => publicResult(parseId<TaxonomyCatalogId>(input, "taxcat_", "catalogId"));
export const parseTaxonomyReleaseId = (input: unknown): ValidationResult<TaxonomyReleaseId> => publicResult(parseId<TaxonomyReleaseId>(input, "taxrel_", "releaseId"));
export const parseTaxonomyAttributionId = (input: unknown): ValidationResult<TaxonomyAttributionId> => publicResult(parseId<TaxonomyAttributionId>(input, "taxattr_", "attributionId"));
export const parseMakeId = (input: unknown): ValidationResult<MakeId> => publicResult(parseId<MakeId>(input, "make_", "makeId"));
export const parseModelId = (input: unknown): ValidationResult<ModelId> => publicResult(parseId<ModelId>(input, "model_", "modelId"));
export const parseTaxonomyReleaseReference = (input: unknown): ValidationResult<TaxonomyReleaseReferenceV1> => publicResult(parseReleaseReferenceInternal(input, "release"));

export function parseTaxonomyEntryReference(input: unknown): ValidationResult<TaxonomyEntryReferenceV1> {
  const outer = inspectObject(input, ["kind", "release", "makeId", "modelId"], "reference");
  if (!outer.ok) return publicResult(outer);
  const kindInput = field(outer.value, "kind", "reference");
  if (!kindInput.ok) return publicResult(kindInput);
  if (typeof kindInput.value !== "string") return publicResult(issue("invalid_type", "reference.kind"));
  if (kindInput.value !== "make" && kindInput.value !== "model") return publicResult(issue("invalid_value", "reference.kind"));
  const exact = inspectObject(outer.value, kindInput.value === "make" ? ["kind", "release", "makeId"] : ["kind", "release", "modelId"], "reference");
  if (!exact.ok) return publicResult(exact);
  const releaseInput = field(exact.value, "release", "reference");
  if (!releaseInput.ok) return publicResult(releaseInput);
  const release = parseReleaseReferenceInternal(releaseInput.value, "reference.release");
  if (!release.ok) return publicResult(release);
  if (kindInput.value === "make") {
    const idInput = field(exact.value, "makeId", "reference");
    if (!idInput.ok) return publicResult(idInput);
    const makeId = parseId<MakeId>(idInput.value, "make_", "reference.makeId");
    return publicResult(makeId.ok ? valid(Object.freeze({ kind: "make" as const, release: release.value, makeId: makeId.value })) : makeId);
  }
  const idInput = field(exact.value, "modelId", "reference");
  if (!idInput.ok) return publicResult(idInput);
  const modelId = parseId<ModelId>(idInput.value, "model_", "reference.modelId");
  return publicResult(modelId.ok ? valid(Object.freeze({ kind: "model" as const, release: release.value, modelId: modelId.value })) : modelId);
}

export function parseTaxonomyRelease(input: unknown): ValidationResult<TaxonomyReleaseV1> {
  const path = "release";
  const object = inspectObject(input, ["schemaVersion", "catalogId", "releaseId", "revision", "releasedAt", "dataMode", "attributions", "makes", "models"], path);
  if (!object.ok) return publicResult(object);
  const versionInput = field(object.value, "schemaVersion", path);
  if (!versionInput.ok) return publicResult(versionInput);
  if (typeof versionInput.value !== "number") return publicResult(issue("invalid_type", `${path}.schemaVersion`));
  if (versionInput.value !== 1) return publicResult(issue("unsupported_version", `${path}.schemaVersion`));
  const catalogInput = field(object.value, "catalogId", path);
  if (!catalogInput.ok) return publicResult(catalogInput);
  const catalogId = parseId<TaxonomyCatalogId>(catalogInput.value, "taxcat_", `${path}.catalogId`);
  if (!catalogId.ok) return publicResult(catalogId);
  const releaseInput = field(object.value, "releaseId", path);
  if (!releaseInput.ok) return publicResult(releaseInput);
  const releaseId = parseId<TaxonomyReleaseId>(releaseInput.value, "taxrel_", `${path}.releaseId`);
  if (!releaseId.ok) return publicResult(releaseId);
  const revisionInput = field(object.value, "revision", path);
  if (!revisionInput.ok) return publicResult(revisionInput);
  const revision = parseRevision(revisionInput.value, `${path}.revision`);
  if (!revision.ok) return publicResult(revision);
  const releasedInput = field(object.value, "releasedAt", path);
  if (!releasedInput.ok) return publicResult(releasedInput);
  const releasedAt = parseReleasedAt(releasedInput.value, `${path}.releasedAt`);
  if (!releasedAt.ok) return publicResult(releasedAt);
  const modeInput = field(object.value, "dataMode", path);
  if (!modeInput.ok) return publicResult(modeInput);
  if (typeof modeInput.value !== "string") return publicResult(issue("invalid_type", `${path}.dataMode`));
  if (modeInput.value !== "synthetic") return publicResult(issue("invalid_value", `${path}.dataMode`));
  const attributionInput = field(object.value, "attributions", path);
  if (!attributionInput.ok) return publicResult(attributionInput);
  const attributions = parseOrderedCollection(attributionInput.value, `${path}.attributions`, 2048, parseAttribution, (item) => item.attributionId);
  if (!attributions.ok) return publicResult(attributions);
  const makeInput = field(object.value, "makes", path);
  if (!makeInput.ok) return publicResult(makeInput);
  const makes = parseOrderedCollection(makeInput.value, `${path}.makes`, 1024, parseMake, (item) => item.makeId);
  if (!makes.ok) return publicResult(makes);
  const modelInput = field(object.value, "models", path);
  if (!modelInput.ok) return publicResult(modelInput);
  const models = parseOrderedCollection(modelInput.value, `${path}.models`, 16384, parseModel, (item) => item.modelId);
  if (!models.ok) return publicResult(models);

  const attributionIds = new Set(attributions.value.map((item) => item.attributionId));
  for (let index = 0; index < makes.value.length; index += 1) {
    const make = makes.value[index]!;
    if (!attributionIds.has(make.primaryName.attributionId)) return publicResult(issue("invalid_value", `${path}.makes[${index}].primaryName.attributionId`));
    for (let aliasIndex = 0; aliasIndex < make.aliases.length; aliasIndex += 1) {
      if (!attributionIds.has(make.aliases[aliasIndex]!.attributionId)) return publicResult(issue("invalid_value", `${path}.makes[${index}].aliases[${aliasIndex}].attributionId`));
    }
  }
  const makeIds = new Set(makes.value.map((item) => item.makeId));
  for (let index = 0; index < models.value.length; index += 1) {
    const model = models.value[index]!;
    if (!makeIds.has(model.makeId)) return publicResult(issue("invalid_value", `${path}.models[${index}].makeId`));
    if (!attributionIds.has(model.primaryName.attributionId)) return publicResult(issue("invalid_value", `${path}.models[${index}].primaryName.attributionId`));
    for (let aliasIndex = 0; aliasIndex < model.aliases.length; aliasIndex += 1) {
      if (!attributionIds.has(model.aliases[aliasIndex]!.attributionId)) return publicResult(issue("invalid_value", `${path}.models[${index}].aliases[${aliasIndex}].attributionId`));
    }
  }
  return publicResult(valid(Object.freeze({
    schemaVersion: 1 as const, catalogId: catalogId.value, releaseId: releaseId.value,
    revision: revision.value, releasedAt: releasedAt.value, dataMode: "synthetic" as const,
    attributions: attributions.value, makes: makes.value, models: models.value,
  })));
}

export function findTaxonomyMake(release: TaxonomyReleaseV1, makeId: MakeId): TaxonomyMakeLookupResult {
  const data = release.makes.find((make) => make.makeId === makeId);
  return data === undefined ? Object.freeze({ status: "not_found" }) : Object.freeze({ status: "found", data });
}
export function findTaxonomyModel(release: TaxonomyReleaseV1, modelId: ModelId): TaxonomyModelLookupResult {
  const data = release.models.find((model) => model.modelId === modelId);
  return data === undefined ? Object.freeze({ status: "not_found" }) : Object.freeze({ status: "found", data });
}
export function resolveTaxonomyEntryReference(release: TaxonomyReleaseV1, reference: TaxonomyEntryReferenceV1): TaxonomyEntryResolutionResult {
  if (
    release.catalogId !== reference.release.catalogId || release.releaseId !== reference.release.releaseId ||
    release.revision !== reference.release.revision
  ) return Object.freeze({ status: "release_mismatch" });
  if (reference.kind === "make") {
    const result = findTaxonomyMake(release, reference.makeId);
    return result.status === "found"
      ? Object.freeze({ status: "found", kind: "make", data: result.data })
      : Object.freeze({ status: "not_found" });
  }
  const result = findTaxonomyModel(release, reference.modelId);
  return result.status === "found"
    ? Object.freeze({ status: "found", kind: "model", data: result.data })
    : Object.freeze({ status: "not_found" });
}
