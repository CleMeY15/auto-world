import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";

import { evaluateLocalPostgresGosuAudit as realEvaluateAudit,
  validatePostgresGosuReportInventory as realValidateInventory } from "../scripts/postgres-image/audit-policy.mjs";
import { validatePostgresPackageControls as realValidatePackageControls }
  from "../scripts/postgres-image/candidate-attestation-access.mjs";

const SOURCE = path.resolve("scripts/postgres-image/admission-authority.mjs");
const SELF = fileURLToPath(import.meta.url);
const POLICY = readFileSync("infra/postgres-image/admission-policy.json");
const CONTROLS = readFileSync("infra/postgres-image/package-controls.json");
const TRACKED_INVENTORY = JSON.parse(readFileSync("infra/postgres-image/admission-inventory.json", "utf8"));
const ROOT = "/opt/auto-world/postgres-admission";
const HIGH_WATER = `${ROOT}/high-water.json`;
const INTENT = `${ROOT}/.high-water-update.intent`;
const TEMPORARY = `${ROOT}/.high-water-update.tmp`;
const INITIALIZED = `${ROOT}/authority-state-initialized.json`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha1 = (value) => createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex");
const canonical = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const clone = (value) => JSON.parse(JSON.stringify(value));
const property = (name, value) => ({ name: `aquasecurity:trivy:${name}`, value });
const commit = "a".repeat(40);
const AUDIT_ROLES = ["audit-receipt.json", "candidate-sbom.cdx.json", "candidate-vulnerabilities.json",
  "database-evidence.json", "database-java-after-manifest.json", "database-java-before-manifest.json",
  "database-vulnerability-after-manifest.json", "database-vulnerability-before-manifest.json",
  "fixture-gomod-vulnerable-baseline.json", "fixture-gomod-vulnerable-candidate.json",
  "fixture-java-jar-clean-candidate-candidate.json", "fixture-java-war-vulnerable-baseline.json",
  "fixture-java-war-vulnerable-candidate.json", "scanner-self.cdx.json", "scanner-self.json", "scanner-version-probe.json"];

