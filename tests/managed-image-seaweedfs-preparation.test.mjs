import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { exportManagedTextEvidence } from "../scripts/scanner/official-audit.mjs";

const root = path.resolve(import.meta.dirname, "..");
const materials = path.join(root, "infra/managed-images/seaweedfs");
const preparation = readFileSync(path.join(materials, "prepare-source.sh"), "utf8");

function shellPath(value) {
  if (process.platform !== "win32") return value;
  const normalized = value.replaceAll("\\", "/");
  return normalized.replace(/^([A-Za-z]):/u, (_, drive) => `/mnt/${drive.toLowerCase()}`);
}

const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
const read = (directory, name) => readFileSync(path.join(directory, name), "utf8");

function createFixture(t) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "aw-seaweed-preparation-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const bin = path.join(fixture, "bin");
  const fixtureMaterials = path.join(fixture, "materials");
  const originals = path.join(fixtureMaterials, "original");
  const corrected = path.join(fixtureMaterials, "corrected");
  const licenses = path.join(fixtureMaterials, "licenses");
  for (const directory of [bin, originals, corrected, licenses]) mkdirSync(directory, { recursive: true });
  for (const relative of ["original/go.mod", "original/go.sum", "corrected/go.mod", "corrected/go.sum", "licenses/seaweedfs-LICENSE"])
    cpSync(path.join(materials, relative), path.join(fixtureMaterials, relative));
  const archive = path.join(fixture, "source.tar.gz");
  writeFileSync(archive, "archive-fixture\n");
  const prep = path.join(fixture, "prepare-source.sh");
  writeFileSync(prep, preparation);

  writeFileSync(path.join(bin, "wc"), `#!/bin/sh
temporary=$(mktemp)
cat > "$temporary"
count=$(/usr/bin/wc -c < "$temporary" | tr -d '[:space:]')
if grep -qx archive-fixture "$temporary"; then count=81881370; fi
printf '   %s  \n' "$count"
rm -f "$temporary"
`);
  writeFileSync(path.join(bin, "sha256sum"), `#!/bin/sh
if [ "\${1-}" = -c ]; then
  check=$(cat)
  if [ "\${AW_FAIL_IAM_HASH-}" = 1 ] && printf '%s\n' "$check" | grep -q 'iamapi_authz_test.go'; then
    printf '%s\n' 'fixture: FAILED' >&2
    exit 1
  fi
  printf '%s\n' 'fixture: OK'
  exit 0
fi
exec /usr/bin/sha256sum "$@"
`);
  writeFileSync(path.join(bin, "tar"), `#!/bin/sh
target=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -C ]; then shift; target=$1; fi
  shift
done
printf '%s\n' 'extract stdout'
printf '%s\n' 'extract stderr' >&2
if [ "\${AW_FAIL_EXTRACT-}" = 1 ]; then exit 23; fi
cp "$AW_FIXTURE_ORIGINALS/go.mod" "$target/go.mod"
cp "$AW_FIXTURE_ORIGINALS/go.sum" "$target/go.sum"
cp "$AW_FIXTURE_LICENSE" "$target/LICENSE"
mkdir -p "$target/weed/iamapi"
if [ "\${AW_OMIT_IAM_SOURCE-}" != 1 ]; then
  authz_bytes=8153
  if [ "\${AW_BAD_IAM_SIZE-}" = 1 ]; then authz_bytes=8152; fi
  head -c "$authz_bytes" /dev/zero | tr '\\000' a > "$target/weed/iamapi/iamapi_authz_test.go"
fi
head -c 68613 /dev/zero | tr '\\000' b > "$target/weed/iamapi/iamapi_management_handlers.go"
head -c 1854 /dev/zero | tr '\\000' c > "$target/weed/iamapi/iamapi_handlers.go"
`);
  writeFileSync(path.join(bin, "go"), `#!/bin/sh
printf '%s\n' "$*" >> "$AW_FAKE_GO_LOG"
case "$*" in
  version) printf '%s\n' 'go version go1.27.3 linux/amd64' ;;
  'mod download -json all')
    printf '%s\n' '{"Path":"partial.example"}'
    if [ "\${AW_FAIL_DOWNLOAD-}" = 1 ]; then
      printf '%s\n' 'module download failed' >&2
      exit 17
    fi
    if [ "\${AW_MUTATE_DOWNLOAD-}" = 1 ]; then
      printf '%s\n' 'example.test/unexpected v1.0.0 h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' >> go.sum
    fi
    ;;
  'mod verify') printf '%s\n' 'all modules verified' ;;
  'list -m -json all') printf '%s\n' '{"Path":"github.com/seaweedfs/seaweedfs"}' ;;
  *) exit 97 ;;
esac
`);
  for (const file of [prep, path.join(bin, "wc"), path.join(bin, "sha256sum"), path.join(bin, "tar"), path.join(bin, "go")])
    chmodSync(file, 0o755);

  const run = (name, variables = {}) => {
    const source = path.join(fixture, `${name}-source`);
    const output = path.join(fixture, `${name}-output`);
    const log = path.join(fixture, `${name}-go.log`);
    const assignments = {
      AW_FIXTURE_ORIGINALS: originals,
      AW_FIXTURE_LICENSE: path.join(licenses, "seaweedfs-LICENSE"),
      AW_FAKE_GO_LOG: log,
      ...variables,
    };
    const environment = Object.entries(assignments)
      .map(([key, value]) => `${key}=${shellQuote(shellPath(String(value)))}`).join(" ");
    const argumentsValue = [prep, source, output, fixtureMaterials, archive]
      .map((value) => shellQuote(shellPath(value))).join(" ");
    const command = `PATH=${shellQuote(shellPath(bin))}:/usr/bin:/bin ${environment} /bin/bash --posix ${argumentsValue}`;
    const executable = process.platform === "win32" ? "C:/Windows/System32/bash.exe" : "bash";
    const result = spawnSync(executable, ["--posix", "-c", command], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    return { result, evidence: path.join(output, "evidence"), source, log };
  };
  return { fixture, run };
}

