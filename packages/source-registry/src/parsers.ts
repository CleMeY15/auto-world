import {
  parseSourceId,
  type AcquisitionMethod,
  type LegalStatus,
  type SourceId,
  type ValidationResult,
} from "@auto-world/vehicle-schema";
import type {
  Audience,
  CachingPolicy,
  CircuitState,
  DeclaredSourcePolicy,
  MediaPolicy,
  PiiPolicy,
  PolicyEligibility,
  PolicyEligibilityRequest,
  PolicyIneligibilityReason,
  RetentionPolicy,
  SourceAuthorization,
  SourceConfiguration,
  SourceCredentials,
  SourceEvent,
  SourceEventKind,
  SourceField,
  SourceGrant,
  SourceHealth,
  SourceHealthPolicy,
  SourceHealthReason,
  SourceHealthSample,
  SourceOperations,
  SourceRegistry,
  SourceRevision,
  SourceState,
  TakedownPolicy,
  Territory,
} from "./types.js";
import {
  booleanValue,
  deepFreeze,
  inspectArray,
  inspectObject,
  integerValue,
  issue,
  literalValue,
  milliseconds,
  nullableInteger,
  parseTimestamp,
  prefixedReference,
  publicResult,
  required as get,
  stringValue,
  uniqueLiteralArray,
  valid,
  type InternalResult,
} from "./validation.js";

const territories = ["FR", "DE", "KR", "GB", "US", "CH", "JP"] as const;
const acquisitionMethods = ["api", "feed", "crawl", "manual"] as const;
const legalStatuses = [
  "official_api", "licensed_partner", "dealer_feed", "permitted_crawl",
  "restricted", "blocked", "unknown",
] as const;
const audiences = ["internal", "consumer", "b2b"] as const;
const sourceFields = [
  "source_listing_id", "url", "price", "mileage", "power", "co2", "vin",
  "description", "media", "seller_pii",
] as const;
const sourceStates = ["disabled", "enabled", "takedown"] as const;
const eventKinds = ["create", "replace_configuration", "enable", "disable", "takedown"] as const;
const permittedLegalStatuses: ReadonlySet<LegalStatus> = new Set([
  "official_api", "licensed_partner", "dealer_feed", "permitted_crawl",
]);

function parseSchemaVersion(input: unknown, path: string): InternalResult<1> {
  if (typeof input !== "number") return issue("invalid_type", path);
  return input === 1 ? valid(1) : issue("unsupported_version", path);
}

function parseDisplayName(input: unknown, path: string): InternalResult<string> {
  const text = stringValue(input, path);
  if (!text.ok) return text;
  if (text.value.length < 1 || text.value.length > 120 || text.value.trim() !== text.value) {
    return issue("invalid_value", path);
  }
  for (let index = 0; index < text.value.length; index += 1) {
    const code = text.value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) return issue("invalid_value", path);
  }
  return text;
}

function parseSourceIdentifier(input: unknown, path: string): InternalResult<SourceId> {
  const parsed = parseSourceId(input);
  if (parsed.success) return valid(parsed.data);
  const first = parsed.issues[0];
  return issue(first?.code ?? "invalid_value", path);
}

function parseCredentials(input: unknown, path: string): InternalResult<SourceCredentials> {
  const initial = inspectObject(input, ["kind", "ref"], path);
  if (!initial.ok) return initial;
  const kindInput = get(initial.value, "kind", path);
  if (!kindInput.ok) return kindInput;
  const kind = literalValue(kindInput.value, ["none", "secret_ref"] as const, `${path}.kind`);
  if (!kind.ok) return kind;
  if (kind.value === "none") {
    const exact = inspectObject(input, ["kind"], path);
    return exact.ok ? valid({ kind: "none" }) : exact;
  }
  const exact = inspectObject(input, ["kind", "ref"], path);
  if (!exact.ok) return exact;
  const refInput = get(exact.value, "ref", path);
  if (!refInput.ok) return refInput;
  const ref = prefixedReference(refInput.value, `${path}.ref`, "secret://auto-world/", 128);
  return ref.ok ? valid({ kind: "secret_ref", ref: ref.value }) : ref;
}

function parseAuthorization(input: unknown, path: string): InternalResult<SourceAuthorization> {
  const object = inspectObject(input, ["basisRef", "reviewerRef", "reviewedAt", "validFrom", "validUntil"], path);
  if (!object.ok) return object;
  const basisInput = get(object.value, "basisRef", path); if (!basisInput.ok) return basisInput;
  const basisRef = prefixedReference(basisInput.value, `${path}.basisRef`, "evidence_"); if (!basisRef.ok) return basisRef;
  const reviewerInput = get(object.value, "reviewerRef", path); if (!reviewerInput.ok) return reviewerInput;
  const reviewerRef = prefixedReference(reviewerInput.value, `${path}.reviewerRef`, "actor_"); if (!reviewerRef.ok) return reviewerRef;
  const reviewedInput = get(object.value, "reviewedAt", path); if (!reviewedInput.ok) return reviewedInput;
  const reviewedAt = parseTimestamp(reviewedInput.value, `${path}.reviewedAt`); if (!reviewedAt.ok) return reviewedAt;
  const fromInput = get(object.value, "validFrom", path); if (!fromInput.ok) return fromInput;
  const validFrom = parseTimestamp(fromInput.value, `${path}.validFrom`); if (!validFrom.ok) return validFrom;
  const untilInput = get(object.value, "validUntil", path); if (!untilInput.ok) return untilInput;
  const validUntil = parseTimestamp(untilInput.value, `${path}.validUntil`); if (!validUntil.ok) return validUntil;
  if (validFrom.value >= validUntil.value) return issue("invalid_value", `${path}.validUntil`);
  if (reviewedAt.value > validUntil.value) return issue("invalid_value", `${path}.reviewedAt`);
  return valid({ basisRef: basisRef.value, reviewerRef: reviewerRef.value, reviewedAt: reviewedAt.value, validFrom: validFrom.value, validUntil: validUntil.value });
}

