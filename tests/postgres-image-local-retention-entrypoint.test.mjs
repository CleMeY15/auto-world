import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { runLocalPostgresRetention, validateLocalPostgresRetentionPolicyBytes }
  from "../scripts/postgres-image/local-retention-diagnostic.mjs";

test("local retainer binds the reviewed policy bytes before trusting its authority label", () => {
  const bytes = readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url));
  const policy = validateLocalPostgresRetentionPolicyBytes(bytes);
  assert.equal(policy.subject, "ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93");
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  for (const altered of [changed, bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from(" ")]),
    bytes.toString("utf8"), Buffer.alloc(1024 ** 2 + 1)]) {
    assert.throws(() => validateLocalPostgresRetentionPolicyBytes(altered), /postgres_local_retention_entrypoint_invalid/u);
  }
});

test("input-free local retainer rejects arguments, ambient routes and missing credentials before creating private work", async () => {
  const keys = ["GITHUB_TOKEN", "GITHUB_ACTIONS", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"];
  const saved = keys.map((key) => [key, Object.hasOwn(process.env, key), process.env[key]]);
  const inventory = () => existsSync("/home/autoworld")
    ? readdirSync("/home/autoworld").filter((name) => name.startsWith("pg-local-retention-")).sort() : [];
  const before = inventory();
  const reset = () => { for (const key of keys) delete process.env[key]; };
  const rejected = (args) => assert.rejects(runLocalPostgresRetention(args), /postgres_local_retention_entrypoint_invalid/u);
  try {
    reset(); process.env.GITHUB_TOKEN = "fixture-credential-never-used";
    await rejected(["--skip-verification"]);
    for (const key of ["GITHUB_ACTIONS", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
      reset(); process.env.GITHUB_TOKEN = "fixture-credential-never-used"; process.env[key] = "";
      await rejected([]);
    }
    reset(); await rejected([]);
    process.env.GITHUB_TOKEN = ""; await rejected([]);
    process.env.GITHUB_TOKEN = "x".repeat(8193); await rejected([]);
    assert.deepEqual(inventory(), before);
  } finally {
    for (const [key, present, value] of saved) {
      if (present) process.env[key] = value; else delete process.env[key];
    }
  }
});
