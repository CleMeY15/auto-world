import { compose, port as publishedPort, pull, up, withProjectLock } from "../data-infra/runtime.mjs";
import { ensureRawBucket } from "../data-infra/cli.mjs";
import { prepareTools, serviceHealth } from "../data-infra/probes.mjs";
import { migrate as migrateConnector } from "../prototype-postgres/migrations.mjs";
import { deriveRoleCredentials, migrate as migrateSearch, provisionRoles } from "../prototype-search/migrations.mjs";

const DEFAULT_PORT = 3_211;
const RESERVED_PORTS = new Set([3_100, 3_210]);
const REQUIRED_CONDITIONS = Object.freeze(["auto-world-demo", "auto-world-prototype"]);
const SEED_INVOCATION = "prototype-application-seed-v1";

function conditionsFrom(execArgv, nodeOptions) {
  const values = new Set();
  const collect = (tokens) => {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "--conditions" && typeof tokens[index + 1] === "string") values.add(tokens[++index]);
      else if (token.startsWith("--conditions=")) values.add(token.slice("--conditions=".length));
    }
  };
  collect(execArgv);
  if (typeof nodeOptions === "string") collect(nodeOptions.match(/(?:[^\s"]+|"[^"]*")+/gu)?.map((value) => value.replace(/^"|"$/gu, "")) ?? []);
  return values;
}

export function assertPrototypeExecution(dependencies = {}) {
  if (process.env.NODE_ENV === "production" || (dependencies.environment ?? process.env).NODE_ENV === "production") {
    throw new Error("prototype_production_forbidden");
  }
  const conditions = dependencies.conditions ?? conditionsFrom(dependencies.execArgv ?? process.execArgv,
    (dependencies.environment ?? process.env).NODE_OPTIONS);
  if (!REQUIRED_CONDITIONS.every((condition) => conditions.has(condition))) throw new Error("prototype_conditions_required");
}

function applicationPort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535 || RESERVED_PORTS.has(value)) {
    throw new Error("prototype_application_port_invalid");
  }
  return value;
}

async function classifiedStep(name, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && typeof error.prototypeApplicationStep !== "string") {
      try { Object.defineProperty(error, "prototypeApplicationStep", { value: name }); } catch { /* Preserve the original failure. */ }
    }
    throw error;
  }
}

async function defaultModules() {
  const [{ createPostgresPrototype }, { createSearchPrototype }, { createDemoApi }, shared] = await Promise.all([
    import("../../services/ingestion/.prototype-dist/index.js"),
    import("../../services/search/.prototype-dist/index.js"),
    import("../../services/api/dist/index.js"),
    import("../prototype-shared/ingestion.mjs"),
  ]);
  return { createPostgresPrototype, createSearchPrototype, createDemoApi, ingest: shared.ingest,
    generatedAdapter: shared.generatedAdapter };
}

function abortableDelay(milliseconds, signal, delay = globalThis.setTimeout) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => { if (timer !== undefined) globalThis.clearTimeout(timer); finish(); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else timer = delay(finish, milliseconds);
  });
}

export const TEST_ONLY_abortableDelay = abortableDelay;