function parseGrant(input: unknown, path: string): InternalResult<SourceGrant> {
  const object = inspectObject(input, ["territory", "acquisitionMethod", "audience", "fields"], path);
  if (!object.ok) return object;
  const territoryInput = get(object.value, "territory", path); if (!territoryInput.ok) return territoryInput;
  const territory = literalValue<Territory>(territoryInput.value, territories, `${path}.territory`); if (!territory.ok) return territory;
  const methodInput = get(object.value, "acquisitionMethod", path); if (!methodInput.ok) return methodInput;
  const acquisitionMethod = literalValue<AcquisitionMethod>(methodInput.value, acquisitionMethods, `${path}.acquisitionMethod`); if (!acquisitionMethod.ok) return acquisitionMethod;
  const audienceInput = get(object.value, "audience", path); if (!audienceInput.ok) return audienceInput;
  const audience = literalValue<Audience>(audienceInput.value, audiences, `${path}.audience`); if (!audience.ok) return audience;
  const fieldsInput = get(object.value, "fields", path); if (!fieldsInput.ok) return fieldsInput;
  const fields = uniqueLiteralArray<SourceField>(fieldsInput.value, `${path}.fields`, sourceFields); if (!fields.ok) return fields;
  if (!fields.value.includes("source_listing_id")) return issue("invalid_value", `${path}.fields`);
  if (audience.value !== "internal" && (fields.value.includes("vin") || fields.value.includes("seller_pii"))) {
    return issue("invalid_value", `${path}.fields`);
  }
  return valid({ territory: territory.value, acquisitionMethod: acquisitionMethod.value, audience: audience.value, fields: [...fields.value] });
}

function parseCaching(input: unknown, path: string): InternalResult<CachingPolicy> {
  const object = inspectObject(input, ["allowed", "maxAgeSeconds"], path); if (!object.ok) return object;
  const allowedInput = get(object.value, "allowed", path); if (!allowedInput.ok) return allowedInput;
  const allowed = booleanValue(allowedInput.value, `${path}.allowed`); if (!allowed.ok) return allowed;
  const ageInput = get(object.value, "maxAgeSeconds", path); if (!ageInput.ok) return ageInput;
  const age = integerValue(ageInput.value, `${path}.maxAgeSeconds`, 0, 315_360_000); if (!age.ok) return age;
  if ((!allowed.value && age.value !== 0) || (allowed.value && age.value < 1)) return issue("invalid_value", `${path}.maxAgeSeconds`);
  return valid({ allowed: allowed.value, maxAgeSeconds: age.value });
}

function parseRetention(input: unknown, path: string): InternalResult<RetentionPolicy> {
  const keys = ["rawSeconds", "normalizedSeconds", "mediaSeconds", "piiSeconds"] as const;
  const object = inspectObject(input, keys, path); if (!object.ok) return object;
  const values: number[] = [];
  for (const key of keys) {
    const itemInput = get(object.value, key, path); if (!itemInput.ok) return itemInput;
    const item = integerValue(itemInput.value, `${path}.${key}`, 0, 315_360_000); if (!item.ok) return item;
    values.push(item.value);
  }
  return valid({ rawSeconds: values[0]!, normalizedSeconds: values[1]!, mediaSeconds: values[2]!, piiSeconds: values[3]! });
}

function parseMedia(input: unknown, path: string): InternalResult<MediaPolicy> {
  const object = inspectObject(input, ["mode", "attributionRequired"], path); if (!object.ok) return object;
  const modeInput = get(object.value, "mode", path); if (!modeInput.ok) return modeInput;
  const mode = literalValue(modeInput.value, ["none", "reference", "licensed_copy"] as const, `${path}.mode`); if (!mode.ok) return mode;
  const attributionInput = get(object.value, "attributionRequired", path); if (!attributionInput.ok) return attributionInput;
  const attributionRequired = booleanValue(attributionInput.value, `${path}.attributionRequired`); if (!attributionRequired.ok) return attributionRequired;
  return valid({ mode: mode.value, attributionRequired: attributionRequired.value });
}

function parsePii(input: unknown, path: string): InternalResult<PiiPolicy> {
  const object = inspectObject(input, ["mode", "purposeRef"], path); if (!object.ok) return object;
  const modeInput = get(object.value, "mode", path); if (!modeInput.ok) return modeInput;
  const mode = literalValue(modeInput.value, ["none", "professional_only", "private_seller"] as const, `${path}.mode`); if (!mode.ok) return mode;
  const purposeInput = get(object.value, "purposeRef", path); if (!purposeInput.ok) return purposeInput;
  if (mode.value === "none") {
    return purposeInput.value === null ? valid({ mode: "none", purposeRef: null }) : issue("invalid_value", `${path}.purposeRef`);
  }
  const purposeRef = prefixedReference(purposeInput.value, `${path}.purposeRef`, "purpose_");
  return purposeRef.ok ? valid({ mode: mode.value, purposeRef: purposeRef.value }) : purposeRef;
}

