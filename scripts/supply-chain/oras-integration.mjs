import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import https from "node:https";
import { createConnection } from "node:net";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";
import {
  createOwnedDirectory,
  cleanEnvironment,
  policyError,
  removeOwnedDirectory,
  runCommand,
} from "./process.mjs";
import { createBootstrapFixture, validateBootstrapFixture, validateOrasCopiedFixture } from "./oci.mjs";
import { hashFileBounded, readFileBounded } from "./native-audit.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const MAX_BODY_BYTES = 256 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const INTEGRATION_TIMEOUT_MS = 10 * 60_000;
const SAFE_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
  TMPDIR: "",
});
const MEDIA_INDEX = "application/vnd.oci.image.index.v1+json";
const MEDIA_MANIFEST = "application/vnd.oci.image.manifest.v1+json";

const fail = (code) => {
  throw policyError(code);
};

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const blobPath = (value) => `blobs/sha256/${value.slice(7)}`;
const headerText = (headers) => Object.entries(headers)
  .flatMap(([name, value]) => [name, ...(Array.isArray(value) ? value : [value ?? ""])])
  .join("\n");

export function parseOrasArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 8) fail("oras_arguments_refused");
  const expected = ["--binary", "--sha256", "--workspace", "--output"];
  const result = Object.create(null);
  for (let index = 0; index < expected.length; index += 1) {
    if (argv[index * 2] !== expected[index]) fail("oras_arguments_refused");
    const value = argv[index * 2 + 1];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      fail("oras_arguments_refused");
    }
    result[expected[index].slice(2)] = value;
  }
  if (!path.isAbsolute(result.binary) || !path.isAbsolute(result.workspace) ||
      !path.isAbsolute(result.output) || !SHA256.test(result.sha256)) {
    fail("oras_arguments_refused");
  }
  return Object.freeze(result);
}

export function assertOrasRuntime(platform = process.platform, environment = process.env) {
  if (platform !== "linux" || environment.GITHUB_ACTIONS !== "true") {
    fail("oras_runtime_refused");
  }
}

async function validateBinary(binary, expectedHash) {
  if ((await hashFileBounded(binary, MAX_BINARY_BYTES)).sha256 !== expectedHash) {
    fail("oras_binary_identity_mismatch");
  }
}

async function validateWorkspace(workspace, output, runnerTemp) {
  if (typeof runnerTemp !== "string" || !path.isAbsolute(runnerTemp)) fail("oras_workspace_refused");
  const [workspaceReal, runnerReal] = await Promise.all([realpath(workspace), realpath(runnerTemp)]);
  const info = await lstat(workspaceReal);
  if (!info.isDirectory() || info.isSymbolicLink() || path.relative(runnerReal, workspaceReal).startsWith("..") ||
      path.relative(runnerReal, workspaceReal) === "" || (await readdir(workspaceReal)).length !== 0) {
    fail("oras_workspace_refused");
  }
  if (path.dirname(output) !== workspaceReal || !/^oras-integration-[a-z0-9-]+\.json$/u.test(path.basename(output))) {
    fail("oras_output_refused");
  }
  await lstat(output).then(() => fail("oras_output_refused"), (error) => {
    if (error?.code !== "ENOENT") fail("oras_output_refused");
  });
  return workspaceReal;
}

async function writeFixture(directory, files) {
  for (const [name, bytes] of files) {
    const destination = path.join(directory, ...name.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
}

export async function readFixture(directory, expectedNames) {
  const names = [...expectedNames];
  const files = new Map();
  const found = [];
  let entries = 0;
  let totalBytes = 0;
  const walk = async (current, prefix = "") => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > 64) fail("oras_layout_entry_limit");
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) fail("oras_layout_entry_refused");
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), relative);
      else {
        totalBytes += (await lstat(path.join(current, entry.name))).size;
        if (totalBytes > 32 * 1024) fail("oras_layout_size_limit");
        found.push(relative);
      }
    }
  };
  await walk(directory);
  if (found.sort().join("\n") !== names.sort().join("\n")) fail("oras_layout_graph_mismatch");
  for (const name of names) files.set(name, await readFileBounded(path.join(directory, ...name.split("/")), 32 * 1024));
  return files;
}

const collectBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) request.destroy(policyError("oras_registry_body_limit"));
    else chunks.push(chunk);
  });
  request.once("end", () => resolve(Buffer.concat(chunks)));
  request.once("error", reject);
});

