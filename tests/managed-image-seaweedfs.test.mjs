import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readManagedSeaweedTests } from "../scripts/scanner/managed-seaweed.mjs";
import { exportManagedTextEvidence } from "../scripts/scanner/official-audit.mjs";

const root = path.resolve(import.meta.dirname, "..");
const materials = path.join(root, "infra/managed-images/seaweedfs");
const recipe = readFileSync(path.join(root, "infra/managed-images/Dockerfile.seaweedfs"), "utf8");
const ignore = readFileSync(path.join(root, "infra/managed-images/Dockerfile.seaweedfs.dockerignore"), "utf8");
const preparation = readFileSync(path.join(materials, "prepare-source.sh"), "utf8");
const runner = readFileSync(path.join(materials, "run-normal-profile.sh"), "utf8");
const notice = readFileSync(path.join(materials, "DERIVATIVE-NOTICE.txt"), "utf8");
const originalMod = readFileSync(path.join(materials, "original/go.mod"));
const originalSum = readFileSync(path.join(materials, "original/go.sum"));
const correctedMod = readFileSync(path.join(materials, "corrected/go.mod"));
const correctedSum = readFileSync(path.join(materials, "corrected/go.sum"));
const license = readFileSync(path.join(materials, "licenses/seaweedfs-LICENSE"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const identities = Object.freeze({
  builder: "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747",
  base: "sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707",
  source: "ffa87c25fdf587178b1521ad87f2a4a72a02e584",
  archive: "d650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9",
  originalMod: "4980945b680fa12c0457f0aa909926401860d66e816eccc6f8508c71a5290ee8",
  originalSum: "78c8b44110c4633c5721e0f7dad0fe99308116ebb7bdd5dafb160dc378f31d89",
  correctedMod: "5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9",
  correctedSum: "abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a",
  license: "d789d433cc11da163273d1e39be2e8fa67642f9a58ef220d3f258fa9c14ef613",
});

function stage(source, name) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.endsWith(` AS ${name}`));
  assert.notEqual(start, -1, `stage ${name} exists`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("FROM "));
  return lines.slice(start, next === -1 ? undefined : next).join("\n");
}

function assertRecipeBoundary(source, preparationSource) {
  assert.match(source, new RegExp(`^FROM golang@${identities.builder} AS weed-build$`, "mu"));
  assert.match(source, new RegExp(`^FROM chrislusf/seaweedfs@${identities.base} AS seaweedfs-base$`, "mu"));
  assert.ok(source.includes(`ADD --checksum=sha256:${identities.archive} https://codeload.github.com/seaweedfs/seaweedfs/tar.gz/${identities.source} /tmp/seaweedfs-source.tar.gz`));
  assert.match(source, /^RUN \/bin\/sh \/materials\/prepare-source\.sh$/mu);
  assert.match(preparationSource, /archive_bytes=\$\(wc -c < "\$archive" \| tr -d '\[:space:\]'\)/u);
  assert.match(preparationSource, /test "\$archive_bytes" = 81881370/u);
  assert.match(preparationSource, /test "\$compiler_version" = 'go version go1\.27\.3 linux\/amd64'/u);
  assert.match(source, /GOENV=off GOTOOLCHAIN=local GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=amd64/u);
  assert.match(source, /GOPROXY=https:\/\/proxy\.golang\.org GOSUMDB=sum\.golang\.org/u);
  assert.match(preparationSource, /go mod download -json all/u);
  assert.match(preparationSource, /go mod verify/u);
  for (const [sourcePath, bytes, hash] of [
    ["weed/iamapi/iamapi_authz_test.go", "8153", "1bcd8c6bf19ff9727d5836ba3253c8291710122bb1068cfab8264ef77d2b0285"],
    ["weed/iamapi/iamapi_management_handlers.go", "68613", "20c370620e0f15f342c90aad57a6b956e67b4ff4f43a7c486d242f9f2aa9e7a2"],
    ["weed/iamapi/iamapi_handlers.go", "1854", "cb4ee02bb29825df0a27a8bf275f7db73da1d3ecbe415d6c22b02fe843af5966"],
  ]) {
    assert.ok(preparationSource.includes(sourcePath), sourcePath);
    assert.ok(preparationSource.includes(bytes), bytes);
    assert.ok(preparationSource.includes(hash), hash);
  }
  assert.ok(preparationSource.indexOf("run_phase original-material") < preparationSource.indexOf("run_phase iam-fixture-source"));
  assert.ok(preparationSource.indexOf("run_phase iam-fixture-source") < preparationSource.indexOf("run_phase corrected-material"));
  assert.match(source, /^RUN --network=none \/bin\/sh \/materials\/run-normal-profile\.sh$/mu);
  assert.doesNotMatch(source, /^ARG\s|\bgit (?:clone|init|checkout)|(?:apt|apk|dnf)(?:-get)?\s+(?:add|install)/mu);
  assert.ok(source.indexOf("RUN /bin/sh /materials/prepare-source.sh") < source.indexOf("RUN --network=none /bin/sh /materials/run-normal-profile.sh"));
  assert.equal([...source.matchAll(/^FROM /gmu)].length, 4);
}

