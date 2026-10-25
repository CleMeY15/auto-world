import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  POSTGRES_PACKAGE_BOOTSTRAP,
  runPostgresPackageBootstrap,
  sha256,
} from "../scripts/postgres-image/package-bootstrap.mjs";

test("the immutable harmless bootstrap contract remains exact after producer retirement", () => {
  assert.equal(POSTGRES_PACKAGE_BOOTSTRAP.retired, true);
  assert.equal(POSTGRES_PACKAGE_BOOTSTRAP.image, "ghcr.io/clemey15/auto-world-postgres-gosu");
  assert.equal(POSTGRES_PACKAGE_BOOTSTRAP.payload, "auto-world-postgres-gosu-package-bootstrap-v1\n");
  assert.equal(sha256(Buffer.from(POSTGRES_PACKAGE_BOOTSTRAP.payload)),
    "3dcac3d89244976f683b3d6c26b91cd992b758baa17801f08b1533c0e235be38");
  assert.equal(Buffer.byteLength(POSTGRES_PACKAGE_BOOTSTRAP.payload), 46);
  assert.equal(sha256(Buffer.from(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile)),
    "aea9d6d5010b46d1fa97daa186252d0d641d7aa31d1ac2b68541b94596b0de65");
  assert.equal(Buffer.byteLength(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile), 246);
  assert.match(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile, /^FROM scratch\n/u);
  assert.doesNotMatch(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile, /^(?:RUN|ADD)\s/mu);
  assert.deepEqual(POSTGRES_PACKAGE_BOOTSTRAP.authenticatedFiles, [
    ".github/workflows/postgres-package-bootstrap.yml",
    "scripts/postgres-image/package-private-read.mjs",
    "scripts/postgres-image/package-bootstrap.mjs",
    "scripts/package-bootstrap/registry-proof.mjs",
    "scripts/package-bootstrap/prepare.mjs",
  ]);
});

test("the retired producer rejects function and direct CLI invocation without executable build logic", (context) => {
  assert.throws(() => runPostgresPackageBootstrap(), /postgres_package_bootstrap_retired/u);
  const script = new URL("../scripts/postgres-image/package-bootstrap.mjs", import.meta.url);
  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source, /node:child_process|\bbuildx\b|docker\s+(?:login|push)|--push|packages: write/u);
  const cwd = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-bootstrap-retired-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  const before = readdirSync(cwd);
  const result = spawnSync(process.execPath, [fileURLToPath(script)], {
    cwd, encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 5_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "postgres_package_bootstrap_failed:postgres_package_bootstrap_retired\n");
  assert.deepEqual(readdirSync(cwd), before);
});
