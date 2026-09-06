import { pathToFileURL } from "node:url";
import { initProject, loadProject, withProjectLock, InfraError, compose, pull, up, stop, start, down, reset } from "./runtime.mjs";
import { migrate } from "./migrations.mjs";
import { prepareTools, s3, serviceHealth } from "./probes.mjs";
import { backup, restoreCheck } from "./backup.mjs";
import { withCancellation } from "./cancellation.mjs";

export function parseCommand(args) {
  const [command, ...rest] = args;
  if (!["init", "up", "status", "migrate", "stop", "start", "down", "reset", "backup", "restore-check"].includes(command)) throw new InfraError("infra_command_invalid");
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!["--project", "--service", "--direction", "--backup"].includes(name) || typeof value !== "string" || value.startsWith("--") || Object.hasOwn(options, name)) throw new InfraError("infra_options_invalid");
    options[name] = value;
  }
  if (options["--service"] !== undefined && !["stop", "start"].includes(command)) throw new InfraError("infra_options_invalid");
  if (options["--service"] !== undefined && !["postgres", "redis", "opensearch", "object-store"].includes(options["--service"])) throw new InfraError("infra_options_invalid");
  if (options["--direction"] !== undefined && (command !== "migrate" || !["up", "down"].includes(options["--direction"]))) throw new InfraError("infra_options_invalid");
  if (options["--backup"] !== undefined && command !== "restore-check") throw new InfraError("infra_options_invalid");
  if (command === "restore-check" && options["--backup"] === undefined) throw new InfraError("infra_backup_id_required");
  return { command, project: options["--project"], services: options["--service"] === undefined ? undefined : [options["--service"]], direction: options["--direction"] ?? "up", backupId: options["--backup"] };
}

export async function main(args) {
  const selected = parseCommand(args);
  if (selected.command === "init") {
    const state = await initProject({ project: selected.project });
    return { phase: "init", status: "passed", code: "local_credentials_initialized", project: state.project };
  }
  const state = { ...await loadProject(selected.project), deadlineAt: Date.now() + 20 * 60000 };
  return withProjectLock(state, async () => {
    switch (selected.command) {
      case "up": {
        await compose(state, ["config", "--quiet"], { timeoutMs: 10000 });
        const pulling = { ...state, deadlineAt: Math.min(state.deadlineAt, Date.now() + 600000) };
        await pull(pulling);
        await prepareTools(pulling);
        await up(state);
        await migrate(state);
        try { await s3(state, "head-bucket"); } catch { await s3(state, "create-bucket"); }
        const health = await serviceHealth(state);
        if (health.some((entry) => entry.status !== "passed")) throw new InfraError("infra_usable_readiness_failed");
        return { phase: "up", status: "passed", code: "services_and_schema_ready", health };
      }
      case "status": return { phase: "status", health: await serviceHealth(state) };
      case "migrate": await migrate(state, selected.direction); break;
      case "stop": await stop(state, selected.services); break;
      case "start": await start(state, selected.services); break;
      case "down": await down(state); break;
      case "reset": {
        const result = await reset(state);
        return { phase: "reset", status: "passed", code: "owned_data_volumes_removed_backups_preserved", removedVolumes: result.removedVolumes };
      }
      case "backup": {
        const saved = await backup(state);
        return { phase: "backup", status: "passed", code: "cold_archives_created", backupId: saved.backupId };
      }
      case "restore-check": {
        await prepareTools(state);
        const restored = await restoreCheck(state, selected.backupId);
        return { phase: "restore-check", status: "passed", code: "isolated_restore_verified_and_removed", project: restored.project };
      }
    }
    return { phase: selected.command, status: "passed", code: "operation_completed" };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await withCancellation(() => main(process.argv.slice(2)));
    console.log(JSON.stringify(result));
    if (result.health?.some((entry) => entry.status !== "passed")) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", code: error instanceof InfraError ? error.code : "infra_operation_failed" }));
    process.exitCode = 1;
  }
}
