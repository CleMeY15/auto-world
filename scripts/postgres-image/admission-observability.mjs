const ERROR = "postgres_admission_observability_invalid";
const SINK_ERROR = "postgres_admission_observability_sink_failed";

const RESULTS = Object.freeze(["SUCCEEDED", "FAILED"]);
const LEASE_STATES = Object.freeze(["ABSENT", "CURRENT", "RENEWING", "DRAINING", "EXPIRED", "REVOKED", "STOPPED"]);
const INTENTS = Object.freeze(["SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP", "RESTORE_VERIFY"]);
const PHASES = Object.freeze(["AUTHORITY", "IMAGE_ACQUIRE", "DAEMON_START", "IMAGE_LOAD", "VOLUME_CREATE",
  "CONTAINER_CREATE", "CONTAINER_START", "READINESS", "SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP",
  "RESTORE_VERIFY", "STOP", "CLEANUP"]);
const REASONS = Object.freeze(["NONE", "PENDING", "REVOKED", "SUPPORT_EXPIRED", "NETWORK_FAILURE",
  "PROTECTION_FAILURE", "HEAD_CHANGED", "AUTHORITY_INVALID", "P2_STALE", "P3_SETTINGS_STALE",
  "P3_MANIFEST_STALE", "ARCHIVE_STALE", "ARCHIVE_MISMATCH", "SOCKET_SUBSTITUTED", "DAEMON_SUBSTITUTED",
  "DEADLINE_EXCEEDED", "CANCELLED", "DRAIN_TIMEOUT", "CLEANUP_UNCERTAIN", "OPERATION_FAILED"]);
const ALERTS = Object.freeze(["RENEWAL_FAILURE", "PROTECTION_FAILURE", "HEAD_FAILURE", "NETWORK_FAILURE",
  "PENDING_WITH_OWNED_SERVICE", "REVOKED_WITH_OWNED_SERVICE", "P2_WARNING", "P2_EXPIRED", "P3_SETTINGS_WARNING",
  "P3_SETTINGS_EXPIRED", "P3_MANIFEST_WARNING", "P3_MANIFEST_EXPIRED", "ARCHIVE_WARNING", "ARCHIVE_EXPIRED",
  "SOCKET_SUBSTITUTION", "DAEMON_SUBSTITUTION", "DRAIN_TIMEOUT", "CLEANUP_UNCERTAINTY"]);
const SEVERITIES = Object.freeze(["WARNING", "ERROR", "CRITICAL"]);
const COUNTERS = Object.freeze(["postgres_admission_authority_checks_total", "postgres_admission_renewals_total",
  "postgres_admission_sessions_total", "postgres_admission_phases_total", "postgres_admission_drains_total"]);
const GAUGES = Object.freeze(["postgres_admission_lease_state", "postgres_admission_p2_seconds_remaining",
  "postgres_admission_p3_settings_seconds_remaining", "postgres_admission_p3_manifest_seconds_remaining",
  "postgres_admission_archive_health_seconds_remaining", "postgres_admission_support_seconds_remaining"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const PUBLIC_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[1-9][0-9]{0,19}|[A-Z][A-Z0-9_]{0,63})$/u;
const SENSITIVE_PUBLIC_ID = /(?:TOKEN|AUTHORIZATION|COOKIE|ENVIRONMENT|PASSWORD|SECRET|SQL|PATH|RECEIPT|STDOUT|STDERR)/u;

function fail(code = ERROR) { throw new Error(code); }
function enumeration(value, allowed) { if (typeof value !== "string" || !allowed.includes(value)) fail(); return value; }
function finite(value) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(); return value; }
function integer(value) { if (!Number.isSafeInteger(value) || value < 0) fail(); return value; }
function sha256(value) { if (value !== null && (typeof value !== "string" || !SHA256.test(value))) fail(); return value; }
function publicId(value) {
  if (value !== null && (typeof value !== "string" || !PUBLIC_ID.test(value) || SENSITIVE_PUBLIC_ID.test(value))) fail();
  return value;
}
function exact(value, keys) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) fail();
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    return [key, descriptor.value];
  }));
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function labels(value, allowed) {
  const keys = Object.keys(value).sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== [...allowed].sort()[index])) fail();
  return freeze({ ...value });
}
function labelKey(value) { return Object.entries(value).map(([key, item]) => `${key}=${item}`).join(","); }

