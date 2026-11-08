import { setTimeout as wait } from "node:timers/promises";

import { serviceHealth as inspectServiceHealth } from "../data-infra/probes.mjs";

const EXPECTED_SERVICES = Object.freeze(["postgres", "redis", "opensearch", "object-store"]);
const EXPECTED = new Set(EXPECTED_SERVICES);
const TIMEOUT = "prototype_web_usable_readiness_timeout";
const INVALID = "prototype_web_usable_readiness_invalid";

function invalid() {
  const error = new Error(INVALID);
  error.name = INVALID;
  throw error;
}

function optionalString(value, pattern) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !pattern.test(value)) invalid();
  return value;
}

function sanitize(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)
      || !EXPECTED.has(entry.service) || !["passed", "failed"].includes(entry.status)) invalid();
  const phase = optionalString(entry.phase, /^[a-z][a-z0-9_-]{0,63}$/u);
  const code = optionalString(entry.code, /^[a-z][a-z0-9_]{0,63}$/u);
  const reason = optionalString(entry.reason, /^[A-Za-z0-9_]{1,64}$/u);
  const apiCode = optionalString(entry.apiCode, /^[A-Za-z0-9_]{1,64}$/u);
  if (entry.accessDenied !== undefined && typeof entry.accessDenied !== "boolean") invalid();
  if (entry.durationMs !== undefined && (!Number.isFinite(entry.durationMs) || entry.durationMs < 0)) invalid();
  return Object.freeze({ service: entry.service, status: entry.status,
    ...(phase === undefined ? {} : { phase }), ...(code === undefined ? {} : { code }),
    ...(reason === undefined ? {} : { reason }), ...(entry.accessDenied === undefined ? {} : { accessDenied: entry.accessDenied }),
    ...(apiCode === undefined ? {} : { apiCode }),
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }) });
}

function inspect(input) {
  if (!Array.isArray(input) || input.length !== EXPECTED_SERVICES.length) invalid();
  const seen = new Set();
  const health = input.map((entry) => {
    const value = sanitize(entry);
    if (seen.has(value.service)) invalid();
    seen.add(value.service);
    return value;
  });
  if (EXPECTED_SERVICES.some((service) => !seen.has(service))) invalid();
  return Object.freeze(health);
}

function failureSignature(entry) {
  return JSON.stringify({ service: entry.service, status: entry.status, phase: entry.phase,
    code: entry.code, reason: entry.reason, accessDenied: entry.accessDenied, apiCode: entry.apiCode });
}

function timeout(health) {
  const error = new Error(TIMEOUT);
  error.name = TIMEOUT;
  Object.defineProperty(error, "health", { value: health, enumerable: true });
  return error;
}

export async function waitForWebServices(state, dependencies = {}) {
  const serviceHealth = dependencies.serviceHealth ?? inspectServiceHealth;
  const now = dependencies.now ?? Date.now;
  const delay = dependencies.delay ?? ((milliseconds) => wait(milliseconds));
  const onDiagnostic = dependencies.onDiagnostic ?? ((health) => {
    console.error(JSON.stringify({ event: "prototype_web_usable_readiness_wait", health }));
  });
  const startedAt = now();
  const deadlineAt = Math.min(state.deadlineAt ?? Number.POSITIVE_INFINITY, startedAt + 120_000);
  const diagnostics = new Set();
  let lastHealth = Object.freeze([]);
  while (now() < deadlineAt) {
    lastHealth = inspect(await serviceHealth({ ...state, deadlineAt }));
    if (lastHealth.every((entry) => entry.status === "passed")) {
      if (now() < deadlineAt) return lastHealth;
      throw timeout(lastHealth);
    }
    for (const entry of lastHealth) {
      if (entry.status !== "failed") continue;
      const signature = failureSignature(entry);
      if (!diagnostics.has(signature)) {
        diagnostics.add(signature);
        onDiagnostic(entry);
      }
    }
    const remaining = deadlineAt - now();
    if (remaining <= 0) break;
    await delay(Math.min(1_000, remaining));
  }
  throw timeout(lastHealth);
}
