import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../infra/managed-images/opensearch-core/", import.meta.url));
const recipe = readFileSync(new URL("../infra/managed-images/Dockerfile.opensearch-core", import.meta.url), "utf8");
const build = readFileSync(path.join(directory, "build-core.sh"), "utf8");
const fixture = readFileSync(path.join(directory, "fixtures/XContentParserTests.java"));
const patch = readFileSync(path.join(directory, "xcontent-yaml-string-boundary.patch"), "utf8");
const helper = readFileSync(path.join(directory, "patch-xcontent-yaml-string-boundary.sh"), "utf8");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const linuxExecution = { skip: process.platform !== "linux" && "Linux CI execution required; this is a new Windows platform exclusion" };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function temporaryDirectory(t) {
  const result = mkdtempSync(path.join(os.tmpdir(), "aw-xcontent-boundary-"));
  t.after(() => rmSync(result, { recursive: true, force: true }));
  return result;
}

function sourceTree(t, bytes = fixture) {
  const root = temporaryDirectory(t);
  const target = path.join(root, "libs/x-content/src/test/java/org/opensearch/common/xcontent/XContentParserTests.java");
  const production = path.join(root, "libs/x-content/src/main/java/org/opensearch/common/xcontent/yaml/YamlXContent.java");
  const evidence = path.join(root, "evidence");
  mkdirSync(path.dirname(target), { recursive: true });
  mkdirSync(path.dirname(production), { recursive: true });
  mkdirSync(evidence);
  writeFileSync(target, bytes);
  writeFileSync(production, "production-parser-sentinel\n");
  return { root, target, production, evidence };
}

function runHelper(source) {
  return spawnSync(bash, [
    path.join(directory, "patch-xcontent-yaml-string-boundary.sh").replaceAll("\\", "/"),
    source.root.replaceAll("\\", "/"),
    source.evidence.replaceAll("\\", "/"),
  ], { encoding: "utf8", timeout: 15000, windowsHide: true });
}

test("the vendored x-content fixture and official patch delta are exact", () => {
  assert.equal(fixture.length, 44221);
  assert.equal(sha256(fixture), "e45a76b389275584674a9458d573d2e13f19c65f36fdc00f6300d9a911f822e7");
  assert.match(patch, /^--- a\/libs\/x-content\/src\/test\/java\/org\/opensearch\/common\/xcontent\/XContentParserTests\.java$/mu);
  assert.match(patch, /^\+\+\+ b\/libs\/x-content\/src\/test\/java\/org\/opensearch\/common\/xcontent\/XContentParserTests\.java$/mu);
  assert.deepEqual(
    patch.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")),
    [
      "-        /* use 50% of the limit, difficult to get the exact size of the content right */",
      "-        () -> randomRealisticUnicodeOfCodepointLengthBetween(1, (int) (YamlXContent.DEFAULT_CODEPOINT_LIMIT * 0.50))",
    ],
  );
  assert.match(patch, /Math\.min\(YamlXContent\.DEFAULT_CODEPOINT_LIMIT \/ 2, YamlXContent\.DEFAULT_MAX_STRING_LEN \/ 2\)/u);
  assert.doesNotMatch(patch, /src\/main|DEFAULT_MAX_STRING_LEN\s*=/u);
  assert.match(helper, /e45a76b389275584674a9458d573d2e13f19c65f36fdc00f6300d9a911f822e7/u);
  assert.match(helper, /2b0c7153b492ac3a701fe51d21ac2f6f3af79421abc5f3477e002ceb790a6f52/u);
  assert.doesNotMatch(helper, /^patch /mu);
});

test("the authenticated helper patches only the pinned test source and rejects missing, foreign, and repeated inputs", linuxExecution, (t) => {
  const source = sourceTree(t);
  const productionBefore = readFileSync(source.production);
  const result = runHelper(source);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const patched = readFileSync(source.target);
  assert.equal(patched.length, 44306);
  assert.equal(sha256(patched), "2b0c7153b492ac3a701fe51d21ac2f6f3af79421abc5f3477e002ceb790a6f52");
  assert.deepEqual(readFileSync(path.join(source.evidence, "xcontent-parser-tests.original.java.txt")), fixture);
  assert.deepEqual(readFileSync(path.join(source.evidence, "xcontent-parser-tests.patched.java.txt")), patched);
  assert.deepEqual(readFileSync(source.production), productionBefore);
  assert.notEqual(runHelper(source).status, 0);
  assert.deepEqual(readFileSync(source.target), patched);
  assert.deepEqual(readFileSync(source.production), productionBefore);

  const foreign = sourceTree(t, Buffer.from(fixture.toString("utf8").replace("public class XContentParserTests", "public class ForeignXContentParserTests")));
  const foreignBefore = readFileSync(foreign.target);
  assert.notEqual(runHelper(foreign).status, 0);
  assert.deepEqual(readFileSync(foreign.target), foreignBefore);

  const missing = sourceTree(t);
  rmSync(missing.target);
  assert.notEqual(runHelper(missing).status, 0);
});

