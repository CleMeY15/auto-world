import assert from "node:assert/strict";
import { access, link, mkdir, readFile, readdir, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertAuditPackageBudget, publishNativeAuditDiagnostics } from "../scripts/supply-chain/audit-artifacts.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import { sha256 } from "../scripts/supply-chain/strict-json.mjs";

test("failed scan packaging retains only its closed phase-specific public diagnostics", async () => {
  const owned = await createOwnedDirectory();
  try {
    const workspace = path.join(owned.path, "work");
    const destination = path.join(owned.path, "public");
    await mkdir(workspace);
    const bytes = Buffer.from('{"Version":"diagnostic only"}');
    await writeFile(path.join(workspace, "scanner-version.json"), bytes);
    await writeFile(path.join(workspace, "unexpected-private-scratch"), "excluded");
    await writeFile(path.join(workspace, "native-audit-results.json"), "premature fake success");
    await publishNativeAuditDiagnostics({ workspace, destination, phase: "scanner", status: "failed" });
    assert.deepEqual((await readdir(destination)).sort(), ["diagnostic-package.json", "scanner-version.json"]);
    assert.deepEqual(await readFile(path.join(destination, "scanner-version.json")), bytes);
    const receipt = JSON.parse(await readFile(path.join(destination, "diagnostic-package.json"), "utf8"));
    assert.equal(receipt.executionStatus, "failed");
    assert.equal(receipt.state, "diagnostic_only");
    assert.deepEqual(receipt.files, [{ path: "scanner-version.json", sha256: sha256(bytes), size: bytes.length }]);
    await assert.rejects(access(path.join(workspace, "scanner-version.json")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(workspace, "unexpected-private-scratch"), "utf8"), "excluded");
  } finally { await removeOwnedDirectory(owned); }
});

test("package rejects hardlinked or oversized known leaves before publishing", async () => {
  const owned = await createOwnedDirectory();
  try {
    for (const attack of ["hardlink", "oversized"]) {
      const workspace = path.join(owned.path, attack);
      const destination = path.join(owned.path, `${attack}-public`);
      await mkdir(workspace);
      const leaf = path.join(workspace, "scanner-version.json");
      if (attack === "hardlink") {
        const target = path.join(owned.path, "original");
        await writeFile(target, "must not be moved or uploaded");
        await link(target, leaf);
      } else { await writeFile(leaf, "x"); await truncate(leaf, 8 * 1024 ** 2 + 1); }
      await assert.rejects(publishNativeAuditDiagnostics({ workspace, destination, phase: "scanner", status: "failed" }),
        { code: attack === "hardlink" ? "evidence_path_invalid" : "evidence_size_invalid" });
      await assert.rejects(access(destination), { code: "ENOENT" });
      await access(leaf);
    }
  } finally { await removeOwnedDirectory(owned); }
});

test("successful packaging requires complete evidence and cannot overwrite an existing destination", async () => {
  const owned = await createOwnedDirectory();
  try {
    const workspace = path.join(owned.path, "work");
    const destination = path.join(owned.path, "public");
    await mkdir(workspace);
    await assert.rejects(publishNativeAuditDiagnostics({ workspace, destination, phase: "complete", status: "passed" }), { code: "ENOENT" });
    await assert.rejects(access(destination), { code: "ENOENT" });
    await mkdir(destination);
    await writeFile(path.join(destination, "sentinel"), "preserve");
    await assert.rejects(publishNativeAuditDiagnostics({ workspace, destination, phase: "staging", status: "failed" }), { code: "audit_package_destination_exists" });
    assert.equal(await readFile(path.join(destination, "sentinel"), "utf8"), "preserve");
  } finally { await removeOwnedDirectory(owned); }
});

test("package accounting includes its inventory receipt in the six-GiB ceiling", () => {
  const GiB = 1024 ** 3;
  assert.equal(assertAuditPackageBudget([2 * GiB, 2 * GiB, 2 * GiB - 64 * 1024]), 6 * GiB);
  assert.throws(() => assertAuditPackageBudget([2 * GiB, 2 * GiB, 2 * GiB - 64 * 1024 + 1]), { code: "audit_package_size_exceeded" });
  for (const sizes of [[2 * GiB + 1], [-1], [Number.MAX_SAFE_INTEGER + 1]]) assert.throws(() => assertAuditPackageBudget(sizes));
});
