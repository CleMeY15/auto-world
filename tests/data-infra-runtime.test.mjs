import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  InfraError,
  S3_BUCKET,
  createRuntime,
  images,
  root,
  run,
} from "../scripts/data-infra/runtime.mjs";

const makeCheckout = () => mkdtemp(path.join(tmpdir(), "aw-runtime-test-"));
const removeCheckout = async (checkout) => {
  assert.ok(checkout.startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(checkout, { recursive: true, force: true });
};

test("exports the absolute checkout and immutable image inventory", () => {
  assert.equal(path.isAbsolute(root), true);
  assert.equal(S3_BUCKET, "aw-raw");
  assert.deepEqual(Object.keys(images).sort(), ["awsCli", "opensearch", "postgres", "redis", "seaweedfs", "trivy"]);
  assert.equal(Object.isFrozen(images), true);
  assert.equal(Object.isFrozen(images.postgres.platform), true);
});

test("run uses argument arrays, honors input/environment and returns captured output", async () => {
  const marker = "runtime-marker";
  const result = await run(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout); process.stderr.write(process.env.AW_TEST_MARKER)"],
    { input: "stdin-value", env: { ...process.env, AW_TEST_MARKER: marker }, timeoutMs: 5_000 },
  );
  assert.deepEqual(result, { stdout: "stdin-value", stderr: marker, code: 0 });
  const failed = await run(process.execPath, ["-e", "process.stderr.write('private'); process.exit(7)"], {
    timeoutMs: 5_000,
  });
  assert.deepEqual(failed, { stdout: "", stderr: "private", code: 7 });
});

test("run enforces fixed timeout and output-cap errors without embedding child output", async () => {
  await assert.rejects(
    run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 10 }),
    (error) => error instanceof InfraError && error.code === "process_timeout" && error.message === "process_timeout",
  );
  await assert.rejects(
    run(process.execPath, ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"], { timeoutMs: 5_000 }),
    (error) => error instanceof InfraError && error.code === "process_output_limit",
  );
});

test("project initialization is exclusive, replayable and rejects credential drift", async () => {
  const checkout = await makeCheckout();
  try {
    const runtime = createRuntime(checkout);
    const state = await runtime.initProject({ project: "aw-test-state", test: true });
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.checkout, checkout);
    assert.equal(state.dir, path.join(checkout, ".local-data", "projects", "aw-test-state"));
    assert.deepEqual(Object.values(state.ports), ["0", "0", "0", "0"]);
    for (const secret of Object.values(state.credentials)) assert.match(secret, /^[a-f0-9]{64}$/u);
    assert.equal(new Set(Object.values(state.credentials)).size, 7);
    assert.deepEqual(await runtime.loadProject("aw-test-state"), state);
    assert.deepEqual(await runtime.initProject({ project: "aw-test-state", test: true }), state);
    const s3 = JSON.parse(await readFile(path.join(state.dir, "s3.json"), "utf8"));
    assert.deepEqual(s3.identities[0].actions, ["Admin:aw-raw", "Read:aw-raw", "List:aw-raw", "Write:aw-raw"]);
    assert.ok(s3.identities[0].actions.every((action) => action.endsWith(":aw-raw")));
    assert.equal(s3.identities.some((identity) => identity.name === "anonymous"), false);
    await assert.rejects(
      runtime.initProject({
        project: "aw-test-state",
        test: true,
        credentials: { ...state.credentials, redis: "a".repeat(64) },
      }),
      (error) => error instanceof InfraError && error.code === "credential_mismatch",
    );
  } finally {
    await removeCheckout(checkout);
  }
});

test("project guards reject traversal, wrong mode and malformed restore credentials", async () => {
  const checkout = await makeCheckout();
  try {
    const runtime = createRuntime(checkout);
    await assert.rejects(runtime.initProject({ project: "../../escape", test: true }), hasCode("invalid_project"));
    await assert.rejects(runtime.initProject({ project: "aw-local-state", test: true }), hasCode("project_mode_mismatch"));
    await assert.rejects(
      runtime.initProject({ project: "aw-test-state", test: true, credentials: { pgBootstrap: "a".repeat(64) } }),
      hasCode("credentials_invalid"),
    );
  } finally {
    await removeCheckout(checkout);
  }
});