function parseTakedown(input: unknown, path: string): InternalResult<TakedownPolicy> {
  const object = inspectObject(input, ["contactRef", "procedureRef", "maxResponseSeconds"], path); if (!object.ok) return object;
  const contactInput = get(object.value, "contactRef", path); if (!contactInput.ok) return contactInput;
  const contactRef = prefixedReference(contactInput.value, `${path}.contactRef`, "contact_"); if (!contactRef.ok) return contactRef;
  const procedureInput = get(object.value, "procedureRef", path); if (!procedureInput.ok) return procedureInput;
  const procedureRef = prefixedReference(procedureInput.value, `${path}.procedureRef`, "procedure_"); if (!procedureRef.ok) return procedureRef;
  const responseInput = get(object.value, "maxResponseSeconds", path); if (!responseInput.ok) return responseInput;
  const maxResponseSeconds = integerValue(responseInput.value, `${path}.maxResponseSeconds`, 1, 315_360_000); if (!maxResponseSeconds.ok) return maxResponseSeconds;
  return valid({ contactRef: contactRef.value, procedureRef: procedureRef.value, maxResponseSeconds: maxResponseSeconds.value });
}

function parsePolicy(
  input: unknown,
  path: string,
  configuredTerritories: readonly Territory[],
  configuredMethods: readonly AcquisitionMethod[],
): InternalResult<DeclaredSourcePolicy> {
  const object = inspectObject(input, ["authorization", "grants", "caching", "retention", "media", "pii", "takedown"], path); if (!object.ok) return object;
  const authorizationInput = get(object.value, "authorization", path); if (!authorizationInput.ok) return authorizationInput;
  const authorization = parseAuthorization(authorizationInput.value, `${path}.authorization`); if (!authorization.ok) return authorization;
  const grantsInput = get(object.value, "grants", path); if (!grantsInput.ok) return grantsInput;
  const grantArray = inspectArray(grantsInput.value, `${path}.grants`, 256, 1); if (!grantArray.ok) return grantArray;
  const grants: SourceGrant[] = [];
  const tupleSet = new Set<string>();
  for (let index = 0; index < grantArray.value.length; index += 1) {
    const grant = parseGrant(grantArray.value[index], `${path}.grants[${index}]`); if (!grant.ok) return grant;
    if (!configuredTerritories.includes(grant.value.territory)) return issue("invalid_value", `${path}.grants[${index}].territory`);
    if (!configuredMethods.includes(grant.value.acquisitionMethod)) return issue("invalid_value", `${path}.grants[${index}].acquisitionMethod`);
    const tuple = `${grant.value.territory}:${grant.value.acquisitionMethod}:${grant.value.audience}`;
    if (tupleSet.has(tuple)) return issue("duplicate_id", `${path}.grants[${index}]`);
    tupleSet.add(tuple); grants.push(grant.value);
  }
  for (let index = 0; index < grants.length; index += 1) {
    const grant = grants[index]!;
    if (grant.audience === "internal") continue;
    const internal = grants.find((candidate) => candidate.territory === grant.territory && candidate.acquisitionMethod === grant.acquisitionMethod && candidate.audience === "internal");
    if (internal === undefined || !grant.fields.every((field) => internal.fields.includes(field))) {
      return issue("invalid_value", `${path}.grants[${index}].fields`);
    }
  }
  const cachingInput = get(object.value, "caching", path); if (!cachingInput.ok) return cachingInput;
  const caching = parseCaching(cachingInput.value, `${path}.caching`); if (!caching.ok) return caching;
  const retentionInput = get(object.value, "retention", path); if (!retentionInput.ok) return retentionInput;
  const retention = parseRetention(retentionInput.value, `${path}.retention`); if (!retention.ok) return retention;
  if (caching.value.allowed && caching.value.maxAgeSeconds > retention.value.normalizedSeconds) return issue("invalid_value", `${path}.caching.maxAgeSeconds`);
  const mediaInput = get(object.value, "media", path); if (!mediaInput.ok) return mediaInput;
  const media = parseMedia(mediaInput.value, `${path}.media`); if (!media.ok) return media;
  const piiInput = get(object.value, "pii", path); if (!piiInput.ok) return piiInput;
  const pii = parsePii(piiInput.value, `${path}.pii`); if (!pii.ok) return pii;
  const internalFields = new Set(grants.filter((grant) => grant.audience === "internal").flatMap((grant) => grant.fields));
  if (media.value.mode === "none" && (internalFields.has("media") || retention.value.mediaSeconds !== 0)) return issue("invalid_value", `${path}.media.mode`);
  if (media.value.mode === "reference" && (!internalFields.has("media") || retention.value.mediaSeconds !== 0)) return issue("invalid_value", `${path}.media.mode`);
  if (media.value.mode === "licensed_copy" && (!internalFields.has("media") || retention.value.mediaSeconds < 1)) return issue("invalid_value", `${path}.media.mode`);
  if (pii.value.mode === "none" && (internalFields.has("seller_pii") || retention.value.piiSeconds !== 0)) return issue("invalid_value", `${path}.pii.mode`);
  if (pii.value.mode !== "none" && (!internalFields.has("seller_pii") || retention.value.piiSeconds < 1)) return issue("invalid_value", `${path}.pii.mode`);
  const takedownInput = get(object.value, "takedown", path); if (!takedownInput.ok) return takedownInput;
  const takedown = parseTakedown(takedownInput.value, `${path}.takedown`); if (!takedown.ok) return takedown;
  return valid({ authorization: authorization.value, grants, caching: caching.value, retention: retention.value, media: media.value, pii: pii.value, takedown: takedown.value });
}