function assertRuntimeBoundary(source) {
  const base = stage(source, "seaweedfs-base").split("\n").filter(Boolean);
  assert.deepEqual(base, [`FROM chrislusf/seaweedfs@${identities.base} AS seaweedfs-base`]);
  const runtime = stage(source, "runtime");
  assert.match(runtime, /^FROM seaweedfs-base AS runtime\n/u);
  assert.deepEqual(runtime.split("\n").filter((line) => line.startsWith("COPY ")), [
    "COPY --from=weed-build --chown=0:0 --chmod=0755 /out/weed /usr/bin/weed",
    "COPY --from=weed-build --chown=0:0 /out/evidence/licenses/ /usr/share/licenses/auto-world-seaweedfs/",
    "COPY --from=weed-build --chown=0:0 /out/evidence/DERIVATIVE-NOTICE.txt /usr/share/licenses/auto-world-seaweedfs/DERIVATIVE-NOTICE.txt",
  ]);
  assert.doesNotMatch(runtime, /^(?:ENV|ENTRYPOINT|CMD|WORKDIR|VOLUME|EXPOSE|USER|ADD)\s/mu);
  for (const status of ["preparation.exit-code", "package-list.exit-code", "go-test.exit-code", "go-test-capture.exit-code", "build.exit-code", "build-validation.exit-code"])
    assert.ok(runtime.includes(`test "$(cat /tmp/weed-build/evidence/${status})" = 0`), status);
  assert.match(runtime, /test "\$\(cat \/tmp\/weed-build\/evidence\/go-test-stream\.tsv\)" = "\$\(cat \/tmp\/weed-build\/evidence\/go-test-concat\.tsv\)"/u);
  assert.match(runtime, /cmp \/usr\/bin\/weed \/tmp\/weed-build\/weed/u);
  assert.match(runtime, /stat -c '%u:%g:%a' \/usr\/bin\/weed/u);
}

test("SeaweedFS materials retain exact original and corrected bytes", () => {
  assert.equal(sha256(originalMod), identities.originalMod);
  assert.equal(sha256(originalSum), identities.originalSum);
  assert.equal(sha256(correctedMod), identities.correctedMod);
  assert.equal(sha256(correctedSum), identities.correctedSum);
  assert.equal(sha256(license), identities.license);
  assert.equal(originalMod.byteLength, 26652);
  assert.equal(originalSum.byteLength, 167603);
  assert.equal(correctedMod.byteLength, 26652);
  assert.equal(correctedSum.byteLength, 232835);
  assert.equal(license.byteLength, 11337);
});

