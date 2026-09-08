import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertTrivyUnitTempPath, runTrivyUnitTests, summarizeTrivyUnitCapture, trivyTestInventory, trivyUnitArguments } from "../scripts/supply-chain/native-build.mjs";
import { createOwnedDirectory, removeOwnedDirectory, runCommand } from "../scripts/supply-chain/process.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

const source = Buffer.from('package demo\nimport "testing"\nfunc TestTiny(t *testing.T) {}\nfunc TestOther(t *testing.T) {}\n');
const inventory = () => trivyTestInventory([{ path: "pkg/demo/demo_test.go", bytes: source }]);
const capture = (output, exit = 1) => Buffer.from(`${output}\nAUTOWORLD_TRIVY_UNIT_EXIT=${exit}\n`);

test("Trivy's owned temporary path fits the pinned Podman Unix socket on every random suffix", async () => {
  const oldRoot = "/home/runner/work/_temp/auto-world-native-build-trivy-2/tmp";
  const currentRoot = "/home/runner/work/_temp/aw-build-trivy-2/tmp";
  assert.equal(Buffer.byteLength(oldRoot), 59);
  assert.equal(Buffer.byteLength(currentRoot), 44);
  assert.throws(() => assertTrivyUnitTempPath(oldRoot), /trivy_unit_temp_path_too_long_or_invalid/u);
  assert.doesNotThrow(() => assertTrivyUnitTempPath(currentRoot));
  // Go 1.26 t.TempDir: test name + decimal uint32 + /001, then Podman's suffix.
  const socket = `${currentRoot}/TestPodmanImage4294967295/001/podman/podman.sock`;
  assert.equal(Buffer.byteLength(socket), 93);
  assert.doesNotThrow(() => assertTrivyUnitTempPath(`/${"a".repeat(57)}`));
  assert.throws(() => assertTrivyUnitTempPath(`/${"a".repeat(58)}`));
  assert.doesNotThrow(() => assertTrivyUnitTempPath(`/a${"é".repeat(28)}`));
  assert.throws(() => assertTrivyUnitTempPath(`/${"é".repeat(29)}`));
  for (const invalid of [undefined, "", "relative", "/nul\0"]) assert.throws(() => assertTrivyUnitTempPath(invalid));
  // Refuse the known bad path before Git, Bash, source or compiler execution.
  await assert.rejects(() => runTrivyUnitTests("/missing-go", "/missing-source", { TMPDIR: oldRoot }, 1),
    /trivy_unit_temp_path_too_long_or_invalid/u);
});

test("Trivy diagnostic passes the unchanged unit command only through quoted positional arguments", () => {
  const executable = path.resolve("go ' $(not-a-command)");
  const args = trivyUnitArguments(executable);
  assert.deepEqual(args.slice(0, 3), ["--noprofile", "--norc", "-c"]);
  assert.equal(args[3], '"$@" 2>&1; code=$?; printf "\\nAUTOWORLD_TRIVY_UNIT_EXIT=%s\\n" "$code"');
  assert.deepEqual(args.slice(4), ["--", executable, "tool", "mage", "test:unit"]);
  assert.throws(() => trivyUnitArguments("relative-go"));
  assert.throws(() => trivyUnitArguments(`${executable}\0`));
});

test("Trivy diagnostics retain only source-listed parent tests, packages and fixed classifications", () => {
  const output = ["PRIVATE_SENTINEL=not-public", "AUTOWORLD_TRIVY_UNIT_EXIT=0",
    "--- FAIL: TestTiny/subcase=secret-token (0.01s)", "--- FAIL: TestTiny (0.02s)",
    "--- FAIL: TestInjected (0.01s)", "FAIL\tgithub.com/aquasecurity/trivy/pkg/demo\t0.03s",
    "FAIL\tgithub.com/aquasecurity/trivy/not-in-source\t0.03s", "Error Trace: /private/home/secret", "no such file or directory"].join("\n");
  const value = summarizeTrivyUnitCapture(capture(output, 17), Buffer.alloc(0), inventory());
  assert.equal(value.exitCode, 17);
  assert.equal(value.state, "diagnostic_only");
  assert.deepEqual(value.failedTests, ["TestTiny"]);
  assert.deepEqual(value.failedPackages, ["github.com/aquasecurity/trivy/pkg/demo"]);
  assert.deepEqual(value.classes, ["assertion_failure", "missing_fixture"]);
  assert.equal(value.unknownFailures, 2);
  assert.deepEqual(value.output, { sha256: sha256(Buffer.from(output)), size: Buffer.byteLength(output) });
  for (const secret of ["PRIVATE_SENTINEL", "secret-token", "/private/home", "TestInjected", "not-in-source"]) {
    assert.equal(canonicalJsonBuffer(value).includes(Buffer.from(secret)), false);
  }
});

