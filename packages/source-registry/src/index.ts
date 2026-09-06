export const workspaceBoundary = {
  name: "@auto-world/source-registry",
  kind: "package",
  status: "active",
} as const;

export {
  appendSourceRevision,
  deriveSourceHealth,
  evaluatePolicyEligibility,
  parseSourceRegistry,
} from "./parsers.js";

export type {
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
  SourceHealthStatus,
  SourceOperations,
  SourceRegistry,
  SourceRevision,
  SourceState,
  TakedownPolicy,
  Territory,
} from "./types.js";