test("preparation preserves an early extraction failure and does not invoke Go", (t) => {
  const { fixture, run } = createFixture(t);
  const { result, evidence, log } = run("extract-failure", { AW_FAIL_EXTRACT: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(evidence, "preparation.exit-code").trim(), "23");
  assert.equal(read(evidence, "preparation-first-failed-phase.txt").trim(), "source-extract");
  assert.equal(read(evidence, "preparation/source-extract.exit-code").trim(), "23");
  assert.equal(read(evidence, "preparation/source-extract.stdout.txt"), "extract stdout\n");
  assert.equal(read(evidence, "preparation/source-extract.stderr.txt"), "extract stderr\n");
  assert.equal(read(evidence, "preparation/original-material.exit-code").trim(), "125");
  assert.equal(read(evidence, "preparation/iam-fixture-source.exit-code").trim(), "125");
  assert.match(read(evidence, "preparation/module-download.stderr.txt"), /first_failed_phase=source-extract/u);
  assert.equal(existsSync(log), false);
  const exportedRoot = path.join(fixture, "exported-preparation-evidence");
  const exported = exportManagedTextEvidence(evidence, exportedRoot);
  assert.ok(exported.some(({ path: evidencePath }) => evidencePath === "preparation.exit-code"));
  assert.ok(exported.some(({ path: evidencePath }) => evidencePath === "preparation/source-extract.stderr.txt"));
  assert.deepEqual(readFileSync(path.join(exportedRoot, "preparation/source-extract.stderr.txt")),
    readFileSync(path.join(evidence, "preparation/source-extract.stderr.txt")));
});

test("preparation preserves module-download output and stops subsequent Go phases", (t) => {
  const { run } = createFixture(t);
  const { result, evidence, log } = run("download-failure", { AW_FAIL_DOWNLOAD: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(evidence, "preparation.exit-code").trim(), "17");
  assert.equal(read(evidence, "preparation-first-failed-phase.txt").trim(), "module-download");
  assert.equal(read(evidence, "preparation/module-download.exit-code").trim(), "17");
  assert.equal(read(evidence, "module-download.json"), '{"Path":"partial.example"}\n');
  assert.equal(read(evidence, "preparation/module-download.stderr.txt"), "module download failed\n");
  assert.equal(read(evidence, "preparation/module-verify.exit-code").trim(), "125");
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["version", "mod download -json all"]);
});

test("preparation rejects a successful download that changes the frozen go.sum", (t) => {
  const { fixture, run } = createFixture(t);
  const { result, evidence, log } = run("download-mutates-material", { AW_MUTATE_DOWNLOAD: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(evidence, "preparation.exit-code").trim(), "1");
  assert.equal(read(evidence, "preparation-first-failed-phase.txt").trim(), "final-material");
  for (const phase of ["module-download", "module-verify", "module-inventory"])
    assert.equal(read(evidence, `preparation/${phase}.exit-code`).trim(), "0", phase);
  assert.equal(read(evidence, "preparation/final-material.exit-code").trim(), "1");
  assert.match(read(evidence, "preparation/final-material.stderr.txt"), /corrected\/go\.sum/u);
  assert.equal(read(evidence, "module-download.json"), '{"Path":"partial.example"}\n');
  assert.equal(read(evidence, "module-verify.txt"), "all modules verified\n");
  assert.equal(read(evidence, "module-inventory.json"), '{"Path":"github.com/seaweedfs/seaweedfs"}\n');
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["version", "mod download -json all", "mod verify", "list -m -json all"]);
  const exportedRoot = path.join(fixture, "exported-final-material-evidence");
  const exported = exportManagedTextEvidence(evidence, exportedRoot);
  for (const evidencePath of ["preparation/final-material.exit-code", "preparation/final-material.stderr.txt"]) {
    assert.ok(exported.some(({ path: exportedPath }) => exportedPath === evidencePath), evidencePath);
    assert.deepEqual(readFileSync(path.join(exportedRoot, evidencePath)), readFileSync(path.join(evidence, evidencePath)));
  }
});

test("preparation refuses missing, wrong-sized, or hash-mismatched IAM fixture sources", async (t) => {
  const { run } = createFixture(t);
  const cases = [
    ["missing", { AW_OMIT_IAM_SOURCE: 1 }],
    ["wrong-size", { AW_BAD_IAM_SIZE: 1 }],
    ["wrong-hash", { AW_FAIL_IAM_HASH: 1 }],
  ];
  for (const [name, variables] of cases) {
    await t.test(name, () => {
      const { result, evidence, log } = run(`iam-${name}`, variables);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(read(evidence, "preparation.exit-code").trim(), "1");
      assert.equal(read(evidence, "preparation-first-failed-phase.txt").trim(), "iam-fixture-source");
      assert.equal(read(evidence, "preparation/iam-fixture-source.exit-code").trim(), "1");
      assert.equal(read(evidence, "preparation/corrected-material.exit-code").trim(), "125");
      assert.equal(existsSync(path.join(evidence, "iam-public-fixture-source.tsv")), false);
      assert.equal(existsSync(log), false);
    });
  }
});

test("successful preparation accepts padded wc output and retains all phase evidence", (t) => {
  const { run } = createFixture(t);
  const { result, evidence, source, log } = run("success");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(evidence, "preparation.exit-code").trim(), "0");
  assert.equal(read(evidence, "preparation-first-failed-phase.txt").trim(), "NONE");
  for (const phase of ["archive-identity", "source-extract", "original-material", "iam-fixture-source", "corrected-material", "compiler-identity", "module-download", "module-verify", "module-inventory", "final-material"])
    assert.equal(read(evidence, `preparation/${phase}.exit-code`).trim(), "0", phase);
  assert.equal(read(evidence, "iam-public-fixture-source.tsv"), [
    "weed/iamapi/iamapi_authz_test.go\t8153\t1bcd8c6bf19ff9727d5836ba3253c8291710122bb1068cfab8264ef77d2b0285",
    "weed/iamapi/iamapi_management_handlers.go\t68613\t20c370620e0f15f342c90aad57a6b956e67b4ff4f43a7c486d242f9f2aa9e7a2",
    "weed/iamapi/iamapi_handlers.go\t1854\tcb4ee02bb29825df0a27a8bf275f7db73da1d3ecbe415d6c22b02fe843af5966",
    "",
  ].join("\n"));
  assert.equal(read(evidence, "module-download.json"), read(evidence, "preparation/module-download.stdout.txt"));
  assert.equal(read(evidence, "module-verify.txt"), read(evidence, "preparation/module-verify.stdout.txt"));
  assert.equal(read(evidence, "module-inventory.json"), read(evidence, "preparation/module-inventory.stdout.txt"));
  assert.deepEqual(readFileSync(path.join(source, "go.mod")), readFileSync(path.join(materials, "corrected/go.mod")));
  assert.deepEqual(readFileSync(path.join(source, "go.sum")), readFileSync(path.join(materials, "corrected/go.sum")));
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["version", "mod download -json all", "mod verify", "list -m -json all"]);
});
