import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const BROKER = new URL("../scripts/postgres-image/admission-broker.mjs", import.meta.url);

if (typeof vm.SourceTextModule !== "function") {
  test("admission broker VM tests", () => {
    const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      env: { ...process.env, AUTO_WORLD_ADMISSION_VM: "1" }, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
} else {
  const synthetic = (context, identifier, values) => {
    const names = Object.keys(values);
    return new vm.SyntheticModule(names, function initialize() {
      for (const name of names) this.setExport(name, values[name]);
    }, { context, identifier });
  };

  async function loadBroker() {
    const context = vm.createContext({
      AbortController: globalThis.AbortController, Buffer, console, performance: globalThis.performance, process,
      setImmediate: globalThis.setImmediate, TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder,
    });
    const dependencies = new Map();
    dependencies.set("./admission-authority.mjs", synthetic(context, "mock:authority", {
      openPostgresAdmissionAuthority: async () => { throw new Error("not called"); },
    }));
    dependencies.set("./admission-archive-maintenance.mjs", synthetic(context, "mock:archive", {
      getPostgresAdmissionImageArchiveSource: () => { throw new Error("not called"); },
      loadPostgresAdmissionArchiveContext: () => { throw new Error("not called"); },
      verifyPostgresAdmissionArchiveFast: () => { throw new Error("not called"); },
    }));
    dependencies.set("./admission-observability.mjs", synthetic(context, "mock:observability", {
      createPostgresAdmissionObservability: () => { throw new Error("not called"); },
    }));
    dependencies.set("../docker-isolated/daemon-postgres-runtime-helper.mjs", synthetic(context, "mock:helper", {
      createPostgresRuntimeDaemonHelper: () => { throw new Error("not called"); },
      postgresRuntimeDaemonConfiguration: () => { throw new Error("not called"); },
    }));
    dependencies.set("../docker-isolated/daemon-postgres-runtime.mjs", synthetic(context, "mock:guards", {
      validatePostgresRuntimeDaemonInfo: () => { throw new Error("not called"); },
      validatePostgresRuntimeDaemonStartProof: () => { throw new Error("not called"); },
      validatePostgresRuntimeDaemonStopProof: () => { throw new Error("not called"); },
    }));
    const module = new vm.SourceTextModule(readFileSync(BROKER, "utf8"), {
      context, identifier: BROKER.href, initializeImportMeta: (meta) => { meta.url = BROKER.href; },
    });
    await module.link(async (specifier) => {
      if (dependencies.has(specifier)) return dependencies.get(specifier);
      const namespace = await import(specifier);
      return synthetic(context, specifier, Object.fromEntries(Object.keys(namespace).map((key) => [key, namespace[key]])));
    });
    await module.evaluate();
    context.broker = module.namespace;
    return context;
  }

  test("public validators enforce the closed input and result schemas", async () => {
    const context = await loadBroker();
    const valid = vm.runInContext(`broker.validatePostgresSupportedSessionInput({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(valid)),
      { kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK" });
    for (const expression of [
      "{}",
      `{ kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SHELL" }`,
      `{ kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK", sql: "SELECT 1" }`,
    ]) assert.throws(() => vm.runInContext(`broker.validatePostgresSupportedSessionInput(${expression})`, context),
      /postgres_admission_arguments_invalid/u);

    const result = {
      kind: "POSTGRES_SUPPORTED_SESSION_RESULT_V1", state: "COMPLETED", intent: "SQL_CHECK",
      admissionGeneration: 1, authorityRevision: 1, resolvedMainSha: "a".repeat(40),
      phases: ["AUTHORITY", "IMAGE_ACQUIRE", "DAEMON_START", "IMAGE_LOAD", "VOLUME_CREATE", "CONTAINER_CREATE",
        "CONTAINER_START", "READINESS", "SQL_CHECK", "STOP", "CLEANUP"],
      cleanup: { containers: "REMOVED", image: "REMOVED", daemon: "STOPPED", volumes: "PRESERVED", backups: "PRESERVED" },
    };
    context.result = result;
    assert.equal(vm.runInContext("broker.validatePostgresSupportedSessionResult(JSON.parse(JSON.stringify(result))).state", context), "COMPLETED");
    assert.throws(() => vm.runInContext(`{
      const value = JSON.parse(JSON.stringify(result)); value.phases.reverse(); broker.validatePostgresSupportedSessionResult(value);
    }`, context),
      /postgres_admission_arguments_invalid/u);
  });

  test("failure diagnostics expose only the closed public reason vocabulary", async () => {
    const context = await loadBroker();
    const hiddenDiagnostic = vm.runInContext(`{
      const error = new Error("secret token and private path"); error.phase = "/private/path";
      broker.postgresAdmissionFailureDiagnostic(error, "BAD");
    }`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(hiddenDiagnostic)), {
      kind: "POSTGRES_SUPPORTED_SESSION_FAILURE_V1", state: "FAILED", intent: "SERVICE",
      phase: "AUTHORITY", code: "postgres_admission_authority_denied",
    });
    assert.equal(vm.runInContext(`{
      const error = Object.assign(new Error("postgres_admission_migration_contract_unavailable"), { phase: "MIGRATION" });
      broker.validatePostgresAdmissionFailureDiagnostic(broker.postgresAdmissionFailureDiagnostic(error, "MIGRATION")).phase;
    }`, context), "MIGRATION");
  });

  test("broker production surface exports no authority or effect injection seam", async () => {
    const context = await loadBroker();
    assert.deepEqual(Object.keys(context.broker).sort(), [
      "postgresAdmissionFailureDiagnostic", "runPostgresSupportedSession", "validatePostgresAdmissionFailureDiagnostic",
      "validatePostgresSupportedSessionInput", "validatePostgresSupportedSessionResult",
    ]);
    const source = readFileSync(BROKER, "utf8");
    assert.doesNotMatch(source, /startPostgresRuntimeDaemonLease|TEST_ONLY|dependencies\s*=|authorize\s*:/u);
    assert.match(source, /createPostgresRuntimeDaemonHelper/u);
  });
}