test("partial initialization erases only its newly created secret directory", async () => {
  const checkout = await makeCheckout();
  try {
    for (const failAfter of [0, 1, 2, 3]) {
      let writes = 0;
      const runtime = createRuntime(checkout, { persistPrivateFile: async (file, contents) => {
        if (failAfter === 0) throw new Error("injected_write_failure");
        await writeFile(file, contents, { flag: "wx", mode: 0o600 });
        if (++writes === failAfter) throw new Error("injected_write_failure");
      } });
      const project = `aw-test-partial-${failAfter}`;
      await assert.rejects(runtime.initProject({ project, test: true }), hasCode("state_create_failed"));
      await assert.rejects(access(path.join(checkout, ".local-data", "projects", project)), (error) => error.code === "ENOENT");
    }
  } finally { await removeCheckout(checkout); }
});

test("project lock rejects overlapping operations and is released after completion", async () => {
  const checkout = await makeCheckout();
  try {
    const runtime = createRuntime(checkout);
    const state = await runtime.initProject({ project: "aw-test-lock", test: true });
    let release;
    const held = runtime.withProjectLock(state, () => new Promise((resolve) => {
      release = resolve;
    }));
    while (release === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    await assert.rejects(runtime.withProjectLock(state, async () => undefined), hasCode("project_locked"));
    release("done");
    assert.equal(await held, "done");
    assert.equal(await runtime.withProjectLock(state, async () => "again"), "again");
  } finally {
    await removeCheckout(checkout);
  }
});

test("compose pins project/config/env arguments and suppresses ambient Auto World and Compose variables", async () => {
  const checkout = await makeCheckout();
  const calls = [];
  try {
    const runProcess = async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === "context" && args[1] === "show") return ok("default\n");
      if (args[0] === "context" && args[1] === "inspect") return ok('"unix:///var/run/docker.sock"\n');
      if (args[0] === "info") return ok("linux\n");
      if (args[0] === "compose" && args[1] === "version") return ok("Docker Compose version v2\n");
      return ok("configured\n");
    };
    const runtime = createRuntime(checkout, {
      runProcess,
      environment: { PATH: process.env.PATH, AW_INTRUDER: "bad", COMPOSE_FILE: "bad" },
    });
    const state = await runtime.initProject({ project: "aw-test-compose", test: true });
    const result = await runtime.compose(state, ["config", "--quiet"], { timeoutMs: 10_000 });
    assert.equal(result.stdout, "configured\n");
    const call = calls.at(-1);
    assert.equal(call.command, "docker");
    assert.deepEqual(call.args.slice(0, 8), [
      "compose",
      "--project-name",
      state.project,
      "--env-file",
      path.join(state.dir, "env"),
      "--file",
      path.join(checkout, "infra", "compose.json"),
      "config",
    ]);
    assert.equal(call.options.env.AW_INTRUDER, undefined);
    assert.equal(call.options.env.COMPOSE_FILE, undefined);
    assert.equal(call.options.env.AW_OWNER_TOKEN, state.ownerToken);
    await assert.rejects(runtime.compose(state, ["--project-name", "escape", "config"]), hasCode("compose_arguments_invalid"));
  } finally {
    await removeCheckout(checkout);
  }
});

test("local Docker guard fails closed for remote contexts", async () => {
  const runtime = createRuntime(root, {
    runProcess: async (_command, args) => {
      if (args[0] === "context" && args[1] === "show") return ok("remote\n");
      if (args[0] === "context" && args[1] === "inspect") return ok('"tcp://example.invalid:2376"\n');
      throw new Error("unexpected call");
    },
  });
  await assert.rejects(runtime.assertLocalDocker(), hasCode("docker_context_remote"));
  const overridden = createRuntime(root, {
    environment: { ...process.env, DOCKER_HOST: "tcp://example.invalid:2376" },
    runProcess: async () => {
      throw new Error("must fail before invoking Docker");
    },
  });
  await assert.rejects(overridden.assertLocalDocker(), hasCode("docker_context_remote"));
});