test("Trivy capture refuses absent, malformed, nonterminal markers and wrapper stderr", () => {
  for (const bytes of [Buffer.from("FAIL"), capture("", 256), Buffer.from("\nAUTOWORLD_TRIVY_UNIT_EXIT=-1\n"),
    Buffer.concat([capture("", 1), Buffer.from("untrusted suffix")])]) {
    assert.throws(() => summarizeTrivyUnitCapture(bytes, Buffer.alloc(0), inventory()));
  }
  assert.throws(() => summarizeTrivyUnitCapture(capture("", 0), Buffer.from("wrapper failed"), inventory()));
  assert.deepEqual(summarizeTrivyUnitCapture(capture("ok", 0), Buffer.alloc(0), inventory()).classes, []);
  assert.deepEqual(summarizeTrivyUnitCapture(capture("unknown cause", 1), Buffer.alloc(0), inventory()).classes, ["unclassified_failure"]);
});

test("Trivy test inventory rejects traversal, duplicates and non-test sources", () => {
  for (const files of [[], [{ path: "../demo_test.go", bytes: source }], [{ path: "demo.go", bytes: source }],
    [{ path: "demo_test.go", bytes: source }, { path: "demo_test.go", bytes: source }],
    [{ path: "demo_test.go", bytes: Buffer.from("package demo") }]]) assert.throws(() => trivyTestInventory(files));
  const a = { path: "pkg/a/a_test.go", bytes: source };
  const b = { path: "pkg/b/b_test.go", bytes: source };
  assert.deepEqual(trivyTestInventory([a, b]), trivyTestInventory([b, a]));
});

test("Trivy diagnostics cap identities explicitly instead of publishing unbounded failure data", () => {
  const names = Array.from({ length: 140 }, (_, index) => `TestCase${index}`);
  const inputs = trivyTestInventory([{ path: "pkg/demo/demo_test.go", bytes: Buffer.from(names.map((name) => `func ${name}(t *testing.T) {}`).join("\n")) }]);
  const value = summarizeTrivyUnitCapture(capture(names.map((name) => `--- FAIL: ${name} (0.01s)`).join("\n")), Buffer.alloc(0), inputs);
  assert.equal(value.failedTests.length, 128);
  assert.equal(value.omittedIdentities, 12);
  assert.ok(canonicalJsonBuffer(value).length < 64 * 1024);
  const directories = Array.from({ length: 70 }, (_, index) => `pkg/${"a".repeat(240)}/${"b".repeat(230)}${index}`);
  const packageInventory = trivyTestInventory(directories.map((directory) => ({ path: `${directory}/demo_test.go`, bytes: source })));
  const packages = summarizeTrivyUnitCapture(capture(directories.map((directory) => `FAIL\tgithub.com/aquasecurity/trivy/${directory}\t0.01s`).join("\n")), Buffer.alloc(0), packageInventory);
  assert.equal(packages.failedPackages.length, 64);
  assert.equal(packages.omittedIdentities, 6);
  assert.ok(canonicalJsonBuffer(packages).length < 64 * 1024);
});

test("Linux wrapper reports a real failing process before rejecting and never emits raw test output", { skip: process.platform !== "linux" }, async () => {
  const owned = await createOwnedDirectory();
  const env = { PATH: "/usr/bin:/bin", HOME: owned.path, TMPDIR: owned.path, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GOFLAGS: "-mod=readonly" };
  const originalWrite = process.stdout.write;
  const emitted = [];
  try {
    await mkdir(path.join(owned.path, "pkg/demo"), { recursive: true });
    await writeFile(path.join(owned.path, "pkg/demo/demo_test.go"), source);
    await runCommand("/usr/bin/git", ["init", "--quiet"], { cwd: owned.path, env });
    await runCommand("/usr/bin/git", ["add", "--", "pkg/demo/demo_test.go"], { cwd: owned.path, env });
    const fakeGo = path.join(owned.path, "fake-go ' $(no-expansion)");
    await writeFile(fakeGo, '#!/bin/sh\n[ "$#" = 3 ] && [ "$1" = tool ] && [ "$2" = mage ] && [ "$3" = test:unit ] || exit 99\n[ "$CGO_ENABLED" = 0 ] && [ "$GOEXPERIMENT" = jsonv2 ] && [ "$GOFLAGS" = -mod=readonly ] || exit 98\nprintf "%s\\n" "PRIVATE_SENTINEL" "AUTOWORLD_TRIVY_UNIT_EXIT=0" "--- FAIL: TestTiny/private-case (0.01s)"\nprintf "%s\\n" "RAW_STDERR_SENTINEL" >&2\nexit 17\n');
    await chmod(fakeGo, 0o700);
    process.stdout.write = (chunk) => { emitted.push(Buffer.from(chunk)); return true; };
    await assert.rejects(() => runTrivyUnitTests(fakeGo, owned.path, env, 5000), /trivy_upstream_tests_failed/u);
    process.stdout.write = originalWrite;
    assert.equal(emitted.length, 1);
    const bytes = Buffer.concat(emitted);
    for (const sentinel of ["PRIVATE_SENTINEL", "RAW_STDERR_SENTINEL", "private-case"]) assert.equal(bytes.includes(Buffer.from(sentinel)), false);
    const event = JSON.parse(bytes.toString("utf8"));
    assert.equal(event.phase, "trivy_upstream_diagnostic");
    assert.equal(event.receipt.exitCode, 17);
    assert.deepEqual(event.receipt.failedTests, ["TestTiny"]);
    assert.equal(event.sha256, sha256(canonicalJsonBuffer(event.receipt)));
  } finally {
    process.stdout.write = originalWrite;
    await removeOwnedDirectory(owned);
  }
});
