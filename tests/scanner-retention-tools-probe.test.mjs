import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, linkSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exerciseScannerRetentionTools, validateScannerRetentionToolsProbeContext,
  TEST_ONLY_scannerRetentionToolsCommand } from "../scripts/scanner/retention-tools-probe.mjs";
import { SCANNER_RETENTION_PUBLISHER_TOOLS as TOOLS } from "../scripts/scanner/retention-tool-identity.mjs";

const imageId = `sha256:${"a".repeat(64)}`; const containerId = "b".repeat(64);
const baselineImage = `sha256:${"c".repeat(64)}`; const baselineContainer = "d".repeat(64);
const zero = "0001-01-01T00:00:00Z";
const nonce = "1".repeat(32); const name = `aw-scanner-tools-42-1-${nonce}`;
const success = (stdout = "") => ({ status: 0, signal: null, stdout, stderr: "" });
const failed = (stderr) => ({ status: 1, signal: null, stdout: "", stderr });

function fixture(t, settings = {}) {
  const work = mkdtempSync(path.join(os.tmpdir(), "scanner-tools-regression-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const calls = []; const logs = []; let image; let container; let removed = false; let copied = false;
  const env = { PATH: "/usr/bin:/bin", HOME: work, DOCKER_CONFIG: path.join(work, "docker") };
  const commandRunner = async (command, args, options) => {
    calls.push({ command, args });
    assert.equal(options.env, env); assert.equal(options.cwd, work);
    assert.ok(options.timeout > 0 && options.timeout <= 60_000); assert.equal(options.maxBuffer, 1024 * 1024);
    if (command === "go") return success(`${TOOLS.go}\n`);
    assert.equal(command, "docker");
    if (args[0] === "version") return success(`${settings.unknownTools ? "{}" : TOOLS.dockerProfiles[settings.aws ? 1 : 0].identity}\n`);
    if (args[0] === "buildx" && args[1] === "version") return success(`${TOOLS.buildx}\n`);
    if (args[0] === "buildx" && args[1] === "inspect") {
      assert.deepEqual(args, ["buildx", "inspect", "default"]);
      return success(`Name:          default\nDriver:        ${settings.driver ?? "docker"}\n\nNodes:\nName: default\nEndpoint: default\n`);
    }
    if (args[1] === "ls") {
      assert.deepEqual(args.slice(1), ["ls", "--all", "--quiet", "--no-trunc"]);
      const rows = args[0] === "image" ? [baselineImage, ...(image ? [image.Id] : [])]
        : [baselineContainer, ...(container ? [container.Id] : [])];
      return success(`${rows.join("\n")}\n`);
    }
    if (args[1] === "inspect") {
      const [kind, , identity] = args;
      if (settings.uncertainAbsence && !image) return failed("Cannot connect to the Docker daemon\n");
      if (settings.uncertainAfterRemove && removed) return failed("Permission denied\n");
      if (settings.collision === kind && !image && !container) return success(JSON.stringify({ Id: "foreign" }));
      const object = kind === "image" ? image : container;
      if (object) {
        const current = JSON.parse(JSON.stringify(object));
        if (kind === "image") {
          settings.mutateImage?.(current);
          if (copied && settings.imageChangesBeforeCleanup) current.Config.Labels = {};
        } else {
          settings.mutateContainer?.(current);
          if (copied && settings.containerChangesBeforeCleanup) current.Config.Labels = {};
        }
        return success(`${JSON.stringify(current)}\n`);
      }
      return { ...failed(`Error response from daemon: No such ${kind}: ${identity}\n`),
        stdout: settings.absenceStdout ?? "\n" };
    }
    if (args[0] === "buildx" && args[1] === "build") {
      assert.equal(args[args.indexOf("--builder") + 1], "default");
      for (const flag of ["--pull=false", "--no-cache", "--provenance=false", "--sbom=false", "--load"]) assert.ok(args.includes(flag));
      assert.equal(args[args.indexOf("--network") + 1], "none");
      assert.ok(!args.includes("--push"));
      const context = args.at(-1);
      assert.equal(readFileSync(path.join(context, "Dockerfile"), "utf8"), "FROM scratch\nCOPY proof.txt /proof.txt\n");
      const [key, value] = args[args.indexOf("--label") + 1].split("=");
      image = { Id: imageId, Os: "linux", Architecture: "amd64", Size: 1024,
        RepoTags: [args[args.indexOf("--tag") + 1]], Config: { Labels: { [key]: value } } };
      if (settings.buildFails) return failed("Build failed after local load\n");
      writeFileSync(args[args.indexOf("--iidfile") + 1], `${settings.badIid ? baselineImage : imageId}\n`);
      return success();
    }
    if (args[0] === "create") {
      assert.equal(args.at(-2), imageId); assert.equal(args.at(-1), "/proof-never-executed");
      assert.equal(args[args.indexOf("--pull") + 1], "never");
      container = { Id: containerId, Name: `/${name}`, Image: imageId,
        Config: { Image: imageId, Cmd: ["/proof-never-executed"], Labels: { ...image.Config.Labels } },
        HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"] },
        State: { Status: "created", Running: false, Paused: false, Restarting: false, OOMKilled: false,
          Dead: false, Pid: 0, ExitCode: 0, Error: "", StartedAt: zero, FinishedAt: zero } };
      if (settings.createFails) return { ...failed("Interrupted after creation\n"),
        ...(settings.timeout ? { error: new Error("ETIMEDOUT") } : {}) };
      return success(`${settings.badCid ? baselineContainer : containerId}\n`);
    }
    if (args[0] === "cp") {
      assert.equal(args[1], `${containerId}:/proof.txt`);
      copied = true;
      const original = path.join(work, "context", "proof.txt");
      if (settings.copyHardlink) linkSync(original, args[2]);
      else if (settings.copySymlink) symlinkSync(original, args[2]);
      else writeFileSync(args[2], settings.badCopy ? "different bytes\n" : readFileSync(original));
      return success();
    }
    if (args[1] === "rm") {
      assert.equal(args.length, 3);
      if (settings.cleanupFails) return failed("Removal refused\n");
      if (args[0] === "container") { assert.equal(args[2], containerId); container = undefined; }
      else { assert.equal(args[0], "image"); assert.equal(args[2], imageId);
        if (container) return failed("Image is in use\n"); image = undefined; }
      removed = true;
      return success();
    }
    assert.fail(`Unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, logs, remaining: () => ({ image, container }),
    run: () => exerciseScannerRetentionTools({ work, env, runId: "42", runAttempt: "1", nonce,
      commandRunner, log: (entry) => logs.push(JSON.parse(entry)) }) };
}

for (const aws of [false, true]) test(`native probe builds, copies and cleans up allocated ${aws ? "AWS" : "Azure"} profile`, async (t) => {
  const f = fixture(t, { aws }); const result = await f.run();
  assert.equal(result.result, "PASSED"); assert.equal(result.stoppedNeverStarted, true);
  assert.equal(result.profileId, TOOLS.dockerProfiles[aws ? 1 : 0].id);
  assert.deepEqual(f.remaining(), { image: undefined, container: undefined });
  assert.equal(f.logs.at(-1).inventoriesRestored, true);
  assert.ok(!f.calls.some(({ args }) => args.includes("login") || args.includes("push") || args.includes("start")
    || args.includes("prune") || (args[0] === "buildx" && ["create", "rm"].includes(args[1]))));
});

for (const [settings, reason] of [
  [{ unknownTools: true }, "scanner_retention_publish_tool_identity_invalid"],
  [{ driver: "docker-container" }, "default_driver_invalid"],
  [{ collision: "image" }, "name_collision"],
  [{ collision: "container" }, "name_collision"],
  [{ uncertainAbsence: true }, "absence_uncertain"],
  [{ absenceStdout: "" }, "absence_uncertain"],
  [{ absenceStdout: " \n" }, "absence_uncertain"],
  [{ absenceStdout: "[]\n" }, "absence_uncertain"],
]) test(`probe refuses before build: ${JSON.stringify(settings)}`, async (t) => {
  const f = fixture(t, settings);
  await assert.rejects(f.run(), new RegExp(reason, "u"));
  assert.ok(!f.calls.some(({ args }) => args[0] === "buildx" && args[1] === "build"));
  assert.ok(!f.calls.some(({ args }) => args.includes("rm")));
});

for (const [description, settings, reason] of [
  ["wrong immutable build ID", { badIid: true }, "image_identity_invalid"],
  ["wrong returned container ID", { badCid: true }, "container_identity_invalid"],
  ["changed image label", { mutateImage: (image) => { image.Config.Labels = {}; } }, "image_identity_invalid"],
  ["changed image platform", { mutateImage: (image) => { image.Architecture = "arm64"; } }, "image_identity_invalid"],
  ["oversized image", { mutateImage: (image) => { image.Size = 1024 * 1024 + 1; } }, "image_identity_invalid"],
  ["changed container label", { mutateContainer: (container) => { container.Config.Labels = {}; } }, "container_identity_invalid"],
  ["different container image", { mutateContainer: (container) => { container.Image = baselineImage; } }, "container_identity_invalid"],
  ["previously started container", { mutateContainer: (container) => { container.State.StartedAt = "2026-11-16T00:00:00Z"; } }, "container_started"],
  ["wrong copied bytes", { badCopy: true }, "copied_bytes_invalid"],
  ["hardlinked copy", { copyHardlink: true }, "file_invalid"],
  ["symlinked copy", { copySymlink: true }, "file_invalid"],
  ["cleanup command failure", { cleanupFails: true }, "command_failed"],
  ["unknown absence after remove", { uncertainAfterRemove: true }, "absence_uncertain"],
]) test(`probe rejects ${description}`, async (t) => {
  const f = fixture(t, settings); await assert.rejects(f.run(), new RegExp(reason, "u"));
  assert.ok(!f.logs.some((entry) => entry.result === "PASSED"));
  if (description.includes("changed") || description.includes("different container")) {
    assert.ok(!f.calls.some(({ args }) => args[1] === "rm" && args[0] === (settings.mutateImage ? "image" : "container")));
  }
});

for (const settings of [{ buildFails: true }, { createFails: true }, { createFails: true, timeout: true }]) {
  test(`failed creation recovers only the owned object and keeps original failure: ${JSON.stringify(settings)}`, async (t) => {
    const f = fixture(t, settings); await assert.rejects(f.run(), /command_failed/u);
    assert.deepEqual(f.remaining(), { image: undefined, container: undefined });
    assert.ok(!f.logs.some((entry) => entry.result === "PASSED"));
  });
}

for (const kind of ["image", "container"]) test(`cleanup refuses replaced ${kind} ownership`, async (t) => {
  const f = fixture(t, { [`${kind}ChangesBeforeCleanup`]: true });
  await assert.rejects(f.run(), new RegExp(`${kind}_identity_invalid`, "u"));
  assert.ok(!f.calls.some(({ args }) => args[0] === kind && args[1] === "rm"));
  assert.ok(!f.logs.some((entry) => entry.result === "PASSED"));
});

test("probe preserves original copy failure when cleanup also fails", async (t) => {
  const f = fixture(t, { badCopy: true, cleanupFails: true });
  await assert.rejects(f.run(), /copied_bytes_invalid/u);
  assert.equal(f.logs.at(-1).phase, "cleanup"); assert.equal(f.logs.at(-1).result, "FAILED");
});

test("native CLI context refuses non-hosted, wrong-platform and malformed identities", () => {
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", RUNNER_TEMP: "/home/runner/work/_temp",
    GITHUB_WORKSPACE: "/home/runner/work/auto-world/auto-world", GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", PATH: "/usr/bin:/bin" };
  assert.equal(validateScannerRetentionToolsProbeContext(env, "linux", "22.23.4").runnerTemp, env.RUNNER_TEMP);
  for (const mutation of [{ GITHUB_ACTIONS: "false" }, { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_REPOSITORY: "foreign/repo" }, { RUNNER_TEMP: "/tmp" }, { GITHUB_RUN_ID: "42\n" },
    { GITHUB_RUN_ATTEMPT: "0" }, { PATH: "/bin\n" }]) {
    assert.throws(() => validateScannerRetentionToolsProbeContext({ ...env, ...mutation }, "linux", "22.23.4"), /context_invalid/u);
  }
  assert.throws(() => validateScannerRetentionToolsProbeContext(env, "win32", "22.23.4"), /context_invalid/u);
  assert.throws(() => validateScannerRetentionToolsProbeContext(env, "linux", "22.23.2"), /context_invalid/u);
});

test("bounded native runner kills timeout, excess output and surviving process groups", { skip: process.platform !== "linux" }, async () => {
  const options = { cwd: process.cwd(), env: { PATH: "/usr/bin:/bin" }, timeout: 1000 };
  const normal = await TEST_ONLY_scannerRetentionToolsCommand(process.execPath, ["-e", "process.stdout.write('ok')"], options);
  assert.equal(normal.status, 0); assert.equal(normal.error, undefined); assert.equal(normal.stdout, "ok");
  for (const [script, reason] of [
    ["setInterval(() => {}, 1000)", "command_timeout"],
    ["process.stdout.write('a'.repeat(2*1024*1024));setInterval(() => {},1000)", "command_output_limit"],
    ["require('node:child_process').spawn(process.execPath,['-e','setInterval(() => {},1000)'],{stdio:'ignore'});process.exit(0)", "surviving_child"],
  ]) {
    const result = await TEST_ONLY_scannerRetentionToolsCommand(process.execPath, ["-e", script], options);
    assert.match(result.error?.message ?? "", new RegExp(reason, "u"));
  }
});
