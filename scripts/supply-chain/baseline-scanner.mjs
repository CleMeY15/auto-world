import { mkdir, realpath, statfs, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { createNativeCiIdentity, NATIVE_WORKFLOW_PATH } from "./ci-identity.mjs";
import { hashFileBounded, readFileBounded } from "./native-audit.mjs";
import { createOwnedDirectory, policyError, removeOwnedDirectory, runCommand } from "./process.mjs";
import { canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GiB = 1024 ** 3;
const DOCKER = "/usr/bin/docker";
const PARENT = "sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969";
const CHILD = "sha256:ee940acbf1f58ebadb42d01434ce4609530bf1b52536afbd1eee66cd7123c5c9";
const IMAGE = `aquasec/trivy@${CHILD}`;
const fail = (code) => { throw policyError(code); };

export function parseBaselineArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || !["inventory", "compare"].includes(argv[0])) fail("baseline_arguments_refused");
  return Object.freeze({ mode: argv[0] });
}

export function baselineInventoryArguments(configDirectory, operation) {
  if (typeof configDirectory !== "string" || !path.isAbsolute(configDirectory)) fail("baseline_arguments_refused");
  const prefix = ["--host", "unix:///var/run/docker.sock", "--config", configDirectory];
  const operations = {
    version: ["version", "--format", "{{json .}}"],
    info: ["info", "--format", "{{json .}}"],
    images: ["image", "ls", "--all", "--no-trunc", "--digests", "--format", "{{json .}}"],
    pull: ["image", "pull", "--platform", "linux/amd64", IMAGE],
    inspect: ["image", "inspect", IMAGE],
  };
  if (!Object.hasOwn(operations, operation)) fail("baseline_operation_refused");
  return [...prefix, ...operations[operation]];
}

function descriptor(value) {
  if (!value || !/^sha256:[a-f0-9]{64}$/u.test(value.digest ?? "") || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 2 * GiB) fail("baseline_manifest_invalid");
}

export function validateBaselineManifests(parentBytes, childBytes) {
  if (`sha256:${sha256(parentBytes)}` !== PARENT || `sha256:${sha256(childBytes)}` !== CHILD) fail("baseline_manifest_identity_mismatch");
  const parent = parseBoundedJson(parentBytes, { maxBytes: 64 * 1024 });
  const child = parseBoundedJson(childBytes, { maxBytes: 64 * 1024 });
  const selected = parent.manifests?.filter((entry) => entry.platform?.os === "linux" && entry.platform?.architecture === "amd64");
  if (parent.schemaVersion !== 2 || selected?.length !== 1 || selected[0].digest !== CHILD || selected[0].size !== childBytes.length ||
      child.schemaVersion !== 2 || !Array.isArray(child.layers) || child.layers.length < 1 || child.layers.length > 128) fail("baseline_manifest_invalid");
  for (const entry of [child.config, ...child.layers]) descriptor(entry);
  const compressedBytes = child.layers.reduce((sum, entry) => sum + entry.size, child.config.size);
  if (compressedBytes > 2 * GiB) fail("baseline_image_size_refused");
  return Object.freeze({ parent: PARENT, child: CHILD, config: child.config.digest, compressedBytes });
}

// Public registry authentication is held only in memory; redirects and all
// non-allowlisted hosts are refused. No token or HTTP header enters artifacts.
async function registryBytes(url, token) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.port || !["auth.docker.io", "registry-1.docker.io"].includes(target.hostname)) fail("baseline_registry_refused");
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    const request = https.get(target, { headers: {
      Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } }, (response) => {
      if (response.statusCode !== 200) { response.destroy(); reject(policyError("baseline_registry_response_refused")); return; }
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > 64 * 1024) response.destroy(policyError("baseline_registry_size_refused"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", () => reject(policyError("baseline_registry_failed")));
    });
    request.setTimeout(60_000, () => request.destroy(policyError("baseline_registry_timeout")));
    const deadline = setTimeout(() => request.destroy(policyError("baseline_registry_timeout")), 60_000);
    request.once("close", () => clearTimeout(deadline));
    request.on("error", () => reject(policyError("baseline_registry_failed")));
  });
}

