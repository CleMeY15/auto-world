import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";

import { POSTGRES_ATTESTATION_ARTIFACTS, preparePostgresAttestationArtifactInput,
  verifyCurrentRunArtifactApi } from "../scripts/postgres-image/attestation-artifact-input.mjs";
import { githubArtifactZipProfiles,
  scanGitHubArtifactZip } from "../scripts/seaweed-image/read-artifact-zip.mjs";

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const auditPaths = ["audit-receipt.json", "candidate-sbom.cdx.json", "candidate-vulnerabilities.json",
  "database-evidence.json", "database-java-after-manifest.json", "database-java-before-manifest.json",
  "database-vulnerability-after-manifest.json", "database-vulnerability-before-manifest.json",
  "fixture-gomod-vulnerable-baseline.json", "fixture-gomod-vulnerable-candidate.json",
  "fixture-java-jar-clean-candidate-candidate.json", "fixture-java-war-vulnerable-baseline.json",
  "fixture-java-war-vulnerable-candidate.json", "scanner-self.cdx.json", "scanner-self.json",
  "scanner-version-probe.json"];

function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const candidate of entries) {
    const name = Buffer.from(candidate.path, "ascii"); const raw = Buffer.from(candidate.content);
    const method = candidate.method ?? 8; const compressed = method === 8 ? deflateRawSync(raw) : raw;
    const checksum = crc32(raw) >>> 0; const local = Buffer.alloc(30); const descriptor = Buffer.alloc(16);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0008, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0x1234, 10); local.writeUInt16LE(0x5678, 12);
    local.writeUInt16LE(name.length, 26); descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(checksum, 4); descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(raw.length, 12); locals.push(local, name, compressed, descriptor);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x032d, 4);
    central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0008, 8); central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x1234, 12); central.writeUInt16LE(0x5678, 14); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE((candidate.mode ?? 0o100644) * 65_536 + 0x20, 38);
    central.writeUInt32LE(offset, 42); centrals.push(central, name);
    offset += local.length + name.length + compressed.length + descriptor.length;
  }
  const central = Buffer.concat(centrals); const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

function memorySink(output) {
  return (entry) => {
    const chunks = [];
    return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
      final(callback) { output.set(entry.path, Buffer.concat(chunks)); callback(); } });
  };
}

async function scan(bytes, profile, sink = memorySink(new Map())) {
  return scanGitHubArtifactZip({ source: { size: bytes.length,
    readAt(position, length) { return bytes.subarray(position, position + length); } },
  descriptor: { size: bytes.length, digest: sha(bytes) }, profile, openEntrySink: sink });
}

test("PostgreSQL attestation ZIP profiles accept only fixed flat files with reviewed compression", async () => {
  const profiles = [
    [githubArtifactZipProfiles.postgresAttestationAccess, ["access-receipt.json"]],
    [githubArtifactZipProfiles.postgresAttestationSigned, ["predicate.json", "bundle.json", "pre-sign-receipt.json"]],
    [githubArtifactZipProfiles.postgresAttestationAudit, [...auditPaths].reverse()],
  ];
  for (const [profile, names] of profiles) {
    const method = profile === githubArtifactZipProfiles.postgresAttestationAudit ? 0 : 8;
    const output = new Map(); const bytes = zip(names.map((name) => ({ path: name, content: `${name}\n`,
      method, mode: 0o100600 })));
    const receipt = await scan(bytes, profile, memorySink(output));
    assert.equal(receipt.entryCount, names.length); assert.deepEqual([...output.keys()], names);
    await assert.rejects(scan(zip([...names, "extra.json"].map((name) => ({ path: name, content: "x",
      method, mode: 0o100600 }))), profile),
      /seaweed_artifact_zip_profile_invalid/u);
    await assert.rejects(scan(zip(names.map((name, index) => ({ path: name, content: "x",
      method: index === 0 ? (method === 0 ? 8 : 0) : method, mode: 0o100600 }))), profile),
    /seaweed_artifact_zip_profile_invalid/u);
    await assert.rejects(scan(zip(names.map((name, index) => ({ path: index === 0 ? `nested/${name}` : name,
      content: "x", method, mode: 0o100600 }))), profile), /seaweed_artifact_zip_profile_invalid/u);
    await assert.rejects(scan(zip(names.map((name) => ({ path: name, content: "x", method,
      mode: 0o100644 }))), profile), /seaweed_artifact_zip_profile_invalid/u);
  }
});

function apiFixture(mode = "access") {
  const id = 987654; const runId = "123456"; const headSha = "a".repeat(40);
  const run = { id: Number(runId), run_number: 1, run_attempt: 1,
    path: ".github/workflows/postgres-candidate-attest.yml", event: "workflow_dispatch",
    status: "in_progress", conclusion: null, head_branch: "main", head_sha: headSha,
    repository: { full_name: "CleMeY15/auto-world" } };
  const artifact = { id, name: POSTGRES_ATTESTATION_ARTIFACTS[mode].name, expired: false,
    size_in_bytes: 1234, digest: `sha256:${"b".repeat(64)}`,
    url: `https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/${id}`,
    archive_download_url: `https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/${id}/zip`,
    expires_at: "2026-10-10T00:00:00Z", workflow_run: { id: Number(runId), head_sha: headSha } };
  const env = { GITHUB_RUN_ID: runId, GITHUB_SHA: headSha, GITHUB_TOKEN: "token", GH_TOKEN: "token" };
  return { id, run, artifact, env };
}

