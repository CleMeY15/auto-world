import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { catalogPublicationGrant, protectedBytes } from "../bin/catalog-publication-grant.mjs";
import { syntheticEnabledRegistry, syntheticPolicy, SYNTHETIC_NOW } from "./fixtures/synthetic.mjs";

const fields = ["source_listing_id", "url", "description", "mileage", "price", "media"];
const cli = fileURLToPath(new URL("../bin/catalog-publication-grant.mjs", import.meta.url));
const candidate = new URL("../data/src_leboncoin_fr.json", import.meta.url);

function permitted(overrides = {}) {
  const document = syntheticEnabledRegistry({ sourceId: "src_leboncoin_fr" });
  const policy = syntheticPolicy({
    authorization: { validUntil: "9999-01-01T00:00:00.000Z" },
    grants: ["internal", "consumer"].map(audience => ({
      audience, territory: "FR", acquisitionMethod: "crawl", fields,
    })),
    media: { mode: "reference", attributionRequired: true },
    ...overrides,
  });
  for (const { configuration } of document.revisions) {
    configuration.legalStatus = "permitted_crawl";
    configuration.acquisitionMethods = ["crawl"];
    configuration.policy = policy;
  }
  return document;
}

const evidence = Buffer.from("Synthetic verification for tests only.");
const batches = { domBatchIds: ["a".repeat(32)], rustExportSha256: ["b".repeat(64)] };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = object => Buffer.from(JSON.stringify(object));

function releaseFor(registry) {
  const revision = registry.revisions.at(-1);
  return {
    version: 1, sourceId: registry.sourceId, site: "autofind.tech", audience: "consumer",
    registryRevision: revision.revision, registrySha256: digest(json(registry)),
    evidenceRef: revision.configuration.policy?.authorization.basisRef,
    evidenceSha256: digest(evidence), ...batches,
  };
}

function grantFor(registry, now) {
  return catalogPublicationGrant(json(registry), json(releaseFor(registry)), evidence, now);
}

test("consumer reading returns only SQL bounds for already-stored records and attributed URL references", () => {
  const doc = permitted();
  const policy = doc.revisions.at(-1).configuration.policy;
  assert.equal(policy.retention.mediaSeconds, 0);
  assert.deepEqual(grantFor(doc, SYNTHETIC_NOW), {
    validFrom: policy.authorization.validFrom,
    validUntil: policy.authorization.validUntil,
    normalizedSeconds: 172_800,
    mediaSeconds: 172_800,
    ...batches,
  });
  const longLived = permitted({ retention: { normalizedSeconds: 31 * 86_400 } });
  assert.equal(grantFor(longLived, SYNTHETIC_NOW).mediaSeconds, 30 * 86_400);
});

test("consumer grant covers every displayed field with one matching clause", () => {
  for (const field of fields) {
    const doc = permitted();
    for (const revision of doc.revisions) {
      const consumer = revision.configuration.policy.grants[1];
      consumer.fields = consumer.fields.filter(candidate => candidate !== field);
    }
    assert.equal(grantFor(doc, SYNTHETIC_NOW), null, field);
  }
});

test("reading refuses disabled, expired, wrong-source, wrong-territory, and copy-only policies", async () => {
  const disabled = JSON.parse(await readFile(candidate, "utf8"));
  assert.equal(grantFor(disabled, "2026-12-01T00:00:00.000Z"), null);
  const approved = permitted();
  assert.equal(grantFor(approved, approved.revisions.at(-1).configuration.policy.authorization.validUntil), null);
  assert.equal(grantFor({ ...approved, sourceId: "src_different" }, SYNTHETIC_NOW), null);
  const wrongTerritory = permitted();
  for (const { configuration } of wrongTerritory.revisions) {
    configuration.territories = ["DE"];
    for (const grant of configuration.policy.grants) grant.territory = "DE";
  }
  assert.equal(grantFor(wrongTerritory, SYNTHETIC_NOW), null);
  assert.equal(grantFor(permitted({
    media: { mode: "licensed_copy", attributionRequired: true }, retention: { mediaSeconds: 3600 },
  }), SYNTHETIC_NOW), null);
});

