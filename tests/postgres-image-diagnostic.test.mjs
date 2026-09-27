import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { cleanupOwnedResource, containerProfileInspectArguments, dockerBuildArguments, ephemeralContainerArguments,
  parseDiagnosticArguments, postgresContainerArguments,
  runPostgresDiagnostic, validateCommandResult, validateDiagnosticLock, validateMaterialBytes }
  from "../scripts/postgres-image/diagnostic.mjs";

const dockerfile = readFileSync(new URL("../infra/postgres-image/Dockerfile", import.meta.url));
const lock = JSON.parse(readFileSync(new URL("../infra/postgres-image/lock.json", import.meta.url), "utf8"));
const nonce = "a".repeat(24);
const clone = (value) => globalThis.structuredClone(value);
const result = (status, stdout = "", stderr = "") => ({ status, signal: null, error: undefined,
  stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });

test("the lock binds the exact base, signed Alpine materials, executable and recipe", () => {
  assert.deepEqual(validateDiagnosticLock(lock, dockerfile), lock);
  for (const mutate of [
    (value) => { value.base.platformDigest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.base.configId = `sha256:${"0".repeat(64)}`; },
    (value) => { value.apk.sha256 = "0".repeat(64); },
    (value) => { value.apk.index.sha256 = "0".repeat(64); },
    (value) => { value.apk.expectedKeys[0].sha256 = "0".repeat(64); },
    (value) => { value.apk.executable.goVersion = "go1.24.6"; },
    (value) => { value.docker.serverVersion = "28.0.5"; },
  ]) {
    const changed = clone(lock); mutate(changed);
    assert.throws(() => validateDiagnosticLock(changed, dockerfile), /postgres_diagnostic_lock_invalid/u);
  }
  assert.throws(() => validateDiagnosticLock(lock, Buffer.concat([dockerfile, Buffer.from("\n")])),
    /postgres_diagnostic_lock_invalid/u);
});

test("committed APK and index bytes reject any size or digest substitution", () => {
  for (const material of [lock.apk, lock.apk.index]) {
    const bytes = readFileSync(new URL(`../${material.sourcePath}`, import.meta.url));
    assert.deepEqual(validateMaterialBytes(bytes, material), { bytes: material.size, sha256: material.sha256 });
    const changed = Buffer.from(bytes); changed[Math.floor(changed.length / 2)] ^= 1;
    assert.throws(() => validateMaterialBytes(changed, material), /postgres_diagnostic_material_invalid/u);
    assert.throws(() => validateMaterialBytes(bytes.subarray(1), material), /postgres_diagnostic_material_invalid/u);
  }
});