function apiFetch(values) {
  let call = 0;
  return async () => new globalThis.Response(JSON.stringify(values[call++]), { status: 200,
    headers: { "content-type": "application/json" } });
}

test("current-run artifact API binds the exact run, artifact output identity and expiry", async () => {
  for (const mode of ["access", "signed"]) {
    const fixture = apiFixture(mode);
    const accepted = await verifyCurrentRunArtifactApi(mode, fixture.id, fixture.env,
      { fetchImpl: apiFetch([fixture.run, fixture.artifact]), now: () => new Date("2026-10-01T00:00:00Z") });
    assert.equal(accepted.name, POSTGRES_ATTESTATION_ARTIFACTS[mode].name);
    assert.equal(accepted.digest, fixture.artifact.digest);
    for (const mutate of [
      (run) => { run.head_sha = "f".repeat(40); },
      (_run, artifact) => { artifact.id += 1; },
      (_run, artifact) => { artifact.expired = true; },
      (_run, artifact) => { artifact.expires_at = "2026-09-30T00:00:00Z"; },
      (_run, artifact) => { artifact.name = "wrong"; },
      (_run, artifact) => { artifact.digest = "not-a-digest"; },
      (_run, artifact) => { artifact.size_in_bytes = 8 * 1024 ** 2 + 1; },
    ]) {
      const run = JSON.parse(JSON.stringify(fixture.run));
      const artifact = JSON.parse(JSON.stringify(fixture.artifact)); mutate(run, artifact);
      await assert.rejects(verifyCurrentRunArtifactApi(mode, fixture.id, fixture.env,
        { fetchImpl: apiFetch([run, artifact]), now: () => new Date("2026-10-01T00:00:00Z") }),
      /postgres_attestation_artifact_api_invalid/u);
    }
  }
});

test("API transport, malformed and oversized responses remain errors", async () => {
  const fixture = apiFixture();
  for (const fetchImpl of [async () => new globalThis.Response("{}", { status: 500 }),
    async () => new globalThis.Response("{"),
    async () => new globalThis.Response("x".repeat(512 * 1024 + 1))]) {
    await assert.rejects(verifyCurrentRunArtifactApi("access", fixture.id, fixture.env,
      { fetchImpl, now: () => new Date("2026-10-01T00:00:00Z") }),
    /postgres_attestation_artifact_api_invalid/u);
  }
});

test("native input writes private verified files and removes only its owned ZIP", { skip: process.platform !== "linux" }, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "aw-postgres-attestation-input-"));
  await chmod(temporary, 0o700); t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const mode of ["access", "signed", "audit"]) {
    const output = path.join(temporary, `${mode}-output`); const downloadRoot = path.join(temporary, `${mode}-download`);
    const names = mode === "access" ? ["access-receipt.json"]
      : mode === "signed" ? ["bundle.json", "pre-sign-receipt.json", "predicate.json"] : auditPaths;
    const method = mode === "audit" ? 0 : 8;
    const bytes = zip(names.map((name) => ({ path: name, content: `${name}\n`,
      method, mode: 0o100600 })));
    let auditApiCalls = 0;
    const result = await preparePostgresAttestationArtifactInput(mode, {}, {
      requireContext: () => ({ mode, contract: POSTGRES_ATTESTATION_ARTIFACTS[mode], uid: process.getuid(),
        artifactId: 123, workspace: temporary, output, downloadRoot }),
      verifyCurrentArtifact: async () => ({ id: 123, name: POSTGRES_ATTESTATION_ARTIFACTS[mode].name,
        size: bytes.length, digest: sha(bytes), runId: "123", headSha: "a".repeat(40) }),
      authenticateRuntimeSource: () => ({ runtimePolicy: { audit: { artifact: { id: 456,
        name: POSTGRES_ATTESTATION_ARTIFACTS.audit.name, size: bytes.length, sha256: sha(bytes).slice(7) },
      runId: "456", recipeRevision: "c".repeat(40) } } }),
      verifyAuditApi: async () => { auditApiCalls += 1; },
      download: async ({ handle }) => { await handle.write(bytes); },
    });
    assert.equal(result.state, "COMPLETE"); assert.equal(result.scan.entryCount, names.length);
    assert.equal(auditApiCalls, mode === "audit" ? 1 : 0);
    await assert.rejects(stat(downloadRoot), { code: "ENOENT" });
    assert.deepEqual((await Promise.all(names.map(async (name) => [name,
      await readFile(path.join(output, name), "utf8"), (await stat(path.join(output, name))).mode & 0o777]))),
    names.map((name) => [name, `${name}\n`, 0o600]));
  }
});