function parseOperations(input: unknown, path: string): InternalResult<SourceOperations> {
  const keys = ["incremental", "fullReconcileIntervalSeconds", "deletionMode", "deletionPropagationSeconds", "freshnessSeconds", "requestsPerMinute", "concurrency", "timeoutMs", "maxRetries"] as const;
  const object = inspectObject(input, keys, path); if (!object.ok) return object;
  const incrementalInput = get(object.value, "incremental", path); if (!incrementalInput.ok) return incrementalInput;
  const incremental = booleanValue(incrementalInput.value, `${path}.incremental`); if (!incremental.ok) return incremental;
  const reconcileInput = get(object.value, "fullReconcileIntervalSeconds", path); if (!reconcileInput.ok) return reconcileInput;
  const fullReconcileIntervalSeconds = integerValue(reconcileInput.value, `${path}.fullReconcileIntervalSeconds`, 1, 315_360_000); if (!fullReconcileIntervalSeconds.ok) return fullReconcileIntervalSeconds;
  const modeInput = get(object.value, "deletionMode", path); if (!modeInput.ok) return modeInput;
  const deletionMode = literalValue(modeInput.value, ["explicit_tombstone", "full_reconciliation", "both"] as const, `${path}.deletionMode`); if (!deletionMode.ok) return deletionMode;
  const deletionInput = get(object.value, "deletionPropagationSeconds", path); if (!deletionInput.ok) return deletionInput;
  const deletionPropagationSeconds = integerValue(deletionInput.value, `${path}.deletionPropagationSeconds`, 1, 315_360_000); if (!deletionPropagationSeconds.ok) return deletionPropagationSeconds;
  const freshnessInput = get(object.value, "freshnessSeconds", path); if (!freshnessInput.ok) return freshnessInput;
  const freshnessSeconds = integerValue(freshnessInput.value, `${path}.freshnessSeconds`, 1, 315_360_000); if (!freshnessSeconds.ok) return freshnessSeconds;
  const rpmInput = get(object.value, "requestsPerMinute", path); if (!rpmInput.ok) return rpmInput;
  const requestsPerMinute = integerValue(rpmInput.value, `${path}.requestsPerMinute`, 1, 1_000_000); if (!requestsPerMinute.ok) return requestsPerMinute;
  const concurrencyInput = get(object.value, "concurrency", path); if (!concurrencyInput.ok) return concurrencyInput;
  const concurrency = integerValue(concurrencyInput.value, `${path}.concurrency`, 1, 1_000); if (!concurrency.ok) return concurrency;
  const timeoutInput = get(object.value, "timeoutMs", path); if (!timeoutInput.ok) return timeoutInput;
  const timeoutMs = integerValue(timeoutInput.value, `${path}.timeoutMs`, 1, 300_000); if (!timeoutMs.ok) return timeoutMs;
  const retriesInput = get(object.value, "maxRetries", path); if (!retriesInput.ok) return retriesInput;
  const maxRetries = integerValue(retriesInput.value, `${path}.maxRetries`, 0, 20); if (!maxRetries.ok) return maxRetries;
  return valid({ incremental: incremental.value, fullReconcileIntervalSeconds: fullReconcileIntervalSeconds.value, deletionMode: deletionMode.value, deletionPropagationSeconds: deletionPropagationSeconds.value, freshnessSeconds: freshnessSeconds.value, requestsPerMinute: requestsPerMinute.value, concurrency: concurrency.value, timeoutMs: timeoutMs.value, maxRetries: maxRetries.value });
}

function parseHealthPolicy(input: unknown, path: string): InternalResult<SourceHealthPolicy> {
  const keys = ["maxSampleAgeSeconds", "maxSuccessAgeSeconds", "maxErrorBps", "maxParseErrorBps", "maxStaleBps", "maxLatencyP95Ms"] as const;
  const object = inspectObject(input, keys, path); if (!object.ok) return object;
  const bounds = [[1,315_360_000],[1,315_360_000],[0,10_000],[0,10_000],[0,10_000],[1,300_000]] as const;
  const values: number[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!; const inputValue = get(object.value, key, path); if (!inputValue.ok) return inputValue;
    const bound = bounds[index]!; const parsed = integerValue(inputValue.value, `${path}.${key}`, bound[0], bound[1]); if (!parsed.ok) return parsed;
    values.push(parsed.value);
  }
  return valid({ maxSampleAgeSeconds: values[0]!, maxSuccessAgeSeconds: values[1]!, maxErrorBps: values[2]!, maxParseErrorBps: values[3]!, maxStaleBps: values[4]!, maxLatencyP95Ms: values[5]! });
}

