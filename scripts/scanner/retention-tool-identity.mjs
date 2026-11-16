import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PROFILE_BYTES = 3070;
const PROFILE_SHA256 = "63ade7c710fe29cedb2a6f558935d0fe8533451b48bc23e6bbc7a4b337ea606a";
const fail = (reason) => { throw new Error(`scanner_retention_publish_${reason}`); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Only these reviewed repository bytes define the two allowed publisher hosts.
// No path, environment variable or caller-provided profile selects this policy.
export function validateScannerRetentionPublisherToolProfileBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== PROFILE_BYTES || sha256(bytes) !== PROFILE_SHA256) {
    fail("tool_profile_identity_invalid");
  }
  return freeze(JSON.parse(bytes.toString("utf8")));
}

export const SCANNER_RETENTION_PUBLISHER_TOOLS = validateScannerRetentionPublisherToolProfileBytes(
  readFileSync(new URL("../../infra/scanner/retention-publisher-tools.json", import.meta.url)),
);

function commandRecord(stdout) {
  if (typeof stdout !== "string" || stdout.length === 0 || Buffer.byteLength(stdout, "utf8") > 65536) {
    fail("tool_identity_invalid");
  }
  // Remove only a command's optional single LF, never trim or reserialize JSON.
  const record = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  if (record.length === 0 || /[\r\n\0]/u.test(record)) fail("tool_identity_invalid");
  return record;
}

export function validateScannerRetentionPublisherTools(observed) {
  if (observed === null || typeof observed !== "object") fail("tool_identity_invalid");
  const docker = commandRecord(observed.docker);
  const buildx = commandRecord(observed.buildx);
  const go = commandRecord(observed.go);
  const policy = SCANNER_RETENTION_PUBLISHER_TOOLS;
  if (buildx !== policy.buildx || go !== policy.go) fail("tool_identity_invalid");
  const profile = policy.dockerProfiles.find((candidate) => candidate.identity === docker
    && candidate.bytes === Buffer.byteLength(docker, "utf8") && candidate.sha256 === sha256(docker));
  if (!profile) fail("tool_identity_invalid");
  return Object.freeze({ profileId: profile.id, profileSha256: profile.sha256, docker, buildx, go });
}

export function validateScannerRetentionQualificationTools(bytes) {
  const policy = SCANNER_RETENTION_PUBLISHER_TOOLS;
  const expected = policy.qualificationRunnerTools;
  if (!Buffer.isBuffer(bytes) || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    fail("qualification_tool_identity_invalid");
  }
  const records = bytes.toString("utf8").split("\n");
  // The AWS extension never rewrites or substitutes the original Azure evidence.
  for (const identity of [policy.dockerProfiles[0].identity, policy.go, policy.buildx]) {
    if (records.filter((record) => record === identity).length !== 1) {
      fail("qualification_tool_identity_invalid");
    }
  }
  return true;
}
