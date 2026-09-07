import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";
import {
  MANAGED_RUNNER_UTILITY_PATHS,
  TRIVY_PATCH_IDENTITIES,
  TRIVY_WASM_INPUTS,
  assertManagedRunnerUtilitiesMatch,
  validateMaterialLock,
  validateManagedRunnerUtilities,
  validateMaterialProposal,
  validateSourceSelection,
  releaseEvidenceProvenance,
  sourceEvidenceProvenance,
} from "../scripts/supply-chain/materials.mjs";

const selectionBytes = readFileSync(new URL("../infra/supply-chain/native-sources.json", import.meta.url));
const selection = validateSourceSelection(JSON.parse(selectionBytes));
const selectionSha256 = sha256(canonicalJsonBuffer(selection));
const runnerUtilities = Object.entries(MANAGED_RUNNER_UTILITY_PATHS).map(([name, utilityPath]) => ({ name, path: utilityPath, identity: `${name} fixed identity` }));

function proposal(tool, overrides = {}) {
  const value = {
    schemaVersion: 1,
    state: "material_lock_proposal",
    selectionSha256,
    tool,
    sourceTree: "a".repeat(40),
    sourceArchive: { sha256: "1".repeat(64), size: 1 },
    compilerArchive: { goos: "linux", sha256: "2".repeat(64), size: 1 },
    modules: [{
      path: "example.invalid/module", version: "v1.0.0", sum: `h1:${"A".repeat(43)}=`,
      goModSum: `h1:${"B".repeat(43)}=`, zipSha256: "3".repeat(64), zipSize: 1,
    }],
    patches: [],
    patchProposals: [],
    testMaterials: [],
    sourceDateEpoch: 1_700_000_000,
    recipeFiles: [{ path: "scripts/supply-chain/native-build.mjs", sha256: "6".repeat(64), size: 1 }],
    recipeSha256: "4".repeat(64),
    requiredEvidence: selection.tools.find((entry) => entry.name === tool).requiredEvidence,
    sourceEvidence: {
      licenseFiles: [{ path: "LICENSE", sha256: "7".repeat(64), size: 1 }],
      noticeFiles: [{ path: "NOTICE", sha256: "8".repeat(64), size: 1 }],
      noticeStatus: "present",
      wasmInputs: tool === "trivy" ? TRIVY_WASM_INPUTS.map((entry, index) => ({ ...entry, sha256: String(index + 1).repeat(64), size: 1 })) : [],
      provenanceSha256: "0".repeat(64),
    },
    managedRunner: {
      label: "ubuntu-24.04", imageVersion: "20260901.1",
      utilities: runnerUtilities,
    },
    complete: true,
    blockers: [],
    ...overrides,
  };
  if (tool === "oras" && !Object.hasOwn(overrides, "releaseEvidence")) {
    const verification = selection.tools.find((entry) => entry.name === "oras").orasVerification;
    value.releaseEvidence = {
      materials: verification.materials,
      referenceArchive: { url: verification.referenceArchiveUrl, sha256: verification.referenceArchiveSha256, size: 1 },
      gpg: { fingerprint: verification.releaseKeyFingerprint, verified: true },
      tag: { recordSha256: verification.materials[1].sha256, object: verification.tagObject, target: verification.tagTarget, verified: true, reason: "valid" },
      commit: { recordSha256: verification.materials[2].sha256, commit: verification.tagTarget, tree: value.sourceTree, verified: true, reason: "valid" },
      provenanceSha256: "0".repeat(64),
    };
  }
  if (!overrides.sourceEvidence) value.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(value);
  if (value.releaseEvidence) value.releaseEvidence.provenanceSha256 = releaseEvidenceProvenance(value);
  return value;
}

test("the committed source selection binds exact source and compiler identities", () => {
  assert.equal(selection.compiler.version, "1.26.8");
  assert.deepEqual(selection.tools.map(({ name, commit }) => [name, commit]), [
    ["oras", "db9e29505c3059f2b8fde34ae8cae266c5c765e9"],
    ["cosign", "11926fa5bbbbde47e88fc006b625a17769b743b2"],
    ["trivy", "e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994"],
  ]);
  assert.equal(selection.tools[0].orasVerification.materials.length, 5);
});

