import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateImageReport } from "./audit-policy.mjs";
import { assertLocalDocker, images, root, run, InfraError } from "./runtime.mjs";
import { operationSignal, protectedRecovery, withCancellation } from "./cancellation.mjs";

const owner = randomUUID();
const base = join(root, ".local-data", "audits", owner);
const cache = join(base, "cache");
const reports = join(base, "evidence");
const scanner = `${images.trivy.repository}@${images.trivy.manifestDigest}`;
const deadline = Date.now() + 28 * 60000;

async function cleanupScanner(name) {
  // Killing a Docker CLI does not guarantee that its remote helper stopped.
  const remaining = await run("docker", ["container", "ls", "-aq", "--filter", `name=^/${name}$`], { timeoutMs: 10000 });
  if (remaining.code !== 0) throw new InfraError("infra_audit_cleanup_unverified");
  if (!remaining.stdout.trim()) return;
  const inspected = await run("docker", ["inspect", "--format", '{{index .Config.Labels "io.auto-world.owner"}}', name], { timeoutMs: 10000 });
  if (inspected.code !== 0 || inspected.stdout.trim() !== owner) throw new InfraError("infra_audit_cleanup_unowned");
  const removed = await run("docker", ["rm", "-f", name], { timeoutMs: 15000 });
  if (removed.code !== 0) throw new InfraError("infra_audit_cleanup_failed");
}

async function scan(key, pin) {
  const name = `aw-audit-${owner}-${key.toLowerCase()}`;
  const started = Date.now();
  const scratch = join(base, "scratch", key);
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const args = ["run", "--rm", "--name", name, "--label", `io.auto-world.owner=${owner}`,
    "--user", `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    "--platform", "linux/amd64", "--memory", "1536m", "--cpus", "2", "--pids-limit", "256",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
    "--mount", `type=bind,source=${scratch},target=/tmp`,
    "--mount", `type=bind,source=${cache},target=/cache`, "--mount", `type=bind,source=${reports},target=/reports`,
    scanner, "image", "--cache-dir", "/cache", "--image-src", "remote", "--platform", "linux/amd64",
    "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "--format", "json", "--output", `/reports/${key}.json`,
    "--timeout", "4m", "--disable-telemetry", "--no-progress", "--ignorefile", "/dev/null",
    `${pin.repository}@${pin.manifestDigest}`];
  try {
    const result = await run("docker", args, { timeoutMs: Math.min(300000, deadline - Date.now()) });
    if (result.code !== 0) {
      const categories = [
        ["image_pull_rate_limit", /toomanyrequests|rate.limit/iu],
        ["image_manifest_unavailable", /manifest unknown|not found|no matching manifest/iu],
        ["image_access_denied", /unauthorized|denied|forbidden/iu],
        ["scanner_flag_invalid", /unknown flag|flag provided but not defined/iu],
        ["scanner_readonly_filesystem", /read.only file system/iu],
        ["scanner_permission_denied", /permission denied/iu],
        ["scanner_database_download_failed", /failed to download|database.*error|db error/iu],
        ["scanner_network_failed", /no such host|connection refused|timeout|certificate/iu],
        ["scanner_out_of_space", /no space left/iu],
      ].filter(([, pattern]) => pattern.test(result.stderr)).map(([code]) => code);
      await writeFile(join(reports, `${key}-failure.json`), JSON.stringify({ exitCode: result.code, categories }, null, 2), { flag: "wx" });
      throw new InfraError(categories[0] ?? "infra_image_scan_failed");
    }
  } finally {
    await protectedRecovery(() => cleanupScanner(name));
  }
  const report = JSON.parse(await readFile(join(reports, `${key}.json`), "utf8"));
  const database = JSON.parse(await readFile(join(cache, "db", "metadata.json"), "utf8"));
  if (!Number.isFinite(Date.parse(database.UpdatedAt)) || !Number.isFinite(Date.parse(database.DownloadedAt))) throw new InfraError("infra_audit_database_metadata_missing");
  await writeFile(join(reports, `${key}-database.json`), JSON.stringify({ image: pin, scanner: images.trivy, database, scannedAt: new Date().toISOString() }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ service: key, phase: "image-audit", status: "scanned", code: "report_retained", durationMs: Date.now() - started }));
  return report;
}

await withCancellation(async () => {
try {
  await assertLocalDocker();
  await mkdir(cache, { recursive: true, mode: 0o700 });
  await mkdir(reports, { mode: 0o700 });
  const policy = JSON.parse(await readFile(join(root, "infra", "image-risk-dispositions.json"), "utf8"));
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.dispositions)) throw new InfraError("infra_audit_policy_invalid");
  const summary = [];
  for (const [key, pin] of Object.entries(images)) {
    if (operationSignal()?.aborted) throw new InfraError("process_cancelled");
    try {
      const result = evaluateImageReport(await scan(key, pin), pin, policy.dispositions);
      summary.push({ image: key, ...result });
    } catch (error) {
      summary.push({ image: key, findings: [], blockers: [{ code: error instanceof InfraError ? error.code : "infra_audit_validation_failed" }] });
    }
  }
  await writeFile(join(reports, "summary.json"), JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), images: summary }, null, 2), { flag: "wx" });
  if (summary.some((entry) => entry.blockers.length)) throw new InfraError("infra_image_audit_blocked");
  console.log(JSON.stringify({ phase: "image-audit", status: "passed", code: "all_pins_audited" }));
} catch (error) {
  console.error(JSON.stringify({ phase: "image-audit", status: "failed", code: error instanceof InfraError ? error.code : "infra_audit_failed" }));
  process.exitCode = 1;
}
});
