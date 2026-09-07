import { lstat, mkdir, opendir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyExpectedFile } from "./candidate-artifacts.mjs";
import { hashFileBounded } from "./native-audit.mjs";
import { createOwnedDirectory, policyError, removeOwnedDirectory } from "./process.mjs";
import { canonicalJsonBuffer, sha256 } from "./strict-json.mjs";

const MiB = 1024 ** 2;
const PHASES = ["staging", "scanner", "databases", "subjects", "fixtures", "complete"];
const SUBJECTS = ["oras-linux-amd64", "cosign-linux-amd64", "cosign-windows-amd64", "trivy-linux-amd64"];
const MATERIALS = ["gomod/go.mod", "gomod/go.sum", "gomod/submod/go.mod", "gomod/submod/go.sum",
  "gomod/submod2/go.mod", "gomod/submod2/go.sum", "java/test.war", "java/jackson-core-2.15.0.jar"];
const FILES = [
  ...SUBJECTS.map((subject) => ["staging", `${subject}/${subject.startsWith("cosign-windows") ? "cosign.exe" : subject.split("-")[0]}`, 512 * MiB]),
  ["scanner", "scanner-version.json", 8 * MiB],
  ...["vulnerability", "java"].flatMap((name) => [["databases", `databases/${name}.db`, 2048 * MiB], ["databases", `databases/${name}.metadata.json`, 8 * MiB]]),
  ...SUBJECTS.flatMap((subject) => ["build-info", "module-graph", "material-lock", "recipe", "receipt", "sbom", "report"]
    .map((name) => ["subjects", `${subject}/${name}.json`, ["sbom", "report"].includes(name) ? 64 * MiB : 8 * MiB])),
  ...MATERIALS.map((name) => ["fixtures", `fixtures/materials/${name}`, 4 * MiB]),
  ...["gomod-vulnerable", "java-war-vulnerable", "java-jar-clean-candidate"].map((name) => ["fixtures", `fixtures/reports/${name}.json`, 64 * MiB]),
  ["complete", "native-audit-results.json", 8 * MiB],
];
const fail = (code) => { throw policyError(code); };

async function verifyPublicDirectory(directory, expected) {
  const files = new Map(expected.map((entry) => [entry.path, entry]));
  const directories = new Set([""]);
  for (const relative of files.keys()) {
    let parent = path.posix.dirname(relative);
    while (parent !== ".") { directories.add(parent); parent = path.posix.dirname(parent); }
  }
  const visit = async (relative) => {
    const absolute = path.join(directory, relative);
    const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(absolute) !== absolute) fail("audit_package_inventory_changed");
    directories.delete(relative);
    for await (const entry of await opendir(absolute)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (directories.has(name)) await visit(name);
      else if (files.has(name)) {
        const expectedFile = files.get(name);
        const actual = await hashFileBounded(path.join(directory, name), expectedFile.size);
        if (actual.sha256 !== expectedFile.sha256 || actual.size !== expectedFile.size) fail("audit_package_inventory_changed");
        files.delete(name);
      } else fail("audit_package_inventory_changed");
    }
  };
  await visit("");
  if (files.size || directories.size) fail("audit_package_inventory_changed");
}

export function assertAuditPackageBudget(sizes) {
  if (!Array.isArray(sizes) || sizes.length > FILES.length || sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 2048 * MiB)) fail("audit_package_size_invalid");
  const total = sizes.reduce((sum, size) => sum + size, 64 * 1024);
  if (total > 6 * 1024 * MiB) fail("audit_package_size_exceeded");
  return total;
}

// The already-loaded orchestrator calls this after candidate execution. It
// never uploads the working directory. Ordinary failures retain a closed,
// phase-bounded subset of public diagnostics; a killed process publishes none.
export async function publishNativeAuditDiagnostics({ workspace, destination, phase, status }) {
  if (!path.isAbsolute(workspace) || !path.isAbsolute(destination) || path.dirname(workspace) !== path.dirname(destination) ||
      workspace === destination || !PHASES.includes(phase) || !["passed", "failed"].includes(status) ||
      status === "passed" && phase !== "complete") fail("audit_package_arguments_invalid");
  try { await lstat(destination); fail("audit_package_destination_exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const inventory = [];
  for (const [firstPhase, relative, cap] of FILES) {
    if (PHASES.indexOf(firstPhase) > PHASES.indexOf(phase)) continue;
    // A failed audit exports bounded reports/metadata only. Do not duplicate
    // large databases or executables when their job-budget gate itself failed.
    if (status === "failed" && (firstPhase === "staging" || relative.endsWith(".db") || relative.startsWith("fixtures/materials/"))) continue;
    const source = path.join(workspace, relative);
    try { await lstat(source); } catch (error) {
      if (error?.code === "ENOENT" && status === "failed") continue;
      throw error;
    }
    const identity = await hashFileBounded(source, cap);
    inventory.push({ path: relative, ...identity, cap });
    assertAuditPackageBudget(inventory.map((entry) => entry.size));
  }
  const staging = await createOwnedDirectory(path.dirname(destination));
  let published = false;
  try {
    for (const entry of inventory) {
      const source = path.join(workspace, entry.path);
      const target = path.join(staging.path, entry.path);
      await mkdir(path.dirname(target), { recursive: true });
      await copyExpectedFile(source, target, entry, entry.cap);
      const copied = await hashFileBounded(target, entry.cap);
      if (copied.sha256 !== entry.sha256 || copied.size !== entry.size) fail("audit_package_copy_changed");
      // Release only this known, verified work-file leaf. The job budget
      // reserves one maximum-size transient copy, not duplicate accumulation.
      await unlink(source);
    }
    const receipt = canonicalJsonBuffer({ schemaVersion: 1, state: "diagnostic_only", executionStatus: status, phase,
      files: inventory.map(({ path: relative, sha256, size }) => ({ path: relative, sha256, size })) });
    if (receipt.length > 64 * 1024) fail("audit_package_receipt_too_large");
    await writeFile(path.join(staging.path, "diagnostic-package.json"), receipt, { flag: "wx" });
    await verifyPublicDirectory(staging.path, [...inventory, { path: "diagnostic-package.json", sha256: sha256(receipt), size: receipt.length }]);
    await rename(staging.path, destination);
    published = true;
  } finally {
    if (!published) await removeOwnedDirectory(staging);
  }
  return { directory: destination, files: inventory.length };
}