test("the seeded boundary control gates the unseeded forced full suite without changing its thresholds", () => {
  const preparation = build.indexOf('bash /recipe/patch-xcontent-yaml-string-boundary.sh "$PWD" /evidence');
  const controlRun = build.indexOf(":libs:opensearch-x-content:test --rerun", preparation);
  const controlCopy = build.indexOf('cp "$xcontent_control_xml" /evidence/controls/xcontent-string-boundary/', controlRun);
  const cleanup = build.indexOf("rm -rf server/build/test-results/internalClusterTest libs/x-content/build/test-results/test", controlCopy);
  const fullRun = build.indexOf("-Dauto.world.test.output.phase=full --continue", cleanup);
  assert.ok(preparation >= 0 && preparation < controlRun && controlRun < controlCopy && controlCopy < cleanup && cleanup < fullRun);

  const control = build.slice(build.lastIndexOf("  xcontent_control_xml=", controlRun), cleanup);
  for (const value of ["E4705740DC35C4BA", "nl-AW", "Antarctica/McMurdo", "-Druntime.java=25", "testString", "testStringOffLimit"])
    assert.ok(control.includes(value), value);
  assert.match(control, /tests="2"[\s\S]*skipped="0"[\s\S]*failures="0"[\s\S]*errors="0"/u);
  assert.match(control, /UP-TO-DATE\|FROM-CACHE\|SKIPPED\|NO-SOURCE/u);

  const full = build.slice(fullRun, build.indexOf("> /evidence/core-build-and-tests.log", fullRun));
  assert.match(full, /:libs:opensearch-x-content:test --rerun :modules:ingest-geoip:test/u);
  assert.doesNotMatch(full, /-Dtests\.(?:seed|locale|timezone)|XContentParserTests/u);
  const xcontentFullInvocation = full.slice(
    full.indexOf(":libs:opensearch-x-content:test"),
    full.indexOf(":modules:ingest-geoip:yamlRestTest"),
  );
  assert.doesNotMatch(xcontentFullInvocation, /--tests/u);
  assert.match(build, /if \[ "\$fixed_control_ok" -eq 1 \] && \[ "\$xcontent_control_ok" -eq 1 \]; then/u);
  assert.match(build, /full_report_count.*-ne 16/u);
  assert.match(build, /full_test_count.*-lt 1736/u);
  assert.match(build, /full_pass_count.*-lt 1688/u);
  assert.match(build, /full_skipped_count.*-gt 48/u);
  assert.match(build, /:libs:opensearch-x-content:test \(UP-TO-DATE\|FROM-CACHE\|SKIPPED\|NO-SOURCE\)/u);

  assert.match(recipe, /patch-xcontent-yaml-string-boundary\.sh[\s\S]*xcontent-yaml-string-boundary\.patch/u);
  assert.doesNotMatch(recipe, /fixtures\/XContentParserTests\.java/u);
});

test("the boundary success gate rejects failed, incomplete, excluded, duplicated, and cached controls", (t) => {
  const functionStart = build.indexOf("owned_regular_file() {");
  const functionEnd = build.indexOf("\n}\n\nsentinel_absent", functionStart) + 2;
  const gateStart = build.indexOf("  xcontent_control_ok=0");
  const gateEnd = build.indexOf("  printf '%s\\n' \"$xcontent_control_ok\"", gateStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart && gateStart >= 0 && gateEnd > gateStart);
  const ownedRegularFile = build.slice(functionStart, functionEnd);
  const gate = build.slice(gateStart, gateEnd);
  const successfulCase = (name) => `<testcase name="${name}" classname="org.opensearch.common.xcontent.XContentParserTests" time="0.1"/>`;

  const runGate = ({ status = 0, tests = 2, skipped = 0, failures = 0, errors = 0, names = ["testString", "testStringOffLimit"], cached = false } = {}) => {
    const evidence = temporaryDirectory(t);
    const control = path.join(evidence, "controls/xcontent-string-boundary");
    mkdirSync(control, { recursive: true });
    writeFileSync(path.join(control, "gradle.log"), cached ? ":libs:opensearch-x-content:test FROM-CACHE\n" : "executed x-content tests\n");
    writeFileSync(path.join(control, "gradle.exit-code"), `${status}\n`);
    writeFileSync(
      path.join(control, "TEST-org.opensearch.common.xcontent.XContentParserTests.xml"),
      `<testsuite tests="${tests}" skipped="${skipped}" failures="${failures}" errors="${errors}">${names.map(successfulCase).join("")}</testsuite>\n`,
    );
    const command = `${ownedRegularFile}\nxcontent_control_status=${status}\n${gate.replaceAll("/evidence", evidence.replaceAll("\\", "/"))}\nprintf '%s\\n' "$xcontent_control_ok"`;
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", command], { encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return Number(result.stdout.trim());
  };

  assert.equal(runGate(), 1);
  assert.equal(runGate({ status: 1 }), 0);
  assert.equal(runGate({ skipped: 1 }), 0);
  assert.equal(runGate({ failures: 1 }), 0);
  assert.equal(runGate({ names: ["testString", "testString"] }), 0);
  assert.equal(runGate({ cached: true }), 0);
});

test("the new and integrated shell preparation scripts have valid Bash syntax", () => {
  for (const name of ["patch-xcontent-yaml-string-boundary.sh", "build-core.sh"]) {
    const result = spawnSync(bash, ["-n", path.join(directory, name).replaceAll("\\", "/")], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});