test("the correction changes exactly two module versions and retains the authenticated checksum closure", () => {
  const originalModLines = originalMod.toString("utf8").split("\n");
  const correctedModLines = correctedMod.toString("utf8").split("\n");
  const removedMod = originalModLines.filter((line) => !correctedModLines.includes(line));
  const addedMod = correctedModLines.filter((line) => !originalModLines.includes(line));
  assert.deepEqual(removedMod, ["\tgolang.org/x/net v0.61.0", "\tgithub.com/go-jose/go-jose/v4 v4.1.5 // indirect"]);
  assert.deepEqual(addedMod, ["\tgolang.org/x/net v0.62.0", "\tgithub.com/go-jose/go-jose/v4 v4.1.6 // indirect"]);

  const originalSumLines = originalSum.toString("utf8").trimEnd().split("\n");
  const correctedSumLines = correctedSum.toString("utf8").trimEnd().split("\n");
  const originalSumSet = new Set(originalSumLines);
  const correctedSumSet = new Set(correctedSumLines);
  assert.equal(originalSumSet.size, originalSumLines.length);
  assert.equal(correctedSumSet.size, correctedSumLines.length);
  assert.deepEqual(originalSumLines.filter((line) => !correctedSumSet.has(line)), []);
  const addedSums = correctedSumLines.filter((line) => !originalSumSet.has(line));
  assert.equal(addedSums.length, 678);
  for (const fixedModuleSum of [
    "github.com/go-jose/go-jose/v4 v4.1.6 h1:sNRkftxFJxwsILiQukqp5z83QBSmntVwmgRY7AqBDO4=",
    "github.com/go-jose/go-jose/v4 v4.1.6/go.mod h1:x4oUasVrzR7071A4TnHLGSPpNOm2a21K9Kf04k1rs08=",
    "golang.org/x/net v0.62.0 h1:18ELalfM5+XNRwzM2nYqXsZQ9ByS1uhj2O/U7+5jqRY=",
    "golang.org/x/net v0.62.0/go.mod h1:WgDCOTH8iwtB66T4/GfI94AHo/hhdb7Hah9NDseQfiI=",
  ]) assert.ok(addedSums.includes(fixedModuleSum), fixedModuleSum);
});

test("the recipe binds the exact source, builder, base and authenticated then offline phases", () => {
  assertRecipeBoundary(recipe, preparation);
  for (const [changedRecipe, changedPreparation] of [
    [recipe.replace(identities.source, "0".repeat(40)), preparation],
    [recipe.replaceAll(identities.archive, "1".repeat(64)), preparation],
    [recipe.replace(identities.builder, "sha256:" + "2".repeat(64)), preparation],
    [recipe.replace(identities.base, "sha256:" + "3".repeat(64)), preparation],
    [recipe, preparation.replace("go mod verify", "printf verification-skipped")],
    [recipe.replace("RUN --network=none /bin/sh", "RUN /bin/sh"), preparation],
  ]) assert.throws(() => assertRecipeBoundary(changedRecipe, changedPreparation));
});

test("normal-profile tests retain the complete original JSON stream and independent statuses", () => {
  assert.match(runner, /go list -mod=readonly \.\/\.\.\. > "\$evidence\/package-list\.txt"/u);
  assert.match(runner, /go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m \.\/\.\.\./u);
  assert.match(runner, /2> "\$evidence\/go-test\.stderr\.txt" \|\| test_status=\$\?/u);
  assert.match(runner, /sprintf\("%s\/chunk-%04d\.json", output, chunk\)/u);
  assert.match(runner, /NR % 2000 == 0/u);
  assert.match(runner, /printf '%s\\t%s\\t%s\\n' "\$chunk_name" "\$chunk_bytes" "\$chunk_sha256"/u);
  assert.match(runner, /printf '%s\\t%s\\n' "\$stream_bytes" "\$stream_sha256" > "\$evidence\/go-test-stream\.tsv"/u);
  assert.match(runner, /: > "\$work_directory\/go-test-concat\.json"/u);
  assert.match(runner, /cat "\$chunk" >> "\$work_directory\/go-test-concat\.json" \|\| capture_status=1/u);
  assert.match(runner, /if ! cmp "\$work_directory\/go-test-stream\.json" "\$work_directory\/go-test-concat\.json"/u);
  assert.doesNotMatch(runner, /(?:grep|sed|jq).*go-test-stream/u);
  assert.match(runner, /printf '%s\\n' "\$test_status" > "\$evidence\/go-test\.exit-code"/u);
  assert.match(runner, /printf '%s\\n' "\$capture_status" > "\$evidence\/go-test-capture\.exit-code"/u);
  assert.match(runner, /if \[ "\$preparation_status_bytes" != 2 \] \|\| \[ "\$preparation_status" != 0 \]; then/u);
  for (const name of ["package-list.exit-code", "go-test.exit-code", "go-test-capture.exit-code", "build.exit-code", "build-validation.exit-code"])
    assert.ok(runner.includes(name), name);
});

