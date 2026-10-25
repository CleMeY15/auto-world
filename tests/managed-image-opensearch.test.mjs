import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../infra/managed-images/opensearch-core/", import.meta.url));
const recipe = readFileSync(new URL("../infra/managed-images/Dockerfile.opensearch-core", import.meta.url), "utf8");
const build = readFileSync(path.join(directory, "build-core.sh"), "utf8");
const original = readFileSync(path.join(directory, "fixtures/libs.versions.toml"));
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

function catalogueSource(t, bytes = original) {
  const result = temporaryDirectory(t);
  mkdirSync(path.join(result, "gradle"));
  writeFileSync(path.join(result, "gradle/libs.versions.toml"), bytes);
  return result;
}

function assertExplodedDistributionContract(script) {
  assert.match(script, /^ {4}:distribution:archives:buildNoJdkLinux \\$/mu);
  const guard = /if \[ ! -d \/workspace\/source\/distribution\/archives\/no-jdk-linux-tar\/build\/install\/opensearch-3\.9\.0 \]; then\n {2}printf[^\n]+\n {2}build_status=1\nfi/u;
  assert.match(script, guard);
  assert.ok(script.search(guard) < script.indexOf('"$build_status" > /evidence/build.exit-code'));
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

test("JDK inventory is location independent, observes content, and never executes the inert java fixture", linuxExecution, (t) => {
  const source = temporaryDirectory(t);
  mkdirSync(path.join(source, "bin"));
  mkdirSync(path.join(source, "legal"));
  writeFileSync(path.join(source, "release"), 'JAVA_VERSION="25.0.4.1"\n');
  writeFileSync(path.join(source, "legal/NOTICE"), "synthetic retained legal notice\n");
  writeFileSync(path.join(source, "bin/java"), "#!/bin/sh\nexit 99\n");
  chmodSync(path.join(source, "bin/java"), 0o755);
  const initial = runScript("jdk-inventory.sh", [source]);
  assert.equal(initial.status, 0, initial.stderr);
  assert.match(initial.stdout, /JDK_METADATA_TYPE_MODE_UID_GID_PATH_LINK/u);
  assert.match(initial.stdout, /JDK_REGULAR_FILE_SHA256/u);
  assert.ok(initial.stdout.includes(sha256(readFileSync(path.join(source, "bin/java")))));
  const relocated = path.join(temporaryDirectory(t), "relocated");
  cpSync(source, relocated, { recursive: true });
  assert.equal(runScript("jdk-inventory.sh", [relocated]).stdout, initial.stdout);
  writeFileSync(path.join(relocated, "legal/NOTICE"), "changed synthetic notice\n");
  assert.notEqual(runScript("jdk-inventory.sh", [relocated]).stdout, initial.stdout);
  rmSync(path.join(relocated, "release"));
  assert.notEqual(runScript("jdk-inventory.sh", [relocated]).status, 0);
});

test("all preparation scripts have valid Bash syntax without building or executing candidate code", () => {
  for (const name of ["patch-catalogue.sh", "jdk-inventory.sh", "build-core.sh"]) {
    const result = spawnSync(bash, ["-n", path.join(directory, name).replaceAll("\\", "/")], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("the recipe pins source/build/base identities and preserves the original JDK rather than replacing it", () => {
  assert.match(recipe, /^FROM eclipse-temurin@sha256:bb022f5eb485497a672821166e469ce4e2289593d74356b6b327cd43d46e3ff0 AS builder$/mu);
  assert.match(recipe, /^FROM opensearchproject\/opensearch@sha256:13487e0953520edf6cc866dfc672fd67a70ab122aa7d84d4a6c97106f84d3f84 AS prepared-base$/mu);
  assert.match(recipe, /ADD --keep-git-dir=true --chown=1000:1000 https:\/\/github\.com\/opensearch-project\/OpenSearch\.git#4ee42a94e87f66fbf1e62a9871b1b87f91e02472 /u);
  assert.doesNotMatch(recipe, /^ARG\s|apt(?:-get)? install|ADD https?:.*\.tar/mu);
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
  for (const task of [":libs:x-content:updateShas", ":modules:ingest-geoip:updateShas", ":libs:x-content:dependencyLicenses",
    ":libs:x-content:thirdPartyAudit", ":modules:ingest-geoip:dependencyLicenses", ":modules:ingest-geoip:thirdPartyAudit",
    ":libs:x-content:test", ":modules:ingest-geoip:test", ":modules:ingest-geoip:yamlRestTest", ":rest-api-spec:yamlRestTest",
    ":server:internalClusterTest", ":distribution:archives:buildNoJdkLinux", ":distribution:archives:no-jdk-linux-tar:assemble"]) assert.ok(build.includes(task), task);
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
});

test("the evidence export excludes source trees, test binary stores and candidate archives", () => {
  const evidence = recipe.split("FROM scratch AS evidence\n")[1];
  assert.equal(evidence, "COPY --from=builder /evidence/ /opensearch/build/\nCOPY --from=prepared-base /managed-evidence/ /opensearch/base/\n");
  assert.match(build, /-name 'TEST-\*\.xml'/u);
  assert.doesNotMatch(build, /cp .*\.tar|cp .*\.jar|cp .*build\/distributions|cp .*test-results\/ /u);
});
