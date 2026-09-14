import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BOOTSTRAP,
  assertPayloadIntegrity,
  parseArguments,
  parseBuildKitVersions,
  prepareBootstrap,
  sha256,
  validateImageMetadata,
  validateLocalImageId,
  validateOutputPath,
  validatePreparationContext,
} from "../scripts/package-bootstrap/prepare.mjs";

const sourceSha = "a".repeat(40);
const baseEnvironment = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REF: "refs/pull/17/merge",
  GITHUB_REPOSITORY: "CleMeY15/auto-world",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "123456789",
  GITHUB_SHA: sourceSha,
  RUNNER_OS: "Linux",
  RUNNER_TEMP: "/home/runner/work/_temp",
};

test("bootstrap recipe and public proof bytes are exact and dependency-free", () => {
  assert.equal(BOOTSTRAP.payload, "auto-world-private-package-boundary-v1\n");
  assert.equal(BOOTSTRAP.dockerfile, [
    "FROM scratch",
    "COPY proof.txt /proof.txt",
    'LABEL org.opencontainers.image.source="https://github.com/CleMeY15/auto-world"',
    "",
  ].join("\n"));
  assert.equal(Buffer.byteLength(BOOTSTRAP.payload) <= 1024, true);
  assert.doesNotMatch(BOOTSTRAP.dockerfile, /\b(?:RUN|ADD|ENTRYPOINT)\b/u);
  assert.equal(sha256(Buffer.from(BOOTSTRAP.payload)), "d5e5e59eda3174b385ac04154621244178be55d1a7f69f6cc6f6dd1fda43355d");
});