test("the build keeps truthful main metadata and the exact derivative display marker", () => {
  assert.match(runner, /go build -mod=readonly -trimpath -buildvcs=false/u);
  assert.equal([...runner.matchAll(/go build -mod=readonly -trimpath -buildvcs=false/gu)].length, 1);
  assert.ok(runner.indexOf("go build -mod=readonly") < runner.indexOf("go test -json"));
  assert.match(runner, /WEED_BINARY="\$work_directory\/weed" go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m \.\/\.\.\./u);
  assert.match(runner, /sha256sum "\$work_directory\/weed" \| cut -d ' ' -f 1 > "\$evidence\/binary-pre-test-sha256\.txt"/u);
  assert.match(runner, /sha256sum "\$work_directory\/weed" \| cut -d ' ' -f 1 > "\$evidence\/binary-post-test-sha256\.txt"/u);
  assert.match(runner, /if cmp "\$evidence\/binary-pre-test-sha256\.txt" "\$evidence\/binary-post-test-sha256\.txt"; then/u);
  assert.match(runner, /if \[ "\$final_binary_sha256" != "\$pre_test_sha256" \] \|\| \[ "\$final_binary_sha256" != "\$post_test_sha256" \]; then/u);
  assert.match(runner, /github\.com\/seaweedfs\/seaweedfs\/weed\/util\/version\.COMMIT=ffa87c2-aw-go-5b789254/u);
  assert.match(runner, /go version -m "\$output_root\/weed" > "\$evidence\/build-info\.txt"/u);
  assert.match(runner, /"\$output_root\/weed" version > "\$evidence\/weed-version\.txt" 2> "\$evidence\/weed-version\.stderr\.txt"/u);
  assert.match(runner, /grep -F '4\.51' "\$evidence\/weed-version\.txt"/u);
  assert.match(runner, /grep -F 'ffa87c2-aw-go-5b789254' "\$evidence\/weed-version\.txt"/u);
  assert.match(runner, /cmp "\$materials_root\/corrected\/go\.mod" "\$source_root\/go\.mod"/u);
  assert.match(runner, /cmp "\$materials_root\/corrected\/go\.sum" "\$source_root\/go\.sum"/u);
  assert.doesNotMatch(runner, /git |go mod tidy|go get|GOSUMDB=off/u);
  assert.match(notice, /Main Go module: github\.com\/seaweedfs\/seaweedfs, truthful \(devel\) version/u);
  assert.match(notice, /not a source commit or Go module version/u);
  assert.match(notice, /old executable remains present in\nan inherited image layer/u);
});

test("runtime overlays only weed and notices while evidence remains text-only", () => {
  assertRuntimeBoundary(recipe);
  const evidence = stage(recipe, "evidence");
  assert.deepEqual(evidence.split("\n").filter(Boolean), [
    "FROM scratch AS evidence",
    "COPY --from=weed-build /out/evidence/ /",
  ]);
  assert.doesNotMatch(evidence, /\/out\/weed|seaweedfs-source\.tar\.gz/u);
  assert.match(recipe, /io\.auto-world\.seaweedfs\.authority="diagnostic-only-not-admitted"/u);
});

