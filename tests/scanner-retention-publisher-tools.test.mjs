import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SCANNER_RETENTION as P } from "../scripts/scanner/retention-policy.mjs";
import { SCANNER_RETENTION_PUBLISHER_TOOLS as T } from "../scripts/scanner/retention-tool-identity.mjs";
import { TEST_ONLY_publishScannerRetentionCandidate, scannerRetentionPublisherChildEnvironment }
  from "../scripts/scanner/retention-publish.mjs";

function scenario(t, { profile = 0, beforeLogin = {}, beforePush = {}, replaceQualification = false,
  mutateQualificationAfterLogin = false, toolError = false } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "scanner-publisher-tools-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const stage = path.join(work, "stage");
  const qualificationFile = path.join(stage, "scanner-closure/qualification/runner-tools.txt");
  mkdirSync(path.dirname(qualificationFile), { recursive: true });
  // The fixed original member is deliberately distinct from the current host.
  const qualification = Buffer.from([
    "v22.23.4", "gh version 2.103.3 (2026-10-26)", "https://github.com/cli/cli/releases/tag/v2.103.3",
    T.go, T.dockerProfiles[replaceQualification ? 1 : 0].identity, "Docker Compose version v2.38.2", T.buildx, "",
  ].join("\n"));
  writeFileSync(qualificationFile, qualification);
  const archive = path.join(work, "archive.tar"); writeFileSync(archive, "fixture");
  const state = { work, stage, archive, tag: `${P.package}:fixture` };
  const context = { workspace: work, runnerTemp: work, runId: "42", publisher: P.publisher,
    path: process.env.PATH, token: "test-only-token" };
  const options = () => ({ env: scannerRetentionPublisherChildEnvironment(context, path.join(work, "docker-auth"), work) });
  const calls = []; const records = [];
  let round = 0;
  const identity = () => ({ docker: `${T.dockerProfiles[profile].identity}\n`, buildx: `${T.buildx}\n`,
    go: `${T.go}\n`, ...(round === 1 ? beforeLogin : beforePush) });
  const runner = (command, args, opts) => {
    calls.push([command, ...args]);
    assert.equal(opts.env.GOTOOLCHAIN, "local");
    assert.equal(opts.env.GH_TOKEN, undefined);
    assert.equal(opts.env.GITHUB_TOKEN, undefined);
    let stdout = "";
    if (command === "docker" && args[0] === "version") {
      round++;
      if (toolError) return { status: 1, stdout: "", stderr: "daemon unavailable" };
      stdout = identity().docker;
    } else if (command === "docker" && args.join(" ") === "buildx version") stdout = identity().buildx;
    else if (command === "go" && args.join(" ") === "version") stdout = identity().go;
    else if (command === "docker" && args[0] === "login") assert.equal(opts.input, "test-only-token\n");
    else if (command === "docker" && ["image", "container", "volume"].includes(args[0]) && args[1] === "ls") stdout = "";
    else if (command === "docker" && args[0] === "buildx" && args[1] === "create") stdout = "aw-scanner-retention-42\n";
    else if (command === "docker" && args[0] === "buildx" && args[1] === "inspect") {
      stdout = "BuildKit version: v0.28.2\n";
      if (mutateQualificationAfterLogin) writeFileSync(qualificationFile, "substituted");
    } else if (command === "docker" && args[0] === "buildx" && args[1] === "build") {
      assert.ok(args.includes("type=registry,name=" + state.tag + ",push=true"));
    } else if (command === "docker" && args.slice(0, 3).join(" ") === "buildx imagetools inspect") {
      stdout = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: `sha256:${"a".repeat(64)}`, size: 100 },
        layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: `sha256:${"b".repeat(64)}`, size: 1024 }] });
    } else assert.fail(`Unexpected command: ${command} ${args.join(" ")}`);
    return { status: 0, stdout, stderr: "" };
  };
  return { calls, records, qualificationFile, qualification, execute: () =>
    TEST_ONLY_publishScannerRetentionCandidate(state, context, runner, options, (line) => records.push(JSON.parse(line))) };
}

test("publisher validates both complete profiles before login and immediately before push", (t) => {
  for (const profile of [0, 1]) {
    const s = scenario(t, { profile });
    assert.match(s.execute().values.ghcrManifestDigest, /^sha256:[a-f0-9]{64}$/u);
    const index = (prefix) => s.calls.findIndex((call) => call.slice(0, prefix.length).join(" ") === prefix.join(" "));
    const login = index(["docker", "login"]); const push = index(["docker", "buildx", "build"]);
    assert.deepEqual(s.calls.slice(login - 3, login), [["docker", "version", "--format", "{{json .}}"],
      ["docker", "buildx", "version"], ["go", "version"]]);
    assert.deepEqual(s.calls.slice(push - 3, push), s.calls.slice(login - 3, login));
    assert.deepEqual(s.records.map((r) => r.checkpoint), ["before_login", "before_push"]);
    for (const record of s.records) {
      assert.equal(record.profileId, T.dockerProfiles[profile].id);
      assert.equal(record.profileSha256, T.dockerProfiles[profile].sha256);
      assert.equal(record.docker, T.dockerProfiles[profile].identity);
      assert.ok(Buffer.byteLength(JSON.stringify(record)) < 2048);
    }
    assert.deepEqual(readFileSync(s.qualificationFile), s.qualification);
  }
});

test("wrong live tools or substituted qualification refuse before registry authority or builder effects", (t) => {
  for (const options of [
    { beforeLogin: { docker: `${T.dockerProfiles[0].identity}\n\n` } },
    { beforeLogin: { docker: T.dockerProfiles[0].identity.replaceAll("7.0.0-1017-azure", "7.0.0-9999-azure") } },
    { beforeLogin: { buildx: T.buildx.replace("0.38.1", "0.38.2") } },
    { beforeLogin: { go: `${T.go} ` } }, { replaceQualification: true }, { toolError: true },
  ]) {
    const s = scenario(t, options);
    assert.throws(s.execute, /scanner_retention_publish_(?:qualification_tool_identity_invalid|tool_identity_invalid|command_failed)/u);
    assert.equal(s.calls.some((call) => call[1] === "login" || ["create", "build"].includes(call[2])), false);
    assert.deepEqual(s.records, []);
  }
});

test("changed tools or historical evidence after builder bootstrap prevent the OCI push", (t) => {
  for (const options of [
    { beforePush: { docker: `${T.dockerProfiles[1].identity}\n` } },
    { beforePush: { buildx: `${T.buildx}\r\n` } },
    { beforePush: { go: T.go.replace("1.24.13", "1.24.14") } },
    { mutateQualificationAfterLogin: true },
  ]) {
    const s = scenario(t, options);
    assert.throws(s.execute, /scanner_retention_publish_(?:qualification_tool_identity_invalid|tool_identity_(?:invalid|changed))/u);
    assert.equal(s.calls.filter((call) => call[1] === "login").length, 1);
    assert.equal(s.calls.some((call) => call[1] === "buildx" && ["build", "imagetools"].includes(call[2])), false);
    assert.equal(s.records[0].checkpoint, "before_login");
  }
});