test("all three recipes contain exactly the transitive local execution modules", () => {
  const pending = ["lock-update", "native-build", "candidate-artifacts", "native-cli", "native-scan"]
    .map((name) => `scripts/supply-chain/${name}.mjs`);
  const closure = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (closure.has(file)) continue;
    closure.add(file);
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    // This repository uses static ESM imports. Fail if that convention changes
    // instead of silently omitting executable dynamic dependencies.
    assert.doesNotMatch(source, /\b(?:import|require)\s*\(/u, file);
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gu)) {
      const specifier = match[1];
      if (specifier.startsWith("node:")) continue;
      assert.ok(specifier.startsWith("./"), `${file}: ${specifier}`);
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      assert.ok(dependency.startsWith("scripts/supply-chain/"), dependency);
      pending.push(dependency);
    }
  }
  for (const tool of selection.tools) assert.deepEqual([...tool.recipeFiles].sort(), [...closure].sort(), tool.name);
});

test("source selection rejects mutable or substituted source URLs", () => {
  const mutated = JSON.parse(JSON.stringify(selection));
  mutated.tools[0].sourceRepositoryUrl = "https://github.com/oras-project/other.git";
  assert.throws(() => validateSourceSelection(mutated), /source_repository_url_invalid/u);
  mutated.tools[0].sourceRepositoryUrl = "https://evil.invalid/oras-project/oras.git";
  assert.throws(() => validateSourceSelection(mutated), /host_not_allowed/u);
  const symlinkDrift = JSON.parse(JSON.stringify(selection));
  symlinkDrift.tools.find((entry) => entry.name === "trivy").sourceSymlinks[0].target = "other";
  assert.throws(() => validateSourceSelection(symlinkDrift), /source_symlinks_mismatch/u);
  const evidenceDrift = JSON.parse(JSON.stringify(selection));
  evidenceDrift.tools.find((entry) => entry.name === "oras").orasVerification.materials[0].size += 1;
  assert.throws(() => validateSourceSelection(evidenceDrift), /evidence_materials_mismatch/u);
});

test("managed runner inventory closes names, order, paths and identities", () => {
  assert.doesNotThrow(() => validateManagedRunnerUtilities(runnerUtilities, selection.managedRunner.requiredUtilities));
  for (const hostile of [
    runnerUtilities.slice(1),
    [...runnerUtilities, runnerUtilities[0]],
    runnerUtilities.map((entry, index) => index === 1 ? runnerUtilities[0] : entry),
    runnerUtilities.map((entry) => entry.name === "git" ? { ...entry, path: "/attacker/substitute" } : entry),
    runnerUtilities.map((entry) => entry.name === "git" ? { ...entry, identity: "" } : entry),
  ]) assert.throws(() => validateManagedRunnerUtilities(hostile, selection.managedRunner.requiredUtilities), /runner_utilit/u);
  assert.doesNotThrow(() => assertManagedRunnerUtilitiesMatch(runnerUtilities, runnerUtilities, selection.managedRunner.requiredUtilities));
  const identityDrift = runnerUtilities.map((entry) => entry.name === "git" ? { ...entry, identity: "substituted" } : entry);
  assert.throws(() => assertManagedRunnerUtilitiesMatch(runnerUtilities, identityDrift, selection.managedRunner.requiredUtilities), /native_build_runner_utility_drift/u);
});