function imageInventory(bytes) {
  const rows = bytes.toString("utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => parseBoundedJson(Buffer.from(line), { maxBytes: 64 * 1024 }));
  if (rows.length > 1000 || rows.some((entry) => !/^sha256:[a-f0-9]{64}$/u.test(entry.ID ?? ""))) fail("baseline_image_inventory_invalid");
  return [...new Set(rows.map((entry) => entry.ID))].sort();
}

// Inventory is an explicit managed-Docker TCB proposal. It never runs, creates
// or builds a container. Actual comparison needs a separately reviewed receipt.
export async function inventoryBaseline() {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !path.isAbsolute(process.env.RUNNER_TEMP ?? "")) fail("baseline_requires_secret_free_linux_ci");
  if (!/^[0-9]{8}\.[0-9]+\.[0-9]+$/u.test(process.env.ImageVersion ?? "")) fail("baseline_runner_identity_missing");
  const runnerTemp = await realpath(process.env.RUNNER_TEMP);
  const work = await createOwnedDirectory(runnerTemp);
  const evidence = path.join(runnerTemp, "baseline-inventory");
  await mkdir(evidence, { recursive: false });
  try {
    const config = path.join(work.path, "docker-config");
    await mkdir(config, { mode: 0o700 });
    const env = { PATH: "/usr/bin:/bin", HOME: work.path, TMPDIR: work.path,
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
    const options = { cwd: work.path, env, timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 };
    const git = ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-C", ROOT];
    const head = (await runCommand("/usr/bin/git", [...git, "rev-parse", "HEAD^{commit}"], options)).stdout.toString("utf8").trim();
    if (head !== process.env.GITHUB_SHA) fail("baseline_checkout_identity_mismatch");
    await runCommand("/usr/bin/git", [...git, "ls-files", "--error-unmatch", "--", NATIVE_WORKFLOW_PATH, "scripts/supply-chain/baseline-scanner.mjs"], options);
    if ((await runCommand("/usr/bin/git", [...git, "status", "--porcelain", "--untracked-files=no"], options)).stdout.length) fail("baseline_checkout_identity_mismatch");
    const run = createNativeCiIdentity(process.env, await readFileBounded(path.join(ROOT, NATIVE_WORKFLOW_PATH), 64 * 1024));
    const dockerIdentity = await hashFileBounded(DOCKER, 512 * 1024 * 1024);
    const dpkgIdentity = await hashFileBounded("/usr/bin/dpkg-query", 16 * 1024 * 1024);
    const aptIdentity = await hashFileBounded("/usr/bin/apt-cache", 16 * 1024 * 1024);
    const owner = (await runCommand("/usr/bin/dpkg-query", ["--search", DOCKER], options)).stdout.toString("utf8").trim();
    const packageName = owner.split(": ")[0];
    if (!["docker-ce-cli", "docker.io", "moby-cli"].includes(packageName) || owner !== `${packageName}: ${DOCKER}`) fail("baseline_docker_package_unknown");
    const packageInfo = (await runCommand("/usr/bin/dpkg-query", ["--show", "--showformat=${Package}\t${Version}\t${Architecture}\n", packageName], options)).stdout;
    const packageOrigin = (await runCommand("/usr/bin/apt-cache", ["policy", packageName], options)).stdout;
    const invoke = async (operation) => runCommand(DOCKER, baselineInventoryArguments(config, operation), { ...options, timeoutMs: operation === "pull" ? 5 * 60_000 : options.timeoutMs });
    const versionBytes = (await invoke("version")).stdout;
    const version = parseBoundedJson(versionBytes);
    const infoBytes = (await invoke("info")).stdout;
    const info = parseBoundedJson(infoBytes);
    if (!version.Client?.Version || !version.Server?.Version || version.Server.Os !== "linux" || version.Server.Arch !== "amd64" ||
        !Array.isArray(version.Server.Components) || version.Server.Components.length > 20 || info.OSType !== "linux" || info.DockerRootDir !== "/var/lib/docker") fail("baseline_docker_runtime_refused");
    const runtime = { version, info: { ID: info.ID, Driver: info.Driver, DockerRootDir: info.DockerRootDir,
      SecurityOptions: info.SecurityOptions, Runtimes: info.Runtimes, DefaultRuntime: info.DefaultRuntime,
      KernelVersion: info.KernelVersion, OperatingSystem: info.OperatingSystem, Architecture: info.Architecture } };
    await writeFile(path.join(evidence, "managed-docker.json"), canonicalJsonBuffer({ run, runnerImageVersion: process.env.ImageVersion,
      cli: { path: DOCKER, ...dockerIdentity }, packageName, packageInfo: packageInfo.toString("utf8"), packageOrigin: packageOrigin.toString("utf8"),
      metadataTools: { dpkg: dpkgIdentity, apt: aptIdentity }, runtime }), { flag: "wx" });

    const auth = parseBoundedJson(await registryBytes("https://auth.docker.io/token?service=registry.docker.io&scope=repository:aquasec/trivy:pull"));
    if (typeof auth.token !== "string" || auth.token.length > 16384) fail("baseline_registry_auth_invalid");
    const parentBytes = await registryBytes(`https://registry-1.docker.io/v2/aquasec/trivy/manifests/${PARENT}`, auth.token);
    const childBytes = await registryBytes(`https://registry-1.docker.io/v2/aquasec/trivy/manifests/${CHILD}`, auth.token);
    const manifests = validateBaselineManifests(parentBytes, childBytes);
    await writeFile(path.join(evidence, "parent.json"), parentBytes, { flag: "wx" });
    await writeFile(path.join(evidence, "child.json"), childBytes, { flag: "wx" });
    const disk = await statfs("/var/lib/docker", { bigint: true });
    const freeBytes = disk.bavail * disk.bsize;
    if (freeBytes < BigInt(8 * GiB + 2 * manifests.compressedBytes)) fail("baseline_disk_budget_refused");
    const before = imageInventory((await invoke("images")).stdout);
    await invoke("pull");
    const inspected = parseBoundedJson((await invoke("inspect")).stdout);
    if (!Array.isArray(inspected) || inspected.length !== 1) fail("baseline_image_identity_mismatch");
    const image = inspected[0];
    if (image.Id !== manifests.config || image.Os !== "linux" || image.Architecture !== "amd64" ||
        !image.RepoDigests?.includes(IMAGE) || !Number.isSafeInteger(image.Size) || image.Size < 1 || image.Size > 2 * GiB) fail("baseline_image_identity_mismatch");
    const after = imageInventory((await invoke("images")).stdout);
    if (before.some((id) => !after.includes(id)) || after.some((id) => !before.includes(id) && id !== image.Id)) fail("baseline_image_store_changed");
    await writeFile(path.join(evidence, "inventory.json"), canonicalJsonBuffer({ schemaVersion: 1, state: "diagnostic_tcb_proposal",
      baselineState: "failed_non_admitted", run, recipeSha256: sha256(await readFileBounded(fileURLToPath(import.meta.url), 1024 * 1024)),
      manifests, localImage: { id: image.Id, size: image.Size, os: image.Os, architecture: image.Architecture,
        user: image.Config?.User, entrypoint: image.Config?.Entrypoint, command: image.Config?.Cmd },
      imageStore: { before, after }, availableBytesBeforePull: String(freeBytes), containersExecuted: 0 }), { flag: "wx" });
  } finally {
    await removeOwnedDirectory(work);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseBaselineArgs(process.argv.slice(2));
    if (args.mode === "compare") fail("baseline_comparison_review_required");
    await inventoryBaseline();
  } catch (error) {
    process.stderr.write(`${typeof error?.code === "string" ? error.code : "baseline_inventory_failed"}\n`);
    process.exitCode = 1;
  }
}
