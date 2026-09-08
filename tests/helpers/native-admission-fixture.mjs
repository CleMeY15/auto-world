import { cp, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NATIVE_ADMISSION_IMPORT_PATHS } from "../../scripts/supply-chain/native-admission.mjs";
import { TRIVY_PATCH_IDENTITIES } from "../../scripts/supply-chain/materials.mjs";
import { canonicalJsonBuffer, sha256 } from "../../scripts/supply-chain/strict-json.mjs";

// This fixture exercises the production validators with deterministic local data.
// Its tiny placeholder binaries and databases are test data, never native proof.
const REPOSITORY_ROOT = path.resolve(new URL("../..", import.meta.url).pathname.slice(process.platform === "win32" ? 1 : 0));
const NATIVE_RECIPE_PATHS = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "infra/supply-chain/native-sources.json"), "utf8")).tools[0].recipeFiles;
const RUN_SOURCE = "7".repeat(40);
const EMPTY_HASH = sha256(canonicalJsonBuffer([]));
const SUBJECTS = [
  { tool: "oras", target: "linux-amd64", prefix: "oras-linux-amd64", filename: "oras", os: "linux" },
  { tool: "cosign", target: "linux-amd64", prefix: "cosign-linux-amd64", filename: "cosign", os: "linux" },
  { tool: "cosign", target: "windows-amd64", prefix: "cosign-windows-amd64", filename: "cosign.exe", os: "windows" },
  { tool: "trivy", target: "linux-amd64", prefix: "trivy-linux-amd64", filename: "trivy", os: "linux" },
];

async function put(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { sha256: sha256(bytes), size: bytes.length };
}