test("proposal rejects closure, patch order, runner and completion drift", () => {
  assert.doesNotThrow(() => validateMaterialProposal(proposal("oras"), selectionSha256, "oras"));
  assert.throws(() => validateMaterialProposal(proposal("oras", { selectionSha256: "0".repeat(64) }), selectionSha256, "oras"), /selection_mismatch/u);
  assert.throws(() => validateMaterialProposal(proposal("oras", { modules: [] }), selectionSha256, "oras"), /modules_invalid/u);
  assert.throws(() => validateMaterialProposal(proposal("oras", {
    patches: [{ order: 2, kind: "reviewed", path: "infra/supply-chain/patches/a.patch", sha256: "5".repeat(64), size: 1 }],
  }), selectionSha256, "oras"), /patch_order_invalid/u);
  assert.throws(() => validateMaterialProposal(proposal("trivy", {
    patches: [{ order: 1, kind: "unexpected", path: "infra/supply-chain/patches/a.patch", sha256: "5".repeat(64), size: 1 }],
  }), selectionSha256, "trivy", ["grpc-1.83.1", "fixture-locking"]), /patch_kind_not_selected/u);
  assert.throws(() => validateMaterialProposal(proposal("trivy", {
    patches: [{ order: 1, kind: "grpc-1.83.1", path: "infra/supply-chain/patches/../outside.patch", sha256: "5".repeat(64), size: 1 }],
  }), selectionSha256, "trivy", ["grpc-1.83.1", "fixture-locking"]), /patches_0_path_invalid/u);
  assert.throws(() => validateMaterialProposal(proposal("oras", { complete: true, blockers: ["pending"] }), selectionSha256, "oras"), /completion_mismatch/u);
  const missingLicense = proposal("cosign", { complete: false, blockers: ["source-license-evidence-missing"] });
  missingLicense.sourceEvidence.licenseFiles = [];
  missingLicense.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(missingLicense);
  assert.doesNotThrow(() => validateMaterialProposal(missingLicense, selectionSha256, "cosign"));
  const missingNotice = proposal("cosign");
  missingNotice.sourceEvidence.noticeFiles = [];
  missingNotice.sourceEvidence.noticeStatus = "absent-in-pinned-source";
  missingNotice.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(missingNotice);
  assert.doesNotThrow(() => validateMaterialProposal(missingNotice, selectionSha256, "cosign"));
  const inconsistentNotice = proposal("cosign");
  inconsistentNotice.sourceEvidence.noticeFiles = [];
  inconsistentNotice.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(inconsistentNotice);
  assert.throws(() => validateMaterialProposal(inconsistentNotice, selectionSha256, "cosign"), /notice_status_invalid/u);
  assert.throws(() => validateMaterialProposal(proposal("cosign", { requiredEvidence: ["license"] }), selectionSha256, "cosign", [], selection.tools.find((entry) => entry.name === "cosign").requiredEvidence), /required_evidence_mismatch/u);
  const evidencePath = proposal("cosign");
  evidencePath.sourceEvidence.licenseFiles[0].path = "third_party/@scope/package/LICENSE";
  evidencePath.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(evidencePath);
  assert.doesNotThrow(() => validateMaterialProposal(evidencePath, selectionSha256, "cosign"));
  const evidenceDrift = proposal("cosign");
  evidenceDrift.recipeSha256 = "9".repeat(64);
  assert.throws(() => validateMaterialProposal(evidenceDrift, selectionSha256, "cosign"), /source_provenance_mismatch/u);
  const missingReleaseEvidence = proposal("oras");
  delete missingReleaseEvidence.releaseEvidence;
  assert.throws(() => validateMaterialProposal(missingReleaseEvidence, selectionSha256, "oras"), /release_evidence_presence_invalid/u);
  const invalidTagEvidence = proposal("oras");
  invalidTagEvidence.releaseEvidence.tag.verified = false;
  invalidTagEvidence.releaseEvidence.provenanceSha256 = releaseEvidenceProvenance(invalidTagEvidence);
  assert.throws(() => validateMaterialProposal(invalidTagEvidence, selectionSha256, "oras"), /release_tag_invalid/u);
  assert.doesNotThrow(() => validateMaterialProposal(proposal("trivy", {
    complete: false, blockers: ["patch-review-pending"], patchProposals: [{ kind: "grpc-1.83.1", path: "proposal-assets/trivy/trivy-grpc-1.83.1.patch", sha256: "5".repeat(64), size: 1 }],
  }), selectionSha256, "trivy", ["grpc-1.83.1", "fixture-locking"]));
  assert.throws(() => validateMaterialProposal(proposal("trivy", {
    patchProposals: [{ kind: "grpc-1.83.1", path: "proposal-assets/trivy/trivy-grpc-1.83.1.patch", sha256: "5".repeat(64), size: 1 }],
  }), selectionSha256, "trivy", ["grpc-1.83.1", "fixture-locking"]), /patch_proposals_unresolved/u);
  assert.throws(() => validateMaterialProposal(proposal("trivy"), selectionSha256, "trivy", ["grpc-1.83.1", "fixture-locking"]), /patches_incomplete/u);
  const missingWasm = proposal("trivy", { complete: false, blockers: ["patch-review-pending"] });
  missingWasm.sourceEvidence.wasmInputs = [];
  missingWasm.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(missingWasm);
  assert.throws(() => validateMaterialProposal(missingWasm, selectionSha256, "trivy", ["grpc-1.83.1", "fixture-locking"]), /wasm_inputs_invalid/u);
  const substitutedWasm = proposal("trivy", { complete: false, blockers: ["patch-review-pending"] });
  substitutedWasm.sourceEvidence.wasmInputs[0].output = "pkg/module/testdata/analyzer/substitute.wasm";
  substitutedWasm.sourceEvidence.provenanceSha256 = sourceEvidenceProvenance(substitutedWasm);
  assert.throws(() => validateMaterialProposal(substitutedWasm, selectionSha256, "trivy", ["grpc-1.83.1", "fixture-locking"]), /wasm_input_identity_mismatch/u);
});