test("the recipe removes the embedded binary and installs only through the signed offline repository", () => {
  const recipe = dockerfile.toString("utf8");
  const indexVerification = recipe.indexOf("verify /tmp/auto-world-apk/APKINDEX.tar.gz");
  const packageVerification = recipe.indexOf("verify /tmp/auto-world-apk/gosu-1.19-r5.apk");
  const installation = recipe.indexOf("add 'gosu=1.19-r5'");
  assert.match(recipe, /^FROM postgres@sha256:aa90e97e/u);
  assert.match(recipe, /APKINDEX\.tar\.gz gosu-1\.19-r5\.apk/u);
  assert.ok(indexVerification >= 0 && packageVerification > indexVerification && installation > packageVerification);
  assert.match(recipe, /apk --no-network --keys-dir \/etc\/apk\/keys verify \/tmp\/auto-world-apk\/APKINDEX\.tar\.gz/u);
  assert.match(recipe, /apk --no-network --keys-dir \/etc\/apk\/keys verify \/tmp\/auto-world-apk\/gosu-1\.19-r5\.apk/u);
  assert.match(recipe, /ndx \/tmp\/auto-world-apk\/APKINDEX\.tar\.gz/u);
  assert.match(recipe, /apk --no-logfile --no-cache --no-network --repositories-file \/tmp\/auto-world-repositories add/u);
  assert.match(recipe, /sha256sum \/etc\/apk\/keys\/alpine-devel@lists\.alpinelinux\.org-6165ee59\.rsa\.pub/u);
  assert.match(recipe, /rm -f \/usr\/local\/bin\/gosu/u);
  assert.match(recipe, /test ! -e \/usr\/local\/bin\/gosu/u);
  assert.match(recipe, /command -v gosu.*\/usr\/bin\/gosu/u);
  assert.match(recipe, /6d3214ab9d2f1e9ffda75ea2f6bb1f454a13a78dd70318e09eee814ce32cce03/u);
  assert.match(recipe, /go1\.26\.8 on linux\/amd64/u);
  assert.doesNotMatch(recipe, /allow-untrusted|https?:\/\//u);
  assert.doesNotMatch(recipe, /ENTRYPOINT|CMD|EXPOSE|USER/u);
});

test("build and runtime plans are offline, unprivileged, bounded and publish no port", () => {
  const context = path.resolve("diagnostic-context");
  const build = dockerBuildArguments(lock, context, `aw-postgres-gosu:${nonce}`, nonce);
  assert.deepEqual(build.slice(0, 6), ["build", "--network=none", "--pull=false", "--no-cache", "--progress=plain", "--label"]);
  assert.equal(build.at(-1), context);
  assert.doesNotMatch(build.join(" "), /--push|--load|--secret|--ssh|--build-arg/u);

  const envFile = path.resolve("private/postgres.env");
  const args = postgresContainerArguments({ name: `aw-pg-gosu-${nonce}-one`, tag: `aw-postgres-gosu:${nonce}`,
    nonce, volume: `aw-pg-gosu-${nonce}-data`, envFile });
  const joined = args.join(" ");
  assert.match(joined, /--network none/u);
  assert.match(joined, /--read-only --restart no --cap-drop ALL/u);
  assert.match(joined, /--security-opt no-new-privileges=true/u);
  assert.match(joined, /--memory 1073741824 --memory-swap 1073741824 --cpus 1 --pids-limit 256/u);
  assert.match(joined, /--env-file/u);
  assert.match(joined, /type=volume,src=aw-pg-gosu-[a-f0-9]+-data,dst=\/var\/lib\/postgresql\/data/u);
  assert.doesNotMatch(joined, /--publish|-p |docker\.sock|POSTGRES_PASSWORD/u);
  assert.throws(() => postgresContainerArguments({ name: "foreign", tag: `aw-postgres-gosu:${nonce}`,
    nonce, volume: `aw-pg-gosu-${nonce}-data`, envFile }), /postgres_diagnostic_container_arguments_invalid/u);

  for (const [suffix, entrypoint, command] of [["probe", "/bin/sh", ["-ec", "gosu --version"]],
    ["base-export", "/bin/true", []], ["candidate-export", "/bin/true", []]]) {
    const ephemeral = ephemeralContainerArguments({ name: `aw-pg-gosu-${nonce}-${suffix}`,
      image: suffix === "base-export" ? `postgres@${lock.base.platformDigest}` : `aw-postgres-gosu:${nonce}`,
      nonce, entrypoint, command });
    const plan = ephemeral.join(" ");
    assert.match(plan, /--network none --read-only --cap-drop ALL/u);
    assert.match(plan, /--tmpfs \/var\/lib\/postgresql\/data:rw,nosuid,nodev,noexec,size=16777216,mode=0700/u);
    assert.doesNotMatch(plan, /type=volume|--publish|-p /u);
    if (suffix === "probe") assert.match(plan, /--cap-add SETGID --cap-add SETUID/u);
    else assert.doesNotMatch(plan, /--cap-add/u);
  }
  assert.throws(() => ephemeralContainerArguments({ name: `aw-pg-gosu-${nonce}-probe`, image: "postgres:latest",
    nonce, entrypoint: "/bin/sh", command: ["-ec", "true"] }), /postgres_diagnostic_ephemeral_arguments_invalid/u);

  const inspection = containerProfileInspectArguments("b".repeat(64)).join(" ");
  assert.match(inspection, /HostConfig\.NetworkMode/u);
  assert.match(inspection, /HostConfig\.Tmpfs/u);
  assert.doesNotMatch(inspection, /Config\.Env|POSTGRES_PASSWORD|sentinel-password/u);
  const source = readFileSync(new URL("../scripts/postgres-image/diagnostic.mjs", import.meta.url), "utf8");
  assert.ok(source.includes('apk info --quiet -e "gosu=1.19-r5" >/dev/null'));
});

test("the CLI accepts only one explicit absolute owned output argument and rejects runtime auth", async () => {
  const output = path.resolve("private-output");
  assert.deepEqual(parseDiagnosticArguments(["--output", output]), { output });
  for (const argv of [[], ["--output"], ["--output", "relative"], ["--apk", output],
    ["--output", output, "--apk", path.resolve("gosu.apk")]]) {
    assert.throws(() => parseDiagnosticArguments(argv), /postgres_diagnostic_arguments_invalid/u);
  }
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "must-not-be-read";
  try {
    await assert.rejects(runPostgresDiagnostic(["--output", output], { platform: "linux" }),
      /postgres_diagnostic_environment_invalid/u);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous;
  }
});

test("command failures are bounded diagnostics and never accepted", () => {
  assert.equal(validateCommandResult(result(0)).status, 0);
  for (const value of [result(1), { ...result(0), signal: "SIGKILL" }, { ...result(0), error: new Error("spawn") },
    { ...result(0), stdout: Buffer.alloc(4 * 1024 ** 2 + 1) }]) {
    assert.throws(() => validateCommandResult(value, "BUILD"), (error) => {
      assert.equal(error.message, "postgres_diagnostic_command_failed");
      assert.equal(error.phase, "BUILD");
      return true;
    });
  }
});

test("cleanup removes only the exact labeled container identity and preserves uncertain resources", () => {
  const id = "b".repeat(64); const calls = [];
  const invoke = (args) => {
    calls.push(args);
    if (args[1] === "inspect") return result(0, JSON.stringify({ Id: id,
      Labels: { "com.auto-world.postgres-diagnostic": nonce } }));
    return result(0, `${id}\n`);
  };
  assert.equal(cleanupOwnedResource("container", `aw-pg-gosu-${nonce}-one`, id, nonce, invoke), "REMOVED");
  assert.deepEqual(calls.at(-1), ["container", "rm", "--force", "--volumes", id]);
  const imageId = `sha256:${id}`;
  const imageCalls = [];
  cleanupOwnedResource("image", `aw-postgres-gosu:${nonce}`, imageId, nonce, (args) => {
    imageCalls.push(args);
    return args[1] === "inspect" ? result(0, JSON.stringify({ Id: imageId,
      Labels: { "com.auto-world.postgres-diagnostic": nonce } })) : result(0);
  });
  assert.deepEqual(imageCalls.at(-1), ["image", "rm", imageId]);

  let removed = false;
  const foreign = (args) => {
    if (args[1] === "inspect") return result(0, JSON.stringify({ Id: id,
      Labels: { "com.auto-world.postgres-diagnostic": "c".repeat(24) } }));
    removed = true; return result(0);
  };
  assert.throws(() => cleanupOwnedResource("container", `aw-pg-gosu-${nonce}-one`, id, nonce, foreign),
    /postgres_diagnostic_ownership_uncertain/u);
  assert.equal(removed, false);
  assert.equal(cleanupOwnedResource("container", `aw-pg-gosu-${nonce}-one`, id, nonce,
    () => result(1, "", `Error: No such container: aw-pg-gosu-${nonce}-one\n`)), "ABSENT");
  assert.equal(cleanupOwnedResource("image", `aw-postgres-gosu:${nonce}`, null, nonce,
    () => result(1, "", `Error response from daemon: No such image: aw-postgres-gosu:${nonce}\n`)), "ABSENT");
  assert.equal(cleanupOwnedResource("volume", `aw-pg-gosu-${nonce}-data`, null, nonce,
    () => result(1, "[]\n", `Error response from daemon: get aw-pg-gosu-${nonce}-data: no such volume\n`)), "ABSENT");
  assert.throws(() => cleanupOwnedResource("container", `aw-pg-gosu-${nonce}-one`, id, nonce,
    () => result(1, "", "not found")), /postgres_diagnostic_cleanup_inspection_failed/u);
});
