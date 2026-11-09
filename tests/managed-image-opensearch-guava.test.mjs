import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { exportManagedTextEvidence } from "../scripts/scanner/official-audit.mjs";

const directory = fileURLToPath(new URL("../infra/managed-images/opensearch-core/", import.meta.url));
const fixture = readFileSync(path.join(directory, "fixtures/transport-grpc.build.gradle"));
const patchScript = readFileSync(path.join(directory, "patch-transport-grpc-guava.sh"), "utf8");
const readablePatch = readFileSync(path.join(directory, "transport-grpc-guava.patch"), "utf8");
const build = readFileSync(path.join(directory, "build-core.sh"), "utf8");
const recipe = readFileSync(new URL("../infra/managed-images/Dockerfile.opensearch-core", import.meta.url), "utf8");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function temporaryDirectory(t) {
  const result = mkdtempSync(path.join(os.tmpdir(), "aw-opensearch-guava-"));
  t.after(() => rmSync(result, { recursive: true, force: true }));
  return result;
}

function materialSource(t, bytes = fixture) {
  const root = temporaryDirectory(t);
  const target = path.join(root, "modules/transport-grpc/build.gradle");
  const evidence = path.join(root, "evidence");
  mkdirSync(path.dirname(target), { recursive: true });
  mkdirSync(evidence);
  writeFileSync(target, bytes);
  return { root, target, evidence };
}

