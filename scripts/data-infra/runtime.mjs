import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { operationSignal } from "./cancellation.mjs";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TIMEOUT_MS = 20 * 60 * 1000;
const SERVICES = Object.freeze(["postgres", "opensearch", "redis", "object-store"]);
const VOLUMES = Object.freeze([
  "postgres-data",
  "opensearch-data",
  "redis-data",
  "object-store-data",
]);
const NETWORKS = Object.freeze(["foundation"]);
const CREDENTIAL_KEYS = Object.freeze([
  "pgBootstrap",
  "pgMigrator",
  "pgWriter",
  "pgReader",
  "redis",
  "s3Access",
  "s3Secret",
]);
const PORT_DEFAULTS = Object.freeze({
  AW_PG_PORT: "5432",
  AW_REDIS_PORT: "6379",
  AW_SEARCH_PORT: "9200",
  AW_S3_PORT: "9000",
});
const SERVICE_TARGET_PORTS = Object.freeze({
  postgres: 5432,
  opensearch: 9200,
  redis: 6379,
  "object-store": 8333,
});
const ROLE_NAMES = Object.freeze({
  bootstrap: "aw_bootstrap",
  migrator: "aw_migrator",
  writer: "aw_writer",
  reader: "aw_reader",
});
const ROLE_CREDENTIALS = Object.freeze({
  bootstrap: "pgBootstrap",
  migrator: "pgMigrator",
  writer: "pgWriter",
  reader: "pgReader",
});
const PROJECT_PATTERN = /^aw-(?:local|test)-[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const HEX_SECRET_PATTERN = /^[a-f0-9]{64}$/u;
const LOCAL_DOCKER_HOST_PATTERN = /^(?:unix:\/\/\/|npipe:\/\/)/u;
const COMPOSE_COMMANDS = new Set([
  "config",
  "create",
  "down",
  "exec",
  "port",
  "ps",
  "pull",
  "start",
  "stop",
  "up",
]);

export const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const S3_BUCKET = "aw-raw";
export const images = deepFreeze(
  JSON.parse(readFileSync(path.join(root, "infra", "images.json"), "utf8")).images,
);

export class InfraError extends Error {
  constructor(code, options = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "InfraError";
    this.code = code;
    if (typeof options.stderr === "string") {
      Object.defineProperty(this, "stderr", {
        configurable: false,
        enumerable: false,
        value: options.stderr,
        writable: false,
      });
    }
  }
}

export function run(command, args, { input, env, timeoutMs, signal = operationSignal() } = {}) {
  if (typeof command !== "string" || command.length === 0 || command.includes("\0")) {
    throw new InfraError("invalid_command");
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    throw new InfraError("invalid_arguments");
  }
  const deadline = validateTimeout(timeoutMs ?? 15_000);
  if (signal?.aborted) throw new InfraError("process_cancelled");
  if (input !== undefined && typeof input !== "string" && !Buffer.isBuffer(input)) {
    throw new InfraError("invalid_input");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let child;
    let failure;
    let terminationTimer;

    const fail = (error) => {
      if (settled || failure) return;
      failure = error;
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (child !== undefined && !child.killed) child.kill("SIGKILL");
      // Rejection must not start recovery while the child is still alive.
      terminationTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new InfraError("process_termination_unverified", { cause: error }));
      }, 5000);
    };

    try {
      child = spawn(command, args, {
        env: env ?? process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (cause) {
      reject(new InfraError("process_start_failed", { cause }));
      return;
    }

    const timer = setTimeout(() => {
      fail(new InfraError("process_timeout"));
    }, deadline);
    timer.unref();
    const abort = () => fail(new InfraError("process_cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    const collect = (current, chunk) => {
      if (current.length + chunk.length > MAX_OUTPUT_BYTES) {
        fail(new InfraError("process_output_limit"));
        return current;
      }
      return Buffer.concat([current, chunk]);
    };

    child.stdout.on("data", (chunk) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(stderr, chunk);
    });
    child.stdin.on("error", (cause) => {
      if (cause?.code !== "EPIPE") fail(new InfraError("process_io_failed", { cause }));
    });
    child.on("error", (cause) => {
      fail(new InfraError("process_start_failed", { cause }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      globalThis.clearTimeout(terminationTimer);
      signal?.removeEventListener("abort", abort);
      if (failure) { reject(failure); return; }
      resolve({
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        code: Number.isInteger(code) ? code : 1,
      });
    });

    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

export function createRuntime(checkoutRoot, options = {}) {
  const checkout = path.resolve(checkoutRoot);
  const runProcess = options.runProcess ?? run;
  const ambientEnvironment = options.environment ?? process.env;
  const persist = options.persistPrivateFile ?? writePrivateFile;

  async function initProject({ project, test = false, credentials } = {}) {
    const selectedProject = project ?? (test ? `aw-test-${randomUUID()}` : "aw-local-default");
    validateProject(selectedProject);
    if (test !== selectedProject.startsWith("aw-test-")) throw new InfraError("project_mode_mismatch");
    const selectedCredentials = credentials === undefined ? generateCredentials() : validateCredentials(credentials);
    const projectsDir = path.join(checkout, ".local-data", "projects");
    const projectDir = path.join(projectsDir, selectedProject);

    await mkdir(projectsDir, { recursive: true, mode: 0o700 });
    try {
      await mkdir(projectDir, { mode: 0o700 });
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw new InfraError("state_create_failed", { cause });
      const existing = await loadProject(selectedProject);
      if (credentials !== undefined && !sameCredentials(existing.credentials, selectedCredentials)) {
        throw new InfraError("credential_mismatch");
      }
      return existing;
    }

    const normalizedCheckout = checkout;
    const checkoutHash = createHash("sha256").update(normalizedCheckout).digest("hex");
    const state = {
      schemaVersion: 1,
      project: selectedProject,
      ownerToken: `${checkoutHash.slice(0, 16)}-${randomUUID()}`,
      checkout: normalizedCheckout,
      dir: projectDir,
      credentials: selectedCredentials,
      ports: Object.fromEntries(
        Object.entries(PORT_DEFAULTS).map(([key, value]) => [key, test ? "0" : value]),
      ),
    };

    const createdDirectory = await lstat(projectDir);
    try {
      await persist(path.join(projectDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
      await persist(path.join(projectDir, "env"), renderEnvironment(state));
      await persist(path.join(projectDir, "s3.json"), `${JSON.stringify(renderS3Configuration(state), null, 2)}\n`);
      await chmodPrivate(projectDir, 0o700);
      return validateState(state, checkout, projectDir);
    } catch (cause) {
      await protectedInitializationCleanup(projectDir, projectsDir, selectedProject, createdDirectory);
      throw cause instanceof InfraError ? cause : new InfraError("state_create_failed", { cause });
    }
  }

  async function loadProject(project = "aw-local-default") {
    validateProject(project);
    const projectDir = path.join(checkout, ".local-data", "projects", project);
    let raw;
    try {
      raw = await readFile(path.join(projectDir, "state.json"), "utf8");
    } catch (cause) {
      throw new InfraError(cause?.code === "ENOENT" ? "project_not_initialized" : "state_read_failed", { cause });
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new InfraError("state_invalid", { cause });
    }
    const state = validateState(parsed, checkout, projectDir);
    await verifyGeneratedFiles(state);
    return state;
  }

  async function withProjectLock(state, fn) {
    const current = await validateLoadedState(state, checkout);
    if (typeof fn !== "function") throw new InfraError("invalid_lock_callback");
    const lockPath = path.join(current.dir, "operation.lock");
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
    } catch (cause) {
      if (cause?.code === "EEXIST") throw new InfraError("project_locked");
      throw new InfraError("lock_failed", { cause });
    }
    try {
      return await fn();
    } finally {
      await handle.close();
      await rm(lockPath, { force: true });
    }
  }

  async function assertLocalDocker(deadlineAt) {
    const dockerHost = ambientEnvironment.DOCKER_HOST;
    if (typeof dockerHost === "string" && dockerHost.length > 0 && !LOCAL_DOCKER_HOST_PATTERN.test(dockerHost)) {
      throw new InfraError("docker_context_remote");
    }
    const deadlineState = deadlineAt === undefined ? {} : { deadlineAt };
    const contextResult = await runDocker(["context", "show"], 10_000, deadlineState);
    const context = contextResult.stdout.trim();
    if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(context)) throw new InfraError("docker_context_invalid");
    const inspectResult = await runDocker(
      ["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"],
      10_000,
      deadlineState,
    );
    let host;
    try {
      host = JSON.parse(inspectResult.stdout.trim());
    } catch (cause) {
      throw new InfraError("docker_context_invalid", { cause });
    }
    if (typeof host !== "string" || !LOCAL_DOCKER_HOST_PATTERN.test(host)) {
      throw new InfraError("docker_context_remote");
    }
    const infoResult = await runDocker(["info", "--format", "{{.OSType}}"], 10_000, deadlineState);
    if (infoResult.stdout.trim() !== "linux") throw new InfraError("docker_platform_unsupported");
    await runDocker(["compose", "version"], 10_000, deadlineState);
    return { context, host, os: "linux" };
  }

  async function compose(state, args, { input, timeoutMs = 120_000 } = {}) {
    const current = await validateLoadedState(state, checkout);
    validateComposeArguments(args);
    await assertLocalDocker(current.deadlineAt);
    if (["create", "down", "exec", "start", "stop", "up"].includes(args[0])) {
      await inspectOwnership(current);
    }
    const result = await runProcess(
      "docker",
      [
        "compose",
        "--project-name",
        current.project,
        "--env-file",
        path.join(current.dir, "env"),
        "--file",
        path.join(checkout, "infra", "compose.json"),
        ...args,
      ],
      {
        input,
        env: composeEnvironment(current, ambientEnvironment),
        timeoutMs: clippedTimeout(current, timeoutMs),
      },
    );
    if (result.code !== 0) throw commandError("compose_failed", result);
    return result;
  }

  async function sql(
    state,
    query,
    { role = "migrator", database = "autoworld", timeoutMs = 15_000 } = {},
  ) {
    if (typeof query !== "string" && !Buffer.isBuffer(query)) throw new InfraError("invalid_sql_input");
    if (!Object.hasOwn(ROLE_NAMES, role)) throw new InfraError("invalid_sql_role");
    if (!/^[a-z][a-z0-9_]{0,62}$/u.test(database)) throw new InfraError("invalid_database");
    const current = await validateLoadedState(state, checkout);
    try {
      const result = await compose(
        current,
        [
          "exec",
          "--no-TTY",
          "--env",
          `PGPASSWORD=${current.credentials[ROLE_CREDENTIALS[role]]}`,
          "postgres",
          "psql",
          "-X",
          "-A",
          "-t",
          "-q",
          "--set=ON_ERROR_STOP=1",
          "--set=VERBOSITY=sqlstate",
          `--username=${ROLE_NAMES[role]}`,
          `--dbname=${database}`,
        ],
        { input: query, timeoutMs },
      );
      return result.stdout;
    } catch (cause) {
      if (cause instanceof InfraError && cause.code === "compose_failed") {
        throw new InfraError("infra_sql_failed", { cause, stderr: cause.stderr });
      }
      throw cause;
    }
  }

  async function pull(state) {
    const current = await verifyOwnership(state);
    return compose(current, ["pull"], { timeoutMs: 600_000 });
  }

  async function up(state) {
    const current = await verifyOwnership(state);
    return compose(current, ["up", "--detach", "--wait", "--wait-timeout", "180"], {
      timeoutMs: 180_000,
    });
  }

  async function stop(state, services) {
    const current = await verifyOwnership(state);
    const selected = validateServices(services);
    return compose(current, ["stop", "--timeout", "60", ...selected], { timeoutMs: 60_000 });
  }

  async function start(state, services) {
    const current = await verifyOwnership(state);
    const selected = validateServices(services);
    return compose(current, ["start", ...selected], { timeoutMs: 120_000 });
  }

  async function down(state) {
    const current = await verifyOwnership(state);
    return compose(current, ["down", "--timeout", "60"], { timeoutMs: 120_000 });
  }

  async function reset(state) {
    const current = await verifyOwnership(state);
    const volumes = await ownedVolumes(current);
    await down(current);
    const verifiedAfterDown = await ownedVolumes(current);
    if (JSON.stringify(verifiedAfterDown) !== JSON.stringify(volumes)) {
      throw new InfraError("ownership_changed");
    }
    if (verifiedAfterDown.length === 0) return { removedVolumes: [] };
    const result = await runDocker(["volume", "rm", ...verifiedAfterDown], 120_000, current);
    return { removedVolumes: verifiedAfterDown, result };
  }

  async function serviceStates(state) {
    const current = await verifyOwnership(state);
    const result = await compose(current, ["ps", "--all", "--format", "json"], { timeoutMs: 15_000 });
    const entries = parseComposeJson(result.stdout);
    const states = Object.fromEntries(
      SERVICES.map((service) => [service, { state: "absent", health: "", status: "" }]),
    );
    for (const entry of entries) {
      if (!SERVICES.includes(entry.Service)) throw new InfraError("unexpected_resource");
      states[entry.Service] = {
        state: typeof entry.State === "string" ? entry.State : "unknown",
        health: typeof entry.Health === "string" ? entry.Health : "",
        status: typeof entry.Status === "string" ? entry.Status : "",
      };
    }
    return states;
  }

  async function port(state, service, target) {
    if (!Object.hasOwn(SERVICE_TARGET_PORTS, service) || target !== SERVICE_TARGET_PORTS[service]) {
      throw new InfraError("invalid_port_request");
    }
    const current = await verifyOwnership(state);
    const result = await compose(current, ["port", service, String(target)], { timeoutMs: 15_000 });
    const match = /^127\.0\.0\.1:(\d{1,5})$/u.exec(result.stdout.trim());
    const published = match === null ? 0 : Number(match[1]);
    if (published < 1 || published > 65_535) throw new InfraError("port_not_loopback");
    return published;
  }

  async function ownedVolumes(state) {
    const current = await validateLoadedState(state, checkout);
    const ownership = await inspectOwnership(current);
    return ownership.volumes;
  }

  async function verifyOwnership(state) {
    const current = await validateLoadedState(state, checkout);
    await inspectOwnership(current);
    return current;
  }

  async function inspectOwnership(state) {
    await assertLocalDocker(state.deadlineAt);
    const expectedVolumes = new Set(VOLUMES.map((name) => `${state.project}_${name}`));
    const expectedNetworks = new Set(NETWORKS.map((name) => `${state.project}_${name}`));
    const volumes = await inspectNamedResources("volume", expectedVolumes, state);
    await inspectNamedResources("network", expectedNetworks, state);
    await rejectUnexpectedLabeledResources("volume", expectedVolumes, state);
    await rejectUnexpectedLabeledResources("network", expectedNetworks, state);
    await inspectContainers(state);
    return { volumes };
  }

  async function inspectNamedResources(kind, expectedNames, state) {
    const owned = [];
    const listing = await runDocker([kind, "ls", "--format", "{{.Name}}"], 10_000, state);
    const existing = new Set(splitLines(listing.stdout));
    for (const name of expectedNames) {
      if (!existing.has(name)) continue;
      const result = await runDocker([kind, "inspect", name], 10_000, state);
      const item = parseSingleInspection(result.stdout);
      assertLabels(item.Labels ?? item.Config?.Labels, state);
      owned.push(name);
    }
    return owned;
  }

  async function rejectUnexpectedLabeledResources(kind, expectedNames, state) {
    const plural = kind === "volume" ? "volume" : "network";
    const result = await runDocker(
      [plural, "ls", "--filter", `label=com.docker.compose.project=${state.project}`, "--format", "{{.Name}}"],
      10_000,
      state,
    );
    for (const name of splitLines(result.stdout)) {
      if (!expectedNames.has(name)) throw new InfraError("unexpected_resource");
    }
  }

  async function inspectContainers(state) {
    const result = await runDocker(
      ["ps", "--all", "--filter", `label=com.docker.compose.project=${state.project}`, "--format", "{{.ID}}"],
      10_000,
      state,
    );
    const seenServices = new Set();
    for (const identifier of splitLines(result.stdout)) {
      const inspection = await runDocker(["container", "inspect", identifier], 10_000, state);
      const item = parseSingleInspection(inspection.stdout);
      assertLabels(item.Config?.Labels, state);
      const service = item.Config?.Labels?.["com.docker.compose.service"];
      if (!SERVICES.includes(service) || seenServices.has(service)) throw new InfraError("unexpected_resource");
      seenServices.add(service);
    }
  }

  async function runDocker(args, timeoutMs, state = {}) {
    const result = await runProcess("docker", args, {
      env: dockerEnvironment(ambientEnvironment),
      timeoutMs: clippedTimeout(state, timeoutMs),
    });
    if (result.code !== 0) throw commandError("docker_failed", result);
    return result;
  }

  return Object.freeze({
    assertLocalDocker,
    compose,
    down,
    initProject,
    loadProject,
    ownedVolumes,
    port,
    pull,
    reset,
    serviceStates,
    sql,
    start,
    stop,
    up,
    withProjectLock,
  });
}

const defaultRuntime = createRuntime(root);
export const initProject = defaultRuntime.initProject;
export const loadProject = defaultRuntime.loadProject;
export const withProjectLock = defaultRuntime.withProjectLock;
export const compose = defaultRuntime.compose;
export const sql = defaultRuntime.sql;
export const assertLocalDocker = defaultRuntime.assertLocalDocker;
export const pull = defaultRuntime.pull;
export const up = defaultRuntime.up;
export const stop = defaultRuntime.stop;
export const start = defaultRuntime.start;
export const down = defaultRuntime.down;
export const reset = defaultRuntime.reset;
export const serviceStates = defaultRuntime.serviceStates;
export const port = defaultRuntime.port;
export const ownedVolumes = defaultRuntime.ownedVolumes;

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new InfraError("invalid_timeout");
  }
  return value;
}

function validateProject(project) {
  if (typeof project !== "string" || !PROJECT_PATTERN.test(project)) {
    throw new InfraError("invalid_project");
  }
}

function validateCredentials(credentials) {
  if (credentials === null || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new InfraError("credentials_invalid");
  }
  if (!sameKeys(credentials, CREDENTIAL_KEYS)) throw new InfraError("credentials_invalid");
  for (const value of Object.values(credentials)) {
    if (typeof value !== "string" || !HEX_SECRET_PATTERN.test(value)) {
      throw new InfraError("credentials_invalid");
    }
  }
  return Object.freeze({ ...credentials });
}

function generateCredentials() {
  return validateCredentials(
    Object.fromEntries(CREDENTIAL_KEYS.map((key) => [key, randomBytes(32).toString("hex")])),
  );
}

function validateState(candidate, checkout, projectDir) {
  const keys = ["schemaVersion", "project", "ownerToken", "checkout", "dir", "credentials", "ports"];
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) || !sameKeys(candidate, keys)) {
    throw new InfraError("state_invalid");
  }
  validateProject(candidate.project);
  if (candidate.schemaVersion !== 1) throw new InfraError("state_version_unsupported");
  const resolvedCheckout = path.resolve(checkout);
  const resolvedDir = path.resolve(projectDir);
  if (candidate.checkout !== resolvedCheckout || candidate.dir !== resolvedDir) throw new InfraError("state_checkout_mismatch");
  if (!resolvedDir.startsWith(`${resolvedCheckout}${path.sep}`)) throw new InfraError("state_path_invalid");
  const checkoutHash = createHash("sha256").update(resolvedCheckout).digest("hex").slice(0, 16);
  if (typeof candidate.ownerToken !== "string" || !candidate.ownerToken.startsWith(`${checkoutHash}-`)) {
    throw new InfraError("state_owner_invalid");
  }
  if (!/^[a-f0-9]{16}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(candidate.ownerToken)) {
    throw new InfraError("state_owner_invalid");
  }
  validateCredentials(candidate.credentials);
  if (!sameKeys(candidate.ports, Object.keys(PORT_DEFAULTS))) throw new InfraError("state_ports_invalid");
  for (const value of Object.values(candidate.ports)) {
    if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,4})$/u.test(value) || Number(value) > 65_535) {
      throw new InfraError("state_ports_invalid");
    }
  }
  return deepFreeze(globalThis.structuredClone(candidate));
}

