import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { validateTarArchive } from "../scripts/supply-chain/archive.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

test("locked Git fixture preserves upstream origin metadata and every other archive member", async () => {
  const compressed = readFileSync(new URL("../infra/supply-chain/materials/trivy/test-repo-git-worktree.tar.gz", import.meta.url));
  const entries = await validateTarArchive(gunzipSync(compressed, { maxOutputLength: 1024 ** 2 }), {
    maxArchiveBytes: 1024 ** 2, maxTotalFileBytes: 1024 ** 2,
  });
  const configPath = "test-repo/.git/config";
  // The pinned upstream local/repo TestArtifact_Inspect cases expect this URL
  // verbatim. Trivy's metadata reader strips credentials, not a .git suffix.
  const config = Buffer.from('[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n[remote "origin"]\n\turl = https://github.com/aquasecurity/trivy-test-repo/\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n');
  assert.deepEqual(entries.find((entry) => entry.path === configPath), {
    path: configPath, sha256: sha256(config), size: config.length, type: "file",
  });
  assert.equal(entries.length, 52);
  // The original reviewed archive fixes all objects, refs, index, hooks and
  // worktree bytes. Its inventory/order is retained except for origin config.
  assert.equal(sha256(canonicalJsonBuffer(entries.filter((entry) => entry.path !== configPath))),
    "49afafef7fabf58ede90189dbac70217ff7c6ec1b566e9cb3851d31ddfe49a82");
});
