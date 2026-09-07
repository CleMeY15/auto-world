import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { InfraError, loadProject, ownedVolumes, run, serviceStates } from "./runtime.mjs";
import { protectedRecovery } from "./cancellation.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export async function removeGeneratedDirectory(directory, parent, expectedName, allowed, identity) {
  if (resolve(dirname(directory)) !== resolve(parent) || basename(directory) !== expectedName) throw new InfraError("ephemeral_path_invalid");
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new InfraError("ephemeral_path_invalid");
  if (identity && (details.dev !== identity.dev || details.ino !== identity.ino)) throw new InfraError("ephemeral_owner_mismatch");
  const actual = await realpath(directory);
  if (dirname(actual) !== await realpath(parent) || basename(actual) !== expectedName) throw new InfraError("ephemeral_path_invalid");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!allowed.has(entry.name) || entry.isSymbolicLink()) throw new InfraError("ephemeral_unexpected_file");
    if (entry.isDirectory()) {
      if (entry.name !== "helpers" || (await readdir(join(directory, entry.name))).length !== 0) throw new InfraError("ephemeral_unexpected_file");
    } else if (!entry.isFile()) throw new InfraError("ephemeral_unexpected_file");
  }
  // Exact newly generated directory, validated above; never a broad project/root deletion.
  await rm(actual, { recursive: true, force: false });
}

export async function withRawScratch(state, action) {
  const identifier = randomUUID();
  const parent = join(state.dir, "helpers");
  const directory = join(parent, identifier);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, "owner"), state.ownerToken, { mode: 0o600, flag: "wx" });
  try {
    return await action(directory, identifier);
  } finally {
    await protectedRecovery(async () => {
      if (!uuid.test(identifier) || await readFile(join(directory, "owner"), "utf8") !== state.ownerToken) throw new InfraError("ephemeral_owner_mismatch");
      await removeGeneratedDirectory(directory, parent, identifier, new Set(["owner", "input.bin", "output.bin"]));
    });
  }
}

// Only for freshly generated integration/restore projects, after reset, while locked.
// Ordinary local reset intentionally retains its credentials and backups.
export async function discardTestProject(state, { load = loadProject, volumes = ownedVolumes, states = serviceStates, runProcess = run } = {}) {
  const identifier = state.project.slice("aw-test-".length);
  if (!state.project.startsWith("aw-test-") || !uuid.test(identifier)) throw new InfraError("ephemeral_project_invalid");
  const loaded = await load(state.project);
  if (loaded.ownerToken !== state.ownerToken || loaded.dir !== state.dir || loaded.checkout !== state.checkout) throw new InfraError("ephemeral_owner_mismatch");
  if ((await readFile(join(state.dir, "operation.lock"), "utf8")).trim() !== String(process.pid)) throw new InfraError("ephemeral_lock_required");
  if ((await volumes(state)).length || Object.values(await states(state)).some((value) => value.state !== "absent")) throw new InfraError("ephemeral_resources_remain");
  const networks = await runProcess("docker", ["network", "ls", "--filter", `label=com.docker.compose.project=${state.project}`, "--format", "{{.Name}}"], { timeoutMs: 10000 });
  if (networks.code !== 0 || networks.stdout.trim()) throw new InfraError("ephemeral_resources_remain");
  await removeGeneratedDirectory(state.dir, join(state.checkout, ".local-data", "projects"), state.project, new Set(["state.json", "env", "s3.json", "operation.lock", "helpers"]));
}