export function createPostgresAdmissionObservability(options) {
  const { emit } = exact(options, ["emit"]);
  if (typeof emit !== "function") fail();
  const counters = new Map(), gauges = new Map();
  const publish = body => {
    const event = freeze({ kind: "POSTGRES_ADMISSION_OBSERVABILITY_EVENT_V1", observedAt: new Date().toISOString(), ...body });
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line) > 4096) fail();
    try { if (emit(line) !== undefined) fail(SINK_ERROR); } catch { fail(SINK_ERROR); }
    return event;
  };
  const addCounter = (name, metricLabels, amount = 1) => {
    enumeration(name, COUNTERS); integer(amount); if (amount === 0) fail();
    const key = `${name}{${labelKey(metricLabels)}}`; counters.set(key, (counters.get(key) ?? 0) + amount);
  };
  const setGauge = (name, metricLabels, value) => {
    enumeration(name, GAUGES); finite(value); gauges.set(`${name}{${labelKey(metricLabels)}}`, value);
  };
  const api = freeze({
    authorityCheck(value) {
      const item = exact(value, ["result", "reason", "durationMs", "authoritySha256"]);
      enumeration(item.result, RESULTS); enumeration(item.reason, REASONS); finite(item.durationMs); sha256(item.authoritySha256);
      const metricLabels = labels({ result: item.result, reason: item.reason }, ["result", "reason"]);
      const event = publish({ type: "AUTHORITY_CHECK", ...item }); addCounter(COUNTERS[0], metricLabels); return event;
    },
    leaseState(value) {
      const item = exact(value, ["state"]); enumeration(item.state, LEASE_STATES);
      const event = publish({ type: "LEASE_STATE", ...item });
      for (const state of LEASE_STATES) setGauge(GAUGES[0], labels({ state }, ["state"]), state === item.state ? 1 : 0);
      return event;
    },
    renewal(value) {
      const item = exact(value, ["result", "reason", "durationMs"]);
      enumeration(item.result, RESULTS); enumeration(item.reason, REASONS); finite(item.durationMs);
      const metricLabels = labels({ result: item.result, reason: item.reason }, ["result", "reason"]);
      const event = publish({ type: "RENEWAL", ...item }); addCounter(COUNTERS[1], metricLabels); return event;
    },
    session(value) {
      const item = exact(value, ["intent", "result", "reason", "durationMs"]);
      enumeration(item.intent, INTENTS); enumeration(item.result, RESULTS); enumeration(item.reason, REASONS); finite(item.durationMs);
      const metricLabels = labels({ intent: item.intent, result: item.result, reason: item.reason }, ["intent", "result", "reason"]);
      const event = publish({ type: "SESSION", ...item }); addCounter(COUNTERS[2], metricLabels); return event;
    },
    phase(value) {
      const item = exact(value, ["phase", "result", "reason", "durationMs"]);
      enumeration(item.phase, PHASES); enumeration(item.result, RESULTS); enumeration(item.reason, REASONS); finite(item.durationMs);
      const metricLabels = labels({ phase: item.phase, result: item.result, reason: item.reason }, ["phase", "result", "reason"]);
      const event = publish({ type: "PHASE", ...item }); addCounter(COUNTERS[3], metricLabels); return event;
    },
    drain(value) {
      const item = exact(value, ["result", "reason", "durationMs"]);
      enumeration(item.result, RESULTS); enumeration(item.reason, REASONS); finite(item.durationMs);
      const metricLabels = labels({ result: item.result, reason: item.reason }, ["result", "reason"]);
      const event = publish({ type: "DRAIN", ...item }); addCounter(COUNTERS[4], metricLabels); return event;
    },
    currentness(value) {
      const item = exact(value, ["p2SecondsRemaining", "p3SettingsSecondsRemaining", "p3ManifestSecondsRemaining",
        "archiveHealthSecondsRemaining", "supportSecondsRemaining"]);
      for (const number of Object.values(item)) finite(number);
      const event = publish({ type: "CURRENTNESS", ...item });
      for (const [index, number] of Object.values(item).entries()) setGauge(GAUGES[index + 1], freeze({}), number);
      return event;
    },
    alert(value) {
      const item = exact(value, ["alert", "severity", "reason", "durationMs", "publicId"]);
      enumeration(item.alert, ALERTS); enumeration(item.severity, SEVERITIES); enumeration(item.reason, REASONS);
      finite(item.durationMs); publicId(item.publicId); return publish({ type: "ALERT", ...item });
    },
    snapshot() {
      return freeze({ counters: [...counters].sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => ({ name, value })),
        gauges: [...gauges].sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => ({ name, value })) });
    },
  });
  return api;
}