async function writePrivateFile(file, contents) {
  await writeFile(file, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmodPrivate(file, 0o600);
}

async function protectedInitializationCleanup(directory, parent, name, identity) {
  const { removeGeneratedDirectory } = await import("./ephemeral.mjs");
  const { protectedRecovery } = await import("./cancellation.mjs");
  await protectedRecovery(() => removeGeneratedDirectory(directory, parent, name, new Set(["state.json", "env", "s3.json"]), identity));
}

async function chmodPrivate(target, mode) {
  try {
    await chmod(target, mode);
  } catch (cause) {
    if (process.platform !== "win32") throw cause;
  }
}

function renderEnvironment(state) {
  const values = {
    AW_OWNER_TOKEN: state.ownerToken,
    AW_PG_BOOTSTRAP_PASSWORD: state.credentials.pgBootstrap,
    AW_PG_MIGRATOR_PASSWORD: state.credentials.pgMigrator,
    AW_PG_WRITER_PASSWORD: state.credentials.pgWriter,
    AW_PG_READER_PASSWORD: state.credentials.pgReader,
    AW_REDIS_PASSWORD: state.credentials.redis,
    AW_RUNTIME_DIR: state.dir,
    ...state.ports,
  };
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function renderS3Configuration(state) {
  return {
    identities: [
      {
        name: "auto-world-runtime",
        credentials: [
          {
            accessKey: state.credentials.s3Access,
            secretKey: state.credentials.s3Secret,
          },
        ],
        // This local lifecycle identity also creates its one bucket; never grant global Admin.
        actions: [`Admin:${S3_BUCKET}`, `Read:${S3_BUCKET}`, `List:${S3_BUCKET}`, `Write:${S3_BUCKET}`],
      },
    ],
  };
}

async function verifyGeneratedFiles(state) {
  let environment;
  let s3;
  try {
    environment = await readFile(path.join(state.dir, "env"), "utf8");
    s3 = JSON.parse(await readFile(path.join(state.dir, "s3.json"), "utf8"));
  } catch (cause) {
    throw new InfraError("state_incomplete", { cause });
  }
  if (environment !== renderEnvironment(state) || JSON.stringify(s3) !== JSON.stringify(renderS3Configuration(state))) {
    throw new InfraError("state_inconsistent");
  }
}

function composeEnvironment(state, ambient) {
  return {
    ...dockerEnvironment(ambient),
    AW_OWNER_TOKEN: state.ownerToken,
    AW_PG_BOOTSTRAP_PASSWORD: state.credentials.pgBootstrap,
    AW_PG_MIGRATOR_PASSWORD: state.credentials.pgMigrator,
    AW_PG_WRITER_PASSWORD: state.credentials.pgWriter,
    AW_PG_READER_PASSWORD: state.credentials.pgReader,
    AW_REDIS_PASSWORD: state.credentials.redis,
    AW_RUNTIME_DIR: state.dir,
    ...state.ports,
  };
}

function dockerEnvironment(ambient) {
  return Object.fromEntries(
    Object.entries(ambient).filter(([key]) => !key.startsWith("AW_") && !key.startsWith("COMPOSE_")),
  );
}

function validateComposeArguments(args) {
  if (!Array.isArray(args) || args.length === 0 || !COMPOSE_COMMANDS.has(args[0])) {
    throw new InfraError("compose_arguments_invalid");
  }
  const forbidden = new Set([
    "-f",
    "--file",
    "-p",
    "--project-name",
    "--env-file",
    "--project-directory",
    "--remove-orphans",
    "-v",
    "--volumes",
    "--rmi",
  ]);
  if (args.some((argument) => typeof argument !== "string" || argument.includes("\0") || forbidden.has(argument))) {
    throw new InfraError("compose_arguments_invalid");
  }
}

function validateServices(services) {
  if (services === undefined) return [];
  if (!Array.isArray(services) || services.length === 0 || services.some((service) => !SERVICES.includes(service))) {
    throw new InfraError("invalid_services");
  }
  return [...new Set(services)];
}

async function validateLoadedState(state, checkout) {
  if (state === null || typeof state !== "object" || typeof state.project !== "string") {
    throw new InfraError("state_invalid");
  }
  const deadlineAt = state.deadlineAt;
  if (deadlineAt !== undefined && (!Number.isInteger(deadlineAt) || deadlineAt <= Date.now())) {
    throw new InfraError("deadline_exceeded");
  }
  const baseState = deadlineAt === undefined
    ? state
    : Object.fromEntries(Object.entries(state).filter(([key]) => key !== "deadlineAt"));
  const runtime = createRuntime(checkout);
  const loaded = await runtime.loadProject(state.project);
  if (JSON.stringify(loaded) !== JSON.stringify(baseState)) throw new InfraError("state_inconsistent");
  return deadlineAt === undefined ? loaded : deepFreeze({ ...loaded, deadlineAt });
}

function clippedTimeout(state, requested) {
  const timeout = validateTimeout(requested);
  if (state.deadlineAt === undefined) return timeout;
  const remaining = state.deadlineAt - Date.now();
  if (remaining < 1) throw new InfraError("deadline_exceeded");
  return Math.min(timeout, remaining);
}

function sameCredentials(left, right) {
  return CREDENTIAL_KEYS.every((key) => left[key] === right[key]);
}

function sameKeys(value, keys) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function commandError(code, result) {
  return new InfraError(code, { stderr: result.stderr });
}

function parseSingleInspection(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null || typeof parsed[0] !== "object") {
      throw new Error("invalid inspection");
    }
    return parsed[0];
  } catch (cause) {
    throw new InfraError("docker_response_invalid", { cause });
  }
}

function assertLabels(labels, state) {
  if (
    labels === null ||
    typeof labels !== "object" ||
    labels["com.docker.compose.project"] !== state.project ||
    labels["io.auto-world.owner"] !== state.ownerToken
  ) {
    throw new InfraError("ownership_mismatch");
  }
}

function splitLines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function parseComposeJson(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      return splitLines(trimmed).map((line) => JSON.parse(line));
    } catch (cause) {
      throw new InfraError("docker_response_invalid", { cause });
    }
  }
}
