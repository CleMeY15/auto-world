import assert from "node:assert/strict";
import { test } from "node:test";

import { sourceIdentity } from "../scripts/prototype-application/evidence.mjs";

const revision = "1".repeat(40);
const tree = "2".repeat(40);

function outputFor(args, dirty = false) {
  if (args[0] === "rev-parse" && args[1] === "HEAD") return `${revision}\n`;
  if (args[0] === "rev-parse" && args[1] === "HEAD^{tree}") return `${tree}\n`;
  if (args[0] === "status" && args[1] === "--porcelain") return dirty ? " M package.json\n" : "";
  throw new Error("unexpected_git_arguments");
}

test("sourceIdentity reads a clean checkout with bounded and silent Git calls", () => {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return outputFor(args);
  };
  assert.deepEqual(sourceIdentity("C:/checkout", {
    execute, platform: "win32", environment: { GITHUB_SHA: "f".repeat(40) },
  }), { sourceRevision: revision, sourceTree: tree, sourceDirty: false });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.command, "git");
    assert.equal(call.options.cwd, "C:/checkout");
    assert.deepEqual(call.options.stdio, ["ignore", "pipe", "ignore"]);
    assert.equal(call.options.encoding, "utf8");
    assert.equal(call.options.timeout, 5_000);
    assert.equal(call.options.maxBuffer, 64 * 1024);
  }
});

test("sourceIdentity reports a dirty checkout from porcelain output", () => {
  const execute = (_command, args) => outputFor(args, true);
  assert.equal(sourceIdentity("/checkout", { execute, platform: "linux", environment: {} }).sourceDirty, true);
});

test("sourceIdentity uses git.exe only for a WSL native Git failure", () => {
  const commands = [];
  const execute = (command, args) => {
    commands.push(command);
    if (command === "git") throw new Error("native_git_cannot_resolve_windows_worktree");
    return outputFor(args);
  };
  assert.deepEqual(sourceIdentity("/mnt/c/checkout", {
    execute, platform: "linux", environment: { WSL_DISTRO_NAME: "Ubuntu-24.04" },
  }), { sourceRevision: revision, sourceTree: tree, sourceDirty: false });
  assert.deepEqual(commands, ["git", "git.exe", "git.exe", "git.exe"]);
});

test("sourceIdentity rejects malformed object IDs instead of trusting environment SHAs", () => {
  const execute = (_command, args) => args[0] === "status" ? "" : "not-an-object-id\n";
  assert.throws(() => sourceIdentity("/checkout", {
    execute, platform: "linux", environment: { GITHUB_SHA: revision },
  }), /source_identity_unavailable/u);
});

test("sourceIdentity exposes one fixed error for command timeouts and failed WSL fallback", () => {
  const timeout = Object.assign(new Error("timed out and may contain a checkout path"), { code: "ETIMEDOUT" });
  const execute = () => { throw timeout; };
  assert.throws(() => sourceIdentity("/mnt/c/private/checkout", {
    execute, platform: "linux", environment: { WSL_DISTRO_NAME: "Ubuntu" },
  }), (error) => {
    assert.equal(error.message, "source_identity_unavailable");
    assert.equal("cause" in error, false);
    return true;
  });
});
