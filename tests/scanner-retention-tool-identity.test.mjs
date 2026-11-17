import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCANNER_RETENTION_PUBLISHER_TOOLS,
  validateScannerRetentionPublisherToolProfileBytes,
  validateScannerRetentionPublisherTools,
  validateScannerRetentionQualificationTools,
} from "../scripts/scanner/retention-tool-identity.mjs";

const profileBytes = readFileSync(new URL("../infra/scanner/retention-publisher-tools.json", import.meta.url));
const policy = SCANNER_RETENTION_PUBLISHER_TOOLS;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const toolError = { message: "scanner_retention_publish_tool_identity_invalid" };
const profileError = { message: "scanner_retention_publish_tool_profile_identity_invalid" };
const qualificationError = { message: "scanner_retention_publish_qualification_tool_identity_invalid" };
const observations = (profile = policy.dockerProfiles[0]) => ({ docker: profile.identity, buildx: policy.buildx, go: policy.go });
const originalQualification = Buffer.from([
  "v22.23.4",
  "gh version 2.103.3 (2026-10-26)",
  "https://github.com/cli/cli/releases/tag/v2.103.3",
  policy.go,
  policy.dockerProfiles[0].identity,
  "Docker Compose version v2.38.2",
  policy.buildx,
  "",
].join("\n"), "utf8");

test("publisher policy authenticates the two complete reviewed Docker records", () => {
  assert.equal(profileBytes.length, 3070);
  assert.equal(sha256(profileBytes), "63ade7c710fe29cedb2a6f558935d0fe8533451b48bc23e6bbc7a4b337ea606a");
  assert.deepEqual(policy.dockerProfiles.map(({ id, bytes, sha256: digest }) => ({ id, bytes, digest })), [
    { id: "ubuntu-24.04-azure-7.0.0-1017", bytes: 1077, digest: "f84a732dfdccfea6fe1ce0a1d40a45f6d9bde5a053a6b4ad35b19ad565fa7dc8" },
    { id: "ubuntu-24.04-aws-7.0.0-1014", bytes: 1073, digest: "7ee869527b3a74ef1321335fa757c180a4e4697a56a6cece56c3e6484dc4d9cd" },
  ]);
  assert.equal(policy.go, "go version go1.24.13 linux/amd64");
  assert.equal(policy.buildx, "github.com/docker/buildx v0.38.1 0dbe87f36ed472fe36b6796c3f70b4210a731fc5");
  for (const profile of policy.dockerProfiles) {
    assert.equal(Buffer.byteLength(profile.identity, "utf8"), profile.bytes);
    assert.equal(sha256(profile.identity), profile.sha256);
  }
  const loaded = validateScannerRetentionPublisherToolProfileBytes(profileBytes);
  assert.deepEqual(loaded, policy);
  assert.ok(Object.isFrozen(loaded) && Object.isFrozen(loaded.dockerProfiles)
    && loaded.dockerProfiles.every(Object.isFrozen) && Object.isFrozen(loaded.qualificationRunnerTools));
  assert.throws(() => { loaded.dockerProfiles[0].identity = "substituted"; }, TypeError);
});

for (const profile of policy.dockerProfiles) {
  test(`publisher accepts only exact records with zero or one LF: ${profile.id}`, () => {
    for (let endings = 0; endings < 8; endings += 1) {
      const input = observations(profile);
      for (const [index, field] of ["docker", "buildx", "go"].entries()) {
        if (endings & (1 << index)) input[field] += "\n";
      }
      const result = validateScannerRetentionPublisherTools(input);
      assert.deepEqual(result, { profileId: profile.id, profileSha256: profile.sha256, ...observations(profile) });
      assert.ok(Object.isFrozen(result));
    }
  });
}

test("publisher refuses command framing changes, truncation, wrong types and missing records", () => {
  for (const field of ["docker", "buildx", "go"]) {
    const original = observations()[field];
    for (const value of [undefined, null, 42, Buffer.from(original), "", "\n", `${original}\r\n`,
      `${original}\n\n`, `${original}\0`, `${original}\n${original}`, ` ${original}`, `${original} `,
      `${original}\t`, `\n${original}`, original.slice(0, -1), `${original}\u2028`, "x".repeat(65537)]) {
      assert.throws(() => validateScannerRetentionPublisherTools({ ...observations(), [field]: value }), toolError);
    }
    const missing = observations(); delete missing[field];
    assert.throws(() => validateScannerRetentionPublisherTools(missing), toolError);
  }
  for (const value of [undefined, null, false, "tools", 42]) {
    assert.throws(() => validateScannerRetentionPublisherTools(value), toolError);
  }
});

test("publisher refuses different Go and Buildx versions, platforms and commit identities", () => {
  for (const [field, from, to] of [
    ["go", "1.24.13", "1.24.14"], ["go", "amd64", "arm64"], ["go", "linux", "windows"],
    ["buildx", "0.38.1", "0.38.2"], ["buildx", "0dbe87f", "1dbe87f"],
  ]) {
    const input = observations(); input[field] = input[field].replace(from, to);
    assert.throws(() => validateScannerRetentionPublisherTools(input), toolError);
  }
  assert.throws(() => validateScannerRetentionPublisherTools({ ...observations(), go: policy.buildx, buildx: policy.go }), toolError);
});