function runPatch(source) {
  return spawnSync(bash, [path.join(directory, "patch-transport-grpc-guava.sh").replaceAll("\\", "/"),
    source.root.replaceAll("\\", "/"), source.evidence.replaceAll("\\", "/")], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
}

test("the transport-grpc patch is exact, source guarded and retains original and patched evidence", (t) => {
  assert.equal(sha256(fixture), "c77756ad3c96ad3345df98b038bed1e9f1bfbb5947af2e055bd719a3ed0a3e71");
  assert.equal(sha256(readablePatch), "b03a43072ec56fe693a5dd1cd44147f96f78d4ab89a5ff077c7fa8c41939cbbb");
  const source = materialSource(t);
  const result = runPatch(source);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(sha256(readFileSync(source.target)), "c8312d409ea46ecc3407bcbd555ef2551177e554ebda2c5ce2419cfefccd4323");
  const originalEvidence = path.join(source.evidence, "transport-grpc.build.gradle.original.txt");
  const patchedEvidence = path.join(source.evidence, "transport-grpc.build.gradle.patched.txt");
  assert.deepEqual(readFileSync(originalEvidence), fixture);
  assert.deepEqual(readFileSync(patchedEvidence), readFileSync(source.target));

  const exportedDirectory = path.join(source.root, "exported");
  const exported = exportManagedTextEvidence(source.evidence, exportedDirectory);
  assert.deepEqual(exported.map(({ path: evidencePath, sha256: digest }) => [evidencePath, digest]).sort(), [
    ["transport-grpc.build.gradle.original.txt", sha256(fixture)],
    ["transport-grpc.build.gradle.patched.txt", sha256(readFileSync(source.target))],
  ]);
  assert.deepEqual(readFileSync(path.join(exportedDirectory, "transport-grpc.build.gradle.original.txt")), fixture);
  assert.deepEqual(readFileSync(path.join(exportedDirectory, "transport-grpc.build.gradle.patched.txt")), readFileSync(source.target));
  assert.notEqual(runPatch(source).status, 0);

  const patchApplication = materialSource(t);
  const applied = spawnSync("git", ["-C", patchApplication.root, "apply", "--unidiff-zero", "--whitespace=error-all",
    path.join(directory, "transport-grpc-guava.patch")], { encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
  assert.equal(sha256(readFileSync(patchApplication.target)), "c8312d409ea46ecc3407bcbd555ef2551177e554ebda2c5ce2419cfefccd4323");

  const changed = materialSource(t, Buffer.concat([fixture, Buffer.from("// changed\n")]));
  assert.notEqual(runPatch(changed).status, 0);
});

test("the patch changes only the module dependency pair and matching upstream audit classes", () => {
  assert.match(readablePatch, /runtimeOnly "com\.google\.guava:guava:33\.8\.0-jre"/u);
  assert.match(readablePatch, /implementation "com\.google\.guava:failureaccess:1\.0\.3"/u);
  assert.match(readablePatch, /AbstractFutureState\$UnsafeAtomicHelper/u);
  for (const obsolete of ["com.google.common.cache.Striped64", "com.google.common.hash.Striped64", "com.google.common.util.concurrent.AbstractFuture$UnsafeAtomicHelper",
    "com.google.common.primitives.UnsignedBytes$LexicographicalComparatorHolder$UnsafeComparator$1"])
    assert.ok(readablePatch.includes(`-    '${obsolete}`), obsolete);
  assert.doesNotMatch(patchScript, /libs\.versions\.toml|verification-metadata|enabled\s*=\s*false/u);
  assert.match(patchScript, /^target=modules\/transport-grpc\/build\.gradle$/mu);
});

test("preparation resolves exactly two replacement SHA files and preserves unrelated licences", () => {
  assert.match(build, /patch-transport-grpc-guava\.sh "\$PWD" \/evidence > \/evidence\/transport-grpc-guava-preparation\.txt 2>&1 \\\n {2}\|\| preparation_status=\$\?/u);
  assert.match(build, /NOT_RUN_GUAVA_PATCH_FAILED/u);
  assert.ok(build.indexOf("NOT_RUN_GUAVA_PATCH_FAILED") < build.indexOf('printf \'%s\\n\' "$preparation_status" > /evidence/preparation.exit-code'));
  assert.match(build, /:modules:transport-grpc:updateShas/u);
  assert.match(build, /transport-grpc-license-files\.expected-after\.txt/u);
  assert.match(build, /transport-grpc-unrelated-licenses\.before\.sha256/u);
  assert.match(build, /cmp -s \/evidence\/transport-grpc-unrelated-licenses\.before\.sha256 \/evidence\/transport-grpc-unrelated-licenses\.after\.sha256/u);
  assert.match(build, /bb3b79346325315062192205fa6636dd5873151f/u);
  assert.match(build, /aeaffd00d57023a2c947393ed251f0354f0985fc/u);
  assert.match(build, /\[ -e "\$transport_grpc_licenses\/guava-33\.2\.1-jre\.jar\.sha1" \]/u);
  assert.match(build, /\[ -e "\$transport_grpc_licenses\/failureaccess-1\.0\.2\.jar\.sha1" \]/u);
});

test("transport-grpc checks and JUnit evidence remain separate from the established release gate", () => {
  for (const task of ["dependencyLicenses", "thirdPartyAudit", "check"])
    assert.match(build, new RegExp(`:modules:transport-grpc:${task}`));
  assert.match(build, /^for transport_group in test internalClusterTest; do$/mu);
  assert.match(build, /\/evidence\/junit-transport-grpc\/\$transport_group/u);
  assert.match(build, /\[ "\$transport_report_count" -eq 0 \] \|\| \[ "\$transport_test_count" -eq 0 \]/u);
  assert.match(build, /\[ "\$transport_skipped_count" -ne 0 \]/u);
  assert.match(build, /transport-grpc-skips\.txt/u);
  assert.match(build, /transport-grpc-skip-reasons\.txt/u);
  assert.match(build, /\[ "\$full_report_count" -ne 16 \] \|\| \[ "\$full_test_count" -lt 1736 \]/u);
  assert.match(build, /\[ "\$full_skipped_count" -gt 48 \] \|\| \[ "\$full_pass_count" -lt 1688 \]/u);
  assert.doesNotMatch(build, /find \/evidence\/junit-transport-grpc[^\n]*full_/u);
});

test("the transport-grpc JUnit gate rejects missing, failing and skipped groups", { skip: process.platform !== "linux" }, (t) => {
  const loopStart = build.indexOf("for transport_group in test internalClusterTest; do");
  const loopEnd = build.indexOf("find /evidence/junit -type f", loopStart);
  assert.ok(loopStart >= 0 && loopEnd > loopStart);
  const loop = build.slice(loopStart, loopEnd);

  const run = ({ missingInternal = false, failures = 0, skipped = 0 } = {}) => {
    const root = temporaryDirectory(t);
    const evidence = path.join(root, "evidence");
    mkdirSync(evidence);
    writeFileSync(path.join(evidence, "core-build-and-tests.log"), "transport grpc fixture\n");
    for (const group of missingInternal ? ["test"] : ["test", "internalClusterTest"]) {
      const result = path.join(root, `modules/transport-grpc/build/test-results/${group}`);
      mkdirSync(result, { recursive: true });
      writeFileSync(path.join(result, `TEST-${group}.xml`),
        `<testsuite tests="1" failures="${failures}" errors="0" skipped="${skipped}"><testcase name="fixture"/></testsuite>\n`);
    }
    const adapted = loop.replaceAll("/evidence", evidence.replaceAll("\\", "/"));
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", `build_status=0\n${adapted}\nprintf '%s\\n' "$build_status"`], {
      cwd: root, encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return Number(result.stdout.trim());
  };
  assert.equal(run(), 0);
  assert.equal(run({ missingInternal: true }), 1);
  assert.equal(run({ failures: 1 }), 1);
  assert.equal(run({ skipped: 1 }), 1);
});

test("the exploded distribution is bound to the exact Guava artifacts and old versions are rejected", () => {
  assert.match(build, /guava-33\.8\.0-jre\.jar/u);
  assert.match(build, /failureaccess-1\.0\.3\.jar/u);
  assert.match(build, /97b79ec3f2c0a6313a0c2df51ce1abdf8907e6531803467b81efcaaf99b35161/u);
  assert.match(build, /cbfc3906b19b8f55dd7cfd6dfe0aa4532e834250d7f080bd8d211a3e246b59cb/u);
  assert.match(build, /\[ ! -e "\$distribution_module\/guava-33\.2\.1-jre\.jar" \]/u);
  assert.match(build, /\[ ! -e "\$distribution_module\/failureaccess-1\.0\.2\.jar" \]/u);
  assert.match(build, /transport-grpc-distribution-jars\.status/u);
  assert.match(build, /if \[ "\$distribution_jar_status" -ne 0 \]; then build_status=1; fi/u);
});

test("the recipe retains patch materials and exports failure evidence before the runtime status gate", () => {
  assert.match(recipe, /patch-transport-grpc-guava\.sh/u);
  assert.match(recipe, /transport-grpc-guava\.patch/u);
  assert.ok(recipe.indexOf("COPY --from=builder /evidence/build.exit-code") > recipe.indexOf("RUN bash /recipe/build-core.sh"));
  assert.match(recipe, /test "\$\(cat \/tmp\/aw-core-build\.exit-code\)" = 0/u);
  assert.equal((recipe.match(/FROM scratch AS evidence/gu) ?? []).length, 1);
});
