import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compose, images, InfraError, ownedVolumes, port, run, sql } from "./runtime.mjs";
import { conditionalRawWrite, rawKey } from "./raw-protocol.mjs";
import { withRawScratch } from "./ephemeral.mjs";
import { protectedRecovery } from "./cancellation.mjs";

export async function prepareTools(state) {
  const result = await run("docker", ["pull", "--platform", "linux/amd64", `${images.awsCli.repository}@${images.awsCli.manifestDigest}`], { timeoutMs: bounded(state, 600000) });
  if (result.code !== 0) throw new InfraError("infra_tool_pull_failed");
}

function bounded(state, milliseconds) {
  const remaining = (state.deadlineAt ?? Infinity) - Date.now();
  if (remaining < 1) throw new InfraError("deadline_exceeded");
  return Math.min(milliseconds, remaining);
}

async function cleanupS3Helper(state, name) {
  const result = await run("docker", ["container", "ls", "-aq", "--filter", `name=^/${name}$`], { timeoutMs: 10000 });
  if (result.code !== 0) throw new InfraError("infra_helper_cleanup_unverified");
  if (!result.stdout.trim()) return;
  const inspected = await run("docker", ["inspect", "--format", '{{index .Config.Labels "io.auto-world.owner"}}', name], { timeoutMs: 10000 });
  if (inspected.code !== 0 || inspected.stdout.trim() !== state.ownerToken) throw new InfraError("infra_helper_cleanup_unowned");
  const removed = await run("docker", ["rm", "-f", name], { timeoutMs: 10000 });
  if (removed.code !== 0) throw new InfraError("infra_helper_cleanup_failed");
}

export async function s3(state, operation, { key, bytes, timeoutMs = 15000, wrongKey = false } = {}) {
  if (!["create-bucket", "head-bucket", "put-object", "get-object", "head-object"].includes(operation)) throw new InfraError("infra_s3_operation_invalid");
  if (key !== undefined && !/^v1\/raw\/src_[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/run_[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/raw_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(key)) throw new InfraError("infra_s3_key_invalid");
  await ownedVolumes(state); // Verifies the exact network and container ownership too.
  return withRawScratch(state, (directory, id) => executeS3(state, operation, { key, bytes, timeoutMs, wrongKey }, directory, id));
}

async function executeS3(state, operation, { key, bytes, timeoutMs, wrongKey }, directory, id) {
  const name = `aw-helper-${id}`;
  if (bytes !== undefined) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 1048576) throw new InfraError("infra_s3_payload_invalid");
    await writeFile(join(directory, "input.bin"), bytes, { mode: 0o600, flag: "wx" });
  }
  const args = ["run", "--rm", "--name", name, "--label", `io.auto-world.owner=${state.ownerToken}`,
    "--user", `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    "--platform", "linux/amd64", "--network", `${state.project}_foundation`,
    "--memory", "256m", "--cpus", "0.5", "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,size=16m", "--ulimit", "fsize=2097152:2097152",
    "--mount", `type=bind,source=${directory},target=/work`,
    ...["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION", "AWS_EC2_METADATA_DISABLED", "AWS_REQUEST_CHECKSUM_CALCULATION", "AWS_RESPONSE_CHECKSUM_VALIDATION"].flatMap((key) => ["--env", key]),
    `${images.awsCli.repository}@${images.awsCli.manifestDigest}`,
    "--endpoint-url", "http://object-store:8333", "--no-cli-pager", "--no-cli-auto-prompt",
    "--cli-connect-timeout", "3", "--cli-read-timeout", "5", "s3api", operation, "--bucket", "aw-raw"];
  if (key !== undefined) args.push("--key", key);
  if (operation === "put-object") args.push("--if-none-match", "*", "--body", "/work/input.bin");
  if (operation === "get-object") args.push("/work/output.bin");
  let result;
  try {
    result = await run("docker", args, {
      timeoutMs: bounded(state, timeoutMs),
      env: { ...process.env, AWS_ACCESS_KEY_ID: wrongKey ? "0".repeat(64) : state.credentials.s3Access, AWS_SECRET_ACCESS_KEY: state.credentials.s3Secret, AWS_DEFAULT_REGION: "us-east-1", AWS_EC2_METADATA_DISABLED: "true", AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED", AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED" },
    });
  if (operation === "put-object") {
    if (result.code === 0) return "created";
    if (/\(PreconditionFailed\)|\(412\)/u.test(result.stderr)) return "precondition412";
    if (/\(ConditionalRequestConflict\)|\(409\)/u.test(result.stderr)) return "conflict409";
  }
  if (result.code !== 0) throw new InfraError("infra_s3_request_failed", { stderr: result.stderr });
  if (operation === "get-object") {
    const retrieved = await readFile(join(directory, "output.bin"));
    if (retrieved.length > 1048576) throw new InfraError("infra_s3_object_oversized");
    return retrieved;
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
  } finally {
    await protectedRecovery(() => cleanupS3Helper(state, name));
  }
}

export function writeRaw(state, reference, bytes, timeoutMs = 15000) {
  const key = rawKey(reference.source_id, reference.run_id, reference.snapshot_id);
  if (reference.object_key !== key) throw new InfraError("infra_s3_reference_mismatch");
  return conditionalRawWrite({ bytes, timeoutMs,
    put: (remaining) => s3(state, "put-object", { key, bytes, timeoutMs: remaining }),
    get: (remaining) => s3(state, "get-object", { key, timeoutMs: remaining }),
  });
}

export async function redis(state, ...args) {
  const result = await compose(state, ["exec", "--no-TTY", "redis", "redis-cli", "--raw", ...args], { timeoutMs: 15000 });
  return result.stdout.trim();
}

export async function search(state, method = "GET", path = "/_cluster/health", value) {
  if (!["GET", "PUT", "DELETE"].includes(method) || !/^\/[a-z0-9_/?=&-]*$/u.test(path)) throw new InfraError("infra_search_probe_invalid");
  const published = await port(state, "opensearch", 9200);
  const response = await globalThis.fetch(`http://127.0.0.1:${published}${path}`, {
    method, headers: { "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value), signal: globalThis.AbortSignal.timeout(bounded(state, 15000)),
  });
  if (!response.ok) throw new InfraError("infra_search_request_failed");
  return response.json();
}

export async function serviceHealth(state) {
  const probes = {
    postgres: async () => { if ((await sql(state, "SELECT 1;", { role: "reader" })).trim() !== "1") throw new InfraError("infra_sql_probe_failed"); },
    redis: async () => { if (await redis(state, "PING") !== "PONG") throw new InfraError("infra_redis_probe_failed"); },
    opensearch: async () => { const result = await search(state); if (!["green", "yellow"].includes(result.status)) throw new InfraError("infra_search_not_ready"); },
    "object-store": async () => { await s3(state, "head-bucket"); },
  };
  return Promise.all(Object.entries(probes).map(async ([service, probe]) => {
    const started = Date.now();
    try {
      await probe();
      return { service, phase: "usable-health", status: "passed", code: "ready", durationMs: Date.now() - started };
    } catch {
      return { service, phase: "usable-health", status: "failed", code: "dependency_unavailable", durationMs: Date.now() - started };
    }
  }));
}