test("publisher rejects changed Docker fields, third kernels and inconsistent kernel copies", () => {
  const mutate = (change) => {
    const docker = JSON.parse(policy.dockerProfiles[0].identity); change(docker);
    return JSON.stringify(docker);
  };
  const changes = [
    (docker) => { docker.Client.Version = "28.0.5"; },
    (docker) => { docker.Client.ApiVersion = "1.49"; },
    (docker) => { docker.Client.Context = "remote"; },
    (docker) => { docker.Server.Arch = "arm64"; },
    (docker) => { docker.Server.Components[1].Version = "v2.4.3"; },
    (docker) => { docker.Server.Components[2].Details.GitCommit = "v1.5.2-other"; },
    (docker) => { docker.Server.BuildTime = "2025-03-25T15:07:17.000000000+00:00"; },
    (docker) => { docker.Server.KernelVersion = "7.0.0-1018-azure";
      docker.Server.Components[0].Details.KernelVersion = "7.0.0-1018-azure"; },
    (docker) => { docker.Server.KernelVersion = "7.0.0-1014-aws"; },
    (docker) => { docker.Server.Components[0].Details.KernelVersion = "7.0.0-1014-aws"; },
    (docker) => { docker.Server.Unknown = "unreviewed"; },
    (docker) => { delete docker.Server.Components[0].Details.KernelVersion; },
    (docker) => { docker.Server.Components.reverse(); },
  ];
  for (const change of changes) {
    assert.throws(() => validateScannerRetentionPublisherTools({ ...observations(), docker: mutate(change) }), toolError);
  }
});

test("equivalent JSON meaning does not replace exact Docker bytes or select caller profiles", () => {
  const original = policy.dockerProfiles[0].identity;
  const decoded = JSON.parse(original);
  const variants = [
    JSON.stringify(decoded, null, 2),
    JSON.stringify({ Server: decoded.Server, Client: decoded.Client }),
    original.replace('"Client"', '"\\u0043lient"'),
    original.replace('"28.0.4"', '"28.0.\\u0034"'),
  ];
  for (const docker of variants) {
    assert.deepEqual(JSON.parse(docker), decoded);
    assert.throws(() => validateScannerRetentionPublisherTools({ ...observations(), docker,
      profile: { identity: docker }, profilePath: "/tmp/caller-profile.json" }), toolError);
  }
});

test("policy tampering fails despite matching parsed meaning or internally rewritten hashes", () => {
  const edited = JSON.parse(profileBytes);
  edited.dockerProfiles[1].identity = edited.dockerProfiles[1].identity.replaceAll("7.0.0-1014-aws", "7.0.0-1015-aws");
  edited.dockerProfiles[1].sha256 = sha256(edited.dockerProfiles[1].identity);
  const changedByte = Buffer.from(profileBytes); changedByte[100] ^= 1;
  for (const bytes of [undefined, profileBytes.toString(), new Uint8Array(profileBytes), Buffer.alloc(0), changedByte,
    profileBytes.subarray(0, -1), Buffer.concat([profileBytes, Buffer.from("\n")]),
    Buffer.from(profileBytes.toString().replaceAll("\n", "\r\n")),
    Buffer.from(`${JSON.stringify(JSON.parse(profileBytes), null, 2)}\n`),
    Buffer.from(`${JSON.stringify(edited)}\n`)]) {
    assert.throws(() => validateScannerRetentionPublisherToolProfileBytes(bytes), profileError);
  }
});

test("qualification accepts the complete historical member and rejects AWS substitution or altered history", () => {
  assert.equal(originalQualification.length, 1306);
  assert.equal(sha256(originalQualification), "501e44964318b932c631497d97ac244fa2bc5141608d12eabab19e388896ae69");
  assert.equal(validateScannerRetentionQualificationTools(originalQualification), true);
  const text = originalQualification.toString("utf8");
  for (const bytes of [undefined, text, new Uint8Array(originalQualification), Buffer.alloc(0),
    originalQualification.subarray(0, -1), Buffer.concat([originalQualification, Buffer.from("\n")]),
    Buffer.from(text.replaceAll("\n", "\r\n")),
    Buffer.from(text.replace(policy.dockerProfiles[0].identity, policy.dockerProfiles[1].identity)),
    Buffer.from(text.replace("v22.23.4", "v22.23.5")),
    Buffer.from(text.replace("2.103.3", "2.103.4")),
    Buffer.from(text.replace(policy.go, policy.buildx)),
    Buffer.from(text.replace(policy.buildx, "")),
    Buffer.from(`${text}${policy.go}\n`),
    Buffer.from(`${policy.dockerProfiles[0].identity}\n${policy.go}\n${policy.buildx}\n`),
  ]) {
    assert.throws(() => validateScannerRetentionQualificationTools(bytes), qualificationError);
  }
});