if (typeof vm.SourceTextModule !== "function") {
  test("admission authority VM tests", () => {
    const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      env: { ...process.env, AUTO_WORLD_ADMISSION_VM: "1" }, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
} else {
  function generationRoot() {
    const diffIds = [`sha256:${"4".repeat(64)}`];
    const bytePin = (digit = "7") => ({ bytes: 10, sha256: digit.repeat(64) });
    const filePin = (name, digit = "8") => ({ path: `infra/postgres-image/${name}.json`, size: 10, sha256: digit.repeat(64) });
    const proofNames = ["rootAcknowledgement", "rootCandidate", "controlManifest", "terminalManifest", "inventory",
      "provisionalReceipt", "capacity", "outerInvocation", "sourceBundle", "actualReview", "postAckJournal",
      "postAckPublisher", "rootChainFreeze"];
    return {
      schemaVersion: 1, kind: "POSTGRES_ADMISSION_GENERATION_ROOT_V1", admissionGeneration: 1,
      image: { subject: `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:${"1".repeat(64)}`,
        manifestDigest: `sha256:${"1".repeat(64)}`, configDigest: `sha256:${"2".repeat(64)}`,
        diffIdsSha256: sha256(canonical(diffIds)), diffIds },
      build: { recipeRevision: "3".repeat(40), workflowPath: ".github/workflows/postgres-candidate-publish-v4.yml",
        runId: "1", attempt: "1", publication: filePin("publication", "a"), remotePolicy: filePin("remote", "b"),
        sourceClosure: filePin("closure", "c") },
      evidence: { p1: { policy: { bytes: 731542,
        sha256: "f4857beebba7df2f474e3385c38a69f7cfa0bec330d3d3f65ed7795255de871c" },
      acceptance: filePin("p1-acceptance", "d"), inventory: filePin("p1-inventory", "e"),
      referenceDigest: "f".repeat(64), counts: { references: 496, objects: 474 } },
      runtime: { groups: [{ role: "ACCEPTED_RUNTIME_ORIGINALS", sha256: "1".repeat(64), references: 1, objects: 1, bytes: 1 }],
        coldReceipt: bytePin("2"), sqlReceipt: bytePin("3"), dump: bytePin("4"),
        closedAcknowledgement: bytePin("5"), privateAddendum: bytePin("6") },
      p4: { originalAcceptance: filePin("p4-original", "7"), outputAcceptance: filePin("p4-output", "8") },
      p5: { acceptance: { bytes: 4604,
        sha256: "9079ccb664f39d54296fcb4a4ae1287c6bfe116db7518d18ee0a4db4cb8e438b" },
      recipeRevision: "9".repeat(40), completePolicy: bytePin("a"), launchPlan: bytePin("b"),
      counts: { references: 1094, referenceBytes: 1, evidenceObjects: 840, evidenceObjectBytes: 1,
        controlObjects: 43, controlObjectBytes: 1, evidenceCopies: 2, controlCopies: 2, controlReferences: 44 },
      proofs: Object.fromEntries(proofNames.map((name, index) => [name, bytePin((index % 6 + 1).toString())])) } },
      archiveLocator: { schemaVersion: 1, size: 10, sha256: "5".repeat(64) },
      executionFiles: [{ path: "scripts/postgres-image/admission-authority.mjs", size: 10, sha256: "6".repeat(64) }],
      waivers: ["JAVA_DATABASE_MAX_AGE_NOT_ENFORCED", "EXTERNAL_AUTHENTICATED_FORK_PROBE_SKIPPED_BY_USER"],
    };
  }
  function revision(number, previousRevisionSha256, generationRootSha256, state, reason = null, changes = {}) {
    return { authorityRevision: number, previousRevisionSha256, generationRootSha256, state,
      supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
      currentEvidence: { audit: null, packageControls: null }, revocationReason: reason, ...changes };
  }
  function inventoryReports(subject, createdAt) {
    const layer = subject.diffIds.at(-1); const gosu = "github.com/tianon/gosu";
    const dependencies = ["github.com/moby/sys/user@v0.1.0", "golang.org/x/sys@v0.1.0", "stdlib@v1.26.8"];
    const apk = [{ Name: ".postgresql-rundeps", Version: "20260917.213131" },
      { Name: "gosu", Version: "1.19-r5", SrcName: "gosu", SrcVersion: "1.19-r5", Licenses: ["Apache-2.0"] }];
    for (let index = 0; index < 44; index += 1) apk.push({ Name: `fixture${String(index).padStart(2, "0")}`,
      Version: "1.0-r0", SrcName: `origin${String(index % 34).padStart(2, "0")}`, SrcVersion: "1.0-r0",
      Licenses: index === 0 ? ["MIT", "BSD-2-Clause"] : ["MIT"] });
    const go = dependencies.map((entry) => { const at = entry.lastIndexOf("@");
      return { Name: entry.slice(0, at), Version: entry.slice(at + 1) }; });
    go.push({ Name: gosu, ID: gosu, Relationship: "root", AnalyzedBy: "gobinary", DependsOn: [...dependencies] });
    const libraries = [];
    for (const [type, list] of [["alpine", apk], ["gobinary", go]]) for (const pkg of list) {
      const purl = type === "alpine" ? `pkg:apk/alpine/${pkg.Name}@${pkg.Version}?arch=x86_64&distro=3.24.2`
        : `pkg:golang/${pkg.Name}${pkg.Version ? `@${pkg.Version}` : ""}`;
      pkg.ID ??= pkg.Name + (pkg.Version ? `@${pkg.Version}` : ""); pkg.Identifier = { PURL: purl, UID: "opaque" };
      pkg.Layer = { DiffID: layer };
      libraries.push({ type: "library", name: pkg.Name, ...(pkg.Version ? { version: pkg.Version } : {}), purl,
        "bom-ref": purl, ...(pkg.Licenses ? { licenses: pkg.Licenses.map((id) => ({ license: { id } })) } : {}),
        properties: [property("PkgType", type), property("PkgID", pkg.ID), property("LayerDiffID", layer),
          ...(pkg.SrcName ? [property("SrcName", pkg.SrcName), property("SrcVersion", pkg.SrcVersion)] : [])] });
    }
    return { vulnerabilityReport: { SchemaVersion: 2, Trivy: { Version: "0.74.0-autoworld.2" }, CreatedAt: createdAt,
      ArtifactType: "container_image", ArtifactName: subject.artifactName,
      Metadata: { ImageID: subject.imageId, RepoTags: [subject.tag], DiffIDs: clone(subject.diffIds),
        ImageConfig: { os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: clone(subject.diffIds) } },
        OS: { Family: "alpine", Name: "3.24.2" } },
      Results: [{ Target: `${subject.artifactName} (alpine 3.24.2)`, Class: "os-pkgs", Type: "alpine", Packages: apk,
        Vulnerabilities: [] }, { Target: "usr/bin/gosu", Class: "lang-pkgs", Type: "gobinary", Packages: go,
        Vulnerabilities: [] }] },
    cyclonedxReport: { bomFormat: "CycloneDX", specVersion: "1.7", version: 1,
      metadata: { component: { type: "container", name: subject.artifactName } }, components: [...libraries,
        { type: "application", name: "usr/bin/gosu", properties: [property("Type", "gobinary"), property("Class", "lang-pkgs")] },
        { type: "operating-system", name: "alpine", version: "3.24.2",
          properties: [property("Type", "alpine"), property("Class", "os-pkgs")] }],
      dependencies: [{ ref: `pkg:golang/${gosu}`, dependsOn: dependencies.map((entry) => `pkg:golang/${entry}`) }] } };
  }
  function activeFixture({ realReports = false, corruptInventory = false, databaseAfterReport = false,
    now = new Date(), p2RemainingMs = 60 * 60 * 1000, p3SettingsRemainingMs = 24 * 60 * 60 * 1000,
    archiveRemainingMs = 24 * 60 * 60 * 1000, supportNear = false } = {}) {
    const checkedAt = now.toISOString(); const validUntil = new Date(now.getTime() + p2RemainingMs).toISOString();
    const completedAt = new Date(now.getTime() - (24 * 60 * 60 * 1000 - archiveRemainingMs)).toISOString();
    const archiveValidUntil = new Date(now.getTime() + archiveRemainingMs).toISOString();
    const controls = clone(JSON.parse(CONTROLS));
    controls.observedAt = new Date(now.getTime() - (24 * 60 * 60 * 1000 - p3SettingsRemainingMs)).toISOString();
    const controlsBytes = canonical(controls); const root = generationRoot();
    root.image.diffIds = Array.from({ length: 12 }, (_, index) => `sha256:${(index + 1).toString(16).repeat(64)}`);
    root.image.diffIdsSha256 = sha256(canonical(root.image.diffIds));
    const manifestBytes = canonical({ schemaVersion: 2, config: { digest: root.image.configDigest }, layers: [] });
    root.image.manifestDigest = `sha256:${sha256(manifestBytes)}`;
    root.image.subject = `ghcr.io/clemey15/auto-world-postgres-gosu@${root.image.manifestDigest}`;
    const executionBytes = Buffer.from("authority-source\n"); const maintenanceBytes = Buffer.from("maintenance\n");
    root.executionFiles = [{ path: "scripts/postgres-image/admission-archive-maintenance.mjs",
      size: maintenanceBytes.length, sha256: sha256(maintenanceBytes) }, { path: "scripts/postgres-image/admission-authority.mjs",
      size: executionBytes.length, sha256: sha256(executionBytes) }];
    const documents = new Map();
    const add = (role, value) => documents.set(role, canonical(value));
    const auditSubject = { artifactName: "/candidate/postgres-gosu.tar", imageId: root.image.configDigest,
      archiveSha256: "2c1b6b002076fa3772aa9fc899befb86fe525aee1ee1c8007d85bba200c73a05",
      tag: "auto-world/postgres-gosu:run-1", configDigest: root.image.configDigest, diffIds: root.image.diffIds };
    const reportsFixture = inventoryReports(auditSubject, checkedAt);
    if (corruptInventory) reportsFixture.vulnerabilityReport.Results[0].Packages.push(
      clone(reportsFixture.vulnerabilityReport.Results[0].Packages[0]));
    add("candidate-sbom.cdx.json", realReports ? reportsFixture.cyclonedxReport : { bomFormat: "CycloneDX" });
    add("candidate-vulnerabilities.json", realReports ? reportsFixture.vulnerabilityReport
      : { CreatedAt: checkedAt, Metadata: { OS: { Family: "alpine", Name: "3.20" } } });
    const downloadedAt = new Date(now.getTime() + (databaseAfterReport ? 60 * 1000 : -60 * 60 * 1000)).toISOString();
    const observedValues = { vulnerability: { Version: 2, UpdatedAt: downloadedAt, DownloadedAt: downloadedAt },
      java: { Version: 1, UpdatedAt: downloadedAt, DownloadedAt: downloadedAt } };
    add("database-evidence.json", { observed: { vulnerability: { value: observedValues.vulnerability },
      java: { value: observedValues.java } } });
    for (const name of ["vulnerability", "java"]) {
      const manifest = { name, digest: `sha256:${(name === "vulnerability" ? "e" : "f").repeat(64)}` };
      add(`database-${name}-before-manifest.json`, manifest); add(`database-${name}-after-manifest.json`, manifest);
    }
    for (const role of AUDIT_ROLES.filter((role) => role.startsWith("fixture-") || role.startsWith("scanner-"))) add(role, { role });
    const reports = { vulnerability: { sha256: sha256(documents.get("candidate-vulnerabilities.json")),
      size: documents.get("candidate-vulnerabilities.json").length },
    cyclonedx: { sha256: sha256(documents.get("candidate-sbom.cdx.json")),
      size: documents.get("candidate-sbom.cdx.json").length } };
    const controlReports = Object.fromEntries(AUDIT_ROLES.filter((role) => role.startsWith("fixture-")
      || role.startsWith("scanner-")).map((role) => [role,
      { sha256: sha256(documents.get(role)), size: documents.get(role).length }]));
    const subject = { ...auditSubject, archiveBytes: 305474048 };
    add("audit-receipt.json", { kind: "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1", state: "COMPLETE",
      authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
      publication: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED",
      runId: "1", recipeRevision: "a".repeat(40), phase: "COMPLETE", registrySubject: root.image.subject,
      findingCount: 0, blockerCount: 0, blockers: [], supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
      subject, reports, scannerControls: { state: "COMPLETE", reports: controlReports },
      databases: { registry: [{ name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db", tag: "2",
        digest: `sha256:${"e".repeat(64)}`, size: 10, layerBytes: 9 },
      { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db", tag: "1",
        digest: `sha256:${"f".repeat(64)}`, size: 10, layerBytes: 9 }] }, inventory: { packageCount: 50 } });
    const files = AUDIT_ROLES.map((role) => ({ role, size: documents.get(role).length, sha256: sha256(documents.get(role)) }));
    const currentEvidence = { audit: { kind: "POSTGRES_ADMISSION_CURRENT_AUDIT_V1", subject: root.image.subject,
      checkedAt, validUntil, source: { recipeRevision: "a".repeat(40),
        workflowPath: ".github/workflows/postgres-admission-current-audit.yml", runId: "1", attempt: "1" }, files },
    packageControls: { size: controlsBytes.length, sha256: sha256(controlsBytes), observedAt: controls.observedAt } };
    let started = checkedAt.slice(0, 10); let startedDate = new Date(`${started}T00:00:00.000Z`);
    let endDate = new Date(startedDate); endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
    if (endDate.getUTCMonth() !== startedDate.getUTCMonth()) endDate.setUTCDate(0);
    if (supportNear) {
      endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      startedDate = new Date(endDate); startedDate.setUTCFullYear(startedDate.getUTCFullYear() - 1);
      started = startedDate.toISOString().slice(0, 10);
    }
    const archiveDate = new Date(endDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    const rootHash = sha256(canonical(root)); const pending = revision(1, null, rootHash, "PENDING");
    const active = revision(2, sha256(canonical(pending)), rootHash, "ACTIVE", null, {
      supportStartedAt: started, supportEndsAt: endDate.toISOString().slice(0, 10),
      archiveUntil: archiveDate.toISOString().slice(0, 10), currentEvidence });
    const inventoryValue = { schemaVersion: 1, kind: "POSTGRES_ADMISSION_INVENTORY_V1", repository: "CleMeY15/auto-world",
      admissionGeneration: 1, generationRoot: root, previousGenerations: [], authorityRevisions: [pending, active],
      revisionHashes: [sha256(canonical(pending)), sha256(canonical(active))], authorityRevision: 2,
      currentRevisionSha256: sha256(canonical(active)) };
    const fast = { admissionGeneration: 1, generationRootSha256: rootHash,
      archiveLocatorSha256: root.archiveLocator.sha256, executionFilesSha256: "b".repeat(64),
      roots: ["evidence-primary", "evidence-secondary", "control-primary", "control-secondary"].map((role, index) =>
        ({ role, references: 1, objects: 1, bytes: index + 1, membershipSha256: (index + 1).toString().repeat(64) })),
      imageArchive: { size: 305474048, sha256: subject.archiveSha256 },
      claims: { readOnly: true, objectPayloadParsed: false, runtimeAuthority: "NOT_GRANTED", admission: "NOT_AUTHORIZED" } };
    const envelope = { kind: "POSTGRES_ADMISSION_ARCHIVE_HEALTH_ENVELOPE_V1", state: "VERIFIED", observedAt: checkedAt,
      report: { kind: "POSTGRES_ADMISSION_ARCHIVE_FULL_V1", state: "VERIFIED", scope: "COMPLETE_ARCHIVE_HEALTH",
        completedAt, validUntil: archiveValidUntil, admissionGeneration: 1, generationRootSha256: rootHash,
        archiveLocatorSha256: root.archiveLocator.sha256, executionFilesSha256: fast.executionFilesSha256,
        roots: fast.roots, imageArchive: fast.imageArchive, claims: fast.claims },
      process: { status: 0, signal: null, closed: true, stdoutEOF: true, stderrEOF: true },
      command: { size: maintenanceBytes.length, sha256: sha256(maintenanceBytes) },
      policy: { size: POLICY.length, sha256: sha256(POLICY) } };
    return { inventoryValue, controlsBytes, documents, executionBytes, maintenanceBytes, manifestBytes, fast, envelope,
      validUntil };
  }
  function revokeActive(value) {
    const next = clone(value); const prior = next.authorityRevisions.at(-1);
    const revoked = revision(prior.authorityRevision + 1, next.currentRevisionSha256, prior.generationRootSha256,
      "REVOKED", "OPERATOR_REVOKED", { supportStartedAt: prior.supportStartedAt, supportEndsAt: prior.supportEndsAt,
        archiveUntil: prior.archiveUntil, currentEvidence: prior.currentEvidence });
    next.authorityRevisions.push(revoked); next.revisionHashes.push(sha256(canonical(revoked)));
    next.authorityRevision = revoked.authorityRevision; next.currentRevisionSha256 = next.revisionHashes.at(-1); return next;
  }
  function advanceActive(value) {
    const next = clone(value); const prior = next.authorityRevisions.at(-1);
    const active = revision(prior.authorityRevision + 1, next.currentRevisionSha256, prior.generationRootSha256,
      "ACTIVE", null, { supportStartedAt: prior.supportStartedAt, supportEndsAt: prior.supportEndsAt,
        archiveUntil: prior.archiveUntil, currentEvidence: prior.currentEvidence });
    next.authorityRevisions.push(active); next.revisionHashes.push(sha256(canonical(active)));
    next.authorityRevision = active.authorityRevision; next.currentRevisionSha256 = next.revisionHashes.at(-1); return next;
  }
  function inventory(state = "PENDING") {
    const root = generationRoot(); const rootHash = sha256(canonical(root));
    const revisions = [revision(1, null, rootHash, "PENDING")];
    if (state === "REVOKED") revisions.push(revision(2, sha256(canonical(revisions[0])), rootHash, "REVOKED", "OPERATOR_REVOKED"));
    if (state === "ACTIVE_REVOKED") {
      const currentEvidence = { audit: { kind: "POSTGRES_ADMISSION_CURRENT_AUDIT_V1", subject: root.image.subject,
        checkedAt: "2024-03-01T00:00:00.000Z", validUntil: "2024-03-02T00:00:00.000Z",
        source: { recipeRevision: "a".repeat(40), workflowPath: ".github/workflows/postgres-admission-current-audit.yml",
          runId: "1", attempt: "1" }, files: AUDIT_ROLES.map((role, index) => ({ role, size: index + 1,
          sha256: (index % 6 + 1).toString().repeat(64) })) },
      packageControls: { size: CONTROLS.length, sha256: sha256(CONTROLS), observedAt: "2024-03-01T00:00:00.000Z" } };
      revisions.push(revision(2, sha256(canonical(revisions[0])), rootHash, "ACTIVE", null,
        { supportStartedAt: "2024-02-29", supportEndsAt: "2025-02-28", archiveUntil: "2026-02-28", currentEvidence }));
      revisions.push(revision(3, sha256(canonical(revisions[1])), rootHash, "REVOKED", "OPERATOR_REVOKED",
        { supportStartedAt: "2024-02-29", supportEndsAt: "2025-02-28", archiveUntil: "2026-02-28", currentEvidence }));
    }
    const hashes = revisions.map((value) => sha256(canonical(value)));
    return { schemaVersion: 1, kind: "POSTGRES_ADMISSION_INVENTORY_V1", repository: "CleMeY15/auto-world",
      admissionGeneration: 1, generationRoot: root, previousGenerations: [], authorityRevisions: revisions,
      revisionHashes: hashes, authorityRevision: revisions.length, currentRevisionSha256: hashes.at(-1) };
  }
  function enoent() { return Object.assign(new Error("missing"), { code: "ENOENT" }); }
  function virtualFs() {
    let nextFd = 10; let clock = 1n;
    const directory = (ino, mode) => ({ type: "directory", mode, uid: 0, gid: 0, dev: 1n, ino, bytes: Buffer.alloc(0) });
    const rootNode = directory(4n, 0o700);
    const nodes = new Map([["/", directory(1n, 0o755)], ["/opt", directory(2n, 0o755)],
      ["/opt/auto-world", directory(3n, 0o755)], [ROOT, rootNode]]);
    const handles = new Map(); const operations = []; let failAfterIntentUnlinkCount = null; let failCloseFile = null;
    const stat = (node) => ({ dev: node.dev, ino: node.ino, uid: BigInt(node.uid), gid: BigInt(node.gid),
      mode: BigInt(node.mode), nlink: node.type === "directory" ? 2n : 1n, size: BigInt(node.bytes.length),
      mtimeNs: node.mtimeNs ?? 1n, ctimeNs: node.ctimeNs ?? 1n,
      isDirectory: () => node.type === "directory", isFile: () => node.type === "file", isSymbolicLink: () => false });
    const api = {
      constants: fs.constants,
      lstatSync(file) { const node = nodes.get(file); if (!node) throw enoent(); return stat(node); },
      realpathSync(file) { if (!nodes.has(file)) throw enoent(); return file; },
      openSync(file, flags, mode) {
        let node = nodes.get(file);
        if ((flags & fs.constants.O_CREAT) !== 0) {
          if (node && (flags & fs.constants.O_EXCL) !== 0) throw Object.assign(new Error("exists"), { code: "EEXIST" });
          if (!node) { node = { type: "file", mode, uid: 0, gid: 0, dev: 1n, ino: ++clock, bytes: Buffer.alloc(0) }; nodes.set(file, node); }
          operations.push(["create", file]);
        }
        if (!node) throw enoent(); const fd = nextFd++; handles.set(fd, { file, node }); return fd;
      },
      closeSync(fd) {
        const handle = handles.get(fd); assert.ok(handle); handles.delete(fd);
        if (handle.file === failCloseFile) { failCloseFile = null; throw new Error("injected close uncertainty"); }
        const unlinkCount = operations.filter(([operation, file]) => operation === "unlink" && file === INTENT).length;
        if (failAfterIntentUnlinkCount !== null && handle.file === ROOT && unlinkCount > failAfterIntentUnlinkCount) {
          failAfterIntentUnlinkCount = null; throw new Error("injected root close uncertainty");
        }
      },
      fstatSync(fd) { return stat(handles.get(fd).node); },
      fchmodSync(fd, mode) { handles.get(fd).node.mode = mode; },
      fsyncSync(fd) { operations.push(["fsync", handles.get(fd).file]); },
      writeSync(fd, bytes, offset, length, position) {
        const handle = handles.get(fd); const end = position + length;
        if (handle.node.bytes.length < end) { const next = Buffer.alloc(end); handle.node.bytes.copy(next); handle.node.bytes = next; }
        bytes.copy(handle.node.bytes, position, offset, offset + length); return length;
      },
      readSync(fd, target, offset, length, position) {
        const bytes = handles.get(fd).node.bytes; if (position >= bytes.length) return 0;
        const count = Math.min(length, bytes.length - position); bytes.copy(target, offset, position, position + count); return count;
      },
      renameSync(from, to) { const node = nodes.get(from); if (!node) throw enoent(); nodes.set(to, node); nodes.delete(from); operations.push(["rename", from, to]); },
      unlinkSync(file) { if (!nodes.delete(file)) throw enoent(); operations.push(["unlink", file]); },
    };
    const putFile = (file, bytes, mode = 0o600) => {
      const directories = []; let current = path.dirname(file);
      while (!nodes.has(current)) { directories.unshift(current); const parent = path.dirname(current);
        if (parent === current) break; current = parent; }
      for (const directoryPath of directories) nodes.set(directoryPath, directory(++clock, 0o755));
      nodes.set(file, { type: "file", mode, uid: 0, gid: 0, dev: 1n, ino: ++clock, bytes: Buffer.from(bytes) });
    };
    return { api, nodes, operations, putFile,
      failNextClose(file) { failCloseFile = file; },
      failPostRetirementRootClose() {
        failAfterIntentUnlinkCount = operations.filter(([operation, file]) => operation === "unlink" && file === INTENT).length;
      } };
  }
  function response(value, status = 200, headers = {}) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); let sent = false;
    return { status, redirected: false, headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      body: { getReader: () => ({ read: async () => sent
        ? { done: true, value: undefined } : (sent = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }) } };
  }
  function githubContent(file, bytes) {
    return { type: "file", name: path.posix.basename(file), path: file, sha: sha1(bytes), size: bytes.length,
      encoding: "base64", content: bytes.toString("base64") };
  }
  async function synthetic(context, identifier, exports) {
    const names = Object.keys(exports); const module = new vm.SyntheticModule(names, function initialize() {
      for (const name of names) this.setExport(name, exports[name]);
    }, { context, identifier }); await module.link(() => {}); await module.evaluate(); return module;
  }
  async function load({ state = "PENDING", env = { GH_TOKEN: "secret" }, platform = "linux", uid = 0,
    secondHead = commit, inventoryValue = inventory(state), active = null,
    controlsBytes = active?.controlsBytes ?? CONTROLS, clock = { value: 100 }, realValidators = false,
    wallNow = null } = {}) {
    const vfs = virtualFs(); const calls = []; const inventoryBytes = canonical(inventoryValue);
    const contents = new Map([
      ["infra/postgres-image/admission-policy.json", POLICY],
      ["infra/postgres-image/admission-inventory.json", inventoryBytes],
      ["infra/postgres-image/package-controls.json", controlsBytes],
    ]);
    if (active) {
      for (const pin of inventoryValue.authorityRevisions.at(-1).currentEvidence.audit.files) {
        vfs.putFile(`${ROOT}/current-audits/${pin.sha256}.json`, active.documents.get(pin.role), 0o400);
      }
      vfs.putFile(SOURCE, active.executionBytes, 0o644);
      vfs.putFile(path.resolve("scripts/postgres-image/admission-archive-maintenance.mjs"), active.maintenanceBytes, 0o644);
      vfs.putFile(`${ROOT}/archive-health/generation-1.json`, canonical(active.envelope), 0o600);
    }
    let branchCalls = 0; let packageValidations = 0; let auditCalls = 0;
    const fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/branches/main")) {
        branchCalls += 1; return response({ name: "main", protected: true,
          commit: { sha: branchCalls === 1 ? commit : secondHead } });
      }
      const match = /\/contents\/(.+)\?ref=/u.exec(url);
      if (match) {
        const file = match[1].split("/").map(decodeURIComponent).join("/"); const bytes = contents.get(file); assert.ok(bytes);
        return response(githubContent(file, bytes));
      }
      if (active && url === "https://api.github.com/user") return response({ login: "autoworld" });
      if (active && url.startsWith("https://ghcr.io/token?")) {
        assert.match(options.headers.Authorization, /^Basic /u); return response({ token: "registry-secret" });
      }
      if (active && url.includes("https://ghcr.io/v2/clemey15/auto-world-postgres-gosu/manifests/")) {
        const authenticated = options.headers.Authorization === "Bearer registry-secret";
        return authenticated ? response(active.manifestBytes, 200, { "docker-content-digest": inventoryValue.generationRoot.image.manifestDigest,
          "content-type": "application/vnd.oci.image.manifest.v1+json" })
          : response({ errors: [{ code: "UNAUTHORIZED" }] }, 401, { "www-authenticate":
            "Bearer realm=\"https://ghcr.io/token\",service=\"ghcr.io\",scope=\"repository:clemey15/auto-world-postgres-gosu:pull\"" });
      }
      assert.fail(`unexpected URL ${url}`);
    };
    const ContextDate = wallNow === null ? Date : class extends Date {
      constructor(...args) { super(...(args.length === 0 ? [wallNow] : args)); }
      static now() { return new Date(wallNow).getTime(); }
    };
    const context = vm.createContext({ Buffer, Uint8Array, console, Date: ContextDate, TextDecoder: globalThis.TextDecoder, URL,
      AbortController: globalThis.AbortController, setTimeout, clearTimeout: globalThis.clearTimeout, fetch,
      process: { env: { ...env }, platform, getuid: () => uid, getgid: () => uid } });
    const activeFast = active ? vm.runInContext(`(${JSON.stringify(active.fast)})`, context) : null;
    const actualModules = new Map();
    const linker = async (specifier) => {
      if (specifier === "node:fs") return synthetic(context, specifier, { default: vfs.api });
      if (specifier === "node:perf_hooks") return synthetic(context, specifier,
        { performance: { now: () => clock.value } });
      if (specifier.endsWith("candidate-attestation-access.mjs")) return synthetic(context, specifier,
        { validatePostgresPackageControls: (value) => { packageValidations += 1;
          return realValidators ? realValidatePackageControls(clone(value)) : Object.freeze(value); } });
      if (specifier.endsWith("audit-policy.mjs")) return synthetic(context, specifier, {
        evaluateLocalPostgresGosuAudit: (input) => { auditCalls += 1; if (!active) throw new Error("must not run");
          return realValidators ? realEvaluateAudit({ ...clone(input), now: new Date(input.now) })
            : { state: "COMPLETE", findings: [], blockers: [], inventory: { packageCount: 50 } }; },
        validatePostgresGosuReportInventory: (input) => { auditCalls += 1; if (!active) throw new Error("must not run");
          return realValidators ? realValidateInventory(clone(input)) : undefined; },
      });
      if (specifier.endsWith("runtime-restore-audit.mjs")) return synthetic(context, specifier,
        { postgresRuntimeAuditValidUntil: () => { auditCalls += 1; if (!active) throw new Error("must not run");
          return active.validUntil; } });
      if (specifier === "../scanner/audit.mjs") return synthetic(context, specifier,
        { validateDatabaseRegistryManifest: (bytes) => { auditCalls += 1; if (!active) throw new Error("must not run");
          const name = JSON.parse(Buffer.from(bytes).toString("utf8")).name;
          return { digest: `sha256:${(name === "vulnerability" ? "e" : "f").repeat(64)}`, size: 10, layerBytes: 9 }; } });
      if (specifier.endsWith("admission-archive-maintenance.mjs")) return synthetic(context, specifier, {
        loadPostgresAdmissionArchiveContext: () => { if (!active) throw new Error("must not run"); return {}; },
        verifyPostgresAdmissionArchiveFast: () => { if (!active) throw new Error("must not run"); return activeFast; },
      });
      if (!actualModules.has(specifier)) {
        const namespace = await import(specifier); actualModules.set(specifier, await synthetic(context, specifier, namespace));
      }
      return actualModules.get(specifier);
    };
    const module = new vm.SourceTextModule(readFileSync(SOURCE, "utf8"), {
      context, identifier: pathToFileURL(SOURCE).href,
      initializeImportMeta(meta) { meta.url = pathToFileURL(SOURCE).href; },
    });
    await module.link(linker); await module.evaluate();
    return { open: module.namespace.openPostgresAdmissionAuthority, context, vfs, calls, clock,
      setInventory(next) { contents.set("infra/postgres-image/admission-inventory.json", canonical(next)); },
      get packageValidations() { return packageValidations; }, get auditCalls() { return auditCalls; } };
  }

  test("PENDING authenticates protected exact-commit files but issues no authority", async () => {
    const value = await load();
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.calls.length, 5);
    assert.match(value.calls[0].url, /\/branches\/main$/u);
    assert.deepEqual(value.calls.slice(1, 4).map((call) => call.url.includes("?ref=" + commit)), [true, true, true]);
    assert.match(value.calls[4].url, /\/branches\/main$/u);
    assert.equal(value.packageValidations, 1); assert.equal(value.auditCalls, 0);
    assert.equal(Object.hasOwn(value.context.process.env, "GH_TOKEN"), false);
    assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
  });

  test("tracked PENDING inventory authenticates as the closed public schema", async () => {
    const value = await load({ inventoryValue: clone(TRACKED_INVENTORY) });
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.calls.length, 5);
    assert.equal(value.packageValidations, 1);
    assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
  });

  test("ACTIVE completes local proofs and scoped GHCR exchange before issuing and renewing an authentic lease", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    const authority = await value.open();
    assert.equal(value.vfs.nodes.has(INITIALIZED), true);
    assert.deepEqual(Object.keys(authority).sort(), ["acquire", "assertCurrent", "close", "renew"]);
    assert.equal(Object.isFrozen(authority), true);
    const lease = authority.acquire(); const binding = authority.assertCurrent(lease, "SERVICE", 59_998);
    assert.equal(Object.isFrozen(binding), true); assert.equal(Object.isFrozen(binding.generationRoot), true);
    assert.equal(Object.isFrozen(binding.currentness), true);
    assert.deepEqual(Object.keys(binding.currentness).sort(), ["archiveValidUntil", "p2ValidUntil",
      "p3ManifestValidUntil", "p3SettingsValidUntil", "supportValidUntil"]);
    assert.equal(binding.image.manifestDigest, active.inventoryValue.generationRoot.image.manifestDigest);
    assert.equal(value.calls.length, 11);
    const tokenCall = value.calls.find((call) => call.url.includes("ghcr.io/token?"));
    assert.equal(tokenCall.url, "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aclemey15%2Fauto-world-postgres-gosu%3Apull");
    assert.match(tokenCall.options.headers.Authorization, /^Basic /u);
    assert.equal(value.calls.filter((call) => call.options.headers.Authorization === "Bearer registry-secret").length, 2);
    assert.equal(value.calls.filter((call) => call.url.includes("/manifests/")
      && call.options.headers.Authorization === "Bearer secret").length, 0);
    const renewed = await authority.renew(lease);
    assert.throws(() => authority.assertCurrent(lease, "SERVICE"), { message: "postgres_admission_authority_denied" });
    assert.equal(authority.assertCurrent(renewed, "SERVICE").authorityRevision, 2);
    assert.equal(value.calls.length, 16);
    authority.close();
    assert.throws(() => authority.assertCurrent(renewed, "SERVICE"), { message: "postgres_admission_authority_denied" });
  });

  test("ACTIVE replays the real fifty-package inventory, audit policy, and package-controls validators", async () => {
    const active = activeFixture({ realReports: true });
    const value = await load({ active, inventoryValue: active.inventoryValue, realValidators: true });
    const authority = await value.open(); const lease = authority.acquire();
    assert.equal(authority.assertCurrent(lease, "AUTHORITY").authorityRevision, 2);
    assert.equal(value.packageValidations, 2); assert.ok(value.auditCalls >= 3); authority.close();
  });

  test("real P2 validators deny coherent but corrupted inventory and report/database ordering", async () => {
    for (const active of [activeFixture({ realReports: true, corruptInventory: true }),
      activeFixture({ realReports: true, databaseAfterReport: true })]) {
      const value = await load({ active, inventoryValue: active.inventoryValue, realValidators: true });
      await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
      assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
    }
  });

  test("authentic lease copies are rejected and monotonic expiry is public and stable", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    const authority = await value.open(); const lease = authority.acquire();
    assert.throws(() => authority.assertCurrent({}, "SERVICE"), { message: "postgres_admission_authority_denied" });
    value.clock.value += 60_001;
    assert.throws(() => authority.assertCurrent(lease, "SERVICE"), { message: "postgres_admission_lease_expired" });
    await assert.rejects(authority.renew(lease), { message: "postgres_admission_authority_denied" });
    authority.close();
  });

  test("P2, P3 settings, FULL archive, and support boundaries shorten the monotonic lease", async () => {
    const wallNow = "2026-10-06T23:59:50.000Z"; const now = new Date(wallNow);
    const cases = [
      { field: "p2ValidUntil", options: { p2RemainingMs: 10_000 } },
      { field: "p3SettingsValidUntil", options: { p3SettingsRemainingMs: 10_000 } },
      { field: "archiveValidUntil", options: { archiveRemainingMs: 10_000 } },
      { field: "supportValidUntil", options: { supportNear: true } },
    ];
    for (const item of cases) {
      const active = activeFixture({ now, ...item.options }); const value = await load({ active,
        inventoryValue: active.inventoryValue, wallNow });
      const authority = await value.open(); const lease = authority.acquire();
      const binding = authority.assertCurrent(lease, "SERVICE");
      assert.equal(binding.deadlineMonotonic - binding.issuedMonotonic, 10_000);
      assert.equal(Date.parse(binding.currentness[item.field]) - Date.parse(wallNow), 10_000);
      value.clock.value += 5_000;
      assert.throws(() => authority.assertCurrent(lease, "SERVICE"), { message: "postgres_admission_lease_expired" });
      authority.close();
    }
  });

  test("currentness expiring during bootstrap denies before high-water publication", async () => {
    const wallNow = "2026-10-06T12:00:00.000Z"; const active = activeFixture({ now: new Date(wallNow), p2RemainingMs: 0 });
    const value = await load({ active, inventoryValue: active.inventoryValue, wallNow });
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
  });

  test("renewal persists a newly authenticated revocation and drains the prior lease", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    const authority = await value.open(); const lease = authority.acquire(); value.setInventory(revokeActive(active.inventoryValue));
    await assert.rejects(authority.renew(lease), { message: "postgres_admission_authority_revoked" });
    assert.throws(() => authority.assertCurrent(lease, "SERVICE"), { message: "postgres_admission_authority_denied" });
    const retained = JSON.parse(value.vfs.nodes.get(HIGH_WATER).bytes.toString("utf8"));
    assert.equal(retained.state, "REVOKED"); assert.equal(retained.authorityRevision, 3);
    authority.close();
  });

  test("deleted revoked high-water cannot be reset by an older ACTIVE while the durable sentinel remains", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    const authority = await value.open(); const lease = authority.acquire(); value.setInventory(revokeActive(active.inventoryValue));
    await assert.rejects(authority.renew(lease), { message: "postgres_admission_authority_revoked" }); authority.close();
    assert.equal(JSON.parse(value.vfs.nodes.get(HIGH_WATER).bytes.toString("utf8")).state, "REVOKED");
    assert.equal(value.vfs.nodes.has(INITIALIZED), true); value.vfs.nodes.delete(HIGH_WATER);
    const operations = value.vfs.operations.length; value.setInventory(active.inventoryValue);
    value.context.process.env.GH_TOKEN = "second-secret";
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.operations.length, operations); assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
  });

  test("uncertain sentinel close leaves a durable denial before any high-water mutation", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    value.vfs.failNextClose(INITIALIZED);
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(INITIALIZED), true); assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
    const operations = value.vfs.operations.length; value.context.process.env.GH_TOKEN = "second-secret";
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.operations.length, operations);
  });

  test("retained runtime generation without high-water denies a supposedly virgin host", async () => {
    for (const directory of ["generation-1025", "restore-generation-1025"]) {
      const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
      value.vfs.putFile(`${ROOT}/${directory}/volume-identity.json`, Buffer.from("retained\n"));
      const operations = value.vfs.operations.length;
      await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
      assert.equal(value.vfs.operations.length, operations); assert.equal(value.vfs.nodes.has(INITIALIZED), false);
      assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
    }
  });

  test("renewal rejects authenticated authority rollback without replacing high-water", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    const authority = await value.open(); const lease = authority.acquire();
    const retained = Buffer.from(value.vfs.nodes.get(HIGH_WATER).bytes); value.setInventory(inventory("PENDING"));
    await assert.rejects(authority.renew(lease), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.get(HIGH_WATER).bytes.equals(retained), true);
    assert.throws(() => authority.assertCurrent(lease, "SERVICE"), { message: "postgres_admission_authority_denied" });
    authority.close();
  });

  test("post-retirement root close uncertainty quarantines initial ACTIVE publication", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    value.vfs.failPostRetirementRootClose();
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(INTENT), true);
    assert.equal(JSON.parse(value.vfs.nodes.get(HIGH_WATER).bytes.toString("utf8")).state, "ACTIVE");
    value.context.process.env.GH_TOKEN = "second-secret";
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(INTENT), true);
  });

  test("post-retirement close uncertainty drains renewal and prevents old ACTIVE revival", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    const authority = await value.open(); const lease = authority.acquire();
    value.setInventory(advanceActive(active.inventoryValue)); value.vfs.failPostRetirementRootClose();
    await assert.rejects(authority.renew(lease), { message: "postgres_admission_authority_denied" });
    assert.throws(() => authority.assertCurrent(lease, "SERVICE"), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(INTENT), true);
    value.setInventory(active.inventoryValue); value.context.process.env.GH_TOKEN = "second-secret";
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(JSON.parse(value.vfs.nodes.get(HIGH_WATER).bytes.toString("utf8")).authorityRevision, 3);
    authority.close();
  });

  test("archive publication uncertainty markers deny ACTIVE before a lease", async () => {
    const active = activeFixture(); const value = await load({ active, inventoryValue: active.inventoryValue });
    value.vfs.putFile(`${ROOT}/archive-health/.generation-1.update-intent`, Buffer.from("uncertain\n"), 0o600);
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
  });

  test("head movement denies before local persistence", async () => {
    const value = await load({ secondHead: "b".repeat(40) });
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
    assert.equal(value.vfs.operations.length, 0);
  });

  test("duplicate credentials and non-root context fail closed after ambient credential removal", async () => {
    const duplicate = await load({ env: { GH_TOKEN: "one", GITHUB_TOKEN: "two" } });
    await assert.rejects(duplicate.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(Object.hasOwn(duplicate.context.process.env, "GH_TOKEN"), false);
    assert.equal(Object.hasOwn(duplicate.context.process.env, "GITHUB_TOKEN"), false);
    assert.equal(duplicate.calls.length, 0);
    const nonroot = await load({ uid: 1000 });
    await assert.rejects(nonroot.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(Object.hasOwn(nonroot.context.process.env, "GH_TOKEN"), false);
    assert.equal(nonroot.calls.length, 0);
  });

  test("authenticated chain-valid REVOKED persists terminal high-water before stale evidence checks", async () => {
    const value = await load({ state: "REVOKED" });
    await assert.rejects(value.open(), { message: "postgres_admission_authority_revoked" });
    assert.equal(value.auditCalls, 0);
    const retained = JSON.parse(value.vfs.nodes.get(HIGH_WATER).bytes.toString("utf8"));
    assert.equal(retained.state, "REVOKED"); assert.equal(retained.authorityRevision, 2);
    assert.equal(value.vfs.nodes.has(INTENT), false); assert.equal(value.vfs.nodes.has(TEMPORARY), false);
    const markerFsync = value.vfs.operations.findIndex(([operation, file]) => operation === "fsync" && file === INTENT);
    const temporaryCreate = value.vfs.operations.findIndex(([operation, file]) => operation === "create" && file === TEMPORARY);
    assert.ok(markerFsync >= 0 && markerFsync < temporaryCreate);
  });

  test("leap-day activation clamps one calendar year and retains exactly 365 archive days", async () => {
    const value = await load({ state: "ACTIVE_REVOKED" });
    await assert.rejects(value.open(), { message: "postgres_admission_authority_revoked" });
    const retained = JSON.parse(value.vfs.nodes.get(HIGH_WATER).bytes.toString("utf8"));
    assert.equal(retained.state, "REVOKED"); assert.equal(retained.authorityRevision, 3);
  });

  test("date mutation in an otherwise rehashed terminal revision never reaches persistence", async () => {
    const changed = inventory("ACTIVE_REVOKED");
    changed.authorityRevisions[2].supportEndsAt = "2025-03-01";
    changed.revisionHashes[2] = sha256(canonical(changed.authorityRevisions[2]));
    changed.currentRevisionSha256 = changed.revisionHashes[2];
    const value = await load({ inventoryValue: changed });
    await assert.rejects(value.open(), { message: "postgres_admission_authority_denied" });
    assert.equal(value.vfs.nodes.has(HIGH_WATER), false);
  });
}
