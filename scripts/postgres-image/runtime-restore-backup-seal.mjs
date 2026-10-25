import { readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sealPostgresSqlBackup, validatePostgresSqlBackupProof } from "./candidate-sql-backup-restore.mjs";

// A fixed UID1000 read-only seal entrypoint; never executes image code or modifies a dump.
export function runPostgresRuntimeBackupSeal(argv = process.argv.slice(2)) {
  if (argv.length || process.platform !== "linux" || process.getuid?.() !== 1000 || process.getgid?.() !== 1000
    || process.version !== "v22.23.2" || process.getgroups().some((gid) => gid !== 1000)
    || ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "GITHUB_ACTIONS"].some((key) => Object.hasOwn(process.env, key))) {
    throw new Error("postgres_runtime_restore_material_invalid");
  }
  const input = Buffer.alloc(4097); let size = 0;
  for (;;) {
    const count = readSync(0, input, size, input.length - size, null); size += count;
    if (size > 4096) throw new Error("postgres_runtime_restore_material_invalid");
    if (count === 0) break;
  }
  const proof = validatePostgresSqlBackupProof(JSON.parse(input.subarray(0, size).toString("utf8")));
  if (!/^\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}\/work\/backup$/u.test(proof.directory) || proof.identity.uid !== 1000 || proof.identity.gid !== 1000) {
    throw new Error("postgres_runtime_restore_material_invalid");
  }
  return sealPostgresSqlBackup(proof);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runPostgresRuntimeBackupSeal())); }
  catch { console.error(JSON.stringify({ state: "INCOMPLETE", code: "postgres_runtime_restore_material_invalid" })); process.exitCode = 1; }
}
