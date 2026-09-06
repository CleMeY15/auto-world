import {
  evaluatePolicyEligibility,
  parseSourceRegistry,
  type SourceConfiguration,
  type SourceOperations,
} from "@auto-world/source-registry";
import type {
  ConnectorErrorCode,
  ConnectorRunRequest,
  PolicyObligations,
  VerifiedSourceHead,
} from "./types.js";

export type AuthorityCheckResult =
  | {
      readonly success: true;
      readonly head: VerifiedSourceHead;
      readonly registryRevision: number;
      readonly configuration: SourceConfiguration;
      readonly operations: SourceOperations;
      readonly obligations: PolicyObligations;
    }
  | { readonly success: false; readonly code: ConnectorErrorCode };

function readPlainObject(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (typeof input !== "object" || input === null) return null;
  try {
    if (Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== expectedKeys.length) return null;
    const expected = new Set(expectedKeys);
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string" || !expected.has(key)) return null;
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

export function verifyAuthorityHead(
  input: unknown,
  request: ConnectorRunRequest,
  asOf: string,
): AuthorityCheckResult {
  const object = readPlainObject(input, [
    "trust",
    "registry",
    "authorityRevision",
    "verifiedAsOf",
    "authorizationBasisRef",
  ]);
  if (object === null || object.trust !== "authenticated_current") {
    return { success: false, code: "authority_untrusted" };
  }
  if (
    typeof object.authorityRevision !== "number" ||
    !Number.isSafeInteger(object.authorityRevision) ||
    object.authorityRevision < 1 ||
    Object.is(object.authorityRevision, -0) ||
    object.verifiedAsOf !== asOf ||
    typeof object.authorizationBasisRef !== "string"
  ) {
    return { success: false, code: "authority_untrusted" };
  }

  const registry = parseSourceRegistry(object.registry);
  if (!registry.success) return { success: false, code: "authority_untrusted" };
  if (registry.data.sourceId !== request.sourceId) {
    return { success: false, code: "authority_regression" };
  }
  const latest = registry.data.revisions[registry.data.revisions.length - 1];
  if (latest === undefined || object.authorityRevision !== latest.revision) {
    return { success: false, code: "authority_regression" };
  }

  const eligibility = evaluatePolicyEligibility(
    registry.data,
    {
      territory: request.territory,
      acquisitionMethod: request.acquisitionMethod,
      fields: request.fields,
      audience: request.audience,
    },
    asOf,
  );
  if (!eligibility.success) return { success: false, code: "authority_untrusted" };
  if (!eligibility.data.eligible) return { success: false, code: "policy_ineligible" };
  if (
    object.authorizationBasisRef !==
    eligibility.data.policy.authorization.basisRef
  ) {
    return { success: false, code: "authority_untrusted" };
  }
  const grant = eligibility.data.policy.grants.find(
    (candidate) =>
      candidate.audience === "internal" &&
      candidate.territory === request.territory &&
      candidate.acquisitionMethod === request.acquisitionMethod &&
      request.fields.every((field) => candidate.fields.includes(field)),
  );
  if (grant === undefined || grant.audience !== "internal") {
    return { success: false, code: "policy_ineligible" };
  }
  const internalGrant = Object.freeze({
    audience: "internal" as const,
    territory: request.territory,
    acquisitionMethod: request.acquisitionMethod,
    fields: request.fields,
  });

  return {
    success: true,
    head: Object.freeze({
      trust: "authenticated_current",
      registry: registry.data,
      authorityRevision: object.authorityRevision,
      verifiedAsOf: asOf,
      authorizationBasisRef: object.authorizationBasisRef,
    }),
    registryRevision: latest.revision,
    configuration: latest.configuration,
    operations: latest.configuration.operations,
    obligations: Object.freeze({
      grant: internalGrant,
      legalStatus: latest.configuration.legalStatus,
      authorizationBasisRef: object.authorizationBasisRef,
      authorizationValidUntil: eligibility.data.policy.authorization.validUntil,
      caching: eligibility.data.policy.caching,
      retention: eligibility.data.policy.retention,
      media: eligibility.data.policy.media,
      pii: eligibility.data.policy.pii,
      takedown: eligibility.data.policy.takedown,
    }),
  };
}
