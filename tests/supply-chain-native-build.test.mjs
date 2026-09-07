import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseLockUpdateArgs, validateGitTree } from "../scripts/supply-chain/lock-update.mjs";
import { buildNativeCandidate, parseNativeBuildArgs } from "../scripts/supply-chain/native-build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = path.join(root, "infra/supply-chain/native-materials.lock.json");

test("lock proposal CLI accepts only the bounded explicit contract", () => {
  const parsed = parseLockUpdateArgs([
    "propose", "--tool", "cosign", "--workspace", path.join(root, ".tmp-proposal"),
    "--output", path.join(root, ".tmp-proposal.json"),
  ]);
  assert.equal(parsed.command, "propose");
  assert.equal(parsed.tool, "cosign");
  assert.throws(() => parseLockUpdateArgs([
    "propose", "--tool", "cosign", "--workspace", path.join(root, ".tmp"),
    "--output", path.join(root, ".tmp.json"), "--token", "SENTINEL",
  ]), (error) => {
    assert.equal(error.message.includes("SENTINEL"), false);
    assert.equal(error.message.includes("token"), false);
    return true;
  });
});

test("lock merge requires three explicit absolute proposal paths", () => {
  const output = path.join(root, ".tmp-lock.json");
  assert.doesNotThrow(() => parseLockUpdateArgs([
    "merge", "--proposal", path.join(root, "oras.json"), "--proposal", path.join(root, "cosign.json"),
    "--proposal", path.join(root, "trivy.json"), "--output", output,
  ]));
  assert.throws(() => parseLockUpdateArgs(["merge", "--proposal", path.join(root, "oras.json"), "--output", output]), /merge_arguments_invalid/u);
});

test("Git source inventory refuses traversal, links, gitlinks and duplicates before checkout", () => {
  const blob = `100644 blob ${"a".repeat(40)} 12\tcmd/main.go\0`;
  assert.doesNotThrow(() => validateGitTree(Buffer.from(blob)));
  for (const hostile of [
    `100644 blob ${"a".repeat(40)} 12\t../outside\0`,
    `120000 blob ${"a".repeat(40)} 12\tlinked\0`,
    `160000 commit ${"a".repeat(40)} -\tsubmodule\0`,
    `${blob}${blob}`,
    `100644 blob ${"a".repeat(40)} 12\tline\nbreak\0`,
  ]) assert.throws(() => validateGitTree(Buffer.from(hostile)), /source_git_tree_(entry|path)_refused/u);
  assert.throws(() => validateGitTree(Buffer.from([0xff, 0x00])), /encoding_invalid/u);
});

test("native build CLI has no target, activation, registry or credential input", () => {
  const args = parseNativeBuildArgs([
    "build", "--tool", "cosign", "--lock", lock, "--workspace", path.join(root, ".tmp-build"),
    "--output", path.join(root, ".tmp-build.json"), "--repeat", "2",
  ]);
  assert.equal(args.tool, "cosign");
  assert.equal(args.repeat, 2);
  for (const forbidden of ["target", "activate", "registry", "token", "key"]) {
    assert.throws(() => parseNativeBuildArgs([
      "build", "--tool", "oras", "--lock", lock, "--workspace", path.join(root, ".tmp-build"),
      "--output", path.join(root, ".tmp-build.json"), "--repeat", "1", `--${forbidden}`, "SENTINEL",
    ]), (error) => {
      assert.equal(error.message.includes("SENTINEL"), false);
      assert.equal(error.message.includes(forbidden), false);
      return true;
    });
  }
});

test("native candidate execution refuses a non-owned workspace before reading inputs", async () => {
  const expected = process.platform === "linux" && process.env.GITHUB_ACTIONS === "true" && process.env.ImageVersion
    ? /native_build_owned_path_invalid/u
    : /requires_secret_free_github_actions_linux/u;
  await assert.rejects(
    buildNativeCandidate({ tool: "oras", lock, workspace: path.join(root, ".tmp-build"), output: path.join(root, ".tmp-build.json"), repeat: 1 }),
    expected,
  );
});
