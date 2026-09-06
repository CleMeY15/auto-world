import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBackupRuntime, restoreCheck } from "./backup.mjs";
import { protectedRecovery } from "./cancellation.mjs";
import { discardTestProject } from "./ephemeral.mjs";
import { initProject, loadProject, root, withProjectLock } from "./runtime.mjs";

// Only synthetic CI backups are cloned/tampered. Never mutate the valid backup.
export async function rejectUnsafeRestore(state, saved) {
  const backupRoot = join(root, ".local-data", "backups");
  for (const scenario of ["platform", "archive"]) {
    const backupId = randomUUID();
    const directory = join(backupRoot, backupId);
    await mkdir(directory, { mode: 0o700 });
    const manifest = globalThis.structuredClone(saved.manifest);
    manifest.backupId = backupId;
    if (scenario === "platform") manifest.images.postgres.platform.architecture = "arm64";
    else {
      for (const archive of Object.values(manifest.archives)) {
        await copyFile(join(backupRoot, saved.backupId, archive.filename), join(directory, archive.filename));
      }
      await chmod(join(directory, "postgres.tar"), 0o600);
      const file = await open(join(directory, "postgres.tar"), "r+");
      try { await file.write(Buffer.from("corrupt"), 0, 7, 0); }
      finally { await file.close(); }
    }
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    await assert.rejects(restoreCheck(state, backupId), (error) => error.code === (scenario === "platform" ? "backup_manifest_image_mismatch" : "backup_archive_tampered"));
  }

  const existing = await initProject({ test: true });
  try {
    const restore = createBackupRuntime({ uuid: () => existing.project.slice("aw-test-".length) });
    await assert.rejects(restore.restoreCheck(state, saved.backupId), (error) => error.code === "restore_target_exists");
    // A refused target is not reset or reinitialized, including its credentials.
    assert.deepEqual(await loadProject(existing.project), existing);
  } finally {
    await protectedRecovery(() => withProjectLock(existing, () => discardTestProject(existing)));
  }
}