function parseConfiguration(input: unknown, path: string): InternalResult<SourceConfiguration> {
  const object = inspectObject(input, ["displayName", "territories", "acquisitionMethods", "credentials", "legalStatus", "policy", "operations", "healthPolicy"], path); if (!object.ok) return object;
  const nameInput = get(object.value, "displayName", path); if (!nameInput.ok) return nameInput;
  const displayName = parseDisplayName(nameInput.value, `${path}.displayName`); if (!displayName.ok) return displayName;
  const territoryInput = get(object.value, "territories", path); if (!territoryInput.ok) return territoryInput;
  const parsedTerritories = uniqueLiteralArray<Territory>(territoryInput.value, `${path}.territories`, territories); if (!parsedTerritories.ok) return parsedTerritories;
  const methodInput = get(object.value, "acquisitionMethods", path); if (!methodInput.ok) return methodInput;
  const methods = uniqueLiteralArray<AcquisitionMethod>(methodInput.value, `${path}.acquisitionMethods`, acquisitionMethods); if (!methods.ok) return methods;
  const credentialInput = get(object.value, "credentials", path); if (!credentialInput.ok) return credentialInput;
  const credentials = parseCredentials(credentialInput.value, `${path}.credentials`); if (!credentials.ok) return credentials;
  const legalInput = get(object.value, "legalStatus", path); if (!legalInput.ok) return legalInput;
  const legalStatus = literalValue<LegalStatus>(legalInput.value, legalStatuses, `${path}.legalStatus`); if (!legalStatus.ok) return legalStatus;
  const policyInput = get(object.value, "policy", path); if (!policyInput.ok) return policyInput;
  const policy = policyInput.value === null ? valid(null) : parsePolicy(policyInput.value, `${path}.policy`, parsedTerritories.value, methods.value);
  if (!policy.ok) return policy;
  const operationsInput = get(object.value, "operations", path); if (!operationsInput.ok) return operationsInput;
  const operations = parseOperations(operationsInput.value, `${path}.operations`); if (!operations.ok) return operations;
  const healthInput = get(object.value, "healthPolicy", path); if (!healthInput.ok) return healthInput;
  const healthPolicy = parseHealthPolicy(healthInput.value, `${path}.healthPolicy`); if (!healthPolicy.ok) return healthPolicy;
  return valid({ displayName: displayName.value, territories: [...parsedTerritories.value], acquisitionMethods: [...methods.value], credentials: credentials.value, legalStatus: legalStatus.value, policy: policy.value, operations: operations.value, healthPolicy: healthPolicy.value });
}

function parseEvent(input: unknown, path: string): InternalResult<SourceEvent> {
  const object = inspectObject(input, ["eventId", "kind", "actorRef", "at", "reasonRef"], path); if (!object.ok) return object;
  const eventInput = get(object.value, "eventId", path); if (!eventInput.ok) return eventInput;
  const eventId = prefixedReference(eventInput.value, `${path}.eventId`, "aud_"); if (!eventId.ok) return eventId;
  const kindInput = get(object.value, "kind", path); if (!kindInput.ok) return kindInput;
  const kind = literalValue<SourceEventKind>(kindInput.value, eventKinds, `${path}.kind`); if (!kind.ok) return kind;
  const actorInput = get(object.value, "actorRef", path); if (!actorInput.ok) return actorInput;
  const actorRef = prefixedReference(actorInput.value, `${path}.actorRef`, "actor_"); if (!actorRef.ok) return actorRef;
  const atInput = get(object.value, "at", path); if (!atInput.ok) return atInput;
  const at = parseTimestamp(atInput.value, `${path}.at`); if (!at.ok) return at;
  const reasonInput = get(object.value, "reasonRef", path); if (!reasonInput.ok) return reasonInput;
  const reasonRef = prefixedReference(reasonInput.value, `${path}.reasonRef`, "reason_"); if (!reasonRef.ok) return reasonRef;
  return valid({ eventId: eventId.value, kind: kind.value, actorRef: actorRef.value, at: at.value, reasonRef: reasonRef.value });
}

function parseRevision(input: unknown, path: string): InternalResult<SourceRevision> {
  const object = inspectObject(input, ["revision", "state", "configuration", "event"], path); if (!object.ok) return object;
  const revisionInput = get(object.value, "revision", path); if (!revisionInput.ok) return revisionInput;
  const revision = integerValue(revisionInput.value, `${path}.revision`, 1, 1_000); if (!revision.ok) return revision;
  const stateInput = get(object.value, "state", path); if (!stateInput.ok) return stateInput;
  const state = literalValue<SourceState>(stateInput.value, sourceStates, `${path}.state`); if (!state.ok) return state;
  const configurationInput = get(object.value, "configuration", path); if (!configurationInput.ok) return configurationInput;
  const configuration = parseConfiguration(configurationInput.value, `${path}.configuration`); if (!configuration.ok) return configuration;
  const eventInput = get(object.value, "event", path); if (!eventInput.ok) return eventInput;
  const event = parseEvent(eventInput.value, `${path}.event`); if (!event.ok) return event;
  return valid({ revision: revision.value, state: state.value, configuration: configuration.value, event: event.value });
}

function sameConfiguration(left: SourceConfiguration, right: SourceConfiguration): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function enableIssue(configuration: SourceConfiguration, at: string, path: string): InternalResult<true> {
  if (!permittedLegalStatuses.has(configuration.legalStatus)) return issue("invalid_value", `${path}.configuration.legalStatus`);
  const policy = configuration.policy;
  if (policy === null) return issue("invalid_value", `${path}.configuration.policy`);
  const auth = policy.authorization;
  if (auth.reviewedAt > at || auth.validFrom > at || at >= auth.validUntil) return issue("invalid_value", `${path}.event.at`);
  if (policy.retention.rawSeconds < 1 || policy.retention.normalizedSeconds < 1) return issue("invalid_value", `${path}.configuration.policy.retention`);
  if (configuration.legalStatus === "official_api" && configuration.acquisitionMethods.some((method) => method !== "api")) return issue("invalid_value", `${path}.configuration.acquisitionMethods`);
  if (configuration.legalStatus === "dealer_feed" && configuration.acquisitionMethods.some((method) => method !== "feed")) return issue("invalid_value", `${path}.configuration.acquisitionMethods`);
  if (configuration.legalStatus === "permitted_crawl" && configuration.acquisitionMethods.some((method) => method !== "crawl")) return issue("invalid_value", `${path}.configuration.acquisitionMethods`);
  const internals = policy.grants.filter((grant) => grant.audience === "internal");
  if (configuration.territories.some((territory) => !internals.some((grant) => grant.territory === territory))) return issue("invalid_value", `${path}.configuration.policy.grants`);
  if (configuration.acquisitionMethods.some((method) => !internals.some((grant) => grant.acquisitionMethod === method))) return issue("invalid_value", `${path}.configuration.policy.grants`);
  return valid(true);
}

