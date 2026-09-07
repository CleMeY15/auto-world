import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveGoInventory } from "../scripts/supply-chain/go-inventory.mjs";

const sum = "h1:" + "A".repeat(43) + "=";
const module = (path, version) => ({ path, version, sum, goModSum: "h1:" + "B".repeat(43) + "=", zipSha256: "1".repeat(64), zipSize: 1 });

test("derives main, stdlib and dependencies without consulting a report", () => {
  const result = deriveGoInventory({ tool: "oras", buildInfo: [
    "path\toras.land/oras/cmd/oras", "mod\toras.land/oras\t(devel)",
    `dep\tgolang.org/x/sync\tv0.16.0\t${sum}`, "build\tCGO_ENABLED=0",
  ], lockedModules: [module("golang.org/x/sync", "v0.16.0")] });
  assert.deepEqual(result.packages, [
    { name: "oras.land/oras", version: "" }, { name: "stdlib", version: "v1.26.8" },
    { name: "golang.org/x/sync", version: "v0.16.0" },
  ]);
  assert.equal(result.mainModule.rawVersion, "(devel)");
});

test("links an original dependency and its effective replacement to the lock", () => {
  const result = deriveGoInventory({ tool: "trivy", buildInfo: [
    "path\tgithub.com/aquasecurity/trivy/cmd/trivy", "mod\tgithub.com/aquasecurity/trivy\t(devel)",
    `dep\tgoogle.golang.org/grpc\tv1.82.1\t${sum}`, `=>\tgoogle.golang.org/grpc\tv1.83.1\t${sum}`,
  ], lockedModules: [module("google.golang.org/grpc", "v1.82.1"), module("google.golang.org/grpc", "v1.83.1")] });
  assert.deepEqual(result.packages.at(-1), { name: "google.golang.org/grpc", version: "v1.83.1" });
  assert.deepEqual(result.replacements[0], {
    original: { path: "google.golang.org/grpc", version: "v1.82.1" },
    effective: { path: "google.golang.org/grpc", version: "v1.83.1" },
  });
});

test("refuses program/main substitution and unlocked dependencies or replacements", () => {
  const base = { tool: "cosign", buildInfo: ["path\tgithub.com/sigstore/cosign/v3/cmd/cosign", "mod\tgithub.com/sigstore/cosign/v3\t(devel)", "dep\texample.test/a\tv1.0.0"], lockedModules: [module("example.test/a", "v1.0.0")] };
  assert.throws(() => deriveGoInventory({ ...base, buildInfo: ["path\tevil.test/cmd/cosign", ...base.buildInfo.slice(1)] }), { code: "go_main_identity_mismatch" });
  assert.throws(() => deriveGoInventory({ ...base, lockedModules: [module("example.test/a", "v1.0.1")] }), { code: "go_dependency_lock_mismatch" });
  assert.throws(() => deriveGoInventory({ ...base, buildInfo: [...base.buildInfo.slice(0, 2), "dep\texample.test/a\tv1.0.0\th1:wrong"] }), { code: "go_dependency_lock_mismatch" });
  assert.throws(() => deriveGoInventory({ ...base, buildInfo: [...base.buildInfo, "=>\texample.test/b\tv2.0.0"] }), { code: "go_replacement_lock_mismatch" });
});