test("Actions context accepts PR diagnostics and main push/manual only", () => {
  assert.equal(validatePreparationContext(baseEnvironment, "linux").sourceSha, sourceSha);
  for (const eventName of ["push", "workflow_dispatch"]) {
    assert.equal(validatePreparationContext({ ...baseEnvironment, GITHUB_EVENT_NAME: eventName, GITHUB_REF: "refs/heads/main" }, "linux").eventName, eventName);
  }
  const invalidContexts = [
    [{ ...baseEnvironment, GITHUB_REPOSITORY: "other/auto-world" }, "linux"],
    [{ ...baseEnvironment, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature" }, "linux"],
    [{ ...baseEnvironment, GITHUB_EVENT_NAME: "pull_request_target" }, "linux"],
    [{ ...baseEnvironment, GITHUB_RUN_ATTEMPT: "2" }, "linux"],
    [{ ...baseEnvironment, GITHUB_SHA: "not-a-sha" }, "linux"],
    [{ ...baseEnvironment, GITHUB_ACTIONS: "false" }, "linux"],
    [baseEnvironment, "win32"],
  ];
  for (const [environment, platform] of invalidContexts) {
    assert.throws(() => validatePreparationContext(environment, platform), /package_bootstrap_/u);
  }
});

test("output path is one fresh, non-symlinked owned directory under RUNNER_TEMP", (context) => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-package-output-"));
  context.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const output = path.join(runnerTemp, "package-bootstrap");
  assert.equal(validateOutputPath(output, runnerTemp), output);
  assert.throws(() => validateOutputPath(runnerTemp, runnerTemp), /package_bootstrap_output_path_invalid/u);
  assert.throws(() => validateOutputPath(path.join(runnerTemp, "nested", "package-bootstrap"), runnerTemp), /package_bootstrap_output_path_invalid/u);
  assert.throws(() => validateOutputPath(path.join(path.dirname(runnerTemp), "package-bootstrap"), runnerTemp), /package_bootstrap_output_path_invalid/u);
  mkdirSync(output);
  assert.throws(() => validateOutputPath(output, runnerTemp), /package_bootstrap_owned_path_exists/u);
  rmSync(output, { recursive: true });
  const symlink = `${runnerTemp}-link`;
  try {
    symlinkSync(runnerTemp, symlink, "junction");
    assert.throws(() => validateOutputPath(path.join(symlink, "package-bootstrap"), symlink), /package_bootstrap_runner_temp_invalid/u);
  } finally {
    rmSync(symlink, { force: true });
  }
});

test("image metadata binds local config identity, platform, size, and public source", () => {
  const id = `sha256:${"b".repeat(64)}`;
  const metadata = {
    Id: id,
    Os: "linux",
    Architecture: "amd64",
    Size: 4096,
    Config: { Labels: { "org.opencontainers.image.source": BOOTSTRAP.sourceUrl } },
  };
  assert.deepEqual(validateImageMetadata(metadata), {
    architecture: "amd64",
    localImageIdentity: { type: "DOCKER_CONFIG_ID", value: id },
    os: "linux",
    size: 4096,
    source: BOOTSTRAP.sourceUrl,
  });
  assert.equal("registryManifestDigest" in validateImageMetadata(metadata), false);
  assert.throws(() => validateImageMetadata({ ...metadata, Architecture: "arm64" }), /package_bootstrap_image_platform_invalid/u);
  assert.throws(() => validateImageMetadata({ ...metadata, Os: "windows" }), /package_bootstrap_image_platform_invalid/u);
  assert.throws(() => validateImageMetadata({ ...metadata, Size: BOOTSTRAP.imageSizeLimit + 1 }), /package_bootstrap_image_size_invalid/u);
  assert.throws(() => validateImageMetadata({ ...metadata, Config: { Labels: { "org.opencontainers.image.source": "https://example.test/repo" } } }), /package_bootstrap_image_source_invalid/u);
});

test("local Docker config IDs cannot be confused with registry identities", () => {
  const id = `sha256:${"c".repeat(64)}`;
  assert.deepEqual(validateLocalImageId(id), { type: "DOCKER_CONFIG_ID", value: id });
  for (const invalid of ["c".repeat(64), `CleMeY15/auto-world@${id}`, `sha256:${"C".repeat(64)}`, "sha256:short"]) {
    assert.throws(() => validateLocalImageId(invalid), /package_bootstrap_local_image_id_invalid/u);
  }
});

test("BuildKit identity parser requires actual per-node backend versions", () => {
  assert.deepEqual(parseBuildKitVersions("Name: default\nNodes:\n  BuildKit: v0.17.3\n  BuildKit: v0.16.0-rc1\n"), ["v0.17.3", "v0.16.0-rc1"]);
  assert.throws(() => parseBuildKitVersions("github.com/docker/buildx v0.19.3\n"), /package_bootstrap_buildkit_identity_invalid/u);
  assert.throws(() => parseBuildKitVersions("BuildKit: unknown\n"), /package_bootstrap_buildkit_identity_invalid/u);
});

test("copied proof verification rejects changed, oversized, and non-buffer payloads", () => {
  const expected = Buffer.from(BOOTSTRAP.payload);
  assert.deepEqual(assertPayloadIntegrity(expected), { sha256: sha256(expected), size: expected.length });
  assert.throws(() => assertPayloadIntegrity(Buffer.from("changed\n")), /package_bootstrap_payload_integrity_failed/u);
  assert.throws(() => assertPayloadIntegrity(Buffer.alloc(1025)), /package_bootstrap_payload_integrity_failed/u);
  assert.throws(() => assertPayloadIntegrity(BOOTSTRAP.payload), /package_bootstrap_payload_integrity_failed/u);
});

test("CLI arguments require exactly one absolute output", () => {
  const output = path.resolve("package-bootstrap");
  assert.deepEqual(parseArguments(["--output", output]), { output });
  for (const argv of [[], ["--output"], ["--output", "relative"], ["--other", output], ["--output", output, "extra"]]) {
    assert.throws(() => parseArguments(argv), /package_bootstrap_arguments_invalid/u);
  }
});

test("preparation emits a bounded local-only receipt and uses a stopped container", (context) => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-package-run-"));
  context.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const output = path.join(runnerTemp, "package-bootstrap");
  const calls = [];
  const localId = `sha256:${"d".repeat(64)}`;
  const commandRunner = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "version") return { status: 0, stdout: "27.5.1|27.5.1\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.19.3\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "inspect") return { status: 0, stdout: "Name: default\n  BuildKit: v0.17.3\n", stderr: "" };
    if (args[0] === "image" && args[1] === "inspect" && args[2]?.startsWith("auto-world-bootstrap")) return { status: 1, stdout: "", stderr: "missing" };
    if (args[0] === "container" && args[1] === "inspect") return { status: 1, stdout: "", stderr: "missing" };
    if (args[0] === "image" && args[1] === "inspect" && args[2] === "--format") {
      return { status: 0, stdout: JSON.stringify({ Id: localId, Os: "linux", Architecture: "amd64", Size: 4096,
        Config: { Labels: { "org.opencontainers.image.source": BOOTSTRAP.sourceUrl } } }), stderr: "" };
    }
    if (args[0] === "cp") {
      writeFileSync(args[2], BOOTSTRAP.payload);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const receipt = prepareBootstrap({
    argv: ["--output", output],
    commandRunner,
    env: { ...baseEnvironment, RUNNER_TEMP: runnerTemp },
    platform: "linux",
  });
  assert.equal(receipt.state, "LOCAL_PREPARATION_ONLY");
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.publication, "NOT_ATTEMPTED");
  assert.equal(receipt.packageConfiguration, "NOT_VERIFIED");
  assert.equal(receipt.forkAccessTest, "SKIPPED_BY_USER");
  assert.equal(receipt.forkIsolation, "NOT_VERIFIED");
  assert.deepEqual(receipt.image.localImageIdentity, { type: "DOCKER_CONFIG_ID", value: localId });
  assert.deepEqual(receipt.tools.buildKitBackendVersions, ["v0.17.3"]);
  assert.equal(existsSync(path.join(output, "receipt.json")), true);
  assert.equal(existsSync(path.join(runnerTemp, `aw-package-bootstrap-${baseEnvironment.GITHUB_RUN_ID}-attempt-1`)), false);
  assert.equal(readFileSync(path.join(output, "proof.txt"), "utf8"), BOOTSTRAP.payload);
  assert.equal(calls.some((call) => call[1] === "run" || call[1] === "start" || call[1] === "push" || call[1] === "login"), false);
  const create = calls.find((call) => call[1] === "create");
  assert.deepEqual(create?.slice(2, 5), ["--name", `aw-package-bootstrap-${baseEnvironment.GITHUB_RUN_ID}`, "--pull=never"]);
});

