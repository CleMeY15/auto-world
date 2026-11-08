import path from "node:path";
import { fileURLToPath } from "node:url";

import { protectedRecovery, operationSignal, withCancellation } from "../data-infra/cancellation.mjs";
import { initProject, loadProject, stop, withProjectLock } from "../data-infra/runtime.mjs";
import { assertPrototypeExecution, DEFAULT_PORT, openApplication, prepareApplication } from "./runtime.mjs";

const TEST_PROJECT = /^aw-test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SEARCH_EVENTS = new Set(["published", "retry", "halted", "database_unavailable", "lag_warning"]);
const API_CODES = new Set(["read_unavailable", "cancelled"]);

function safeNumber(value) { return Number.isFinite(value) && value >= 0 ? value : undefined; }
function safeInteger(value) { return Number.isSafeInteger(value) && value >= 0 ? value : undefined; }

export function createCliEventSink(output = (value) => console.log(JSON.stringify(value))) {
  return (input) => {
    if (typeof input !== "object" || input === null || Array.isArray(input) || typeof input.name !== "string") return;
    if (SEARCH_EVENTS.has(input.name)) {
      const event = { event: "prototype_application_signal", name: input.name };
      const attempt = safeInteger(input.attempt); const documents = safeInteger(input.documents);
      const durationMs = safeNumber(input.durationMs); const lagMs = safeNumber(input.lagMs);
      if (attempt !== undefined) event.attempt = attempt;
      if (documents !== undefined) event.documents = documents;
      if (durationMs !== undefined) event.durationMs = durationMs;
      if (lagMs !== undefined) event.lagMs = lagMs;
      output(event);
      return;
    }
    if (input.name === "api.failure" && ["/v1/demo/search", "/v1/demo/listings/:listingId", "/v2/demo/catalog",
      "/v2/demo/search", "/v2/demo/listings/:listingId"].includes(input.route)
      && Number.isInteger(input.status) && input.status >= 500 && input.status <= 599 && API_CODES.has(input.code)) {
      output({ event: "prototype_application_signal", name: input.name, route: input.route, status: input.status, code: input.code });
      return;
    }
    if (input.name === "application_health" && safeInteger(input.pending) !== undefined
      && safeNumber(input.lagMs) !== undefined && ["none", "warning", "critical"].includes(input.alert)) {
      output({ event: "prototype_application_signal", name: input.name, pending: input.pending,
        lagMs: input.lagMs, alert: input.alert });
    }
  };
}

export function parseArguments(args) {
  const options = { port: DEFAULT_PORT, seed: false, consume: true };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--seed" || name === "--no-consume") {
      if (seen.has(name)) throw new Error("prototype_application_arguments_invalid");
      seen.add(name);
      if (name === "--seed") options.seed = true;
      else options.consume = false;
      continue;
    }
    const value = args[++index];
    if (typeof value !== "string" || value.startsWith("--")) throw new Error("prototype_application_arguments_invalid");
    if (seen.has(name)) throw new Error("prototype_application_arguments_invalid");
    seen.add(name);
    if (name === "--project" && TEST_PROJECT.test(value)) options.project = value;
    else if (name === "--port" && /^[0-9]{1,5}$/u.test(value) && Number(value) > 0 && Number(value) <= 65_535
      && ![3_100, 3_210].includes(Number(value))) options.port = Number(value);
    else throw new Error("prototype_application_arguments_invalid");
  }
  return Object.freeze(options);
}

export async function runServer(args, dependencies = {}) {
  const selected = parseArguments(args);
  (dependencies.assertPrototypeExecution ?? assertPrototypeExecution)(dependencies);
  const signal = dependencies.signal ?? operationSignal();
  if (signal === undefined) throw new Error("prototype_application_signal_missing");
  if (signal.aborted) throw new Error("prototype_application_cancelled");
  const initialize = dependencies.initProject ?? initProject;
  const load = dependencies.loadProject ?? loadProject;
  const prepare = dependencies.prepareApplication ?? prepareApplication;
  const open = dependencies.openApplication ?? openApplication;
  const lock = dependencies.withProjectLock ?? withProjectLock;
  const stopServices = dependencies.stop ?? stop;
  const emit = dependencies.emit ?? ((value) => console.log(JSON.stringify(value)));
  const onEvent = dependencies.onEvent ?? createCliEventSink(emit);
  let state;
  let application;
  let failure;
  try {
    state = selected.project === undefined ? await initialize({ test: true }) : await load(selected.project);
    emit({ event: "prototype_application_project", project: state.project, port: selected.port });
    await prepare(state);
    if (signal.aborted) throw new Error("prototype_application_cancelled");
    application = await open(state, { port: selected.port, seed: selected.seed, consume: selected.consume, onEvent, signal });
    if (signal.aborted) throw new Error("prototype_application_cancelled");
    emit({ event: "prototype_application_ready", project: state.project, port: application.port });
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  } catch (error) {
    failure = error;
  }
  if (application !== undefined) {
    await protectedRecovery(async () => {
      try { await application?.close(); } catch (error) { failure ??= error; }
      try { await lock(state, () => stopServices(state)); } catch (error) { failure ??= error; }
    });
  }
  if (failure !== undefined) throw failure;
  return { project: state.project, port: selected.port };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await withCancellation(() => runServer(process.argv.slice(2)), { processExit: true });
  } catch {
    console.error(JSON.stringify({ event: "prototype_application_failed", code: "prototype_application_start_failed" }));
    if (!process.exitCode) process.exitCode = 1;
  }
}
