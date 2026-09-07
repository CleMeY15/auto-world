import { pathToFileURL } from "node:url";

export function dormantResult(args) {
  if (Array.isArray(args) && args.length === 1 && args[0] === "status") {
    return Object.freeze({
      schemaVersion: 1, state: "preparation_only", activation: "blocked",
      code: "platform_boundary_unavailable", capabilities: [],
    });
  }
  return Object.freeze({
    schemaVersion: 1, state: "refused", activation: "blocked",
    code: "privileged_operation_unavailable", capabilities: [],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = dormantResult(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.state === "refused" ? 1 : 0;
}