function failureRunner({ calls, copiedPayload = BOOTSTRAP.payload, failBuild = false }) {
  const localId = `sha256:${"e".repeat(64)}`;
  return (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "version") return { status: 0, stdout: "27.5.1|27.5.1\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.19.3\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "build" && failBuild) {
      return { status: null, stdout: "", stderr: "credential=SECRET_VALUE", error: new Error("SECRET_VALUE") };
    }
    if (args[0] === "buildx" && args[1] === "inspect") return { status: 0, stdout: "  BuildKit: v0.17.3\n", stderr: "" };
    if (args[0] === "image" && args[1] === "inspect" && args[2]?.startsWith("auto-world-bootstrap")) return { status: 1, stdout: "", stderr: "missing" };
    if (args[0] === "container" && args[1] === "inspect") return { status: 1, stdout: "", stderr: "missing" };
    if (args[0] === "image" && args[1] === "inspect" && args[2] === "--format") {
      return { status: 0, stdout: JSON.stringify({ Id: localId, Os: "linux", Architecture: "amd64", Size: 4096,
        Config: { Labels: { "org.opencontainers.image.source": BOOTSTRAP.sourceUrl } } }), stderr: "" };
    }
    if (args[0] === "cp") {
      writeFileSync(args[2], copiedPayload);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

test("changed container bytes fail closed, retain a FAILED receipt, and clean Docker objects", (context) => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-package-changed-"));
  context.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const output = path.join(runnerTemp, "package-bootstrap");
  const calls = [];
  assert.throws(() => prepareBootstrap({
    argv: ["--output", output],
    commandRunner: failureRunner({ calls, copiedPayload: "changed\n" }),
    env: { ...baseEnvironment, RUNNER_TEMP: runnerTemp, GITHUB_RUN_ID: "223456789" },
    platform: "linux",
  }), /package_bootstrap_payload_integrity_failed/u);
  const receipt = JSON.parse(readFileSync(path.join(output, "receipt.json"), "utf8"));
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.phases.find((phase) => phase.name === "stopped_container_copy")?.reason, "package_bootstrap_payload_integrity_failed");
  assert.equal(receipt.phases.at(-1).name, "cleanup");
  assert.equal(receipt.phases.at(-1).result, "PASSED");
  assert.equal(calls.some((call) => call[1] === "rm"), true);
  assert.equal(calls.some((call) => call[1] === "image" && call[2] === "rm"), true);
});

test("command failures expose only fixed diagnostics and still retain a receipt", (context) => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-package-command-"));
  context.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const output = path.join(runnerTemp, "package-bootstrap");
  const calls = [];
  assert.throws(() => prepareBootstrap({
    argv: ["--output", output],
    commandRunner: failureRunner({ calls, failBuild: true }),
    env: { ...baseEnvironment, RUNNER_TEMP: runnerTemp, GITHUB_RUN_ID: "323456789" },
    platform: "linux",
  }), /^Error: package_bootstrap_command_failed$/u);
  const rawReceipt = readFileSync(path.join(output, "receipt.json"), "utf8");
  const receipt = JSON.parse(rawReceipt);
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.phases.find((phase) => phase.name === "image_build")?.reason, "package_bootstrap_command_failed");
  assert.doesNotMatch(rawReceipt, /SECRET_VALUE/u);
  assert.equal(receipt.phases.at(-1).result, "PASSED");
});
