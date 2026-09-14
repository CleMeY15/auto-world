import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertResourceBudget, canonicalMaterial, clippedTimeout, parseArguments, removeOwnedTree, sha256,
  summarizeGoTestJson, validateArtifactAllowlist, validateArtifactDirectory, validateBuildInfo, validateSeaweedLock,
} from "../scripts/seaweed/build.mjs";

const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(path.join(root, "infra/seaweed/seaweed-lock.json"), "utf8"));

test("Seaweed lock binds the exact reviewed source, compiler, patch, manifest, and production variant", () => {
  assert.equal(validateSeaweedLock(lock), lock);
  assert.throws(() => validateSeaweedLock({ ...lock, patch: { ...lock.patch, size: lock.patch.size + 1 } }), /seaweed_lock_invalid/u);
  for (const field of ["patch", "moduleChanges", "requiredTests"]) {
    const bytes = readFileSync(path.join(root, lock[field].path));
    assert.equal(bytes.length, lock[field].size);
    assert.equal(sha256(bytes), lock[field].sha256);
    assert.throws(() => canonicalMaterial(Buffer.concat([bytes, Buffer.from("x")]), lock[field]), /seaweed_material_changed/u);
  }
  assert.deepEqual(lock.build.tags, []);
  assert.equal(lock.build.cgoEnabled, "0");
  assert.doesNotMatch(lock.build.ldflags, /(?:^|\s)-(?:s|w)(?:\s|$)|trimpath|buildid/u);
});

test("bounded arguments, deadlines, resources, and artifact paths fail closed", () => {
  const output = path.resolve(tmpdir(), "seaweed-build-1");
  assert.deepEqual(parseArguments(["--repeat", "1", "--output", output]), { output, repeat: 1 });
  assert.throws(() => parseArguments(["--repeat", "3", "--output", output]), /seaweed_arguments_invalid/u);
  assert.equal(clippedTimeout({ deadlineMs: 100, finalizationReserveMs: 20 }, 10, 90), 70);
  assert.throws(() => clippedTimeout({ deadlineMs: 100, finalizationReserveMs: 20 }, 80, 1), /seaweed_inner_deadline_exceeded/u);
  const limits = { workBytes: 10, retainedBytes: 10, minimumFreeBytes: 5, aggregateLogBytes: 10 };
  assert.doesNotThrow(() => assertResourceBudget({ workBytes: 10, retainedBytes: 10, freeBytes: 5, logBytes: 10, limits }));
  for (const changed of [{ workBytes: 11 }, { retainedBytes: 11 }, { freeBytes: 4 }, { logBytes: 11 }]) {
    assert.throws(() => assertResourceBudget({ workBytes: 10, retainedBytes: 10, freeBytes: 5, logBytes: 10, limits, ...changed }), /seaweed_.+_failed|seaweed_.+_exceeded/u);
  }
  assert.equal(validateArtifactAllowlist(["weed", "materials/required-tests.json", "materials/modules/" + "a".repeat(64) + "/source.zip"]), true);
  assert.throws(() => validateArtifactAllowlist(["weed", "../secret"]), /seaweed_artifact_allowlist_invalid/u);
});

test("required go test events bind package plus top-level name and retain skips", () => {
  const required = ["example.test/pkg:TestRequired"];
  const output = Buffer.from([
    { Action: "pass", Package: "example.test/pkg", Test: "TestRequired" },
    { Action: "skip", Package: "example.test/pkg", Test: "TestIntentional" },
  ].map(JSON.stringify).join("\n") + "\n");
  assert.deepEqual(summarizeGoTestJson(output, required), { requiredPassed: 1, skips: ["example.test/pkg:TestIntentional"] });
  assert.throws(() => summarizeGoTestJson(Buffer.from(JSON.stringify({ Action: "skip", Package: "example.test/pkg", Test: "TestRequired" })), required), /seaweed_required_test_failed/u);
  assert.throws(() => summarizeGoTestJson(Buffer.from("not-json"), required), /seaweed_test_output_invalid/u);
});

test("build metadata requires corrected dependency, platform, VCS revision, modified state, and no tags", () => {
  const info = ["/tmp/auto-world-seaweed-source-diagnostic/bin/weed", `\tdep\tgoogle.golang.org/grpc\t${lock.grpc.version}\th1:x`, "\tbuild\tCGO_ENABLED=0", "\tbuild\tGOARCH=amd64", "\tbuild\tGOOS=linux", "\tbuild\tGOAMD64=v1", `\tbuild\tvcs.revision=${lock.source.commit}`, "\tbuild\tvcs.modified=true"].join("\n");
  assert.equal(validateBuildInfo(info, lock), true);
  assert.throws(() => validateBuildInfo(info.replace("vcs.modified=true", "vcs.modified=false"), lock), /seaweed_build_info_invalid/u);
  assert.throws(() => validateBuildInfo(`${info}\n\tbuild\t-tags=elastic`, lock), /seaweed_build_tags_invalid/u);
});

test("cleanup removes only the exact owned nonsymlink tree", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "seaweed-clean-"));
  const owned = path.join(parent, "auto-world-seaweed-source-diagnostic");
  mkdirSync(owned); writeFileSync(path.join(owned, "x"), "x");
  removeOwnedTree(owned, parent);
  const foreign = path.join(parent, "foreign"); mkdirSync(foreign);
  assert.throws(() => removeOwnedTree(foreign, parent), /seaweed_cleanup_path_invalid/u);
  const target = path.join(parent, "target"); mkdirSync(target);
  const linked = path.join(parent, "auto-world-seaweed-source-diagnostic");
  symlinkSync(target, linked, "junction");
  assert.throws(() => removeOwnedTree(linked, parent), /seaweed_cleanup_path_invalid/u);
  rmSync(parent, { recursive: true, force: true });
});

test("artifact validation permits only bounded failure logs or a complete passed inventory", () => {
  const failed = mkdtempSync(path.join(tmpdir(), "seaweed-artifact-")); mkdirSync(path.join(failed, "logs"));
  writeFileSync(path.join(failed, "logs/01-command.log"), "failure"); writeFileSync(path.join(failed, "build-receipt.json"), JSON.stringify({ schemaVersion: 1, result: "FAILED" }));
  assert.equal(validateArtifactDirectory(failed).result, "FAILED");
  writeFileSync(path.join(failed, "weed"), "partial");
  assert.throws(() => validateArtifactDirectory(failed), /seaweed_failed_artifact_unsafe/u);
  rmSync(failed, { recursive: true, force: true });
});