test("deny-all build context exposes only this recipe and its exact materials", () => {
  assert.equal(ignore, "**\n!infra/\n!infra/managed-images/\n!infra/managed-images/Dockerfile.seaweedfs\n!infra/managed-images/seaweedfs/\n!infra/managed-images/seaweedfs/**\n");
  assert.doesNotMatch(ignore, /lock\.json|scripts\/|tests\//u);
});

test("the preparation script uses portable Alpine sh syntax without running candidate code", () => {
  assert.match(preparation, /^#!\/bin\/sh\nset -eu\n/u);
  assert.match(runner, /^#!\/bin\/sh\nset -euo pipefail\n/u);
  for (const script of [preparation, runner]) {
    assert.doesNotMatch(script, /#!\/bin\/bash|\[\[|\]\]|^\s*(?:local|declare)\s|\(\([^)]*\+\+\)\)|\$\{![^}]+\}/mu);
    const bash = spawnSync("bash", ["--posix", "-n"], {
      encoding: "utf8",
      input: script,
      windowsHide: true,
    });
    assert.equal(bash.status, 0, bash.stderr);
  }
});

function shellPath(value) {
  if (process.platform !== "win32") return value;
  const normalized = value.replaceAll("\\", "/");
  return normalized.replace(/^([A-Za-z]):/u, (_, drive) => `/mnt/${drive.toLowerCase()}`);
}

const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

test("the unique prebuilt candidate drives tests, preserves failed events, and detects mutation", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "aw-seaweed-runner-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const source = path.join(fixture, "source");
  const output = path.join(fixture, "output");
  const fixtureMaterials = path.join(fixture, "materials");
  const modules = path.join(fixture, "modules");
  const compiler = path.join(fixture, "compiler");
  const bin = path.join(fixture, "bin");
  for (const directory of [path.join(source, "weed"), path.join(fixtureMaterials, "corrected"),
    path.join(modules, "github.com/go-jose/go-jose/v4@v4.1.6"), path.join(modules, "golang.org/x/net@v0.62.0"),
    compiler, bin]) mkdirSync(directory, { recursive: true });
  cpSync(path.join(materials, "corrected/go.mod"), path.join(source, "go.mod"));
  cpSync(path.join(materials, "corrected/go.sum"), path.join(source, "go.sum"));
  cpSync(path.join(materials, "corrected/go.mod"), path.join(fixtureMaterials, "corrected/go.mod"));
  cpSync(path.join(materials, "corrected/go.sum"), path.join(fixtureMaterials, "corrected/go.sum"));
  cpSync(path.join(materials, "DERIVATIVE-NOTICE.txt"), path.join(fixtureMaterials, "DERIVATIVE-NOTICE.txt"));
  cpSync(path.join(materials, "licenses/seaweedfs-LICENSE"), path.join(source, "LICENSE"));
  for (const file of [path.join(compiler, "LICENSE"), path.join(compiler, "PATENTS"),
    path.join(modules, "github.com/go-jose/go-jose/v4@v4.1.6/LICENSE"),
    path.join(modules, "golang.org/x/net@v0.62.0/LICENSE"), path.join(modules, "golang.org/x/net@v0.62.0/PATENTS")])
    writeFileSync(file, "fixture licence\n");
  const fakeGo = path.join(bin, "go");
  const fixtureRunner = path.join(fixture, "run-normal-profile.sh");
  writeFileSync(fixtureRunner, runner);
  writeFileSync(fakeGo, `#!/bin/sh
printf '%s\n' "$*" >> "$AW_FAKE_GO_LOG"
case "$1" in
  list) printf '%s\\n' example.test/one example.test/two; exit 0 ;;
  build)
    if [ "\${AW_BUILD_FAIL-}" = 1 ]; then printf '%s\\n' 'intentional build failure' >&2; exit 9; fi
    output=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -o ]; then shift; output=$1; fi
      shift
    done
    printf '%s\\n' '#!/bin/sh' 'if [ "$1" = version ]; then if [ "\${AW_MUTATE_ON_VERSION-}" = 1 ]; then printf "%s\\n" "# finalization mutation" >> "$0"; fi; printf "%s\\n" "version 4.51 ffa87c2-aw-go-5b789254"; exit 0; fi' 'exit 97' > "$output"
    chmod 755 "$output"
    ;;
  test)
    test -n "\${WEED_BINARY-}" && test -f "$WEED_BINARY" || exit 96
    if [ "\${AW_MUTATE_BINARY-}" = 1 ]; then printf '%s\\n' '# changed during tests' >> "$WEED_BINARY"; fi
    if [ "\${AW_TEST_EMPTY-}" != 1 ]; then
      i=1
      while [ "$i" -le 2001 ]; do printf '{"Action":"output","Package":"example.test/one","Output":"line-%s\\\\n"}\\n' "$i"; i=$((i + 1)); done
    fi
    printf '%s\\n' 'intentional test failure' >&2
    exit 7
    ;;
  version) printf '%s\\n' 'fixture build info'; exit 0 ;;
  *) exit 97 ;;
esac
`);
  chmodSync(fakeGo, 0o755);
  const executable = process.platform === "win32" ? "C:/Windows/System32/bash.exe" : "bash";
  const runFixture = (target, variables = {}, preparationStatus = "0\n") => {
    mkdirSync(path.join(target, "evidence"), { recursive: true });
    writeFileSync(path.join(target, "evidence/preparation.exit-code"), preparationStatus);
    const log = path.join(target, "go.log");
    const environment = Object.entries({ AW_FAKE_GO_LOG: log, ...variables })
      .map(([key, value]) => `${key}=${shellQuote(shellPath(String(value)))}`).join(" ");
    const values = [fixtureRunner, source, target, fixtureMaterials, modules, compiler]
      .map((value) => shellQuote(shellPath(value))).join(" ");
    const command = `PATH=${shellQuote(shellPath(bin))}:/usr/bin:/bin ${environment} /bin/bash --posix ${values}`;
    const result = spawnSync(executable, ["--posix", "-c", command], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    return { result, log };
  };
  const { result: run, log } = runFixture(output);
  assert.equal(run.status, 0, run.stderr);
  const evidence = path.join(output, "evidence");
  assert.equal(readFileSync(path.join(evidence, "go-test.exit-code"), "utf8").trim(), "7");
  assert.equal(readFileSync(path.join(evidence, "go-test-capture.exit-code"), "utf8").trim(), "0");
  assert.equal(readFileSync(path.join(evidence, "build.exit-code"), "utf8").trim(), "0");
  assert.equal(readFileSync(path.join(evidence, "build-validation.exit-code"), "utf8").trim(), "0");
  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(calls.filter((call) => call.startsWith("build ")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("test ")).length, 1);
  assert.ok(calls.findIndex((call) => call.startsWith("build ")) < calls.findIndex((call) => call.startsWith("test ")));
  const preHash = readFileSync(path.join(evidence, "binary-pre-test-sha256.txt"), "utf8");
  const postHash = readFileSync(path.join(evidence, "binary-post-test-sha256.txt"), "utf8");
  assert.match(preHash, /^[0-9a-f]{64}\n$/u);
  assert.equal(postHash, preHash);
  const manifest = readFileSync(path.join(evidence, "go-test-manifest.tsv"), "utf8").trim().split("\n");
  assert.equal(manifest.length, 2);
  assert.match(manifest[0], /^chunk-0000\.json\t[1-9][0-9]*\t[0-9a-f]{64}$/u);
  assert.match(manifest[1], /^chunk-0001\.json\t[1-9][0-9]*\t[0-9a-f]{64}$/u);
  assert.equal(readFileSync(path.join(evidence, "go-test-stream.tsv"), "utf8"), readFileSync(path.join(evidence, "go-test-concat.tsv"), "utf8"));
  const exportedRoot = path.join(fixture, "exported-test-evidence");
  exportManagedTextEvidence(evidence, exportedRoot);
  for (const entry of manifest) {
    const [chunk] = entry.split("\t");
    assert.deepEqual(readFileSync(path.join(exportedRoot, "go-test-events", chunk)), readFileSync(path.join(evidence, "go-test-events", chunk)));
  }

  const emptyOutput = path.join(fixture, "empty-output");
  const { result: emptyRun } = runFixture(emptyOutput, { AW_TEST_EMPTY: 1 });
  assert.equal(emptyRun.status, 0, emptyRun.stderr);
  const emptyEvidence = path.join(emptyOutput, "evidence");
  assert.equal(readFileSync(path.join(emptyEvidence, "go-test.exit-code"), "utf8").trim(), "7");
  assert.equal(readFileSync(path.join(emptyEvidence, "go-test-capture.exit-code"), "utf8").trim(), "1");
  assert.equal(readFileSync(path.join(emptyEvidence, "build.exit-code"), "utf8").trim(), "0");
  assert.equal(readFileSync(path.join(emptyEvidence, "go-test-manifest.tsv"), "utf8"), "");
  assert.equal(readFileSync(path.join(emptyEvidence, "go-test-stream.tsv"), "utf8"), readFileSync(path.join(emptyEvidence, "go-test-concat.tsv"), "utf8"));

  const changedOutput = path.join(fixture, "changed-output");
  const { result: changedRun } = runFixture(changedOutput, { AW_MUTATE_BINARY: 1, AW_TEST_EMPTY: 1 });
  assert.equal(changedRun.status, 0, changedRun.stderr);
  const changedEvidence = path.join(changedOutput, "evidence");
  assert.notEqual(readFileSync(path.join(changedEvidence, "binary-pre-test-sha256.txt"), "utf8"),
    readFileSync(path.join(changedEvidence, "binary-post-test-sha256.txt"), "utf8"));
  assert.equal(readFileSync(path.join(changedEvidence, "build-validation.exit-code"), "utf8").trim(), "1");
  assert.equal(statSync(path.join(changedOutput, "weed")).size, 0);

  const finalizationChangedOutput = path.join(fixture, "finalization-changed-output");
  const { result: finalizationChangedRun } = runFixture(finalizationChangedOutput, { AW_MUTATE_ON_VERSION: 1, AW_TEST_EMPTY: 1 });
  assert.equal(finalizationChangedRun.status, 0, finalizationChangedRun.stderr);
  const finalizationChangedEvidence = path.join(finalizationChangedOutput, "evidence");
  const finalizationPreHash = readFileSync(path.join(finalizationChangedEvidence, "binary-pre-test-sha256.txt"), "utf8").trim();
  const finalizationPostHash = readFileSync(path.join(finalizationChangedEvidence, "binary-post-test-sha256.txt"), "utf8").trim();
  const finalizationFinalHash = readFileSync(path.join(finalizationChangedEvidence, "binary-sha256.txt"), "utf8").split(" ")[0];
  assert.equal(finalizationPostHash, finalizationPreHash);
  assert.notEqual(finalizationFinalHash, finalizationPreHash);
  assert.equal(readFileSync(path.join(finalizationChangedEvidence, "build-validation.exit-code"), "utf8").trim(), "1");
  assert.match(readFileSync(path.join(finalizationChangedEvidence, "weed-version.txt"), "utf8"), /4\.51.*ffa87c2-aw-go-5b789254/u);
  assert.ok(statSync(path.join(finalizationChangedOutput, "weed")).size > 0);

  const failedBuildOutput = path.join(fixture, "failed-build-output");
  const { result: failedBuildRun, log: failedBuildLog } = runFixture(failedBuildOutput, { AW_BUILD_FAIL: 1 });
  assert.equal(failedBuildRun.status, 0, failedBuildRun.stderr);
  const failedBuildEvidence = path.join(failedBuildOutput, "evidence");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "package-list.exit-code"), "utf8").trim(), "0");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "build.exit-code"), "utf8").trim(), "9");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "build.stderr.txt"), "utf8"), "intentional build failure\n");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "go-test.exit-code"), "utf8").trim(), "125");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "go-test-capture.exit-code"), "utf8").trim(), "125");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "build-validation.exit-code"), "utf8").trim(), "1");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "go-test.stderr.txt"), "utf8"), "");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "go-test-manifest.tsv"), "utf8"), "");
  assert.equal(readFileSync(path.join(failedBuildEvidence, "go-test-manifest.sha256"), "utf8"), `${sha256(Buffer.alloc(0))}  go-test-manifest.tsv\n`);
  assert.equal(readFileSync(path.join(failedBuildEvidence, "go-test-stream.tsv"), "utf8"), `0\t${sha256(Buffer.alloc(0))}\n`);
  assert.equal(readFileSync(path.join(failedBuildEvidence, "go-test-concat.tsv"), "utf8"), `0\t${sha256(Buffer.alloc(0))}\n`);
  assert.equal(existsSync(path.join(failedBuildEvidence, "go-test-events/chunk-0000.json")), false);
  assert.equal(readFileSync(failedBuildLog, "utf8").split("\n").some((call) => call.startsWith("test ")), false);
  assert.equal(statSync(path.join(failedBuildOutput, "weed")).size, 0);
  const exportedFailedBuild = path.join(fixture, "exported-failed-build");
  exportManagedTextEvidence(failedBuildEvidence, exportedFailedBuild);
  assert.deepEqual(readFileSync(path.join(exportedFailedBuild, "build.stderr.txt")),
    readFileSync(path.join(failedBuildEvidence, "build.stderr.txt")));

  const sentinel = path.join(fixture, "unexpected-go-call");
  const sentinelGo = `#!/bin/sh\nprintf '%s\\n' called > ${shellQuote(shellPath(sentinel))}\nexit 98\n`;
  writeFileSync(fakeGo, sentinelGo);
  chmodSync(fakeGo, 0o755);
  const blockedOutput = path.join(fixture, "blocked-output");
  const { result: blockedRun } = runFixture(blockedOutput, {}, "23\n");
  assert.equal(blockedRun.status, 0, blockedRun.stderr);
  const blockedEvidence = path.join(blockedOutput, "evidence");
  assert.equal(existsSync(sentinel), false);
  for (const status of ["package-list.exit-code", "go-test.exit-code", "go-test-capture.exit-code", "build.exit-code", "build-validation.exit-code"])
    assert.equal(readFileSync(path.join(blockedEvidence, status), "utf8").trim(), "125", status);
  assert.equal(statSync(path.join(blockedOutput, "weed")).size, 0);
  const exportedBlockedEvidence = path.join(fixture, "exported-blocked-evidence");
  const exported = exportManagedTextEvidence(blockedEvidence, exportedBlockedEvidence);
  assert.ok(exported.some(({ path: evidencePath }) => evidencePath === "preparation.exit-code"));
  assert.ok(exported.some(({ path: evidencePath }) => evidencePath === "build.stderr.txt"));
  assert.throws(() => readManagedSeaweedTests(exportedBlockedEvidence), /scanner_managed_seaweed_evidence_invalid/u);

  const malformedOutput = path.join(fixture, "malformed-output");
  const { result: malformedRun } = runFixture(malformedOutput, {}, "0\n\n");
  assert.equal(malformedRun.status, 0, malformedRun.stderr);
  assert.equal(existsSync(sentinel), false);
  assert.equal(readFileSync(path.join(malformedOutput, "evidence/go-test.exit-code"), "utf8").trim(), "125");
});