function parseRegistryInternal(input: unknown, path: string): InternalResult<SourceRegistry> {
  const object = inspectObject(input, ["schemaVersion", "sourceId", "revisions"], path); if (!object.ok) return object;
  const versionInput = get(object.value, "schemaVersion", path); if (!versionInput.ok) return versionInput;
  const version = parseSchemaVersion(versionInput.value, `${path}.schemaVersion`); if (!version.ok) return version;
  const sourceInput = get(object.value, "sourceId", path); if (!sourceInput.ok) return sourceInput;
  const sourceId = parseSourceIdentifier(sourceInput.value, `${path}.sourceId`); if (!sourceId.ok) return sourceId;
  const revisionsInput = get(object.value, "revisions", path); if (!revisionsInput.ok) return revisionsInput;
  const array = inspectArray(revisionsInput.value, `${path}.revisions`, 1_000, 1); if (!array.ok) return array;
  const revisions: SourceRevision[] = [];
  const eventIds = new Set<string>();
  for (let index = 0; index < array.value.length; index += 1) {
    const revisionPath = `${path}.revisions[${index}]`;
    const revision = parseRevision(array.value[index], revisionPath); if (!revision.ok) return revision;
    if (revision.value.revision !== index + 1) return issue("invalid_value", `${revisionPath}.revision`);
    if (eventIds.has(revision.value.event.eventId)) return issue("duplicate_id", `${revisionPath}.event.eventId`);
    eventIds.add(revision.value.event.eventId);
    const previous = revisions[index - 1];
    if (previous === undefined) {
      if (revision.value.event.kind !== "create") return issue("invalid_value", `${revisionPath}.event.kind`);
      if (revision.value.state !== "disabled") return issue("invalid_value", `${revisionPath}.state`);
    } else {
      if (revision.value.event.at < previous.event.at) return issue("invalid_value", `${revisionPath}.event.at`);
      if (previous.state === "takedown") return issue("invalid_value", `${revisionPath}.state`);
      const unchanged = sameConfiguration(previous.configuration, revision.value.configuration);
      if (revision.value.event.kind === "replace_configuration") {
        if (revision.value.state !== "disabled") return issue("invalid_value", `${revisionPath}.state`);
        if (unchanged) return issue("invalid_value", `${revisionPath}.configuration`);
      } else {
        if (!unchanged) return issue("invalid_value", `${revisionPath}.configuration`);
        if (revision.value.event.kind === "enable") {
          if (previous.state !== "disabled" || revision.value.state !== "enabled") return issue("invalid_value", `${revisionPath}.state`);
          const enabled = enableIssue(revision.value.configuration, revision.value.event.at, revisionPath); if (!enabled.ok) return enabled;
        } else if (revision.value.event.kind === "disable") {
          if (previous.state !== "enabled" || revision.value.state !== "disabled") return issue("invalid_value", `${revisionPath}.state`);
        } else if (revision.value.event.kind === "takedown") {
          if (revision.value.state !== "takedown") return issue("invalid_value", `${revisionPath}.state`);
        } else {
          return issue("invalid_value", `${revisionPath}.event.kind`);
        }
      }
    }
    revisions.push(revision.value);
  }
  return valid(deepFreeze({ schemaVersion: 1, sourceId: sourceId.value, revisions }));
}

function parseRequest(input: unknown, path: string): InternalResult<PolicyEligibilityRequest> {
  const object = inspectObject(input, ["territory", "acquisitionMethod", "fields", "audience"], path); if (!object.ok) return object;
  const territoryInput = get(object.value, "territory", path); if (!territoryInput.ok) return territoryInput;
  const territory = literalValue<Territory>(territoryInput.value, territories, `${path}.territory`); if (!territory.ok) return territory;
  const methodInput = get(object.value, "acquisitionMethod", path); if (!methodInput.ok) return methodInput;
  const acquisitionMethod = literalValue<AcquisitionMethod>(methodInput.value, acquisitionMethods, `${path}.acquisitionMethod`); if (!acquisitionMethod.ok) return acquisitionMethod;
  const fieldsInput = get(object.value, "fields", path); if (!fieldsInput.ok) return fieldsInput;
  const fields = uniqueLiteralArray<SourceField>(fieldsInput.value, `${path}.fields`, sourceFields); if (!fields.ok) return fields;
  const audienceInput = get(object.value, "audience", path); if (!audienceInput.ok) return audienceInput;
  const audience = literalValue<Audience>(audienceInput.value, audiences, `${path}.audience`); if (!audience.ok) return audience;
  return valid({ territory: territory.value, acquisitionMethod: acquisitionMethod.value, fields: [...fields.value], audience: audience.value });
}

function ineligible(registry: SourceRegistry, asOf: string, reason: PolicyIneligibilityReason): PolicyEligibility {
  const latest = registry.revisions[registry.revisions.length - 1]!;
  return deepFreeze({ eligible: false, sourceId: registry.sourceId, revision: latest.revision, asOf, reason });
}