test("strict schemas reject unknown fields without reflecting their names", () => {
  const hostile = proposal("oras");
  hostile["SENTINEL_DO_NOT_REFLECT"] = "value";
  assert.throws(() => validateMaterialProposal(hostile, selectionSha256, "oras"), (error) => {
    assert.equal(error.message.includes("SENTINEL_DO_NOT_REFLECT"), false);
    return true;
  });
});

test("aggregate material lock requires one complete proposal for every tool", () => {
  const lock = {
    schemaVersion: 1,
    state: "material_locked",
    selectionSha256,
    proposals: [proposal("cosign"), proposal("oras"), proposal("trivy")],
  };
  for (const item of lock.proposals) {
    item.recipeFiles = selection.tools.find((entry) => entry.name === item.tool).recipeFiles.map((file, index) => ({ path: file, sha256: String(index % 10).repeat(64), size: 1 }));
    item.compilerArchive.sha256 = selection.compiler.archives.find((entry) => entry.goos === "linux").sha256;
    if (item.tool === "trivy") {
      item.patches = TRIVY_PATCH_IDENTITIES;
      item.testMaterials = [
        { name: "trivy-test-repo-git-worktree", kind: "git-fixture-archive", origin: "https://github.com/aquasecurity/trivy-test-repo", path: "infra/supply-chain/materials/trivy/test-repo-git-worktree.tar.gz", sha256: "082504160f61c7539bf67e3c85c0f614c4536b2e2a09a5fcb76461b3c81b6d76", size: 33_353 },
        { name: "trivy-socat-rpm", kind: "rpm-fixture", origin: "https://mirror.openshift.com/pub/openshift-v4/amd64/dependencies/rpms/4.10-beta/socat-1.7.3.2-2.el7.x86_64.rpm", path: "infra/supply-chain/materials/trivy/socat-1.7.3.2-2.el7.x86_64.rpm", sha256: "629571bd05c7ae50170a7a94d2b987489e7f50de7d733955f70fb8e396831ba9", size: 296_692 },
      ];
      item.modules.push({ path: "github.com/magefile/mage", version: "v1.17.2", sum: `h1:${"C".repeat(43)}=`, goModSum: `h1:${"D".repeat(43)}=`, zipSha256: "9".repeat(64), zipSize: 1 });
      item.modules.push({ path: "google.golang.org/grpc", version: "v1.83.1", sum: `h1:${"E".repeat(43)}=`, goModSum: `h1:${"F".repeat(43)}=`, zipSha256: "a".repeat(64), zipSize: 1 });
    }
  }
  assert.doesNotThrow(() => validateMaterialLock(lock, selection));
  const patchDrift = JSON.parse(JSON.stringify(lock));
  patchDrift.proposals.find((entry) => entry.tool === "trivy").patches[0].sha256 = "0".repeat(64);
  assert.throws(() => validateMaterialLock(patchDrift, selection), /patch_identity_mismatch/u);
  for (const mutate of [
    (utilities) => utilities.slice(1),
    (utilities) => [...utilities, utilities[0]],
    (utilities) => utilities.map((entry, index) => index === 1 ? utilities[0] : entry),
    (utilities) => utilities.map((entry) => entry.name === "git" ? { ...entry, path: "/attacker/substitute" } : entry),
    (utilities) => utilities.map((entry) => entry.name === "git" ? { ...entry, identity: "fabricated" } : entry),
  ]) {
    const runnerDrift = JSON.parse(JSON.stringify(lock));
    runnerDrift.proposals[0].managedRunner.utilities = mutate(runnerDrift.proposals[0].managedRunner.utilities);
    assert.throws(() => validateMaterialLock(runnerDrift, selection), /runner_utilit/u);
  }
  const compilerDrift = JSON.parse(JSON.stringify(lock));
  compilerDrift.proposals[0].compilerArchive.sha256 = "9".repeat(64);
  assert.throws(() => validateMaterialLock(compilerDrift, selection), /lock_compiler_archive_mismatch/u);
  lock.proposals[2] = proposal("cosign");
  assert.throws(() => validateMaterialLock(lock, selection), /lock_proposal_duplicate/u);
});
