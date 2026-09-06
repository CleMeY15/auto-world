export const SYNTHETIC_NOW = "2026-09-06T12:00:00.000Z";

export function syntheticPolicy(overrides = {}) {
  const {
    authorization: authorizationOverrides = {},
    caching: cachingOverrides = {},
    retention: retentionOverrides = {},
    media: mediaOverrides = {},
    pii: piiOverrides = {},
    takedown: takedownOverrides = {},
    ...policyOverrides
  } = overrides;
  return {
    authorization: {
      basisRef: "evidence_synthetic_contract",
      reviewerRef: "actor_synthetic_reviewer",
      reviewedAt: "2026-01-01T00:00:00.000Z",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      ...authorizationOverrides,
    },
    grants: [
      {
        territory: "FR",
        acquisitionMethod: "feed",
        audience: "internal",
        fields: ["source_listing_id", "price", "mileage"],
      },
      {
        territory: "FR",
        acquisitionMethod: "feed",
        audience: "consumer",
        fields: ["source_listing_id", "price"],
      },
    ],
    caching: { allowed: true, maxAgeSeconds: 3_600, ...cachingOverrides },
    retention: {
      rawSeconds: 86_400,
      normalizedSeconds: 172_800,
      mediaSeconds: 0,
      piiSeconds: 0,
      ...retentionOverrides,
    },
    media: { mode: "none", attributionRequired: false, ...mediaOverrides },
    pii: { mode: "none", purposeRef: null, ...piiOverrides },
    takedown: {
      contactRef: "contact_synthetic_legal",
      procedureRef: "procedure_synthetic_takedown",
      maxResponseSeconds: 86_400,
      ...takedownOverrides,
    },
    ...policyOverrides,
  };
}

export function syntheticConfiguration(overrides = {}) {
  const {
    operations: operationsOverrides = {},
    healthPolicy: healthOverrides = {},
    ...configurationOverrides
  } = overrides;
  return {
    displayName: "Synthetic dealer feed",
    territories: ["FR"],
    acquisitionMethods: ["feed"],
    credentials: { kind: "secret_ref", ref: "secret://auto-world/synthetic_feed" },
    legalStatus: "dealer_feed",
    policy: syntheticPolicy(),
    operations: {
      incremental: true,
      fullReconcileIntervalSeconds: 86_400,
      deletionMode: "both",
      deletionPropagationSeconds: 3_600,
      freshnessSeconds: 7_200,
      requestsPerMinute: 120,
      concurrency: 4,
      timeoutMs: 10_000,
      maxRetries: 3,
      ...operationsOverrides,
    },
    healthPolicy: {
      maxSampleAgeSeconds: 900,
      maxSuccessAgeSeconds: 1_800,
      maxErrorBps: 100,
      maxParseErrorBps: 100,
      maxStaleBps: 500,
      maxLatencyP95Ms: 2_000,
      ...healthOverrides,
    },
    ...configurationOverrides,
  };
}

export function syntheticEvent(overrides = {}) {
  return {
    eventId: "aud_synthetic_create",
    kind: "create",
    actorRef: "actor_synthetic_operator",
    at: "2026-01-01T00:00:00.000Z",
    reasonRef: "reason_synthetic_bootstrap",
    ...overrides,
  };
}

export function syntheticRevision(overrides = {}) {
  return {
    revision: 1,
    state: "disabled",
    configuration: syntheticConfiguration(),
    event: syntheticEvent(),
    ...overrides,
  };
}

export function syntheticRegistry(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceId: "src_synthetic_feed",
    revisions: [syntheticRevision()],
    ...overrides,
  };
}

export function syntheticEnabledRegistry(overrides = {}) {
  const configuration = syntheticConfiguration();
  return syntheticRegistry({
    revisions: [
      syntheticRevision({ configuration }),
      syntheticRevision({
        revision: 2,
        state: "enabled",
        configuration: cloneSynthetic(configuration),
        event: syntheticEvent({
          eventId: "aud_synthetic_enable",
          kind: "enable",
          at: "2026-01-02T00:00:00.000Z",
          reasonRef: "reason_synthetic_enable",
        }),
      }),
    ],
    ...overrides,
  });
}

export function syntheticRequest(overrides = {}) {
  return {
    territory: "FR",
    acquisitionMethod: "feed",
    fields: ["source_listing_id", "price"],
    audience: "consumer",
    ...overrides,
  };
}

export function syntheticHealthSample(overrides = {}) {
  return {
    sourceId: "src_synthetic_feed",
    windowStartAt: "2026-09-06T11:50:00.000Z",
    windowEndAt: "2026-09-06T11:59:00.000Z",
    lastSuccessAt: "2026-09-06T11:58:00.000Z",
    requestCount: 100,
    itemCount: 1_000,
    errorBps: 10,
    parseErrorBps: 10,
    staleBps: 20,
    latencyP95Ms: 500,
    circuit: "closed",
    ...overrides,
  };
}

export function cloneSynthetic(value) {
  return JSON.parse(JSON.stringify(value));
}