async function copyRepositoryInput(root, relative) {
  const source = path.join(REPOSITORY_ROOT, relative);
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

function sourceEvidenceProvenance(proposal) {
  return sha256(canonicalJsonBuffer({
    selectionSha256: proposal.selectionSha256,
    tool: proposal.tool,
    sourceTree: proposal.sourceTree,
    sourceArchive: proposal.sourceArchive,
    sourceDateEpoch: proposal.sourceDateEpoch,
    recipeSha256: proposal.recipeSha256,
    requiredEvidence: proposal.requiredEvidence,
    licenseFiles: proposal.sourceEvidence.licenseFiles,
    noticeFiles: proposal.sourceEvidence.noticeFiles,
    noticeStatus: proposal.sourceEvidence.noticeStatus,
    wasmInputs: proposal.sourceEvidence.wasmInputs,
  }));
}

function releaseEvidenceProvenance(proposal) {
  const releaseEvidence = { ...proposal.releaseEvidence };
  delete releaseEvidence.provenanceSha256;
  return sha256(canonicalJsonBuffer({ selectionSha256: proposal.selectionSha256, tool: proposal.tool,
    sourceTree: proposal.sourceTree, recipeSha256: proposal.recipeSha256, releaseEvidence }));
}

function buildInfo(tool) {
  const main = { oras: "oras.land/oras", cosign: "github.com/sigstore/cosign/v3", trivy: "github.com/aquasecurity/trivy" }[tool];
  return [`path\t${main}/cmd/${tool}`, `mod\t${main}\t(devel)`, "build\tCGO_ENABLED=0"];
}

function recipeEvidence(tool, selected, proposal, compilerVersion) {
  return { tool, commit: selected.commit, modifiedVersion: selected.modifiedVersion, targets: selected.targets,
    compiler: compilerVersion, tests: selected.upstreamTests, patchPolicy: selected.patchPolicy,
    requiredEvidence: selected.requiredEvidence, recipeFiles: proposal.recipeFiles };
}

function orasEvidence(binarySha256) {
  const hash = (value) => sha256(Buffer.from(value));
  return { binarySha256, childDigest: `sha256:${hash("child")}`, configDigest: `sha256:${hash("config")}`,
    parentDigest: `sha256:${hash("parent")}`, phase: "oras_cli_integration", status: "passed", negatives: [
      ...["redirect_refused", "bearer_refused", "upload-location_refused"].map((code) =>
        ({ code, scope: "native_cli", challenges: 1, authenticatedRequests: 1, secondaryRequests: 1 })),
      { code: "proxy_environment_refused", scope: "subprocess_environment_boundary", nativeCommandExecuted: false, secondaryRequests: 0 },
      { code: "native_proxy_auth_scoped", scope: "native_cli", nativeCommandExecuted: true, authenticatedRequests: 1, proxyConnects: 1 },
      { code: "native_proxy_connect_refused", scope: "native_cli", nativeCommandExecuted: true, challenges: 1, secondaryRequests: 1 },
    ] };
}

function cosignEvidence(binarySha256, selection, proposal) {
  const publicKey = Buffer.from("synthetic-public-key");
  const bundle = Buffer.from("synthetic-bundle");
  const subject = Buffer.from("synthetic-subject");
  return { binarySha256, bundleSha256: sha256(bundle), primaryKeySha256: sha256(publicKey), subjectSha256: sha256(subject),
    publicKeyBase64: publicKey.toString("base64"), bundleBase64: bundle.toString("base64"), subjectBase64: subject.toString("base64"),
    network: "isolated_namespace", networkProof: { interfaces: ["lo"], ipv4NonLoopbackRoutes: 0, ipv6NonLoopbackRoutes: 0,
      status: "isolated", namespaceSha256: sha256(Buffer.from("namespace")), parentNamespaceSha256: sha256(Buffer.from("parent-namespace")), probe: "ENETUNREACH" },
    revokedLedger: "cosign_ledger_revoked", sourceCommit: selection.commit, sourceSha256: proposal.sourceArchive.sha256, status: "passed",
    tests: { missingKey: "key_missing", tamper: "signature_invalid", valid: "signature_valid", wrongKey: "signature_invalid" } };
}

function scannerFinding(id, packageName, version, fixedVersion) {
  return { VulnerabilityID: id, PkgName: packageName, InstalledVersion: version, FixedVersion: fixedVersion,
    Severity: "HIGH", Status: "fixed", SeveritySource: "synthetic", PrimaryURL: "https://example.invalid/advisory",
    DataSource: { ID: "synthetic", Name: "Synthetic", URL: "https://example.invalid/source" } };
}

function fixtureReports(expectedInventory, manifest, scannerVersion) {
  const groups = expectedInventory.targets.filter((entry) => entry.fixture === "gomod-vulnerable");
  const goFindings = manifest.fixtures.find((entry) => entry.id === "gomod-vulnerable").expected.findings;
  const go = { SchemaVersion: 2, ArtifactType: "filesystem", ArtifactName: "gomod", Trivy: { Version: scannerVersion },
    Results: groups.map((group) => ({ Target: group.scanSubjectRelativeTarget, Class: group.resultClass, Type: group.resultType,
      Packages: group.packages.map((entry) => entry.version === "" ? { ...group.reportJsonRootPackage } :
        { Name: entry.name, Version: entry.version, Relationship: entry.relationship }),
      Vulnerabilities: goFindings.filter((entry) => entry.target === group.scanSubjectRelativeTarget)
        .map((entry) => scannerFinding(entry.id, entry.package, entry.version, entry.fixedVersion)) })) };
  const javaGroup = expectedInventory.targets.find((entry) => entry.fixture === "java-war-vulnerable");
  const javaExpected = manifest.fixtures.find((entry) => entry.id === "java-war-vulnerable").expected;
  const war = { SchemaVersion: 2, ArtifactType: "filesystem", ArtifactName: "test.war", Trivy: { Version: scannerVersion }, Results: [{
    Target: "test.war", Class: javaGroup.resultClass, Type: javaGroup.resultType,
    Packages: javaGroup.packages.map((entry) => ({ Name: entry.name, Version: entry.version })),
    Vulnerabilities: [scannerFinding(javaExpected.finding.id, javaExpected.package, javaExpected.version, javaExpected.finding.fixedVersion)],
  }] };
  const clean = { SchemaVersion: 2, ArtifactType: "filesystem", ArtifactName: "jackson-core-2.15.0.jar", Trivy: { Version: scannerVersion },
    Results: [{ Target: "jackson-core-2.15.0.jar", Class: "lang-pkgs", Type: "jar",
      Packages: [{ Name: "com.fasterxml.jackson.core:jackson-core", Version: "2.15.0" }], Vulnerabilities: [] }] };
  return { "gomod-vulnerable": go, "java-war-vulnerable": war, "java-jar-clean-candidate": clean };
}

function baselineReport(report, fixtureId) {
  const value = globalThis.structuredClone(report);
  value.Trivy.Version = "0.74.0";
  value.ArtifactName = fixtureId === "gomod-vulnerable" ? "/fixtures/gomod" : "/fixtures/java/test.war";
  return value;
}

function subjectReport(tool, filename, packages, scannerVersion) {
  return { SchemaVersion: 2, ArtifactType: "filesystem", ArtifactName: "subject", Trivy: { Version: scannerVersion },
    CreatedAt: "2026-09-08T10:00:00Z", Results: [{ Class: "lang-pkgs", Type: "gobinary", Target: filename,
      Packages: packages.map(({ name, version }) => ({ Name: name, ...(version ? { Version: version } : {}) })), Vulnerabilities: [] }] };
}

function subjectSbom(filename, packages) {
  const properties = (values) => Object.entries(values).map(([name, value]) => ({ name, value }));
  return { bomFormat: "CycloneDX", metadata: { component: { type: "application", name: "subject" }, tools: { components: [{ type: "application", name: "trivy" }] } },
    components: [{ type: "application", name: filename, properties: properties({ "aquasecurity:trivy:Type": "gobinary", "aquasecurity:trivy:Class": "lang-pkgs" }) },
      ...packages.map(({ name, version }) => ({ type: "library", name, ...(version ? { version } : {}),
        properties: properties({ "aquasecurity:trivy:PkgType": "gobinary" }) }))] };
}

export async function createNativeAdmissionFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "auto-world-native-admission-fixture-")));
  const cleanup = async () => rm(root, { recursive: true, force: true });
  try {
    for (const relative of new Set([...NATIVE_RECIPE_PATHS, ...NATIVE_ADMISSION_IMPORT_PATHS,
      "infra/supply-chain/native-sources.json", ".github/workflows/native-bootstrap.yml",
      "infra/supply-chain/materials/scanner-fixtures", "infra/supply-chain/materials/baseline-fixtures",
      "infra/supply-chain/materials/baseline-docker"])) await copyRepositoryInput(root, relative);

    const selection = JSON.parse(await readFile(path.join(root, "infra/supply-chain/native-sources.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "infra/supply-chain/native-materials.lock.json"), "utf8"));
    const sourceBytes = Object.fromEntries(lock.proposals.map(({ tool }) => [tool, Buffer.from(`synthetic-source-${tool}`)]));
    for (const proposal of lock.proposals) {
      const selected = selection.tools.find((entry) => entry.name === proposal.tool);
      if (proposal.tool === "trivy") {
        proposal.patches = TRIVY_PATCH_IDENTITIES.map((entry) => ({ ...entry }));
        proposal.testMaterials = await Promise.all(proposal.testMaterials.map(async (entry) => {
          const bytes = await readFile(path.join(REPOSITORY_ROOT, entry.path));
          return { ...entry, sha256: sha256(bytes), size: bytes.length };
        }));
      }
      proposal.recipeFiles = [];
      for (const relative of selected.recipeFiles) {
        const bytes = await readFile(path.join(root, relative));
        proposal.recipeFiles.push({ path: relative, sha256: sha256(bytes), size: bytes.length });
      }
      proposal.recipeSha256 = sha256(canonicalJsonBuffer(recipeEvidence(proposal.tool, selected, proposal, selection.compiler.version)));
      proposal.sourceArchive = { sha256: sha256(sourceBytes[proposal.tool]), size: sourceBytes[proposal.tool].length };
      proposal.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(proposal);
      if (proposal.releaseEvidence) proposal.releaseEvidence.provenanceSha256 = releaseEvidenceProvenance(proposal);
    }
    const lockBytes = canonicalJsonBuffer(lock);
    await put(path.join(root, "infra/supply-chain/native-materials.lock.json"), lockBytes);

    const admission = await import(`${pathToFileURL(path.join(root, "scripts/supply-chain/native-admission.mjs")).href}?fixture=${Date.now()}`);
    const baselineTcb = await import(`${pathToFileURL(path.join(root, "scripts/supply-chain/baseline-tcb.mjs")).href}?fixture=${Date.now()}`);
    const baselineComparison = await import(`${pathToFileURL(path.join(root, "scripts/supply-chain/baseline-comparison.mjs")).href}?fixture=${Date.now()}`);
    const materials = await import(`${pathToFileURL(path.join(root, "scripts/supply-chain/materials.mjs")).href}?fixture=${Date.now()}`);
    const validatedSelection = materials.validateSourceSelection(selection);
    const validatedLock = materials.validateMaterialLock(lock, validatedSelection);

    const workflowBytes = await readFile(path.join(root, ".github/workflows/native-bootstrap.yml"));
    const run = { id: "34179141478", attempt: 1, workflowSha: RUN_SOURCE, sourceSha: RUN_SOURCE,
      workflowRef: "CleMeY15/auto-world/.github/workflows/native-bootstrap.yml@refs/pull/8/merge", event: "pull_request",
      workflowFileSha256: sha256(workflowBytes) };
    const lockSha256 = sha256(lockBytes);
    const selectionSha256 = sha256(canonicalJsonBuffer(validatedSelection));
    const candidateDirectory = path.join(root, "evidence/native-candidates");
    await mkdir(candidateDirectory, { recursive: true });
    const records = [];
    const outputBytes = {};
    for (const proposal of validatedLock.proposals) {
      const selected = validatedSelection.tools.find((entry) => entry.name === proposal.tool);
      const info = buildInfo(proposal.tool);
      const targets = proposal.tool === "cosign" ? ["linux-amd64", "windows-amd64"] : ["linux-amd64"];
      for (const repeat of [1, 2]) {
        const artifact = path.join(candidateDirectory, `native-candidate-${proposal.tool}-${repeat}`);
        await mkdir(path.join(artifact, "out"), { recursive: true });
        const outputs = [];
        for (const target of targets) {
          const filename = `${proposal.tool}${target === "windows-amd64" ? ".exe" : ""}`;
          const bytes = outputBytes[`${proposal.tool}:${target}`] ??= Buffer.from(`synthetic-binary-${proposal.tool}-${target}`);
          await put(path.join(artifact, `out/${filename}`), bytes);
          outputs.push({ target, path: `out/${filename}`, sha256: sha256(bytes), size: bytes.length,
            buildInfo: info, buildInfoSha256: sha256(canonicalJsonBuffer(info)) });
        }
        const record = { schemaVersion: 1, state: "built_candidate", tool: proposal.tool, repeat,
          sourceCommit: selected.commit, repositoryCommit: run.sourceSha, selectionSha256, materialLockSha256: lockSha256,
          recipeSha256: proposal.recipeSha256, compilerVersion: validatedSelection.compiler.version,
          runner: { label: "ubuntu-24.04", imageVersion: proposal.managedRunner.imageVersion,
            utilityInventorySha256: sha256(canonicalJsonBuffer(proposal.managedRunner.utilities)) }, run,
          versionOutputSha256: sha256(Buffer.from(`${proposal.tool}-version`)), outputs };
        await put(path.join(artifact, "record.json"), canonicalJsonBuffer(record));
        await put(path.join(artifact, "source.tar.gz"), sourceBytes[proposal.tool]);
        records.push(record);
      }
    }

    const expectations = ["oras", "cosign", "trivy"].flatMap((tool) => [1, 2].map((repeat) => records.find((entry) => entry.tool === tool && entry.repeat === repeat))).map((record) => {
      const proposal = validatedLock.proposals.find((entry) => entry.tool === record.tool);
      return { tool: record.tool, repeat: record.repeat, sourceCommit: record.sourceCommit, repositoryCommit: record.repositoryCommit,
        selectionSha256, materialLockSha256: lockSha256, recipeSha256: proposal.recipeSha256,
        compilerVersion: validatedSelection.compiler.version, runnerImageVersion: proposal.managedRunner.imageVersion,
        utilityInventorySha256: record.runner.utilityInventorySha256, run };
    });
    const candidateArtifacts = await import(`${pathToFileURL(path.join(root, "scripts/supply-chain/candidate-artifacts.mjs")).href}?fixture=${Date.now()}`);
    const sources = Object.fromEntries(validatedLock.proposals.map((entry) => [entry.tool, entry.sourceArchive]));
    const matrix = await candidateArtifacts.verifyCandidateArtifactMatrix(candidateDirectory, expectations, sources);
    const reproducibilityFile = path.join(root, "evidence/native-reproducibility.json");
    await put(reproducibilityFile, canonicalJsonBuffer(matrix));

    const cliDirectory = path.join(root, "evidence/native-cli");
    await mkdir(cliDirectory, { recursive: true });
    const orasOutput = records.find((entry) => entry.tool === "oras" && entry.repeat === 1).outputs[0];
    const cosignOutput = records.find((entry) => entry.tool === "cosign" && entry.repeat === 1).outputs[0];
    const orasBytes = canonicalJsonBuffer(orasEvidence(orasOutput.sha256));
    const cosignSelection = validatedSelection.tools.find((entry) => entry.name === "cosign");
    const cosignProposal = validatedLock.proposals.find((entry) => entry.tool === "cosign");
    const cosignBytes = canonicalJsonBuffer(cosignEvidence(cosignOutput.sha256, cosignSelection, cosignProposal));
    await put(path.join(cliDirectory, "oras-integration-native.json"), orasBytes);
    await put(path.join(cliDirectory, "cosign-airgap-native.json"), cosignBytes);
    const cliSummary = { schemaVersion: 1, run, materialLockSha256: lockSha256, matrixSha256: sha256(canonicalJsonBuffer(matrix)), results: [
      { tool: "oras", filename: "oras-integration-native.json", sha256: sha256(orasBytes), binarySha256: orasOutput.sha256 },
      { tool: "cosign", filename: "cosign-airgap-native.json", sha256: sha256(cosignBytes), binarySha256: cosignOutput.sha256 },
    ] };
    await put(path.join(cliDirectory, "native-cli-results.json"), canonicalJsonBuffer(cliSummary));

    const auditDirectory = path.join(root, "evidence/native-audit");
    await mkdir(auditDirectory, { recursive: true });
    const scannerVersion = validatedSelection.tools.find((entry) => entry.name === "trivy").modifiedVersion;
    const scannerVersionBytes = canonicalJsonBuffer({ Version: scannerVersion });
    await put(path.join(auditDirectory, "scanner-version.json"), scannerVersionBytes);
    const databaseBytes = { vulnerability: Buffer.from("synthetic-vulnerability-database"), java: Buffer.from("synthetic-java-database") };
    const metadata = { Version: 2, UpdatedAt: "2026-09-08T08:30:00Z", NextUpdate: "2026-09-09T08:30:00Z", DownloadedAt: "2026-09-08T09:00:00Z" };
    const javaMetadata = { ...metadata, Version: 1 };
    const dbIdentity = {};
    for (const [name, bytes] of Object.entries(databaseBytes)) dbIdentity[name] = await put(path.join(auditDirectory, `databases/${name}.db`), bytes);
    const dbMetadataIdentity = {
      vulnerability: await put(path.join(auditDirectory, "databases/vulnerability.metadata.json"), canonicalJsonBuffer(metadata)),
      java: await put(path.join(auditDirectory, "databases/java.metadata.json"), canonicalJsonBuffer(javaMetadata)),
    };
    const databases = [
      { name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db:2", sha256: dbIdentity.vulnerability.sha256,
        metadataSha256: dbMetadataIdentity.vulnerability.sha256, updatedAt: metadata.UpdatedAt, downloadedAt: metadata.DownloadedAt },
      { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db:1", sha256: dbIdentity.java.sha256,
        metadataSha256: dbMetadataIdentity.java.sha256, updatedAt: javaMetadata.UpdatedAt, downloadedAt: javaMetadata.DownloadedAt },
    ];
    const subjectResults = [];
    const trivyBytes = outputBytes["trivy:linux-amd64"];
    for (const subject of SUBJECTS) {
      const selected = validatedSelection.tools.find((entry) => entry.name === subject.tool);
      const proposal = validatedLock.proposals.find((entry) => entry.tool === subject.tool);
      const record = records.find((entry) => entry.tool === subject.tool && entry.repeat === 1);
      const output = record.outputs.find((entry) => entry.target === subject.target);
      const directory = path.join(auditDirectory, subject.prefix);
      await mkdir(directory, { recursive: true });
      await put(path.join(directory, subject.filename), outputBytes[`${subject.tool}:${subject.target}`]);
      const infoBytes = canonicalJsonBuffer(output.buildInfo);
      const graphBytes = canonicalJsonBuffer(proposal.modules);
      const recipeBytes = canonicalJsonBuffer(recipeEvidence(subject.tool, selected, proposal, validatedSelection.compiler.version));
      if (sha256(recipeBytes) !== proposal.recipeSha256) throw new Error(`synthetic_recipe_mismatch:${subject.tool}`);
      const packages = [{ name: { oras: "oras.land/oras", cosign: "github.com/sigstore/cosign/v3", trivy: "github.com/aquasecurity/trivy" }[subject.tool], version: "" },
        { name: "stdlib", version: `v${validatedSelection.compiler.version}` }];
      const reportBytes = canonicalJsonBuffer(subjectReport(subject.tool, subject.filename, packages, scannerVersion));
      const sbomBytes = canonicalJsonBuffer(subjectSbom(subject.filename, packages));
      const evidence = {
        buildInfo: await put(path.join(directory, "build-info.json"), infoBytes),
        moduleGraph: await put(path.join(directory, "module-graph.json"), graphBytes),
        material: await put(path.join(directory, "material-lock.json"), lockBytes),
        recipe: await put(path.join(directory, "recipe.json"), recipeBytes),
        sbom: await put(path.join(directory, "sbom.json"), sbomBytes),
        report: await put(path.join(directory, "report.json"), reportBytes),
      };
      const receipt = { schemaVersion: 1, kind: "native_binary", state: "audited_candidate", run,
        subject: { name: subject.tool, version: selected.modifiedVersion, os: subject.os, architecture: "amd64",
          sha256: output.sha256, size: output.size, sourceCommit: selected.commit, materialSha256: lockSha256,
          recipeSha256: proposal.recipeSha256, buildInfoSha256: evidence.buildInfo.sha256, moduleGraphSha256: evidence.moduleGraph.sha256 },
        scanner: { name: "trivy", version: scannerVersion, sha256: sha256(trivyBytes) }, databases,
        evidence: { scannerVersionSha256: sha256(scannerVersionBytes), sbomSha256: evidence.sbom.sha256, reportSha256: evidence.report.sha256 } };
      await put(path.join(directory, "receipt.json"), canonicalJsonBuffer(receipt));
      subjectResults.push({ tool: subject.tool, target: subject.target, state: "audit_proposal", packageCount: packages.length,
        findings: [], blockers: [] });
    }

    const fixtureRoot = path.join(root, "infra/supply-chain/materials/scanner-fixtures");
    const manifestBytes = await readFile(path.join(fixtureRoot, "manifest.json"));
    const manifest = JSON.parse(manifestBytes);
    const expectedInventory = JSON.parse(await readFile(path.join(root, "infra/supply-chain/materials/baseline-fixtures/expected-inventory.json"), "utf8"));
    const reports = fixtureReports(expectedInventory, manifest, scannerVersion);
    const fixtureMaterials = [];
    for (const fixture of manifest.fixtures) for (const material of fixture.material) {
      const bytes = await readFile(path.join(fixtureRoot, material.path));
      await put(path.join(auditDirectory, `fixtures/materials/${material.path}`), bytes);
      fixtureMaterials.push({ path: `materials/${material.path}`, sha256: sha256(bytes), size: bytes.length });
    }
    const fixtureReportEntries = [];
    for (const [fixtureId, report] of Object.entries(reports)) {
      const bytes = canonicalJsonBuffer(report);
      await put(path.join(auditDirectory, `fixtures/reports/${fixtureId}.json`), bytes);
      fixtureReportEntries.push({ fixtureId, path: `fixtures/reports/${fixtureId}.json`, sha256: sha256(bytes), size: bytes.length });
    }
    const summary = { schemaVersion: 1, budget: {}, results: subjectResults.map(({ tool, target, state, packageCount, findings, blockers }) =>
      ({ tool, target, state, packageCount, findingCount: findings.length, blockerCount: blockers.length,
        findingsSha256: EMPTY_HASH, blockersSha256: EMPTY_HASH })), fixtures: {
      manifest: { path: "infra/supply-chain/materials/scanner-fixtures/manifest.json", sha256: sha256(manifestBytes), size: manifestBytes.length },
      materials: fixtureMaterials, reports: fixtureReportEntries,
    } };
    await put(path.join(auditDirectory, "native-audit-results.json"), canonicalJsonBuffer(summary));
    const auditArtifacts = await import(`${pathToFileURL(path.join(root, "scripts/supply-chain/audit-artifacts.mjs")).href}?fixture=${Date.now()}`);
    const auditFiles = [];
    for (const contract of auditArtifacts.NATIVE_AUDIT_ARTIFACT_FILES) {
      const bytes = await readFile(path.join(auditDirectory, contract.path));
      auditFiles.push({ path: contract.path, sha256: sha256(bytes), size: bytes.length });
    }
    await put(path.join(auditDirectory, "diagnostic-package.json"), canonicalJsonBuffer({ schemaVersion: 1, state: "diagnostic_only",
      executionStatus: "passed", phase: "complete", files: auditFiles }));

    const baselineDirectory = path.join(root, "evidence/baseline");
    await mkdir(baselineDirectory, { recursive: true });
    const reference = await baselineTcb.loadBaselineTcbReference();
    const managed = { ...globalThis.structuredClone(reference.managedIdentity), run };
    managed.runtime.info.ID = "d67bd2e5-c674-4039-b894-ae52dbe8151a";
    const baselineRecipeBytes = await readFile(path.join(root, "scripts/supply-chain/baseline-scanner.mjs"));
    const inventory = { schemaVersion: 1, state: "diagnostic_tcb_proposal", baselineState: "failed_non_admitted", run,
      recipeSha256: sha256(baselineRecipeBytes), manifests: reference.manifests, localImage: { ...reference.localImage, volumes: null },
      imageStore: { before: [], after: [reference.localImage.id] }, availableBytesBeforePull: String(16 * 1024 ** 3), containersExecuted: 0 };
    const verifiedTcb = await baselineTcb.validateBaselineTcbReceipt(managed, inventory,
      { expectedRun: run, expectedRecipeSha256: inventory.recipeSha256 });
    const tcbEntries = [];
    for (const [filename, value] of [["tcb-managed-docker.json", managed], ["tcb-inventory.json", inventory]]) {
      const bytes = canonicalJsonBuffer(value);
      await put(path.join(baselineDirectory, filename), bytes);
      tcbEntries.push({ path: filename, sha256: sha256(bytes), size: bytes.length });
    }
    const baselineEntries = [];
    const comparisons = [];
    for (const fixtureId of ["gomod-vulnerable", "java-war-vulnerable"]) {
      const value = baselineReport(reports[fixtureId], fixtureId);
      const bytes = canonicalJsonBuffer(value);
      await put(path.join(baselineDirectory, `${fixtureId}.json`), bytes);
      baselineEntries.push({ fixtureId, path: `${fixtureId}.json`, sha256: sha256(bytes), size: bytes.length });
      comparisons.push({ candidate: baselineComparison.normalizeBaselineComparisonReport(fixtureId, reports[fixtureId], scannerVersion),
        baseline: baselineComparison.normalizeBaselineComparisonReport(fixtureId, value, "0.74.0") });
    }
    const expected = await baselineComparison.loadBaselineExpectedInventory(manifest);
    const comparison = baselineComparison.compareBaselineReports(comparisons.map((entry) => entry.candidate), comparisons.map((entry) => entry.baseline), expected);
    if (!comparison.matched) throw new Error("synthetic_baseline_mismatch");
    const baselineReceipt = { schemaVersion: 1, state: "failed_non_admitted", comparisonStatus: "match", run,
      baseline: { image: `aquasec/trivy@${reference.manifests.child}`, version: "0.74.0", tcbIdentitySha256: verifiedTcb.identitySha256 },
      candidate: { version: scannerVersion, matrixSha256: sha256(canonicalJsonBuffer(matrix)) }, tcbEvidence: tcbEntries,
      reports: baselineEntries, comparison: comparison.comparisons };
    await put(path.join(baselineDirectory, "baseline-comparison.json"), canonicalJsonBuffer(baselineReceipt));

    const inputPaths = [...new Set(["infra/supply-chain/native-sources.json", "infra/supply-chain/native-materials.lock.json",
      ".github/workflows/native-bootstrap.yml", ...NATIVE_RECIPE_PATHS, ...admission.NATIVE_ADMISSION_IMPORT_PATHS])];
    const repositoryFiles = [];
    for (const relative of inputPaths) {
      const bytes = await readFile(path.join(root, relative));
      repositoryFiles.push({ path: relative, bytes, sha256: sha256(bytes), size: bytes.length });
    }
    const byPath = new Map(repositoryFiles.map((entry) => [entry.path, entry]));
    const identity = (relative) => ({ path: relative, sha256: byPath.get(relative).sha256, size: byPath.get(relative).size });
    const context = { schemaVersion: 1, state: "native_evidence_context", repository: "CleMeY15/auto-world", prNumber: 8, run,
      source: { headSha: "a".repeat(40), baseSha: "b".repeat(40), mergeSha: run.sourceSha,
        mergeTree: "c".repeat(40), mergeParents: ["b".repeat(40), "a".repeat(40)] },
      startedAt: "2026-09-08T08:00:00Z", completedAt: "2026-09-08T12:00:00Z",
      selection: identity("infra/supply-chain/native-sources.json"), materialLock: identity("infra/supply-chain/native-materials.lock.json"),
      workflow: identity(".github/workflows/native-bootstrap.yml"), nativeRecipeFiles: NATIVE_RECIPE_PATHS.map(identity),
      admissionRecipeFiles: admission.NATIVE_ADMISSION_IMPORT_PATHS.map(identity) };
    const contextBytes = canonicalJsonBuffer(context);
    const repository = { context: { path: "native-admission-context.json", bytes: contextBytes, sha256: sha256(contextBytes), size: contextBytes.length },
      files: repositoryFiles, authorIds: ["/root", "/root/bootstrap_native_executor"] };
    const derivation = { repositoryRoot: root, repository, candidateDirectory, reproducibilityFile, cliDirectory, auditDirectory, baselineDirectory };
    return { root, cleanup, admission, derivation, paths: {
      record: path.join(candidateDirectory, "native-candidate-oras-1/record.json"),
      audit: path.join(auditDirectory, "oras-linux-amd64/report.json"),
      database: path.join(auditDirectory, "databases/vulnerability.db"),
      cli: path.join(cliDirectory, "oras-integration-native.json"),
      tcb: path.join(baselineDirectory, "tcb-inventory.json"),
      auditCount: path.join(auditDirectory, "fixtures/materials/gomod/go.mod"),
      proposal: path.join(root, "infra/supply-chain/native-admission.json"),
    }, put, unlink };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
