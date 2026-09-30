import { createHash } from "node:crypto";
import { validatePostgresCandidateArchive } from "../../scripts/postgres-image/candidate-proof.mjs";
const runId = "36700000001";
const recipeRevision = "a".repeat(40);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (bytes) => `sha256:${hash(bytes)}`;
const json = (value) => Buffer.from(JSON.stringify(value));
const phaseNames = ["managed_engine", "registry_login", "raw_tag_manifest", "anonymous_digest_denied", "raw_digest_manifest",
  "local_inventory_before", "local_collision_check", "exact_digest_pull", "simple_local_alias", "private_docker_save",
  "full_archive_validation", "private_archive_callback", "owned_docker_cleanup", "owned_temporary_cleanup"];
function tar(entries) {
  const parts = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0); const block = Buffer.alloc(512);
    Buffer.from(entry.name).copy(block);
    const octal = (offset, width, value) => Buffer.from(`${value.toString(8).padStart(width - 1, "0")}\0`).copy(block, offset);
    octal(100, 8, entry.type === "5" ? 0o755 : 0o644); octal(108, 8, 0); octal(116, 8, 0);
    octal(124, 12, content.length); octal(136, 12, 1_700_000_000);
    block.fill(0x20, 148, 156); block.write(entry.type ?? "0", 156);
    Buffer.from("ustar\0").copy(block, 257); Buffer.from("00").copy(block, 263);
    Buffer.from("root").copy(block, 265); Buffer.from("root").copy(block, 297);
    const checksum = block.reduce((total, byte) => total + byte, 0);
    Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(block, 148);
    parts.push(block, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
export function privateRetentionFixture() {
  const tag = `aw-postgres-gosu:${hash(Buffer.from(`${runId}:${recipeRevision}`)).slice(0, 24)}`;
  const layers = Array.from({ length: 12 }, (_, index) => {
    const buffer = Buffer.alloc(1024); Buffer.from(`raw-layer-${index}\n`).copy(buffer); return buffer;
  });
  const diffIds = layers.map(digest);
  const runtime = { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], WorkingDir: "/" };
  const config = json({ architecture: "amd64", os: "linux", docker_version: "28.0.4", config: runtime,
    rootfs: { type: "layers", diff_ids: diffIds } }); const imageId = digest(config);
  const rawLayers = layers.map((value, index) => ({ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: diffIds[index], size: value.length }));
  const manifest = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: imageId, size: config.length }, layers: rawLayers });
  const ids = Array.from({ length: 12 }, (_, index) => hash(Buffer.from(`legacy-${index}`)));
  const zero = { Hostname: "", Domainname: "", User: "", AttachStdin: false, AttachStdout: false,
    AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null, Image: "",
    Volumes: null, WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null };
  const records = ids.map((id, index) => json(index === 11 ? { id, parent: ids[index - 1], created: "2026-09-30T10:00:00Z",
    container: "c".repeat(64), container_config: runtime, docker_version: "28.0.4", config: runtime, architecture: "amd64", os: "linux" }
    : { id, ...(index ? { parent: ids[index - 1] } : {}), created: "1970-01-01T01:00:00+01:00", container_config: zero, os: "linux" }));
  const archive = tar([
    { name: "blobs/", type: "5" }, { name: "blobs/sha256/", type: "5" },
    ...layers.map((content, index) => ({ name: `blobs/sha256/${diffIds[index].slice(7)}`, content })),
    ...records.map((content) => ({ name: `blobs/sha256/${hash(content)}`, content })),
    { name: `blobs/sha256/${imageId.slice(7)}`, content: config }, { name: `blobs/sha256/${hash(manifest)}`, content: manifest },
    { name: "index.json", content: json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json", digest: digest(manifest), size: manifest.length,
      annotations: { "io.containerd.image.name": `docker.io/library/${tag}`, "org.opencontainers.image.ref.name": tag.split(":")[1] } }] }) },
    { name: "manifest.json", content: json([{ Config: `blobs/sha256/${imageId.slice(7)}`, RepoTags: [tag],
      Layers: diffIds.map((value) => `blobs/sha256/${value.slice(7)}`), LayerSources: Object.fromEntries(rawLayers.map((item) => [item.digest, item])) }]) },
    { name: "oci-layout", content: json({ imageLayoutVersion: "1.0.0" }) },
    { name: "repositories", content: json({ "aw-postgres-gosu": { [tag.split(":")[1]]: diffIds.at(-1).slice(7) } }) },
  ]);
  const compressed = layers.map((_, index) => ({ mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
    digest: digest(Buffer.from(`compressed-${index}`)), size: 1000 + index }));
  const configDescriptor = { digest: imageId, size: config.length, mediaType: "application/vnd.docker.container.image.v1+json" };
  const remoteManifest = json({ schemaVersion: 2, mediaType: "application/vnd.docker.distribution.manifest.v2+json", config: configDescriptor, layers: compressed });
  const policy = { kind: "POSTGRES_REMOTE_CANDIDATE_POLICY_V1", authority: "REVIEWED_MAIN_POLICY", repository: "CleMeY15/auto-world",
    owner: "CleMeY15", image: "ghcr.io/clemey15/auto-world-postgres-gosu", platform: "linux/amd64", publishedTag: "candidate-36361670116-attempt-1",
    subject: `ghcr.io/clemey15/auto-world-postgres-gosu@${digest(remoteManifest)}`,
    manifest: { digest: digest(remoteManifest), bytes: remoteManifest.length, mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: configDescriptor, layers: compressed, baseLayerCount: 10, newLayerCount: 2 }, candidate: { imageId, diffIds },
    publisher: { workflowPath: ".github/workflows/postgres-candidate-publish-v4.yml", runId: "36361670116", runNumber: "1", runAttempt: "1",
      recipeRevision: "b".repeat(40), receiptSha256: "d".repeat(64), receiptBytes: 22970, result: "PASSED" } };
  const proof = validatePostgresCandidateArchive(archive, { imageId, tag, expectedDiffIds: diffIds, expectedLayers: 12 });
  const receipt = { kind: "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "REMOTE_READ_ONLY", publication: "PUBLISHED_UNADMITTED",
    registryWrite: "NOT_ATTEMPTED", vulnerabilityAudit: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null, runId, recipeRevision, subject: policy.subject, alias: tag,
    remoteManifest: { state: "RAW_MANIFEST_VERIFIED", ...policy.manifest },
    engine: { state: "ENGINE_VERIFIED", docker: "28.0.4|28.0.4", buildx: "test-buildx", serverVersion: "28.0.4", pullResponse: "SUCCESS",
      compressedDigestVerification: "MANAGED_MOBY_PULL", compressedSizeVerification: "RECORDED_ONLY" },
    image: { imageId, diffIds, platform: "linux/amd64" }, archive: { state: "ARCHIVE_VERIFIED", imageId, diffIds,
      archiveSha256: proof.archiveSha256, archiveBytes: proof.archiveBytes, saveResponse: "SUCCESS" },
    publisher: { result: policy.publisher.result, runId: policy.publisher.runId, recipeRevision: policy.publisher.recipeRevision,
      receiptSha256: policy.publisher.receiptSha256, receiptBytes: policy.publisher.receiptBytes },
    phases: phaseNames.map((name) => ({ name, result: "PASSED", durationMs: 0 })) };
  return { archive, policy, proof, receipt };
}

export function retainedFixture() {
  const material = privateRetentionFixture();
  const retention = { kind: "POSTGRES_LOCAL_CANDIDATE_RETENTION_RECEIPT_V1", state: "RETAINED", authority: "LOCAL_DIAGNOSTIC",
    origin: "LOCAL_DIAGNOSTIC", executionId: `local-${runId}`, githubRunId: null, candidateAuthorization: "NOT_AUTHORIZED",
    admission: "NOT_AUTHORIZED", signing: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null, runId, recipeRevision, subject: material.policy.subject,
    imageId: material.policy.candidate.imageId, diffIds: material.policy.candidate.diffIds, archiveProof: material.proof,
    remoteMaterialReceipt: material.receipt, phases: ["private_archive_copy", "retained_archive_validation", "remote_cleanup",
      "post_cleanup_archive_validation"].map((name) => ({ name, result: "PASSED", durationMs: 0 })) };
  return { ...material, retention, receiptBytes: Buffer.from(JSON.stringify(retention)), runId, recipeRevision };
}