export function createRegistryState({ mode = "positive", secondaryOrigin = "", sentinels = [], credential = "" } = {}) {
  return {
    authenticatedRequests: 0,
    blobs: new Map(),
    challenges: 0,
    credential,
    leaks: [],
    manifests: new Map(),
    mode,
    requests: 0,
    secondaryOrigin,
    sentinels: [...sentinels],
    tags: new Map(),
    uploads: new Map(),
  };
}

function recordRequest(state, request, body, inspectForLeaks) {
  if (!inspectForLeaks) return;
  const haystack = `${request.url}\n${headerText(request.headers)}\n${body.toString("utf8")}`;
  for (const sentinel of state.sentinels) {
    if (sentinel && haystack.includes(sentinel)) state.leaks.push("credential_transfer");
  }
}

function boundRegistryState(state) {
  const stores = [state.blobs, state.manifests, state.uploads];
  if (stores.some((store) => store.size > 16) || state.tags.size > 16 ||
      stores.flatMap((store) => [...store.values()]).reduce((size, bytes) => size + bytes.length, 0) > 32 * 1024) {
    fail("oras_registry_state_limit");
  }
}

function send(response, status, headers = {}, body = Buffer.alloc(0)) {
  response.writeHead(status, { "content-length": body.length, ...headers });
  response.end(body);
}

function manifestMedia(bytes) {
  const value = JSON.parse(bytes.toString("utf8"));
  if (value.mediaType === MEDIA_INDEX) return MEDIA_INDEX;
  if (value.mediaType === MEDIA_MANIFEST) return MEDIA_MANIFEST;
  fail("oras_registry_manifest_invalid");
}

export function createRegistryHandler(state, { inspectForLeaks = false } = {}) {
  return async (request, response) => {
    try {
      state.requests += 1;
      if (state.requests > 128) fail("oras_registry_request_limit");
      const body = await collectBody(request);
      recordRequest(state, request, body, inspectForLeaks);
      if (state.mode === "deny") {
        send(response, 418);
        return;
      }
      const origin = `https://${request.headers.host}`;
      const url = new URL(request.url, origin);

      if (state.credential) {
        if (request.headers.authorization !== `Basic ${state.credential}`) {
          send(response, 401, { "www-authenticate": 'Basic realm="oras-test"' });
          return;
        }
        state.authenticatedRequests += 1;
      }

      if (state.mode === "redirect") {
        state.challenges += 1;
        send(response, 307, { location: `${state.secondaryOrigin}/v2/` });
        return;
      }
      if (state.mode === "bearer") {
        state.challenges += 1;
        send(response, 401, {
          "www-authenticate": `Bearer realm="${state.secondaryOrigin}/token",service="oras-test"`,
        });
        return;
      }
      if (url.pathname === "/v2/" && (request.method === "GET" || request.method === "HEAD")) {
        send(response, 200, { "docker-distribution-api-version": "registry/2.0" });
        return;
      }

      const uploadMatch = /^\/v2\/oras-test\/blobs\/uploads\/(.*)$/u.exec(url.pathname);
      if (request.method === "POST" && url.pathname === "/v2/oras-test/blobs/uploads/") {
        if (state.mode === "upload-location") {
          state.challenges += 1;
          send(response, 202, { location: `${state.secondaryOrigin}/v2/oras-test/blobs/uploads/foreign` });
          return;
        }
        const id = `upload-${state.uploads.size}`;
        state.uploads.set(id, Buffer.alloc(0));
        boundRegistryState(state);
        send(response, 202, { "docker-upload-uuid": id, location: `/v2/oras-test/blobs/uploads/${id}` });
        return;
      }
      if (uploadMatch && request.method === "PATCH") {
        if (!state.uploads.has(uploadMatch[1])) return send(response, 404);
        state.uploads.set(uploadMatch[1], Buffer.concat([state.uploads.get(uploadMatch[1]), body]));
        boundRegistryState(state);
        send(response, 202, { location: `/v2/oras-test/blobs/uploads/${uploadMatch[1]}` });
        return;
      }
      if (uploadMatch && request.method === "PUT") {
        if (!state.uploads.has(uploadMatch[1])) return send(response, 404);
        const bytes = Buffer.concat([state.uploads.get(uploadMatch[1]), body]);
        const expected = url.searchParams.get("digest");
        if (digest(bytes) !== expected) return send(response, 400);
        state.blobs.set(expected, bytes);
        state.uploads.delete(uploadMatch[1]);
        boundRegistryState(state);
        send(response, 201, { "docker-content-digest": expected, location: `/v2/oras-test/blobs/${expected}` });
        return;
      }

      const blobMatch = /^\/v2\/oras-test\/blobs\/(sha256:[0-9a-f]{64})$/u.exec(url.pathname);
      if (blobMatch && (request.method === "HEAD" || request.method === "GET")) {
        const bytes = state.blobs.get(blobMatch[1]);
        if (!bytes) return send(response, 404);
        send(response, 200, { "docker-content-digest": blobMatch[1] }, request.method === "GET" ? bytes : Buffer.alloc(0));
        return;
      }

      const manifestMatch = /^\/v2\/oras-test\/manifests\/(.+)$/u.exec(url.pathname);
      if (manifestMatch && request.method === "PUT") {
        const valueDigest = digest(body);
        const reference = decodeURIComponent(manifestMatch[1]);
        if (reference.startsWith("sha256:") && reference !== valueDigest) return send(response, 400);
        state.manifests.set(valueDigest, body);
        if (!reference.startsWith("sha256:")) state.tags.set(reference, valueDigest);
        boundRegistryState(state);
        send(response, 201, {
          "content-type": manifestMedia(body),
          "docker-content-digest": valueDigest,
          location: `/v2/oras-test/manifests/${valueDigest}`,
        });
        return;
      }
      if (manifestMatch && (request.method === "HEAD" || request.method === "GET")) {
        const reference = decodeURIComponent(manifestMatch[1]);
        const valueDigest = reference.startsWith("sha256:") ? reference : state.tags.get(reference);
        const bytes = state.manifests.get(valueDigest);
        if (!bytes) return send(response, 404);
        send(response, 200, {
          "content-type": manifestMedia(bytes),
          "docker-content-digest": valueDigest,
        }, request.method === "GET" ? bytes : Buffer.alloc(0));
        return;
      }
      send(response, 404);
    } catch {
      state.failure = "oras_registry_request_failed";
      if (!response.headersSent) send(response, 500);
      else response.destroy();
    }
  };
}