test("release must attest exact source head, evidence bytes, site and explicit bounded batches", () => {
  const registry = permitted();
  const bytes = json(registry);
  const admission = releaseFor(registry);
  const grant = (changes, proof = evidence) => catalogPublicationGrant(
    bytes, json({ ...admission, ...changes }), proof, SYNTHETIC_NOW,
  );
  assert.deepEqual(grant({ domBatchIds: [] }).rustExportSha256, batches.rustExportSha256);
  assert.deepEqual(grant({ rustExportSha256: [] }).domBatchIds, batches.domBatchIds);
  assert.equal(grant({}, Buffer.from("changed")), null);
  assert.equal(grant({}, Buffer.alloc(0)), null);
  assert.equal(grant({ evidenceSha256: digest(bytes) }, bytes), null);
  for (const change of [
    { version: 2 }, { unexpected: true }, { registryRevision: "2" }, { registryRevision: 1 },
    { registrySha256: digest(Buffer.from("same policy, different bytes")) },
    { evidenceRef: "evidence_other" }, { evidenceRef: undefined }, { evidenceSha256: undefined },
    { site: "another.example" }, { audience: "internal" }, { sourceId: "src_another" },
    { domBatchIds: [], rustExportSha256: [] }, { rustExportSha256: null },
    { domBatchIds: [batches.domBatchIds[0], batches.domBatchIds[0]] },
    { rustExportSha256: ["F".repeat(64)] }, { domBatchIds: ["1".repeat(31)] },
    { domBatchIds: ["a".repeat(32) + "\n"] },
    { rustExportSha256: Array.from({ length: 257 }, (_, i) => i.toString(16).padStart(64, "0")) },
  ]) assert.equal(grant(change), null, Object.keys(change).join(","));
  assert.equal(catalogPublicationGrant(Buffer.concat([bytes, Buffer.from(" ")]), json(admission), evidence, SYNTHETIC_NOW), null);
});

test("a withdrawn head and the replay of its older enabled prefix fail independently", () => {
  const previous = permitted();
  const revisions = [...previous.revisions];
  function transition(state, kind) {
    const revision = revisions.length + 1;
    revisions.push({
      revision, state, configuration: revisions[0].configuration,
      event: { ...revisions[0].event, eventId: "aud_transition_" + revision, kind, at: "2026-06-01T00:00:00.000Z" },
    });
    return { ...previous, revisions: [...revisions] };
  }
  const withdrawn = transition("disabled", "disable");
  const latest = transition("enabled", "enable");
  assert.ok(grantFor(latest, SYNTHETIC_NOW));
  assert.equal(grantFor(withdrawn, SYNTHETIC_NOW), null);
  assert.equal(catalogPublicationGrant(json(withdrawn), json(releaseFor(previous)), evidence, SYNTHETIC_NOW), null);
  assert.equal(catalogPublicationGrant(json(previous), json(releaseFor(latest)), evidence, SYNTHETIC_NOW), null);
  assert.equal(catalogPublicationGrant(json(latest), json(releaseFor(previous)), evidence, SYNTHETIC_NOW), null);
});

test("CLI refuses missing inputs and alternate tickets, keeping policy contents private", () => {
  const path = fileURLToPath(candidate);
  const ticket = "/etc/aw-private-web/catalog-admission.json";
  for (const args of [[], [path], [path, path, path], [path, ticket, path], [path, ticket, "relative"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "catalog_publication_unavailable");
  }
});

test("runtime file reader accepts a root-owned inode and rejects writable ancestry or exceeded size", async t => {
  const sample = "/etc/debian_version";
  const metadata = await lstat(sample).catch(() => null);
  if (!metadata?.isFile() || metadata.uid !== 0) {
    t.skip("Requires the root-owned Debian/Ubuntu release metadata used on the VPS.");
    return;
  }
  assert.deepEqual(await protectedBytes(sample, metadata.size), await readFile(sample));
  await assert.rejects(protectedBytes(sample, metadata.size - 1));
  await assert.rejects(protectedBytes("/etc/../etc/debian_version", metadata.size));
  const dir = await mkdtemp("/tmp/catalog-grant-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const untrusted = join(dir, "release");
  await writeFile(untrusted, "evidence", { mode: 0o600 });
  await assert.rejects(protectedBytes(untrusted, 65536));
  if ((await lstat("/usr/bin/sh").catch(() => null))?.isSymbolicLink()) {
    await assert.rejects(protectedBytes("/usr/bin/sh", 16 * 1024 * 1024));
  }
});
