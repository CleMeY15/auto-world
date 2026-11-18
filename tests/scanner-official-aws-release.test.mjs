import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateManagedImageLock, validateOfficialReleaseConfig } from "../scripts/scanner/official-audit.mjs";

const read = (name) => readFileSync(new URL(name, import.meta.url));
const evidence = (name) => read(`../docs/validation/aws-cli-20261118/${name}.json`);
const sha = (buffer) => `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
const bytes = Object.fromEntries(["index", "platform", "config"].map((kind) => [kind, evidence(`2.41.0-${kind}`)]));
const release = JSON.parse(read("../infra/scanner/official-release.json"));
const lock = JSON.parse(read("../infra/managed-images/lock.json"));

function check(candidate, materials, chain) {
  validateOfficialReleaseConfig(candidate);
  validateManagedImageLock(materials, candidate);
  const snapshot = evidence("pr251-official-release");
  assert.equal(sha(snapshot), "sha256:15873d823b0ec80d316b645a94b708a047e739b579802bed7e9e8f93d262824a");
  const old = JSON.parse(snapshot);
  const aws = old.images.find((image) => image.role === "aws-cli");
  const tag = JSON.parse(evidence("tag"));
  const ref = JSON.parse(evidence("aws-2.41.0-source-tag-ref"));
  const annotated = JSON.parse(evidence("aws-2.41.0-source-tag"));
  assert.equal(tag.name, "2.41.0");
  assert.equal(ref.ref, "refs/tags/2.41.0");
  assert.equal(ref.object.type, "tag");
  assert.equal(ref.object.sha, annotated.sha);
  assert.equal(annotated.tag, tag.name);
  assert.equal(annotated.object.type, "commit");
  assert.equal(annotated.object.sha, "7e6f97cb7b149863b5133857b2095bca3f3cab47");
  assert.equal(tag.digest, "sha256:c5d442efed03350a3c3d7a42b23f42a8e7b76acf5dbb4b021f2641bcd36680ea");
  assert.equal(sha(chain.index), tag.digest);
  const platforms = JSON.parse(chain.index).manifests.filter(({ platform: p }) =>
    p?.os === "linux" && p.architecture === "amd64" && p.variant == null);
  assert.equal(platforms.length, 1);
  const [platform] = platforms;
  assert.equal(sha(chain.platform), platform.digest);
  assert.equal(chain.platform.length, platform.size);
  const config = JSON.parse(chain.platform).config;
  assert.equal(sha(chain.config), config.digest);
  assert.equal(chain.config.length, config.size);
  const subject = JSON.parse(chain.config);
  assert.equal(subject.os, "linux");
  assert.equal(subject.architecture, "amd64");
  assert.deepEqual(subject.config.Entrypoint, ["/usr/local/bin/aws"]);
  assert.equal(subject.config.WorkingDir, "/aws");
  old.resolvedAt = JSON.parse(evidence("resolution")).observedAt;
  aws.version = tag.name;
  aws.manifestDigest = tag.digest;
  aws.platform.digest = platform.digest;
  aws.source.commit = annotated.object.sha;
  assert.deepEqual(candidate, old);
  assert.equal(materials.candidates.find(({ role }) => role === "aws-cli").baseDigest, platform.digest);
}

test("only the authenticated AWS release replaces its entry in the accepted PR251 configuration", () => {
  check(release, lock, bytes);
  for (const kind of Object.keys(bytes)) {
    assert.throws(() => check(release, lock, { ...bytes, [kind]: Buffer.concat([bytes[kind], Buffer.from(" ")]) }));
  }
  const changed = JSON.parse(JSON.stringify(release));
  changed.images.find(({ role }) => role === "aws-cli").source.commit = "0".repeat(40);
  assert.throws(() => check(changed, lock, bytes));
});