async function startTlsServer(key, cert, state, options) {
  const server = https.createServer({ key, cert }, createRegistryHandler(state, options));
  const sockets = new Set();
  const ownSocket = (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (sockets.size > 128) { state.failure = "oras_socket_limit"; socket.destroy(); }
  };
  server.on("connection", ownSocket);
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.on("connect", (request, socket, head) => {
    state.requests += 1;
    recordRequest(state, request, Buffer.alloc(0), true);
    if (!["proxy", "proxy-relay"].includes(state.mode) || request.url !== "oras-test.invalid:443" || state.requests > 128 || head.length > 16 * 1024) {
      state.failure = "oras_proxy_request_invalid";
      socket.destroy();
      return;
    }
    state.challenges += 1;
    if (state.mode === "proxy-relay") {
      if (!Number.isSafeInteger(state.tunnelPort) || state.tunnelPort < 1 || state.tunnelPort > 65535) {
        state.failure = "oras_proxy_tunnel_invalid";
        socket.destroy();
        return;
      }
      const upstream = createConnection({ host: "127.0.0.1", port: state.tunnelPort });
      ownSocket(upstream);
      upstream.once("error", () => { state.failure = "oras_proxy_tunnel_failed"; socket.destroy(); });
      socket.once("error", () => upstream.destroy());
      socket.once("close", () => upstream.destroy());
      upstream.once("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      return;
    }
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  let closing;
  return Object.freeze({
    close: () => closing ??= new Promise((resolve, reject) => {
      const timer = setTimeout(() => { server.closeAllConnections(); for (const socket of sockets) socket.destroy(); }, 1000);
      server.close((error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    }),
    host: `localhost:${address.port}`,
    origin: `https://localhost:${address.port}`,
    port: address.port,
  });
}

async function createTlsIdentity(directory, environment) {
  const key = path.join(directory, "server-key.pem");
  const cert = path.join(directory, "server-cert.pem");
  const openssl = "/usr/bin/openssl";
  await runCommand(openssl, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,DNS:oras-test.invalid,IP:127.0.0.1",
    "-keyout", key, "-out", cert,
  ], { cwd: directory, env: environment, timeoutMs: COMMAND_TIMEOUT_MS, maxOutputBytes: 64 * 1024 });
  return Object.freeze({ cert, certBytes: await readFile(cert), keyBytes: await readFile(key) });
}

function commandEnvironment(directory, cert) {
  return { ...SAFE_ENVIRONMENT, HOME: directory, TMPDIR: directory, SSL_CERT_FILE: cert };
}

async function runCp(binary, source, destination, options, environment, cwd, forbiddenOutput = []) {
  return runCommand(binary, ["cp", "--from-oci-layout", source, destination, ...options], {
    cwd,
    env: environment,
    maxOutputBytes: 1024 * 1024,
    timeoutMs: COMMAND_TIMEOUT_MS,
    forbiddenOutput,
  });
}

// Deliberately tests ORAS's own proxy behavior in secret-free integration. The
// production subprocess boundary continues to refuse every proxy environment.
async function runNativeProxyCommand(binary, source, registryConfig, environment, cwd, proxyOrigin, expectSuccess, forbiddenOutput) {
  const proxy = new URL(proxyOrigin);
  if (proxy.protocol !== "https:" || proxy.hostname !== "localhost" || !proxy.port || proxy.username || proxy.password ||
      proxy.pathname !== "/" || proxy.search || proxy.hash) fail("oras_proxy_endpoint_refused");
  const env = { ...cleanEnvironment(environment), HTTPS_PROXY: proxy.origin };
  await new Promise((resolve, reject) => {
    const child = spawn(binary, ["cp", "--from-oci-layout", source, "oras-test.invalid/oras-test:bootstrap",
      "--to-registry-config", registryConfig], { cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let failure;
    let size = 0;
    const forbidden = forbiddenOutput.map((value) => Buffer.from(value));
    const tailLength = Math.max(...forbidden.map((value) => value.length - 1));
    const kill = (code) => {
      failure ??= code;
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
    };
    const timer = setTimeout(() => kill("oras_proxy_timeout"), COMMAND_TIMEOUT_MS);
    const inspect = () => {
      let tail = Buffer.alloc(0);
      return (bytes) => {
        size += bytes.length;
        if (size > 1024 * 1024) kill("oras_proxy_output_limit");
        if (failure) return;
        const observed = Buffer.concat([tail, bytes]);
        if (forbidden.some((value) => observed.includes(value))) kill("oras_proxy_output_forbidden");
        tail = Buffer.from(observed.subarray(-tailLength));
      };
    };
    child.stdout.on("data", inspect());
    child.stderr.on("data", inspect());
    child.once("error", () => { failure ??= "oras_proxy_start_failed"; });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (failure) reject(policyError(failure));
      else if (expectSuccess && exitCode !== 0) reject(policyError("oras_proxy_positive_failed"));
      else if (!expectSuccess && exitCode === 0) reject(policyError("oras_proxy_negative_unexpected_success"));
      else resolve();
    });
  });
}

async function expectFailure(operation, expectedCode = "command_failed", forbidden = []) {
  try {
    await operation();
  } catch (error) {
    if (error?.code !== expectedCode) throw error;
    const publicFailure = JSON.stringify({
      code: error.code,
      durationMs: error.durationMs,
      exitCode: error.exitCode,
      message: error.message,
    });
    if (forbidden.some((value) => publicFailure.includes(value))) fail("oras_log_leak");
    return;
  }
  fail("oras_negative_unexpected_success");
}

export function verifyRegistryGraph(state, fixture) {
  if (state.failure || state.blobs.size !== 1 || state.manifests.size !== 2 ||
      !state.blobs.has(fixture.configDigest) || !state.manifests.has(fixture.parentDigest) ||
      !state.manifests.has(fixture.childDigest) ||
      [...state.blobs.keys()].some((key) => state.manifests.has(key))) fail("oras_registry_graph_mismatch");
  const expected = new Map([
    [fixture.configDigest, fixture.files.get(blobPath(fixture.configDigest))],
    [fixture.childDigest, fixture.files.get(blobPath(fixture.childDigest))],
    [fixture.parentDigest, fixture.files.get(blobPath(fixture.parentDigest))],
  ]);
  const actual = new Map([...state.blobs, ...state.manifests]);
  if (actual.size !== expected.size || state.uploads.size !== 0 || state.tags.size !== 1 ||
      state.tags.get("bootstrap") !== fixture.parentDigest) fail("oras_registry_graph_mismatch");
  for (const [valueDigest, bytes] of expected) {
    if (!actual.get(valueDigest)?.equals(bytes)) fail("oras_registry_graph_mismatch");
  }
}

export async function runOrasIntegration(args, environment = process.env) {
  assertOrasRuntime(process.platform, environment);
  const started = Date.now();
  const workspace = await validateWorkspace(args.workspace, args.output, environment.RUNNER_TEMP);
  await validateBinary(args.binary, args.sha256);
  const owned = await createOwnedDirectory(workspace);
  const ownedServers = [];
  const createServer = async (...parameters) => {
    const server = await startTlsServer(...parameters);
    ownedServers.push(server);
    return server;
  };
  let result;
  let operationFailure;
  try {
    const source = path.join(owned.path, "source");
    const destination = path.join(owned.path, "destination");
    await Promise.all([mkdir(source), mkdir(destination)]);
    const fixture = createBootstrapFixture();
    validateBootstrapFixture(fixture.files);
    await writeFixture(source, fixture.files);
    const baseEnvironment = { ...SAFE_ENVIRONMENT, HOME: owned.path, TMPDIR: owned.path };
    await runCp(args.binary, `${source}:bootstrap`, `${destination}:bootstrap`, ["--to-oci-layout"], baseEnvironment, owned.path);
    const copied = await readFixture(destination, fixture.files.keys());
    // Only fixed public fixture paths and bounded byte identities reach the log.
    // In particular, retain no copied JSON, temporary path or authentication data.
    process.stdout.write(`${JSON.stringify({ phase: "oras_copy_diagnostic", files: [...fixture.files.keys()].map((name) => ({
      path: name, sha256: digest(copied.get(name)).slice(7), size: copied.get(name).length,
    })) })}\n`);
    validateOrasCopiedFixture(copied);

    const tls = await createTlsIdentity(owned.path, baseEnvironment);
    const orasEnvironment = commandEnvironment(owned.path, tls.cert);
    const positiveState = createRegistryState();
    const positive = await createServer(tls.keyBytes, tls.certBytes, positiveState);
    const emptyAuth = path.join(owned.path, "empty-auth.json");
    await writeFile(emptyAuth, '{"auths":{}}\n', { flag: "wx", mode: 0o600 });
    try {
      await runCp(args.binary, `${source}:bootstrap`, `${positive.host}/oras-test:bootstrap`, ["--to-registry-config", emptyAuth], orasEnvironment, owned.path);
    } finally {
      await positive.close();
    }
    verifyRegistryGraph(positiveState, fixture);

    const credential = "oras-integration-credential-sentinel";
    const encodedCredential = Buffer.from(`autoworld:${credential}`).toString("base64");
    const authFile = path.join(owned.path, "sentinel-auth.json");
    const negatives = [];
    for (const mode of ["redirect", "bearer", "upload-location"]) {
      await writeFile(authFile, JSON.stringify({ auths: {} }), { flag: "w", mode: 0o600 });
      const forbidden = [credential, encodedCredential];
      const secondaryState = createRegistryState({ mode: "deny", sentinels: forbidden });
      const secondary = await createServer(tls.keyBytes, tls.certBytes, secondaryState, { inspectForLeaks: true });
      const primaryState = createRegistryState({ mode, secondaryOrigin: secondary.origin, credential: encodedCredential });
      const primary = await createServer(tls.keyBytes, tls.certBytes, primaryState);
      try {
        await writeFile(authFile, `${JSON.stringify({ auths: { [primary.host]: { auth: encodedCredential } } })}\n`, { flag: "w", mode: 0o600 });
        await expectFailure(() => runCp(args.binary, `${source}:bootstrap`, `${primary.host}/oras-test:bootstrap`,
          ["--to-registry-config", authFile], orasEnvironment, owned.path, forbidden), "command_failed", forbidden);
        if (secondaryState.leaks.length !== 0) {
          fail("oras_credential_transfer");
        }
        if (primaryState.failure || secondaryState.failure) fail("oras_negative_wrong_failure");
        if (primaryState.challenges === 0 || primaryState.authenticatedRequests === 0) fail("oras_negative_not_exercised");
        negatives.push(Object.freeze({ code: `${mode}_refused`, scope: "native_cli", challenges: primaryState.challenges,
          authenticatedRequests: primaryState.authenticatedRequests, secondaryRequests: secondaryState.requests }));
      } finally {
        await Promise.allSettled([primary.close(), secondary.close()]);
      }
    }

    const relayState = createRegistryState({ credential: encodedCredential });
    const relay = await createServer(tls.keyBytes, tls.certBytes, relayState);
    const proxyState = createRegistryState({ mode: "proxy", sentinels: [credential, encodedCredential] });
    const proxy = await createServer(tls.keyBytes, tls.certBytes, proxyState, { inspectForLeaks: true });
    try {
      await expectFailure(() => runCp(args.binary, `${source}:bootstrap`, `${proxy.host}/oras-test:bootstrap`,
        ["--to-registry-config", authFile], { ...orasEnvironment, HTTPS_PROXY: `https://autoworld:${credential}@${proxy.host}` }, owned.path),
      "environment_refused", [credential, encodedCredential]);
      if (proxyState.requests !== 0 || proxyState.leaks.length !== 0) fail("oras_proxy_boundary_failed");
      negatives.push(Object.freeze({ code: "proxy_environment_refused", scope: "subprocess_environment_boundary", nativeCommandExecuted: false, secondaryRequests: 0 }));
      await writeFile(authFile, `${JSON.stringify({ auths: { "oras-test.invalid": { auth: encodedCredential } } })}\n`, { flag: "w", mode: 0o600 });
      proxyState.mode = "proxy-relay";
      proxyState.tunnelPort = relay.port;
      await runNativeProxyCommand(args.binary, `${source}:bootstrap`, authFile, orasEnvironment, owned.path, proxy.origin, true, [credential, encodedCredential]);
      verifyRegistryGraph(relayState, fixture);
      if (proxyState.failure || relayState.authenticatedRequests === 0 || proxyState.challenges === 0 || proxyState.leaks.length !== 0) fail("oras_native_proxy_not_proven");
      negatives.push(Object.freeze({ code: "native_proxy_auth_scoped", scope: "native_cli", nativeCommandExecuted: true,
        authenticatedRequests: relayState.authenticatedRequests, proxyConnects: proxyState.challenges }));
      const priorChallenges = proxyState.challenges;
      proxyState.mode = "proxy";
      await runNativeProxyCommand(args.binary, `${source}:bootstrap`, authFile, orasEnvironment, owned.path, proxy.origin, false, [credential, encodedCredential]);
      if (proxyState.challenges <= priorChallenges) fail("oras_native_proxy_not_proven");
      if (proxyState.failure || proxyState.challenges === 0 || proxyState.requests === 0 || proxyState.leaks.length !== 0) fail("oras_native_proxy_not_proven");
      negatives.push(Object.freeze({ code: "native_proxy_connect_refused", scope: "native_cli", nativeCommandExecuted: true,
        challenges: proxyState.challenges, secondaryRequests: proxyState.requests }));
    } finally {
      await Promise.allSettled([proxy.close(), relay.close()]);
    }

    if (Date.now() - started > INTEGRATION_TIMEOUT_MS) fail("oras_integration_timeout");
    result = Object.freeze({
      binarySha256: args.sha256,
      childDigest: fixture.childDigest,
      configDigest: fixture.configDigest,
      negatives,
      parentDigest: fixture.parentDigest,
      phase: "oras_cli_integration",
      status: "passed",
    });
  } catch (error) {
    operationFailure = error;
    throw error;
  } finally {
    const closed = await Promise.allSettled(ownedServers.map((server) => server.close()));
    await removeOwnedDirectory(owned);
    if (!operationFailure && closed.some((entry) => entry.status === "rejected")) fail("oras_cleanup_failed");
  }
  const outputHandle = await open(args.output, "wx", 0o600);
  try {
    await outputHandle.writeFile(`${JSON.stringify(result)}\n`);
  } finally {
    await outputHandle.close();
  }
  return result;
}

async function main() {
  try {
    const args = parseOrasArguments(process.argv.slice(2));
    await runOrasIntegration(args);
  } catch (error) {
    process.stderr.write(`${typeof error?.code === "string" ? error.code : "oras_integration_failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