function parseHealthSample(input: unknown, path: string): InternalResult<SourceHealthSample> {
  const keys = ["sourceId", "windowStartAt", "windowEndAt", "lastSuccessAt", "requestCount", "itemCount", "errorBps", "parseErrorBps", "staleBps", "latencyP95Ms", "circuit"] as const;
  const object = inspectObject(input, keys, path); if (!object.ok) return object;
  const sourceInput = get(object.value, "sourceId", path); if (!sourceInput.ok) return sourceInput;
  const sourceId = parseSourceIdentifier(sourceInput.value, `${path}.sourceId`); if (!sourceId.ok) return sourceId;
  const startInput = get(object.value, "windowStartAt", path); if (!startInput.ok) return startInput;
  const windowStartAt = parseTimestamp(startInput.value, `${path}.windowStartAt`); if (!windowStartAt.ok) return windowStartAt;
  const endInput = get(object.value, "windowEndAt", path); if (!endInput.ok) return endInput;
  const windowEndAt = parseTimestamp(endInput.value, `${path}.windowEndAt`); if (!windowEndAt.ok) return windowEndAt;
  const successInput = get(object.value, "lastSuccessAt", path); if (!successInput.ok) return successInput;
  const lastSuccessAt = successInput.value === null ? valid(null) : parseTimestamp(successInput.value, `${path}.lastSuccessAt`); if (!lastSuccessAt.ok) return lastSuccessAt;
  const requestInput = get(object.value, "requestCount", path); if (!requestInput.ok) return requestInput;
  const requestCount = integerValue(requestInput.value, `${path}.requestCount`, 0, 1_000_000_000); if (!requestCount.ok) return requestCount;
  const itemInput = get(object.value, "itemCount", path); if (!itemInput.ok) return itemInput;
  const itemCount = integerValue(itemInput.value, `${path}.itemCount`, 0, 1_000_000_000); if (!itemCount.ok) return itemCount;
  const errorInput = get(object.value, "errorBps", path); if (!errorInput.ok) return errorInput;
  const errorBps = nullableInteger(errorInput.value, `${path}.errorBps`, 0, 10_000); if (!errorBps.ok) return errorBps;
  const parseInput = get(object.value, "parseErrorBps", path); if (!parseInput.ok) return parseInput;
  const parseErrorBps = nullableInteger(parseInput.value, `${path}.parseErrorBps`, 0, 10_000); if (!parseErrorBps.ok) return parseErrorBps;
  const staleInput = get(object.value, "staleBps", path); if (!staleInput.ok) return staleInput;
  const staleBps = nullableInteger(staleInput.value, `${path}.staleBps`, 0, 10_000); if (!staleBps.ok) return staleBps;
  const latencyInput = get(object.value, "latencyP95Ms", path); if (!latencyInput.ok) return latencyInput;
  const latencyP95Ms = nullableInteger(latencyInput.value, `${path}.latencyP95Ms`, 0, 300_000); if (!latencyP95Ms.ok) return latencyP95Ms;
  const circuitInput = get(object.value, "circuit", path); if (!circuitInput.ok) return circuitInput;
  const circuit = literalValue<CircuitState>(circuitInput.value, ["closed", "open", "half_open"] as const, `${path}.circuit`); if (!circuit.ok) return circuit;
  if (windowStartAt.value >= windowEndAt.value) return issue("invalid_value", `${path}.windowEndAt`);
  if (lastSuccessAt.value !== null && lastSuccessAt.value > windowEndAt.value) return issue("invalid_value", `${path}.lastSuccessAt`);
  if (requestCount.value === 0 && errorBps.value !== null) return issue("invalid_value", `${path}.errorBps`);
  if (requestCount.value === 0 && latencyP95Ms.value !== null) return issue("invalid_value", `${path}.latencyP95Ms`);
  if (itemCount.value === 0 && parseErrorBps.value !== null) return issue("invalid_value", `${path}.parseErrorBps`);
  if (itemCount.value === 0 && staleBps.value !== null) return issue("invalid_value", `${path}.staleBps`);
  return valid({ sourceId: sourceId.value, windowStartAt: windowStartAt.value, windowEndAt: windowEndAt.value, lastSuccessAt: lastSuccessAt.value, requestCount: requestCount.value, itemCount: itemCount.value, errorBps: errorBps.value, parseErrorBps: parseErrorBps.value, staleBps: staleBps.value, latencyP95Ms: latencyP95Ms.value, circuit: circuit.value });
}

export function parseSourceRegistry(input: unknown): ValidationResult<SourceRegistry> {
  return publicResult(parseRegistryInternal(input, "$"));
}

export function appendSourceRevision(registry: unknown, nextRevision: unknown): ValidationResult<SourceRegistry> {
  const current = parseRegistryInternal(registry, "$.registry"); if (!current.ok) return publicResult(current);
  const next = parseRevision(nextRevision, "$.nextRevision"); if (!next.ok) return publicResult(next);
  const latest = current.value.revisions[current.value.revisions.length - 1]!;
  if (next.value.revision === latest.revision && JSON.stringify(next.value) === JSON.stringify(latest)) return publicResult(valid(current.value));
  if (next.value.revision !== latest.revision + 1) return publicResult(issue("invalid_value", "$.nextRevision.revision"));
  const appended = parseRegistryInternal(
    {
      schemaVersion: 1,
      sourceId: current.value.sourceId,
      revisions: [...current.value.revisions, next.value],
    },
    "$",
  );
  if (!appended.ok) {
    const revisionPath = `$.revisions[${current.value.revisions.length}]`;
    const mappedPath = appended.issue.path.startsWith(revisionPath)
      ? `$.nextRevision${appended.issue.path.slice(revisionPath.length)}`
      : appended.issue.path;
    return publicResult(issue(appended.issue.code, mappedPath));
  }
  return publicResult(appended);
}