export function createApplicationRuntime(dependencies = {}) {
  const loadModules = dependencies.loadModules ?? defaultModules;
  const now = dependencies.now ?? Date.now;

  async function prepareApplication(state, options = {}) {
    assertPrototypeExecution(dependencies);
    return classifiedStep("acquire-project-lock", () => (dependencies.withProjectLock ?? withProjectLock)(state, async () => {
      await classifiedStep("validate-compose", () => (dependencies.compose ?? compose)(state,
        ["config", "--quiet"], { timeoutMs: 10_000 }));
      await classifiedStep("pull-pinned-images", () => (dependencies.pull ?? pull)(state));
      await classifiedStep("prepare-probe-tools", () => (dependencies.prepareTools ?? prepareTools)(state));
      await classifiedStep("start-four-services", () => (dependencies.up ?? up)(state));
      await classifiedStep("migrate-connector-store", () => (dependencies.migrateConnector ?? migrateConnector)(state));
      await classifiedStep("provision-search-roles", () => (dependencies.provisionRoles ?? provisionRoles)(state));
      await classifiedStep("migrate-search-store", () => (dependencies.migrateSearch ?? migrateSearch)(state, "up", options.targetMappingVersion ?? 1));
      await classifiedStep("ensure-raw-bucket", () => (dependencies.ensureRawBucket ?? ensureRawBucket)(state));
      return classifiedStep("verify-four-service-health", async () => {
        const health = await (dependencies.serviceHealth ?? serviceHealth)(state);
        if (!Array.isArray(health) || health.length !== 4 || health.some((entry) => entry.status !== "passed")) {
          throw new Error("prototype_application_readiness_failed");
        }
        return { health };
      });
    }));
  }

  async function openApplication(state, options = {}) {
    assertPrototypeExecution(dependencies);
    const boundPort = applicationPort(options.port ?? DEFAULT_PORT);
    const externalSignal = options.signal;
    if (externalSignal?.aborted) throw new Error("prototype_application_cancelled");
    const controller = new globalThis.AbortController();
    const cancel = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", cancel, { once: true });
    const emit = (event) => { try { options.onEvent?.(Object.freeze(event)); } catch { /* Telemetry is not authority. */ } };
    let modules;
    let ingestion;
    let search;
    let app;
    let consumerPromise;
    let closePromise;
    try {
      modules = await loadModules();
      const postgresPort = await (dependencies.publishedPort ?? publishedPort)(state, "postgres", 5_432);
      const searchPort = await (dependencies.publishedPort ?? publishedPort)(state, "opensearch", 9_200);
      const credentials = (dependencies.deriveRoleCredentials ?? deriveRoleCredentials)(state);
      if (controller.signal.aborted) throw new Error("prototype_application_cancelled");
      ingestion = modules.createPostgresPrototype({ host: "127.0.0.1", port: postgresPort,
        password: state.credentials.pgWriter });
      search = modules.createSearchPrototype({ postgres: { host: "127.0.0.1", port: postgresPort,
        workerPassword: credentials.workerPassword, apiPassword: credentials.apiPassword },
      opensearch: { port: searchPort }, ...(options.onEvent === undefined ? {} : { telemetry: { emit } }),
      ...(options.projectionV2 === undefined ? {} : { targetMappingVersion: 2, projectionV2: options.projectionV2 }) });
      if (options.projectionV2 !== undefined) await search.assertProfile();
      app = modules.createDemoApi({ readPort: search.readPort, loopbackPolicy: { boundPort },
        ...(options.projectionV2 === undefined ? {} : { readPortV2: search.readPortV2, keywordReadPort: search.keywordReadPort }),
        ...(options.onEvent === undefined ? {} : { telemetry: {
          metric: emit, log: emit, span: emit, alert: emit,
        } }) });
      if (controller.signal.aborted) throw new Error("prototype_application_cancelled");
      await app.listen({ host: "127.0.0.1", port: boundPort });
      if (controller.signal.aborted) throw new Error("prototype_application_cancelled");
      if (options.seed === true) {
        const seed = options.webSeed;
        if ((options.projectionV2 === undefined) !== (seed === undefined)) throw new Error("prototype_application_seed_profile_invalid");
        const outcome = await modules.ingest(ingestion, seed?.adapter ?? modules.generatedAdapter(1_000), seed?.invocationKey ?? SEED_INVOCATION, "full",
          { maxEffectMs: 10_000, maxRunMs: 100_000 }, { timeoutMs: 10_000 },
          { signal: controller.signal, telemetry: options.onEvent === undefined ? undefined : { emit },
            ...(seed === undefined ? {} : { mapperVersion: options.projectionV2.mapperVersion }) });
        emit({ name: "application_seed", status: outcome.status });
        if (controller.signal.aborted) throw new Error("prototype_application_cancelled");
        if (outcome.status !== "completed") {
          const failure = new Error("prototype_application_seed_failed");
          // SDK failure categories are fixed, never raw payloads or credentials.
          failure.prototypeApplicationStep = "seed-canonical-store";
          if (/^[a-z_]{1,64}$/u.test(outcome.error?.code ?? "")) failure.code = outcome.error.code;
          throw failure;
        }
      }
      if (options.consume !== false) {
        consumerPromise = (async () => {
          let failures = 0;
          let lastHealthAt = Number.NEGATIVE_INFINITY;
          while (!controller.signal.aborted) {
            try {
              const outcome = await search.consume({ signal: controller.signal });
              failures = 0;
              if (options.onEvent !== undefined && now() - lastHealthAt >= 15_000) {
                lastHealthAt = now();
                try {
                  const health = await search.health();
                  emit({ name: "application_health", pending: health.pending, lagMs: health.lagMs, alert: health.alert });
                } catch { /* The search runtime emits its fixed dependency failure event. */ }
              }
              if (outcome.status === "halted") return;
              await abortableDelay(outcome.status === "published" ? 50 : 250, controller.signal, dependencies.delay);
            } catch {
              if (controller.signal.aborted) return;
              failures = Math.min(failures + 1, 5);
              await abortableDelay(250 * 2 ** (failures - 1), controller.signal, dependencies.delay);
            }
          }
        })();
      }
      if (controller.signal.aborted) throw new Error("prototype_application_cancelled");
    } catch (error) {
      controller.abort();
      externalSignal?.removeEventListener("abort", cancel);
      await consumerPromise?.catch(() => {});
      await app?.close().catch(() => {});
      await search?.close().catch(() => {});
      await ingestion?.close().catch(() => {});
      throw error;
    }
    return Object.freeze({ ingestion, search, app, port: boundPort, url: `http://127.0.0.1:${boundPort}`,
      close() {
        closePromise ??= (async () => {
          controller.abort();
          externalSignal?.removeEventListener("abort", cancel);
          await consumerPromise;
          let failure;
          try { await app.close(); } catch (error) { failure = error; }
          const closedPools = await Promise.allSettled([search.close(), ingestion.close()]);
          failure ??= closedPools.find((result) => result.status === "rejected")?.reason;
          if (failure !== undefined) throw failure;
        })();
        return closePromise;
      } });
  }

  return Object.freeze({ prepareApplication, openApplication });
}

const defaultRuntime = createApplicationRuntime();
export const prepareApplication = defaultRuntime.prepareApplication;
export const openApplication = defaultRuntime.openApplication;
export { DEFAULT_PORT, SEED_INVOCATION };
