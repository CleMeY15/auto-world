import "./guard.mjs";
import * as sdk from "@auto-world/connector-sdk";
import { copy, fakeLease, fakeTime, registry, request, SOURCE, syntheticStore } from "../../_sdk/test-support/index.mjs";
import { createCorpusAdapter } from "./adapter.mjs";
import { SYNTHETIC_CORPUS_MANIFEST } from "./manifest.mjs";

const ALERT_LIMIT = 1;

function requestOverrides(input) {
  function ownValues(record, allowed) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) throw new Error();
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const values = {};
    const descriptors = Object.getOwnPropertyDescriptors(record);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!allowed.includes(key)) throw new Error();
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error();
      values[key] = descriptor.value;
    }
    return values;
  }
  try {
    const values = ownValues(input, ["mode", "invocationKey", "limits"]);
    if (Object.hasOwn(values, "limits")) {
      values.limits = ownValues(values.limits, [
        "maxPages", "maxItems", "maxRunMs", "maxEffectMs", "maxPageBytes", "maxJsonDepth", "maxJsonMembers",
      ]);
    }
    return values;
  } catch {
    throw new Error("synthetic_fixture_overrides_invalid");
  }
}

export function createSyntheticHarness(options = {}) {
  const time = fakeTime(options.initialTime);
  const trace = [];
  const telemetry = [];
  const alerts = [];
  const storage = syntheticStore(time, trace);
  let currentRegistry = registry(options.registry);
  const ports = {
    clock: time.clock,
    scheduler: time.scheduler,
    random: { next: () => 0 },
    telemetry: { emit: (event) => telemetry.push(copy(event)) },
    lease: fakeLease(time, trace),
    store: storage.port,
    adapter: createCorpusAdapter("valid", trace),
    authority: {
      async loadVerifiedCurrent(input) {
        trace.push("fixture.authority");
        return {
          trust: "authenticated_current",
          registry: currentRegistry,
          authorityRevision: currentRegistry.revisions.at(-1).revision,
          verifiedAsOf: input.asOf,
          authorizationBasisRef: currentRegistry.revisions.at(-1).configuration.policy.authorization.basisRef,
        };
      },
    },
  };
  async function run(scenarioName = "valid", overrides = {}, signal) {
    const selectedOverrides = requestOverrides(overrides);
    ports.adapter = createCorpusAdapter(scenarioName, trace);
    const input = request({
      ...selectedOverrides,
      sourceId: SOURCE,
      territory: SYNTHETIC_CORPUS_MANIFEST.source.territory,
      acquisitionMethod: SYNTHETIC_CORPUS_MANIFEST.source.acquisitionMethod,
      audience: "internal",
      fields: ["source_listing_id", "price", "mileage"],
      invocationKey: selectedOverrides.invocationKey ?? `${SYNTHETIC_CORPUS_MANIFEST.fixtureVersion}-${scenarioName}`,
      adapterVersion: `${SYNTHETIC_CORPUS_MANIFEST.fixtureVersion}-${scenarioName}`,
      mapperVersion: "synthetic-search-mapper-v1",
    });
    const result = await time.drive(sdk.runConnector(input, ports, signal));
    if (result.status !== "completed") {
      const circuit = storage.snapshot().runtimes.get(input.sourceId)?.circuit;
      if (circuit?.state === "open" && alerts.length < ALERT_LIMIT) {
        alerts.push(Object.freeze({ code: "synthetic_connector_circuit_open", count: 1 }));
      }
    }
    return result;
  }
  return {
    time,
    trace,
    telemetry,
    alerts,
    storage,
    ports,
    run,
    get registry() { return currentRegistry; },
    set registry(value) { currentRegistry = value; },
  };
}