test("transient absolute deadline clips compose and rejects an exhausted operation", async () => {
  const checkout = await makeCheckout();
  const calls = [];
  try {
    const runProcess = async (_command, args, options) => {
      calls.push({ args, options });
      if (args[0] === "context" && args[1] === "show") return ok("default\n");
      if (args[0] === "context" && args[1] === "inspect") return ok('"unix:///var/run/docker.sock"\n');
      if (args[0] === "info") return ok("linux\n");
      return ok("ok\n");
    };
    const runtime = createRuntime(checkout, { runProcess });
    const state = await runtime.initProject({ project: "aw-test-deadline", test: true });
    await runtime.compose({ ...state, deadlineAt: Date.now() + 1_000 }, ["config", "--quiet"], { timeoutMs: 10_000 });
    assert.ok(calls.at(-1).options.timeoutMs > 0 && calls.at(-1).options.timeoutMs <= 1_000);
    await assert.rejects(
      runtime.compose({ ...state, deadlineAt: Date.now() - 1 }, ["config", "--quiet"]),
      hasCode("deadline_exceeded"),
    );
  } finally {
    await removeCheckout(checkout);
  }
});

test("sql exposes private stderr under the fixed integration error code", async () => {
  const checkout = await makeCheckout();
  try {
    const runProcess = async (_command, args) => {
      if (args[0] === "context" && args[1] === "show") return ok("default\n");
      if (args[0] === "context" && args[1] === "inspect") return ok('"unix:///var/run/docker.sock"\n');
      if (args[0] === "info") return ok("linux\n");
      if (args[0] === "compose" && args[1] === "version") return ok("v2\n");
      if (args[0] === "volume" || args[0] === "network" || args[0] === "ps") return ok("");
      if (args[0] === "compose" && args.includes("psql")) {
        return { stdout: "", stderr: "ERROR: conflict SQLSTATE 23505", code: 1 };
      }
      return ok("");
    };
    const runtime = createRuntime(checkout, { runProcess });
    const state = await runtime.initProject({ project: "aw-test-sql", test: true });
    await assert.rejects(
      runtime.sql(state, "select 1"),
      (error) => {
        assert.equal(error.code, "infra_sql_failed");
        assert.equal(error.message, "infra_sql_failed");
        assert.match(error.stderr, /23505/u);
        assert.equal(Object.keys(error).includes("stderr"), false);
        assert.doesNotMatch(JSON.stringify(error), /23505|pgMigrator/u);
        return true;
      },
    );
  } finally {
    await removeCheckout(checkout);
  }
});

test("ownership mismatch blocks reset before any destructive command", async () => {
  const checkout = await makeCheckout();
  const calls = [];
  try {
    let state;
    const runProcess = async (_command, args) => {
      calls.push(args);
      if (args[0] === "context" && args[1] === "show") return ok("default\n");
      if (args[0] === "context" && args[1] === "inspect") return ok('"unix:///var/run/docker.sock"\n');
      if (args[0] === "info") return ok("linux\n");
      if (args[0] === "compose" && args[1] === "version") return ok("v2\n");
      if (args[0] === "volume" && args[1] === "ls" && !args.includes("--filter")) {
        return ok(`${state.project}_postgres-data\n`);
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        return ok(JSON.stringify([{ Labels: { "com.docker.compose.project": state.project, "io.auto-world.owner": "wrong" } }]));
      }
      return ok("");
    };
    const runtime = createRuntime(checkout, { runProcess });
    state = await runtime.initProject({ project: "aw-test-owner", test: true });
    await assert.rejects(runtime.reset(state), hasCode("ownership_mismatch"));
    assert.equal(calls.some((args) => args[0] === "volume" && args[1] === "rm"), false);
    assert.equal(calls.some((args) => args[0] === "compose" && args.includes("down")), false);
  } finally {
    await removeCheckout(checkout);
  }
});

function ok(stdout, stderr = "") {
  return { stdout, stderr, code: 0 };
}

function hasCode(code) {
  return (error) => error instanceof InfraError && error.code === code && error.message === code;
}
