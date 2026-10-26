import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../infra/managed-images/opensearch-core/", import.meta.url));
const recipe = readFileSync(new URL("../infra/managed-images/Dockerfile.opensearch-core", import.meta.url), "utf8");
const build = readFileSync(path.join(directory, "build-core.sh"), "utf8");
const inventoryScript = readFileSync(path.join(directory, "jdk-inventory.sh"), "utf8");
const outputCapture = readFileSync(path.join(directory, "test-output-capture.gradle"), "utf8");
const outputCaptureVerifier = readFileSync(path.join(directory, "verify-test-output-capture.sh"), "utf8");
const outputManifestVerifier = readFileSync(path.join(directory, "verify-test-output-manifest.gradle"), "utf8");
const outputCaptureFixture = readFileSync(path.join(directory, "fixtures/test-output-capture/fixture-tail.gradle"), "utf8");
const outputCaptureFixtureBuild = readFileSync(path.join(directory, "fixtures/test-output-capture/build.gradle"), "utf8");
const outputCaptureIncludedBuild = readFileSync(path.join(directory, "fixtures/test-output-capture/missing-doclet/build.gradle"), "utf8");
const scannerControls = readFileSync(new URL("../scripts/scanner/controls.mjs", import.meta.url));
const scannerAuditPolicy = readFileSync(new URL("../scripts/scanner/audit-policy.mjs", import.meta.url));
const officialAudit = readFileSync(new URL("../scripts/scanner/official-audit.mjs", import.meta.url));
const original = readFileSync(path.join(directory, "fixtures/libs.versions.toml"));
const snapshotTestOriginal = readFileSync(path.join(directory, "fixtures/SharedClusterSnapshotRestoreIT.java"));
const mockRepositoryOriginal = readFileSync(path.join(directory, "fixtures/MockRepository.java"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const linuxExecution = { skip: process.platform !== "linux" && "Linux CI execution required; this is a new Windows platform exclusion" };

function temporaryDirectory(t) {
  const result = mkdtempSync(path.join(os.tmpdir(), "aw-opensearch-material-"));
  t.after(() => rmSync(result, { recursive: true, force: true }));
  return result;
}

function runScript(name, args = []) {
  return spawnSync(bash, [path.join(directory, name).replaceAll("\\", "/"), ...args.map((arg) => arg.replaceAll("\\", "/"))], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
}

function runOutputDiagnosticFault(t, fault) {
  const root = temporaryDirectory(t);
  const sourceRoot = path.join(root, "source");
  const fixtureRoot = path.join(root, "fixture-work");
  const recipeRoot = path.join(root, "recipe");
  const evidenceRoot = path.join(root, "evidence");
  const fixtureSource = path.join(recipeRoot, "test-output-capture-fixture");
  mkdirSync(path.join(fixtureSource, "server"), { recursive: true });
  mkdirSync(path.join(fixtureSource, "missing-doclet"));
  mkdirSync(sourceRoot);
  mkdirSync(path.join(evidenceRoot, "test-output"), { recursive: true });
  writeFileSync(path.join(recipeRoot, "test-output-capture.gradle"), "init\n");
  writeFileSync(path.join(recipeRoot, "verify-test-output-manifest.gradle"), "verify\n");
  writeFileSync(path.join(fixtureSource, "fixture-tail.gradle"), "tail\n");
  writeFileSync(path.join(fixtureSource, "settings.gradle"), "settings\n");
  writeFileSync(path.join(fixtureSource, "build.gradle"), "build\n");
  writeFileSync(path.join(fixtureSource, "missing-doclet/settings.gradle"), "rootProject.name = 'missing-doclet'\n");
  writeFileSync(path.join(fixtureSource, "missing-doclet/build.gradle"), "plugins { id 'base' }\n");

  const mockGradle = `#!/bin/bash
set -euo pipefail
project=
previous=
for argument in "$@"; do
  if [ "$previous" = -p ]; then project=$argument; fi
  previous=$argument
done
test -d "$project/build"
test ! -L "$project/build"
test "$(stat -c '%u' "$project/build")" -eq "$(id -u)"
if [[ " $* " == *' autoWorldCompositeScopeFixture '* ]]; then
  test -f "$project/missing-doclet/settings.gradle"
  test -f "$project/missing-doclet/build.gradle"
  printf '%s\\n' AUTO_WORLD_COMPOSITE_SCOPE_INCLUDED_PASS AUTO_WORLD_COMPOSITE_SCOPE_ROOT_PASS
  exit 0
fi
if [[ " $* " == *' autoWorldVerifyTestOutputManifest '* ]]; then
  count=0
  if [ -f "$project/manifest-count" ]; then count=$(cat "$project/manifest-count"); fi
  count=$((count + 1))
  printf '%s\\n' "$count" > "$project/manifest-count"
  if [ "$count" -eq 1 ]; then exit 0; fi
  printf '%s\\n' AUTO_WORLD_TEST_OUTPUT_MANIFEST_INVALID
  exit 1
fi
if [[ " $* " != *' autoWorldCaptureFixture '* ]]; then
  printf '%s\\n' PARENT_READY > "$project/parent-ready.marker"
  exit 42
fi
mkdir -p "$project/build/direct-cases/success"
printf '%s\\n' AUTO_WORLD_TEST_OUTPUT_CAPTURE_FIXTURE_DIRECT_PASS > "$project/build/direct-summary.txt"
printf '%s\\n' '{"streams":[]}' > "$project/build/direct-cases/success/manifest.json"
: > "$project/build/direct-cases/success/descriptor-0-stdout.log"
printf '%s\\n' COMPLETE > "$project/build/direct-cases/success/complete.status"
printf '%s\\n' MOCK_DIRECT_LOG
`;
  const gradlew = path.join(sourceRoot, "gradlew");
  writeFileSync(gradlew, mockGradle);
  chmodSync(gradlew, 0o755);

  const injectedCopy = `cp() {
  if [ "$AUTO_WORLD_FAULT" = scratch ] && [ "$1" = -R ] && [[ "$2" == */manifest-golden/. ]]; then
    printf '%s\\n' partial > "$3/partial"
    return 23
  fi
  if [ "$AUTO_WORLD_FAULT" = summary ] && [[ "$1" == */direct-summary.txt ]]; then
    return 37
  fi
  command cp "$@"
}`;
  const slash = (value) => value.replaceAll("\\", "/");
  const adapted = outputCaptureVerifier
    .replace("exec >/dev/null 2>&1", `exec >/dev/null 2>&1\n${injectedCopy}`)
    .replaceAll("/workspace/test-output-capture-fixture", slash(fixtureRoot))
    .replaceAll("/workspace/source", slash(sourceRoot))
    .replaceAll("/recipe", slash(recipeRoot))
    .replaceAll("/evidence", slash(evidenceRoot));
  const subject = path.join(root, "verify-test-output-capture.sh");
  writeFileSync(subject, adapted);
  chmodSync(subject, 0o755);
  const result = spawnSync("/bin/bash", [subject], {
    encoding: "utf8", env: { ...process.env, AUTO_WORLD_FAULT: fault }, timeout: 15000,
  });
  return { evidenceRoot, fixtureRoot, result };
}

function catalogueSource(t, bytes = original) {
  const result = temporaryDirectory(t);
  mkdirSync(path.join(result, "gradle"));
  writeFileSync(path.join(result, "gradle/libs.versions.toml"), bytes);
  return result;
}

function snapshotSource(t, testBytes = snapshotTestOriginal, mockBytes = mockRepositoryOriginal) {
  const result = temporaryDirectory(t);
  const testPath = path.join(result, "server/src/internalClusterTest/java/org/opensearch/snapshots/SharedClusterSnapshotRestoreIT.java");
  const mockPath = path.join(result, "test/framework/src/main/java/org/opensearch/snapshots/mockstore/MockRepository.java");
  mkdirSync(path.dirname(testPath), { recursive: true });
  mkdirSync(path.dirname(mockPath), { recursive: true });
  writeFileSync(testPath, testBytes);
  writeFileSync(mockPath, mockBytes);
  return { result, testPath, mockPath };
}

function assertExplodedDistributionContract(script) {
  assert.match(script, /^ {4}:distribution:archives:buildNoJdkLinux \\$/mu);
  const guard = /if \[ ! -d \/workspace\/source\/distribution\/archives\/no-jdk-linux-tar\/build\/install\/opensearch-3\.9\.0 \]; then\n {2}printf[^\n]+\n {2}build_status=1\nfi/u;
  assert.match(script, guard);
  assert.ok(script.search(guard) < script.indexOf('"$build_status" > /evidence/build.exit-code'));
}

function assertXContentProjectContract(script) {
  for (const task of ["updateShas", "dependencyLicenses", "thirdPartyAudit", "test"])
    assert.ok(script.includes(`:libs:opensearch-x-content:${task}`), task);
  assert.doesNotMatch(script, /:libs:x-content:/u);
  assert.match(script, /^for group in libs\/x-content modules\/ingest-geoip; do$/mu);
  assert.match(script, /^ {2}libs\/x-content\/build\/test-results\/test \\$/mu);
  assert.doesNotMatch(script, /libs\/opensearch-x-content\//u);
}

function assertCaptureInstallationContract(script) {
  const phaseValidation = script.indexOf("AutoWorldTestOutputCapture.acceptsPhase(autoWorldCapturePhase)");
  const rootBuildGuard = script.indexOf("if (gradle.parent == null)");
  const mandatorySelection = script.indexOf("gradle.rootProject.tasks.getByPath(':server:internalClusterTest')");
  assert.ok(phaseValidation >= 0 && phaseValidation < rootBuildGuard && rootBuildGuard < mandatorySelection);
  assert.match(script, /if \(gradle\.parent == null\) \{[\s\S]*tasks\.getByPath\(':server:internalClusterTest'\)[\s\S]*if \(!\(selected instanceof Test\)\)/u);
  assert.doesNotMatch(script, /tasks\.findByPath\(':server:internalClusterTest'\)|GradleInternal|BuildState/u);
}

function assertCompositeScopeConfigurationContract(script) {
  const provider = script.indexOf("def scopeTestProvider = project(':server').tasks.named('internalClusterTest', Test)");
  const task = script.indexOf("tasks.register('autoWorldCompositeScopeFixture')");
  const actionStart = script.indexOf("    doLast {", task);
  const actionEnd = script.indexOf("\n    }\n}", actionStart);
  assert.ok(provider >= 0 && provider < task && task < actionStart && actionStart < actionEnd);
  const action = script.slice(actionStart, actionEnd);
  assert.match(action, /Test selected = scopeTestProvider\.get\(\)/u);
  assert.doesNotMatch(action, /\bproject\s*\(|\.project\b|getByName\(/u);
}

function assertFixtureRootDispatchContract(script) {
  const dispatch = script.indexOf("String fixtureMode = gradle.parent == null ? System.getProperty('auto.world.fixture.mode') : null");
  const direct = script.indexOf("if (fixtureMode == 'direct')", dispatch);
  const integration = script.indexOf("else if (fixtureMode == 'success' || fixtureMode == 'failure')", direct);
  const registration = script.indexOf("gradle.rootProject.tasks.register('autoWorldCaptureFixture')", direct);
  const mandatorySelection = script.indexOf("gradle.rootProject.tasks.getByPath(':server:internalClusterTest')", integration);
  assert.ok(dispatch >= 0 && dispatch < direct && direct < registration && direct < integration && integration < mandatorySelection);
  assert.equal(script.match(/System\.getProperty\('auto\.world\.fixture\.mode'\)/gu)?.length, 1);
}

function pluginAbsenceCommand(dockerfile) {
  const command = dockerfile.match(/shopt -s nullglob dotglob; \\\n {4}plugins=\(\/usr\/share\/opensearch\/plugins\/\*\); \\\n {4}test "\$\{#plugins\[@\]\}" -eq 0;/u)?.[0];
  assert.ok(command, "missing strict empty-plugin check including hidden entries");
  return command.replaceAll("/usr/share/opensearch/plugins", '"$1"').replaceAll(/\\\n\s*/gu, "");
}

test("the real preparation changes exactly four reviewed keys in the authenticated upstream catalogue", linuxExecution, (t) => {
  assert.equal(original.length, 14417);
  assert.equal(sha256(original), "fcd0e5b90015dbf8a14b3296d2eb84f049165f5a0c8b8918052ed063f2037187");
  const source = catalogueSource(t);
  const result = runScript("patch-catalogue.sh", [source]);
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  const patched = readFileSync(path.join(source, "gradle/libs.versions.toml"));
  assert.equal(sha256(patched), "7f24009701658e9f6f856c7199587e6d934fadd8803f0b70a0ef5c94705159bb");
  const before = original.toString("utf8").split("\n");
  const after = patched.toString("utf8").split("\n");
  const changes = before.flatMap((line, index) => line === after[index] ? [] : [[line, after[index]]]);
  assert.equal(changes.length, 4);
  assert.deepEqual(changes.map(([line]) => line.split(/\s/u)[0]), ["jackson", "jackson_databind", "jackson3", "jackson3_databind"]);
  assert.match(patched.toString("utf8"), /^jackson_annotations\s+= "2\.22"$/mu);
  const patch = readFileSync(path.join(directory, "jackson.patch"), "utf8");
  for (const [removed, added] of changes) {
    assert.ok(patch.includes(`-${removed}\n`));
    assert.ok(patch.includes(`+${added}\n`));
  }
});

test("foreign or already patched catalogue bytes are refused before another edit", linuxExecution, (t) => {
  const foreign = Buffer.from(original.toString("utf8").replace('lucene            = "10.5.1"', 'lucene            = "10.5.2"'));
  const source = catalogueSource(t, foreign);
  assert.notEqual(runScript("patch-catalogue.sh", [source]).status, 0);
  assert.deepEqual(readFileSync(path.join(source, "gradle/libs.versions.toml")), foreign);
  writeFileSync(path.join(source, "gradle/libs.versions.toml"), original);
  assert.equal(runScript("patch-catalogue.sh", [source]).status, 0);
  const patched = readFileSync(path.join(source, "gradle/libs.versions.toml"));
  assert.notEqual(runScript("patch-catalogue.sh", [source]).status, 0);
  assert.deepEqual(readFileSync(path.join(source, "gradle/libs.versions.toml")), patched);
});

test("snapshot fault-scope patch materials are exact, narrow, and staged before the selected suite", () => {
  assert.equal(snapshotTestOriginal.length, 113287);
  assert.equal(sha256(snapshotTestOriginal), "e6822f420d0ccb174911dc6631af5ab74ab193c52f88d702082038ee0ec638bd");
  assert.equal(mockRepositoryOriginal.length, 30784);
  assert.equal(sha256(mockRepositoryOriginal), "0d768d21a752111f940cccf096552c81b14ff38f3556e8f68b3156b16aa18029");

  const testPatch = readFileSync(path.join(directory, "snapshot-scope-test.patch"), "utf8");
  const mockPatch = readFileSync(path.join(directory, "snapshot-scope-mock-repository.patch"), "utf8");
  const testHelper = readFileSync(path.join(directory, "patch-snapshot-scope-test.sh"), "utf8");
  const mockHelper = readFileSync(path.join(directory, "patch-snapshot-mock-repository.sh"), "utf8");
  assert.match(testPatch, /skip_exception_on_snapshot_shard_paths_list_blobs/u);
  assert.match(testPatch, /skip_exception_on_snapshot_shard_paths_write/u);
  assert.match(testPatch, /testSnapshotShardPathsListBlobsFaultScope/u);
  assert.match(testPatch, /testSnapshotShardPathsAuxiliaryWriteFaultScope/u);
  assert.match(testPatch, /disableRepoConsistencyCheck\("This test exercises raw mock blob containers without snapshot metadata"\)/u);
  assert.match(testPatch, /random_control_io_exception_rate", 0\.2/u);
  assert.match(testPatch, /if \(skipSnapshotShardPathsListBlobs\)[\s\S]*\.put\("skip_exception_on_snapshot_shard_paths_list_blobs", true\)/u);
  assert.doesNotMatch(testPatch, /\.put\("skip_exception_on_snapshot_shard_paths_list_blobs", skipSnapshotShardPathsListBlobs\)/u);
  const listControlPatch = testPatch.slice(
    testPatch.indexOf("testSnapshotShardPathsListBlobsFaultScope"),
    testPatch.indexOf("testSnapshotShardPathsAuxiliaryWriteFaultScope"),
  );
  assert.doesNotMatch(listControlPatch, /skip_exception_on_snapshot_shard_paths_write/u);
  const writeControlPatch = testPatch.slice(testPatch.indexOf("testSnapshotShardPathsAuxiliaryWriteFaultScope"));
  assert.match(writeControlPatch, /List\.of\("default", "false", "true"\)/u);
  assert.match(writeControlPatch, /if \("false"\.equals\(writeSettingMode\)\) \{[\s\S]*\.put\("skip_exception_on_snapshot_shard_paths_write", false\);[\s\S]*else if \("true"\.equals\(writeSettingMode\)\) \{[\s\S]*\.put\("skip_exception_on_snapshot_shard_paths_write", true\);/u);
  assert.equal(writeControlPatch.match(/repositorySettings\.put\("skip_exception_on_snapshot_shard_paths_write"/gu)?.length, 2);
  assert.match(testPatch, /writeBlob\("snapshot_path_",[\s\S]*containsString\("Random IOException"\)/u);
  assert.match(snapshotTestOriginal.toString("utf8"), /getFailureCount\("test-repo"\), equalTo\(0L\)/u);
  assert.doesNotMatch(testPatch, /^-\s+assertThat\(getFailureCount\("test-repo"/mu);
  assert.match(mockPatch, /path\(\)\.equals\(basePath\(\)\.add\(SnapshotShardPaths\.DIR\)\)/u);
  assert.match(mockPatch, /blobName\.startsWith\("snapshot_path_"\)[\s\S]*blobName\.length\(\) > "snapshot_path_"\.length\(\)/u);
  assert.match(mockPatch, /final boolean failAfterWrite = RandomizedContext\.current\(\)\.getRandom\(\)\.nextBoolean\(\);\n\+[ ]{16}if \(failAfterWrite && skipSnapshotShardPathsWriteException == false\)/u);
  assert.doesNotMatch(mockPatch, /skipSnapshotShardPathsWriteException == false && RandomizedContext/u);
  assert.match(mockRepositoryOriginal.toString("utf8"), /return super\.listBlobs\(\)/u);
  assert.doesNotMatch(mockPatch, /listBlobsByPrefix[\s\S]*skip_exception_on_snapshot_shard_paths/u);
  assert.deepEqual(
    testPatch.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")),
    ['-            .put("random_control_io_exception_rate", 0.2);'],
  );
  assert.deepEqual(
    mockPatch.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")),
    [
      "-                maybeIOExceptionOrBlock(DUMMY_FILE_NAME_LIST_BLOBS);",
      "-                maybeIOExceptionOrBlock(blobName);",
      "-                if (RandomizedContext.current().getRandom().nextBoolean()) {",
    ],
  );
  assert.match(testHelper, /e6822f420d0ccb174911dc6631af5ab74ab193c52f88d702082038ee0ec638bd/u);
  assert.match(testHelper, /6473c23b45acb0628964b3f9b389621db94ce15fff213c54c5a3f32b6c51dc27/u);
  assert.match(mockHelper, /0d768d21a752111f940cccf096552c81b14ff38f3556e8f68b3156b16aa18029/u);
  assert.match(mockHelper, /0ca89767bccae4080fb62302ba927f0a076e9a50c5ebf49e5984efe26396938b/u);
  assert.doesNotMatch(testHelper, /^patch /mu);
  assert.doesNotMatch(mockHelper, /^patch /mu);

  const testPreparation = build.indexOf('bash /recipe/patch-snapshot-scope-test.sh "$PWD"');
  const negativeControl = build.indexOf("/evidence/controls/unfixed/gradle.exit-code");
  const mockPreparation = build.indexOf('bash /recipe/patch-snapshot-mock-repository.sh "$PWD"');
  const positiveControl = build.indexOf("/evidence/controls/seeded-fixed/gradle.exit-code");
  const selectedSuite = build.indexOf(":libs:opensearch-x-content:dependencyLicenses");
  assert.ok(testPreparation >= 0 && testPreparation < negativeControl);
  assert.ok(negativeControl < mockPreparation && mockPreparation < positiveControl);
  assert.ok(positiveControl < selectedSuite);
  const fixedControlCopy = build.indexOf('cp "$control_xml" /evidence/controls/seeded-fixed/');
  const controlCleanup = build.indexOf("rm -rf server/build/test-results/internalClusterTest");
  const fullSuiteRun = build.indexOf("-Dauto.world.test.output.phase=full --continue");
  assert.ok(fixedControlCopy < controlCleanup && controlCleanup < fullSuiteRun);
  assert.match(build, /730D258067002B91/u);
  assert.match(build, /-Dtests\.locale=fr-LU/u);
  assert.match(build, /-Dtests\.timezone=America\/Moncton/u);
  assert.match(build, /testSnapshotFileFailureDuringSnapshot/u);
  assert.match(build, /testSnapshotShardPathsAuxiliaryWriteFaultScope/u);
  assert.match(build, /SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNFIXED/u);
  assert.match(build, /failure-count-delta=1/u);
  assert.match(build, /grep -Fo '<failure '/u);
  assert.match(build, /! grep -Fq 'index\.latest'/u);
  assert.match(build, /full_report_count.*-ne 16/u);
  assert.match(build, /full_test_count.*-lt 1736/u);
  assert.match(build, /full_pass_count.*-lt 1688/u);
  assert.match(build, /full_skipped_count.*-gt 48/u);
  assert.doesNotMatch(build, /"\$full_skipped_count" -(?:eq|lt)/u);
  assert.match(build, /full-suite-skips\.txt/u);
  assert.match(build, /grep -H -B 1 -A 1 '<skipped'/u);
  assert.match(build, /full-suite-skip-reasons\.txt/u);
  assert.match(build, /AssumptionViolatedException\|got: <\.\*>, expected:/u);
  assert.match(build, /patch-snapshot-scope-test\.sh\.txt/u);
  assert.match(build, /patch-snapshot-mock-repository\.sh\.txt/u);
  assert.doesNotMatch(build, /\/evidence\/patch-snapshot-(?:scope-test|mock-repository)\.sh(?:\s|$)/u);
  assert.match(build, /expected-failure-verified\.status/u);
  assert.match(build, /success-verified\.status/u);
  assert.match(build, /testSnapshotShardPathsListBlobsFaultScope.*SharedClusterSnapshotRestoreIT/u);
  assert.match(build, /mkdir -p \/evidence\/junit \/evidence\/licenses \/evidence\/controls\/unfixed \/evidence\/controls\/seeded-fixed/u);
  assert.match(recipe, /patch-snapshot-scope-test\.sh[\s\S]*snapshot-scope-test\.patch/u);
  assert.match(recipe, /patch-snapshot-mock-repository\.sh[\s\S]*snapshot-scope-mock-repository\.patch/u);
  assert.doesNotMatch(recipe, /fixtures\/SharedClusterSnapshotRestoreIT|fixtures\/MockRepository/u);
  assert.match(recipe, /test-output-capture\.gradle[\s\S]*verify-test-output-capture\.sh[\s\S]*verify-test-output-manifest\.gradle/u);
  assert.match(recipe, /fixtures\/test-output-capture\//u);

});

test("bounded native output capture is fixed to the three internal-cluster phases and preserves frozen guards", (t) => {
  assert.match(outputCapture, /PHASES = Set\.of\('unfixed', 'seeded-fixed', 'full'\)/u);
  assert.match(outputCapture, /taskPath != ':server:internalClusterTest'/u);
  assert.match(outputCapture, /Paths\.get\('\/evidence\/test-output'\)\.resolve\(autoWorldCapturePhase\)/u);
  assert.match(outputCapture, /IdentityHashMap<TestDescriptor, DescriptorRecord>/u);
  assert.match(outputCapture, /MAX_DESCRIPTOR_COUNT = 4094/u);
  assert.match(outputCapture, /MAX_STREAM_COUNT = 4093/u);
  assert.match(outputCapture, /MAX_PARENT_DEPTH = 64/u);
  assert.match(outputCapture, /MAX_FIELD_BYTES = 16 \* 1024/u);
  assert.match(outputCapture, /MAX_METADATA_BYTES = 1024 \* 1024/u);
  assert.match(outputCapture, /MAX_EVENTS = 1_000_000L/u);
  assert.match(outputCapture, /MAX_STREAM_BYTES = 4L \* MIB/u);
  assert.match(outputCapture, /MAX_TOTAL_BYTES = 64L \* MIB/u);
  assert.match(outputCapture, /includeSystemOutLog\.set\(false\)/u);
  assert.match(outputCapture, /includeSystemErrLog\.set\(false\)/u);
  assert.match(outputCapture, /implements TaskExecutionListener/u);
  assert.match(outputCapture, /void afterExecute\(Task task, TaskState state\)/u);
  assert.match(outputCapture, /descriptorRecord\.finished/u);
  assert.match(outputCapture, /Files\.createLink\(complete, temporary\)/u);
  assert.doesNotMatch(outputCapture, /StandardCopyOption\.ATOMIC_MOVE/u);
  assert.match(outputCapture, /EXPECTED_UID = 1000/u);
  assert.match(outputCapture, /attributes\.fileKey\(\) == null/u);
  assert.match(outputCapture, /validateDirectoryChain[\s\S]*revalidateOwnedDirectory/u);
  assert.match(outputCapture, /validateDirectoryChain\(parent, null\)[\s\S]*Files\.createDirectory\(outputDirectory\)/u);
  assert.doesNotMatch(outputCapture, /Files\.createDirectories\(outputDirectory\)/u);
  assert.match(outputCapture, /BoundedJsonWriter/u);
  assert.match(outputCapture, /descriptorJsonLength/u);
  assert.match(outputCapture, /validatedRegularFileKey/u);
  assert.match(outputCapture, /Files\.isSameFile\(temporary, complete\)/u);
  assert.doesNotMatch(outputCapture, /groovy\.json\.JsonOutput|\.collect \{ descriptor/u);
  assert.match(outputCapture, /AUTO_WORLD_TEST_OUTPUT_INTEGRITY_ERROR/u);
  assert.doesNotMatch(outputCapture, /getSource\(|outputPerTestCase|Base64|GZIP|chunk/u);
  assertCaptureInstallationContract(outputCapture);
  assert.throws(() => assertCaptureInstallationContract(
    outputCapture.replace("tasks.getByPath(':server:internalClusterTest')", "tasks.findByPath(':server:internalClusterTest')"),
  ));
  assert.throws(() => assertCaptureInstallationContract(
    outputCapture.replace("if (!(selected instanceof Test))", "if (selected == null)"),
  ));

  for (const phase of ["unfixed", "seeded-fixed", "full"])
    assert.match(build, new RegExp(`-Dauto\\.world\\.test\\.output\\.phase=${phase}`, "u"));
  assert.equal(build.match(/-I \/recipe\/test-output-capture\.gradle/gu)?.length, 1);
  assert.match(build, /capture_complete unfixed \/evidence\/controls\/unfixed\/gradle\.log/u);
  assert.match(build, /capture_complete seeded-fixed \/evidence\/controls\/seeded-fixed\/gradle\.log/u);
  assert.match(build, /capture_complete full \/evidence\/core-build-and-tests\.log/u);
  assert.match(build, /test-output-capture\.gradle\.txt/u);
  assert.match(build, /verify-test-output-capture\.sh\.txt/u);
  assert.match(build, /verify-test-output-manifest\.gradle\.txt/u);
  assert.match(build, /AUTO_WORLD_TEST_OUTPUT_INTEGRITY_ERROR/u);
  const preparation = build.slice(build.indexOf("bash ./gradlew"), build.indexOf("fixture_status=1"));
  assert.doesNotMatch(preparation, /test-output-capture|auto\.world\.test\.output/u);

  assert.match(outputCaptureVerifier, /auto\.world\.fixture\.mode=direct/u);
  assert.match(outputCaptureVerifier, /auto\.world\.fixture\.mode=success/u);
  assert.match(outputCaptureVerifier, /auto\.world\.fixture\.mode=failure/u);
  assert.match(outputCaptureVerifier, /-Dauto\.world\.test\.output\.phase=full autoWorldCompositeScopeFixture/u);
  assert.match(outputCaptureVerifier, /publish_process "\$public_root\/scope"[\s\S]*run_check scope-exit/u);
  assert.match(outputCaptureVerifier, /scope-included-marker[\s\S]*AUTO_WORLD_COMPOSITE_SCOPE_INCLUDED_PASS/u);
  assert.match(outputCaptureVerifier, /scope-root-marker[\s\S]*AUTO_WORLD_COMPOSITE_SCOPE_ROOT_PASS/u);
  assert.match(outputCaptureVerifier, /run_check scope-capture-absent path_absent \/evidence\/test-output\/full/u);
  assert.ok(outputCaptureVerifier.indexOf("autoWorldCompositeScopeFixture") < outputCaptureVerifier.indexOf("autoWorldCaptureFixture"));
  assert.match(outputCaptureVerifier, /cp -R "\$fixture_source\/missing-doclet" "\$destination\/"/u);
  assert.match(outputCaptureVerifier, /path_absent "\$destination"[\s\S]*path_absent "\$destination\/build"[\s\S]*mkdir "\$destination\/build"[\s\S]*owned_directory "\$destination\/build"/u);
  assert.match(outputCaptureVerifier, /AUTO_WORLD_FIXTURE_EXPECTED_TASK_FAILURE/u);
  assert.match(outputCaptureVerifier, /test "\$failure_status" -ne 0/u);
  assert.match(outputCaptureVerifier, /sentinel_absent "\$fixture_root\/failure\/gradle\.log" "\$sentinel"/u);
  assert.match(outputCaptureVerifier, /\[ "\$grep_status" -eq 1 \]/u);
  assert.match(outputCaptureVerifier, /trap cleanup_fixture EXIT/u);
  assert.match(outputCaptureVerifier, /local original_status=\$\?/u);
  assert.match(outputCaptureVerifier, /"\$diagnostic_status" = running[\s\S]*record_diagnostic "\$diagnostic_subcase" failed/u);
  assert.match(outputCaptureVerifier, /exit "\$original_status"/u);
  assert.match(outputCaptureVerifier, /owned_directory "\$manifest_capture" \|\| return 1[\s\S]*rm -rf "\$manifest_capture"/u);
  assert.match(outputCaptureVerifier, /case "\$subcase" in[\s\S]*success-exit[\s\S]*failure-sentinel/u);
  assert.match(outputCaptureVerifier, /case "\$status" in\s*initialized\|running\|passed\|failed/u);
  assert.match(outputCaptureVerifier, /exec >\/dev\/null 2>&1/u);
  assert.match(outputCaptureVerifier, /printf '%s\\n' NOT_RUN > "\$process_directory\/gradle\.exit-code"/u);
  assert.match(outputCaptureVerifier, /owned_directory "\$\(dirname "\$manifest_capture"\)"[\s\S]*path_absent "\$manifest_capture"/u);
  assert.match(outputCaptureVerifier, /mkdir "\$manifest_capture"[\s\S]*owned_directory "\$manifest_capture"[\s\S]*manifest_capture_owned=1[\s\S]*cp -R "\$manifest_golden\/\." "\$manifest_capture\/"/u);
  assert.match(outputCaptureVerifier, /publish_process "\$public_root\/success"[\s\S]*run_check success-exit/u);
  assert.match(outputCaptureVerifier, /publish_process "\$public_root\/failure"[\s\S]*run_check failure-exit/u);
  assert.match(outputCaptureVerifier, /publish_process "\$public_root\/manifest\/\$name"[\s\S]*if \[ "\$expected" = pass \]/u);
  assert.match(outputCaptureVerifier, /run_check direct-sentinel[\s\S]*cp "\$fixture_root\/direct\/build\/direct-summary\.txt"/u);
  assert.match(outputCaptureVerifier, /run_check success-sentinel[\s\S]*cp -R "\$fixture_root\/success\/build\/integration-success"/u);
  assert.match(outputCaptureVerifier, /run_check failure-sentinel[\s\S]*cp -R "\$fixture_root\/failure\/build\/integration-failure"/u);
  assert.doesNotMatch(outputCaptureVerifier, /cp -R "\$manifest_capture" "\$public_root/u);

  if (process.platform === "linux") {
    for (const [fault, expectedStatus, expectedExit, expectedParentMarker] of [
      ["scratch", "subcase=manifest-valid\nstatus=failed\n", 23, false],
      ["summary", "subcase=direct-summary\nstatus=failed\n", 37, false],
      ["success-parent", "subcase=success-exit\nstatus=failed\n", 1, true],
    ]) {
      const { evidenceRoot, fixtureRoot, result } = runOutputDiagnosticFault(t, fault);
      assert.equal(result.status, expectedExit, `${fault}: ${result.stdout}\n${result.stderr}`);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      const publicRoot = path.join(evidenceRoot, "test-output-fixture");
      assert.equal(readFileSync(path.join(publicRoot, "last-subcase.status"), "utf8"), expectedStatus);
      assert.equal(existsSync(path.join(evidenceRoot, "test-output/full")), false);
      assert.equal(existsSync(path.join(publicRoot, "success/capture")), false);
      assert.equal(existsSync(path.join(publicRoot, "failure/capture")), false);
      assert.equal(existsSync(path.join(fixtureRoot, "success/parent-ready.marker")), expectedParentMarker);
    }
  }
  assert.match(outputCaptureFixture, /two objects|findAll \{ it\.name == 'same' \}\.size\(\) == 2/u);
  assert.match(outputCaptureFixture, /late-before-task/u);
  assert.match(outputCaptureFixture, /late-after-task/u);
  assert.match(outputCaptureFixture, /marker-failure/u);
  assert.match(outputCaptureFixture, /descriptor-limit/u);
  assert.match(outputCaptureFixture, /event-limit/u);
  assert.match(outputCaptureFixture, /metadata-limit/u);
  assert.match(outputCaptureFixture, /\\u0001/u);
  assert.match(outputCaptureFixture, /ancestor-alias/u);
  assert.match(outputCaptureFixture, /missing-parent[\s\S]*expectIntegrityFailure \{ missingParentCapture\.start\(\) \}[\s\S]*!Files\.exists\(missingParent, LinkOption\.NOFOLLOW_LINKS\)/u);
  assert.match(outputCaptureFixture, /replaced-original/u);
  assert.match(outputCaptureFixture, /stream-replaced/u);
  assert.match(outputCaptureFixture, /depth-limit/u);
  assertFixtureRootDispatchContract(outputCaptureFixture);
  assert.throws(() => assertFixtureRootDispatchContract(
    outputCaptureFixture.replace(
      "String fixtureMode = gradle.parent == null ? System.getProperty('auto.world.fixture.mode') : null",
      "String fixtureMode = System.getProperty('auto.world.fixture.mode')",
    ),
  ));
  assert.match(outputCaptureFixtureBuild, /dependsOn gradle\.includedBuild\('missing-doclet'\)\.task\(':autoWorldIncludedScopeProbe'\)/u);
  assert.match(outputCaptureFixtureBuild, /includeSystemOutLog\.get\(\) == false/u);
  assert.match(outputCaptureFixtureBuild, /includeSystemErrLog\.get\(\) == false/u);
  assert.match(outputCaptureFixtureBuild, /!selected\.state\.executed/u);
  assertCompositeScopeConfigurationContract(outputCaptureFixtureBuild);
  assert.throws(() => assertCompositeScopeConfigurationContract(
    outputCaptureFixtureBuild.replace(
      "Test selected = scopeTestProvider.get()",
      "Test selected = (Test) project(':server').tasks.getByName('internalClusterTest')",
    ),
  ));
  assert.match(outputCaptureIncludedBuild, /gradle\.parent != null/u);
  assert.match(outputCaptureIncludedBuild, /auto\.world\.test\.output\.phase.*full/u);
  assert.match(outputCaptureIncludedBuild, /tasks\.findByPath\(':server:internalClusterTest'\) == null/u);
  assert.match(outputCaptureIncludedBuild, /AUTO_WORLD_COMPOSITE_SCOPE_INCLUDED_PASS/u);

  assert.match(outputManifestVerifier, /JsonSlurper/u);
  assert.match(outputManifestVerifier, /ROOT = Paths\.get\('\/evidence\/test-output'\)/u);
  assert.match(outputManifestVerifier, /:server:internalClusterTest/u);
  assert.match(outputManifestVerifier, /AUTO_WORLD_TEST_OUTPUT_MANIFEST_INVALID/u);
  assert.match(outputManifestVerifier, /validateRegularFile/u);
  assert.match(outputManifestVerifier, /descriptorMetadataBytes/u);
  assert.match(outputManifestVerifier, /sha256\(streamPath, bytes\)/u);
  assert.doesNotMatch(outputManifestVerifier, /System\.getProperty\('.*(?:root|path|task)/u);
  assert.match(outputCaptureVerifier, /manifest-validator=passed negatives=malformed,hash,bytes,totals,aggregate-events,aggregate-bytes,path,missing,extra,file-count,symlink/u);
  for (const scenario of ["malformed", "hash", "bytes", "totals", "aggregate-events", "aggregate-bytes", "path", "missing", "extra", "file-count", "symlink"])
    assert.match(outputCaptureVerifier, new RegExp(`run_manifest_verifier ${scenario} fail`, "u"));
  assert.match(build, /-I \/recipe\/verify-test-output-manifest\.gradle/u);
  assert.match(build, /autoWorldVerifyTestOutputManifest/u);
  assert.match(build, /owned_regular_file/u);
  assert.match(build, /\[ "\$grep_status" -eq 1 \]/u);
  assert.doesNotMatch(build, /! grep -Fq 'AUTO_WORLD_TEST_OUTPUT/u);

  assert.equal(sha256(scannerControls), "ca28b19d57e21b3b778da2ff95fa31bf273f814616ce0b190533d1eeaaa82499");
  assert.equal(sha256(scannerAuditPolicy), "8ee56aeee8d31f3620987186e1876731ce21d3f4763980a0bdc758511248584f");
  assert.equal(sha256(officialAudit), "2fdab4010b4fef843dd60475dc8fb76c51bf7a578109da4f5dccb6d5443159ca");
  assert.match(officialAudit.toString("utf8"), /info\.size > 4 \* MiB/u);
  assert.match(officialAudit.toString("utf8"), /total > 64 \* MiB/u);
  assert.match(officialAudit.toString("utf8"), /files\.length >= 4096/u);
});

test("authenticated snapshot source patches preserve foreign and already-patched inputs", linuxExecution, (t) => {
  const source = snapshotSource(t);
  const testResult = runScript("patch-snapshot-scope-test.sh", [source.result]);
  assert.equal(testResult.status, 0, `${testResult.stdout}\n${testResult.stderr}`);
  const patchedTest = readFileSync(source.testPath);
  assert.notDeepEqual(patchedTest, snapshotTestOriginal);
  assert.deepEqual(readFileSync(source.mockPath), mockRepositoryOriginal);
  assert.notEqual(runScript("patch-snapshot-scope-test.sh", [source.result]).status, 0);
  assert.deepEqual(readFileSync(source.testPath), patchedTest);

  const mockResult = runScript("patch-snapshot-mock-repository.sh", [source.result]);
  assert.equal(mockResult.status, 0, `${mockResult.stdout}\n${mockResult.stderr}`);
  const patchedMock = readFileSync(source.mockPath);
  assert.notDeepEqual(patchedMock, mockRepositoryOriginal);
  assert.deepEqual(readFileSync(source.testPath), patchedTest);
  assert.equal(sha256(patchedTest), "6473c23b45acb0628964b3f9b389621db94ce15fff213c54c5a3f32b6c51dc27");
  assert.equal(sha256(patchedMock), "0ca89767bccae4080fb62302ba927f0a076e9a50c5ebf49e5984efe26396938b");
  const patchedMockSource = patchedMock.toString("utf8");
  const writeMethodStart = patchedMockSource.indexOf("            public void writeBlob(String blobName, InputStream inputStream");
  const writeMethodEnd = patchedMockSource.indexOf("\n            @Override", writeMethodStart + 1);
  assert.ok(writeMethodStart >= 0 && writeMethodEnd > writeMethodStart);
  const writeMethod = patchedMockSource.slice(writeMethodStart, writeMethodEnd);
  assert.equal(writeMethod.match(/nextBoolean\(\)/gu)?.length, 1);
  assert.ok(writeMethod.indexOf("super.writeBlob(") < writeMethod.indexOf("nextBoolean()"));
  assert.ok(writeMethod.indexOf("nextBoolean()") < writeMethod.indexOf("if (failAfterWrite && skipSnapshotShardPathsWriteException == false)"));
  assert.match(writeMethod, /path\(\)\.equals\(basePath\(\)\.add\(SnapshotShardPaths\.DIR\)\)/u);
  assert.match(writeMethod, /blobName\.startsWith\("snapshot_path_"\)[\s\S]*blobName\.length\(\) > "snapshot_path_"\.length\(\)/u);
  assert.equal((writeMethod.match(/maybeIOExceptionOrBlock\(blobName\);/gu) ?? []).length, 2);
  assert.notEqual(runScript("patch-snapshot-mock-repository.sh", [source.result]).status, 0);
  assert.deepEqual(readFileSync(source.mockPath), patchedMock);

  const foreign = snapshotSource(t, Buffer.from(snapshotTestOriginal.toString("utf8").replace("public void testEmptySnapshot", "public void testForeignSnapshot")));
  const foreignBytes = readFileSync(foreign.testPath);
  assert.notEqual(runScript("patch-snapshot-scope-test.sh", [foreign.result]).status, 0);
  assert.deepEqual(readFileSync(foreign.testPath), foreignBytes);

  const foreignMock = snapshotSource(t, snapshotTestOriginal, Buffer.from(mockRepositoryOriginal.toString("utf8").replace("private final AtomicLong", "private final  AtomicLong")));
  const foreignMockBytes = readFileSync(foreignMock.mockPath);
  assert.notEqual(runScript("patch-snapshot-mock-repository.sh", [foreignMock.result]).status, 0);
  assert.deepEqual(readFileSync(foreignMock.mockPath), foreignMockBytes);

  const redGateStart = build.indexOf("  unfixed_control_ok=0");
  const redGateEnd = build.indexOf("  printf '%s\\n' \"$unfixed_control_ok\"", redGateStart);
  const captureCompleteStart = build.indexOf("owned_regular_file() {");
  const captureCompleteEnd = build.indexOf("\n}\n\n# Captured", captureCompleteStart) + 2;
  assert.ok(redGateStart >= 0 && redGateEnd > redGateStart);
  assert.ok(captureCompleteStart >= 0 && captureCompleteEnd > captureCompleteStart);
  const redGate = build.slice(redGateStart, redGateEnd);
  const captureComplete = build.slice(captureCompleteStart, captureCompleteEnd);
  const expectedFailureHeader = '<failure message="java.lang.AssertionError: SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNFIXED failure-count-delta=1" type="java.lang.AssertionError">';
  const runRedGate = (failureElements, {
    captureState = "valid",
    validatorExit = 0,
    expectValidator,
    invocationLogState = "regular",
    validationLogState = "regular",
  } = {}) => {
    assert.equal(typeof expectValidator, "boolean");
    const evidence = temporaryDirectory(t);
    const control = path.join(evidence, "controls/unfixed");
    mkdirSync(control, { recursive: true });
    writeFileSync(
      path.join(control, "TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml"),
      `<testsuite tests="1" failures="1" errors="0" skipped="0"><testcase name="testSnapshotShardPathsListBlobsFaultScope">${failureElements}</testcase></testsuite>\n`,
    );
    if (invocationLogState !== "missing")
      writeFileSync(
        path.join(control, "gradle.log"),
        captureState === "sentinel"
          ? "executed internal cluster test\nAUTO_WORLD_TEST_OUTPUT_INTEGRITY_ERROR\n"
          : "executed internal cluster test\n",
      );
    if (captureState !== "absent") {
      const capture = path.join(evidence, "test-output/unfixed");
      mkdirSync(capture, { recursive: true });
      writeFileSync(
        path.join(capture, "manifest.json"),
        '{"phase":"unfixed","task":":server:internalClusterTest","totals":{"captureErrors":0,"openWriters":0}}\n',
      );
      writeFileSync(path.join(capture, "complete.status"), "COMPLETE\n");
      if (captureState === "poison")
        writeFileSync(path.join(capture, "capture-invalid.status"), "INVALID\n");
    }
    const evidencePath = evidence.replaceAll("\\", "/");
    const fakeWrapper = path.join(evidence, "gradlew");
    const wrapperArgs = path.join(evidence, "wrapper.args");
    const validationLog = path.join(evidence, "test-output-validation/unfixed/gradle.log").replaceAll("\\", "/");
    const validationLogMutation = validationLogState === "missing"
      ? `rm -f '${validationLog}'\n`
      : validationLogState === "directory"
        ? `rm -f '${validationLog}'\nmkdir '${validationLog}'\n`
        : "";
    writeFileSync(fakeWrapper, `#!/bin/bash\nprintf '%s\\n' "$@" > '${wrapperArgs.replaceAll("\\", "/")}'\n${validationLogMutation}exit ${validatorExit}\n`);
    chmodSync(fakeWrapper, 0o755);
    const instrumentedCaptureComplete = captureComplete
      .replaceAll("/evidence", evidencePath)
      .replace("/workspace/source/gradlew", fakeWrapper.replaceAll("\\", "/"));
    const command = `${instrumentedCaptureComplete}\nunfixed_status=1\n${redGate.replaceAll("/evidence", evidencePath)}\nprintf '%s\\n' "$unfixed_control_ok"`;
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", command], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    if (expectValidator) {
      assert.match(readFileSync(wrapperArgs, "utf8"), /-I\n\/recipe\/verify-test-output-manifest\.gradle\n/u);
      assert.match(readFileSync(wrapperArgs, "utf8"), /-Dauto\.world\.verify\.test\.output\.phase=unfixed/u);
      assert.match(readFileSync(wrapperArgs, "utf8"), /autoWorldVerifyTestOutputManifest/u);
    } else {
      assert.equal(existsSync(wrapperArgs), false);
    }
    return Number(result.stdout.trim());
  };
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`, { expectValidator: true }), 1);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`,
    { captureState: "absent", validatorExit: 1, expectValidator: true }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`,
    { captureState: "poison", validatorExit: 1, expectValidator: true }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`,
    { captureState: "sentinel", expectValidator: false }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`,
    { invocationLogState: "missing", expectValidator: false }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`,
    { validatorExit: 1, expectValidator: true }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`,
    { validationLogState: "missing", expectValidator: true }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>`,
    { validationLogState: "directory", expectValidator: true }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}Random IOException</failure>${expectedFailureHeader}Random IOException</failure>`,
    { expectValidator: false }), 0);
  assert.equal(runRedGate(`${expectedFailureHeader}SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNEXPECTED_CAUSE Random IOException</failure>`,
    { expectValidator: false }), 0);
  assert.equal(
    runRedGate('<failure message="java.lang.AssertionError: index.latest SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNFIXED failure-count-delta=1" type="java.lang.AssertionError">Random IOException</failure>',
      { expectValidator: false }),
    0,
  );

  const fixedGateStart = build.indexOf("    fixed_control_ok=0");
  const fixedGateEnd = build.indexOf("    printf '%s\\n' \"$fixed_control_ok\"", fixedGateStart);
  assert.ok(fixedGateStart >= 0 && fixedGateEnd > fixedGateStart);
  const fixedGate = build.slice(fixedGateStart, fixedGateEnd);
  const successfulCase = (name) => `<testcase name="${name}" classname="org.opensearch.snapshots.SharedClusterSnapshotRestoreIT" time="0.1"/>`;
  const fixedNames = [
    "testSnapshotShardPathsListBlobsFaultScope",
    "testSnapshotShardPathsAuxiliaryWriteFaultScope",
    "testSnapshotFileFailureDuringSnapshot",
  ];
  const runFixedGate = ({
    tests = 3,
    failures = 0,
    errors = 0,
    skipped = 0,
    cases = fixedNames.map(successfulCase),
    fixedStatus = 0,
  } = {}) => {
    const evidence = temporaryDirectory(t);
    const control = path.join(evidence, "controls/seeded-fixed");
    mkdirSync(control, { recursive: true });
    writeFileSync(
      path.join(control, "TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml"),
      `<testsuite tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}">${cases.join("")}</testsuite>\n`,
    );
    writeFileSync(path.join(control, "gradle.log"), "executed internal cluster test\n");
    const evidencePath = evidence.replaceAll("\\", "/");
    const command = `capture_complete() { return 0; }\nfixed_status=${fixedStatus}\n${fixedGate.replaceAll("/evidence", evidencePath)}\nprintf '%s\\n' "$fixed_control_ok"`;
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", command], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return Number(result.stdout.trim());
  };
  assert.equal(runFixedGate(), 1);
  assert.equal(runFixedGate({ cases: fixedNames.slice(0, 2).map(successfulCase) }), 0);
  assert.equal(runFixedGate({ cases: [successfulCase(fixedNames[0]), successfulCase(fixedNames[0]), successfulCase(fixedNames[2])] }), 0);
  assert.equal(runFixedGate({
    skipped: 1,
    cases: [successfulCase(fixedNames[0]), `<testcase name="${fixedNames[1]}" classname="org.opensearch.snapshots.SharedClusterSnapshotRestoreIT" time="0.1"><skipped/></testcase>`, successfulCase(fixedNames[2])],
  }), 0);
  assert.equal(runFixedGate({
    failures: 1,
    cases: [successfulCase(fixedNames[0]), `<testcase name="${fixedNames[1]}" classname="org.opensearch.snapshots.SharedClusterSnapshotRestoreIT" time="0.1"><failure/></testcase>`, successfulCase(fixedNames[2])],
  }), 0);
  assert.equal(runFixedGate({ tests: 2 }), 0);
  assert.equal(runFixedGate({ fixedStatus: 1 }), 0);

  const gateStart = build.indexOf("full_report_count=");
  const gateEnd = build.indexOf("if grep -Eq ':server:internalClusterTest", gateStart);
  assert.ok(gateStart >= 0 && gateEnd > gateStart);
  const gate = build.slice(gateStart, gateEnd);
  const runGate = ({ firstReportTests = 236, skipped = 47, failures = 0, errors = 0, scopeSkipped = false, writeScopeSkipped = false }) => {
    const evidence = temporaryDirectory(t);
    const junit = path.join(evidence, "junit");
    const scopePath = path.join(junit, "server/build/test-results/internalClusterTest/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml");
    mkdirSync(path.dirname(scopePath), { recursive: true });
    const scopeCase = scopeSkipped
      ? '<testcase name="testSnapshotShardPathsListBlobsFaultScope" classname="org.opensearch.snapshots.SharedClusterSnapshotRestoreIT" time="0.1"><skipped/></testcase>'
      : '<testcase name="testSnapshotShardPathsListBlobsFaultScope" classname="org.opensearch.snapshots.SharedClusterSnapshotRestoreIT" time="0.1"/>';
    const writeScopeCase = writeScopeSkipped
      ? '<testcase name="testSnapshotShardPathsAuxiliaryWriteFaultScope" classname="org.opensearch.snapshots.SharedClusterSnapshotRestoreIT" time="0.1"><skipped/></testcase>'
      : '<testcase name="testSnapshotShardPathsAuxiliaryWriteFaultScope" classname="org.opensearch.snapshots.SharedClusterSnapshotRestoreIT" time="0.1"/>';
    writeFileSync(scopePath, `<testsuite tests="${firstReportTests}" failures="${failures}" errors="${errors}" skipped="${skipped}">${scopeCase}${writeScopeCase}</testsuite>\n`);
    for (let index = 1; index < 16; index += 1) {
      const report = path.join(junit, `group-${index}/nested-${index % 3}/build/test-results/test/TEST-fixture-${index}.xml`);
      mkdirSync(path.dirname(report), { recursive: true });
      writeFileSync(report, '<testsuite tests="100" failures="0" errors="0" skipped="0"><testcase name="fixture" classname="fixture" time="0.1"/></testsuite>\n');
    }
    writeFileSync(path.join(evidence, "core-build-and-tests.log"), "synthetic full-suite gate fixture\n");
    const evidencePath = evidence.replaceAll("\\", "/");
    const command = `build_status=0\n${gate.replaceAll("/evidence", evidencePath)}\nprintf '%s\\n' "$build_status"`;
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", command], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return Number(result.stdout.trim());
  };
  assert.equal(runGate({ skipped: 47 }), 0);
  assert.equal(runGate({ skipped: 48 }), 0);
  assert.equal(runGate({ firstReportTests: 235 }), 1);
  assert.equal(runGate({ firstReportTests: 237, skipped: 48 }), 0);
  assert.equal(runGate({ skipped: 49 }), 1);
  assert.equal(runGate({ failures: 1 }), 1);
  assert.equal(runGate({ errors: 1 }), 1);
  assert.equal(runGate({ scopeSkipped: true }), 1);
  assert.equal(runGate({ writeScopeSkipped: true }), 1);
});

test("JDK inventory preserves required fields and plugin absence rejects visible and hidden entries", linuxExecution, (t) => {
  const source = temporaryDirectory(t);
  mkdirSync(path.join(source, "bin"));
  mkdirSync(path.join(source, "legal"));
  writeFileSync(path.join(source, "release"), 'JAVA_VERSION="25.0.4.1"\n');
  writeFileSync(path.join(source, "legal/NOTICE"), "synthetic retained legal notice\n");
  writeFileSync(path.join(source, "bin/java"), "#!/bin/sh\nexit 99\n");
  chmodSync(path.join(source, "bin/java"), 0o755);
  symlinkSync("legal", path.join(source, "legal-link"));
  const initial = runScript("jdk-inventory.sh", [source]);
  assert.equal(initial.status, 0, initial.stderr);
  assert.match(initial.stdout, /JDK_TAR_METADATA_NUMERIC_OWNERS_MTIME_NORMALIZED/u);
  assert.match(initial.stdout, /JDK_TREE_TAR_SHA256\n[a-f0-9]{64} {2}-\n/u);
  assert.match(initial.stdout, /\.\/legal-link -> legal/u);
  const relocated = path.join(temporaryDirectory(t), "relocated");
  cpSync(source, relocated, { recursive: true, verbatimSymlinks: true });
  const sourceMode = statSync(source).mode & 0o7777;
  chmodSync(relocated, sourceMode);
  assert.equal(runScript("jdk-inventory.sh", [relocated]).stdout, initial.stdout);
  utimesSync(path.join(relocated, "legal/NOTICE"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
  assert.equal(runScript("jdk-inventory.sh", [relocated]).stdout, initial.stdout);
  chmodSync(relocated, sourceMode ^ 0o010);
  assert.notEqual(runScript("jdk-inventory.sh", [relocated]).stdout, initial.stdout);
  chmodSync(relocated, sourceMode);
  writeFileSync(path.join(relocated, "legal/NOTICE"), "changed synthetic notice\n");
  assert.notEqual(runScript("jdk-inventory.sh", [relocated]).stdout, initial.stdout);
  rmSync(path.join(relocated, "legal"), { recursive: true });
  assert.notEqual(runScript("jdk-inventory.sh", [relocated]).status, 0);
  const plugins = temporaryDirectory(t);
  const command = pluginAbsenceCommand(recipe);
  const check = () => spawnSync(bash, ["-euo", "pipefail", "-c", command, "--", plugins], { encoding: "utf8", timeout: 15000 });
  assert.equal(check().status, 0);
  writeFileSync(path.join(plugins, "visible-plugin"), "synthetic");
  assert.notEqual(check().status, 0);
  rmSync(path.join(plugins, "visible-plugin"));
  writeFileSync(path.join(plugins, ".hidden-plugin"), "synthetic");
  assert.notEqual(check().status, 0);
});

test("all preparation scripts have valid Bash syntax without building or executing candidate code", () => {
  for (const name of ["patch-catalogue.sh", "patch-snapshot-scope-test.sh", "patch-snapshot-mock-repository.sh", "jdk-inventory.sh", "build-core.sh", "verify-test-output-capture.sh"]) {
    const result = spawnSync(bash, ["-n", path.join(directory, name).replaceAll("\\", "/")], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("the recipe pins source/build/base identities and preserves the original JDK rather than replacing it", () => {
  assert.match(recipe, /^FROM eclipse-temurin@sha256:bb022f5eb485497a672821166e469ce4e2289593d74356b6b327cd43d46e3ff0 AS builder$/mu);
  assert.match(recipe, /^FROM opensearchproject\/opensearch@sha256:13487e0953520edf6cc866dfc672fd67a70ab122aa7d84d4a6c97106f84d3f84 AS prepared-base$/mu);
  assert.match(recipe, /ADD --keep-git-dir=true --chown=1000:1000 https:\/\/github\.com\/opensearch-project\/OpenSearch\.git#4ee42a94e87f66fbf1e62a9871b1b87f91e02472 /u);
  assert.doesNotMatch(recipe, /^ARG\s|apt(?:-get)? install|ADD https?:.*\.tar/mu);
  assert.match(recipe, /^ {4}JAVA25_HOME=\/opt\/java\/openjdk \\$/mu);
  assert.equal(recipe.match(/JAVA25_HOME=/gu)?.length, 1);
  assert.ok(recipe.indexOf("JAVA25_HOME=/opt/java/openjdk") < recipe.indexOf(" AS prepared-base"));
  assert.match(recipe, /RUNTIME_JAVA_HOME=\/opt\/java\/openjdk/u);
  assert.match(recipe, /mv \/usr\/share\/opensearch\/jdk \/opt\/aw-preserved-opensearch-jdk/u);
  assert.match(recipe, /mv \/opt\/aw-preserved-opensearch-jdk \/usr\/share\/opensearch\/jdk/u);
  for (const inventory of ["jdk-before.txt", "jdk-preserved.txt", "jdk-restored.txt"]) assert.ok(recipe.includes(inventory));
  assert.match(recipe, /OPENSEARCH_JAVA_HOME=\/usr\/share\/opensearch\/jdk/u);
  assert.match(recipe, /"\$OPENSEARCH_JAVA_HOME\/bin\/java" --version/u);
  assert.match(recipe, /test "\$specification" -ge 21/u);
});

test("the full dated RPM transaction preserves package signatures and exact fixed versions", () => {
  assert.match(recipe, /dnf --releasever=2023\.12\.20261026 --disablerepo="\*" --enablerepo=amazonlinux/u);
  assert.match(recipe, /--setopt=amazonlinux\.gpgcheck=1 --setopt=gpgcheck=1/u);
  assert.match(recipe, /--refresh --best upgrade -y/u);
  assert.match(recipe, /0c790663fd4779e47e261b22155386c82927f2d2c15e0bb90ff6501db0dee1b5/u);
  assert.match(recipe, /openssl-libs 1:3\.5\.8-1\.amzn2023\.0\.3/u);
  assert.match(recipe, /python3-pip-wheel 0:21\.3\.1-2\.amzn2023\.0\.22/u);
  assert.doesNotMatch(recipe, /--nogpgcheck|gpgcheck=0|releasever=latest|--allowerasing|\bdowngrade\b/u);
});

test("core launch configuration and test gates preserve the selected limits and plugin boundary", () => {
  const configuration = Object.fromEntries(readFileSync(path.join(directory, "opensearch.yml"), "utf8").trim().split("\n").map((line) => line.split(": ")));
  assert.equal(configuration["discovery.type"], "single-node");
  assert.equal(configuration["network.host"], "0.0.0.0");
  assert.equal(configuration["path.data"], "/usr/share/opensearch/data");
  assert.equal(configuration["bootstrap.memory_lock"], "true");
  assert.match(recipe, /OPENSEARCH_JAVA_OPTS="-Xms512m -Xmx512m"/u);
  assert.match(recipe, /USER 1000:1000/u);
  assert.match(recipe, /ENTRYPOINT \["\/usr\/share\/opensearch\/bin\/opensearch"\]/u);
  assert.match(recipe, /CMD \[\]/u);
  assert.doesNotMatch(recipe, /DISABLE_INSTALL_DEMO_CONFIG|DISABLE_SECURITY_PLUGIN/u);
  for (const task of [":modules:ingest-geoip:updateShas", ":modules:ingest-geoip:dependencyLicenses", ":modules:ingest-geoip:thirdPartyAudit",
    ":modules:ingest-geoip:test", ":modules:ingest-geoip:yamlRestTest", ":rest-api-spec:yamlRestTest",
    ":server:internalClusterTest", ":distribution:archives:buildNoJdkLinux", ":distribution:archives:no-jdk-linux-tar:assemble"]) assert.ok(build.includes(task), task);
  assertXContentProjectContract(build);
  assert.throws(() => assertXContentProjectContract(build.replaceAll(":libs:opensearch-x-content:", ":libs:x-content:")));
  assert.throws(() => assertXContentProjectContract(build.replaceAll("libs/x-content/", "libs/opensearch-x-content/")));
  assert.throws(() => assertXContentProjectContract(build.replace("for group in libs/x-content ", "for group in libs/opensearch-x-content ")));
  assertExplodedDistributionContract(build);
  assert.throws(() => assertExplodedDistributionContract(build.replace("    :distribution:archives:buildNoJdkLinux \\\n", "")));
  assert.throws(() => assertExplodedDistributionContract(build.replace("if [ ! -d /workspace/source/distribution/archives/no-jdk-linux-tar/build/install/opensearch-3.9.0 ]; then", "if false; then")));
  for (const suite of ["SimpleRecoveryIT", "RestoreSnapshotIT", "SharedClusterSnapshotRestoreIT"]) assert.ok(build.includes(suite));
  assert.match(build, /--max-workers=2/u);
  assert.match(build, /-Dtests\.jvms=1/u);
  assert.match(build, /gradle-wrapper\.jar \| sha256sum --check --strict/u);
  assert.doesNotMatch(build, /-x (?:test|dependencyLicenses|thirdPartyAudit)|\.enabled\s*=\s*false|verification-metadata/u);
  assert.match(recipe, /test "\$\(cat \/tmp\/aw-core-build\.exit-code\)" = 0/u);
  assert.match(build, /junit-counts\.txt/u);
  pluginAbsenceCommand(recipe);
  assert.throws(() => pluginAbsenceCommand(recipe.replace("nullglob dotglob", "nullglob")));
  assert.throws(() => pluginAbsenceCommand(recipe.replace('test "${#plugins[@]}" -eq 0', 'test "${#plugins[@]}" -eq 1')));
  assert.doesNotMatch(recipe, /\bfind\b|dnf[^\n]*install[^\n]*findutils/u);
  assert.doesNotMatch(inventoryScript, /\bfind\b|--owner=|--group=|--mode=|--dereference/u);
  for (const option of ["--sort=name", "--format=gnu", "--numeric-owner", "--mtime=@0", "--file=-"])
    assert.ok(inventoryScript.includes(option), option);
});

test("the evidence export excludes source trees, test binary stores and candidate archives", () => {
  const evidence = recipe.split("FROM scratch AS evidence\n")[1];
  assert.equal(evidence, "COPY --from=builder /evidence/ /opensearch/build/\nCOPY --from=prepared-base /managed-evidence/ /opensearch/base/\n");
  assert.match(build, /-name 'TEST-\*\.xml'/u);
  assert.doesNotMatch(build, /cp .*\.tar|cp .*\.jar|cp .*build\/distributions|cp .*test-results\/ /u);
});