export function evaluatePolicyEligibility(registry: unknown, request: unknown, now: unknown): ValidationResult<PolicyEligibility> {
  const parsedRegistry = parseRegistryInternal(registry, "$.registry"); if (!parsedRegistry.ok) return publicResult(parsedRegistry);
  const parsedRequest = parseRequest(request, "$.request"); if (!parsedRequest.ok) return publicResult(parsedRequest);
  const asOf = parseTimestamp(now, "$.now"); if (!asOf.ok) return publicResult(asOf);
  const latest = parsedRegistry.value.revisions[parsedRegistry.value.revisions.length - 1]!;
  if (latest.event.at > asOf.value) return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "future_revision")));
  if (latest.state === "takedown") return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "takedown")));
  if (latest.state !== "enabled") return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "disabled")));
  if (!permittedLegalStatuses.has(latest.configuration.legalStatus)) return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "legal_status")));
  const policy = latest.configuration.policy;
  if (policy === null) return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "missing_policy")));
  const auth = policy.authorization;
  if (auth.reviewedAt > asOf.value || auth.validFrom > asOf.value || asOf.value >= auth.validUntil) return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "policy_not_current")));
  if (parsedRequest.value.audience !== "internal" && (parsedRequest.value.fields.includes("vin") || parsedRequest.value.fields.includes("seller_pii"))) return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "internal_only_field")));
  const clause = policy.grants.find((grant) => grant.territory === parsedRequest.value.territory && grant.acquisitionMethod === parsedRequest.value.acquisitionMethod && grant.audience === parsedRequest.value.audience && parsedRequest.value.fields.every((field) => grant.fields.includes(field)));
  if (clause === undefined) return publicResult(valid(ineligible(parsedRegistry.value, asOf.value, "scope_not_granted")));
  return publicResult(valid(deepFreeze({ eligible: true, sourceId: parsedRegistry.value.sourceId, revision: latest.revision, asOf: asOf.value, policy })));
}

export function deriveSourceHealth(registry: unknown, sample: unknown, now: unknown): ValidationResult<SourceHealth> {
  const parsedRegistry = parseRegistryInternal(registry, "$.registry"); if (!parsedRegistry.ok) return publicResult(parsedRegistry);
  const parsedSample = parseHealthSample(sample, "$.sample"); if (!parsedSample.ok) return publicResult(parsedSample);
  const asOf = parseTimestamp(now, "$.now"); if (!asOf.ok) return publicResult(asOf);
  const latest = parsedRegistry.value.revisions[parsedRegistry.value.revisions.length - 1]!;
  if (parsedSample.value.sourceId !== parsedRegistry.value.sourceId) return publicResult(issue("invalid_value", "$.sample.sourceId"));
  if (parsedSample.value.windowEndAt > asOf.value) return publicResult(issue("invalid_value", "$.sample.windowEndAt"));
  if (latest.event.at > asOf.value) return publicResult(issue("invalid_value", "$.now"));
  const policy = latest.configuration.healthPolicy;
  const reasons: SourceHealthReason[] = [];
  const noSuccess = parsedSample.value.lastSuccessAt === null;
  const staleSuccess = !noSuccess && milliseconds(asOf.value) - milliseconds(parsedSample.value.lastSuccessAt!) > policy.maxSuccessAgeSeconds * 1_000;
  const staleSample = milliseconds(asOf.value) - milliseconds(parsedSample.value.windowEndAt) > policy.maxSampleAgeSeconds * 1_000;
  const missing =
    parsedSample.value.errorBps === null ||
    parsedSample.value.parseErrorBps === null ||
    parsedSample.value.staleBps === null ||
    parsedSample.value.latencyP95Ms === null;
  const errorRate = parsedSample.value.errorBps !== null && parsedSample.value.errorBps > policy.maxErrorBps;
  const parseRate = parsedSample.value.parseErrorBps !== null && parsedSample.value.parseErrorBps > policy.maxParseErrorBps;
  const staleRatio = parsedSample.value.staleBps !== null && parsedSample.value.staleBps > policy.maxStaleBps;
  const latency = parsedSample.value.latencyP95Ms !== null && parsedSample.value.latencyP95Ms > policy.maxLatencyP95Ms;
  if (parsedSample.value.circuit === "open") reasons.push("circuit_open");
  if (noSuccess) reasons.push("no_success");
  if (staleSuccess) reasons.push("stale_success");
  if (staleSample) reasons.push("stale_sample");
  if (missing) reasons.push("missing_measurements");
  if (parsedSample.value.circuit === "half_open") reasons.push("circuit_half_open");
  if (errorRate) reasons.push("error_rate");
  if (parseRate) reasons.push("parse_error_rate");
  if (staleRatio) reasons.push("stale_ratio");
  if (latency) reasons.push("latency");
  const status = parsedSample.value.circuit === "open" || noSuccess || staleSuccess
    ? "unhealthy"
    : staleSample || missing
      ? "unknown"
      : parsedSample.value.circuit === "half_open" || errorRate || parseRate || staleRatio || latency
        ? "degraded"
        : "healthy";
  return publicResult(valid(deepFreeze({ sourceId: parsedRegistry.value.sourceId, revision: latest.revision, asOf: asOf.value, status, reasons })));
}
