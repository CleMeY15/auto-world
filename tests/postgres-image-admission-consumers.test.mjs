import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import consumers from "../infra/postgres-image/admission-consumers.json" with { type: "json" };

const directory = "scripts/postgres-image";
const effectSurface = /node:child_process|docker-isolated|executeCandidateAudit|executePostgresScanner|withVerifiedRemotePostgresCandidate|runPostgresSupportedSession/u;

test("all PostgreSQL process, Docker and image routes have an explicit supported, offline or diagnostic classification", () => {
  const actual = fs.readdirSync(directory).filter(name => name.endsWith(".mjs")
    && effectSurface.test(fs.readFileSync(path.join(directory, name), "utf8"))).sort();
  const classified = [path.basename(consumers.supportedEntryPoint), path.basename(consumers.privateSupportedBroker),
    path.basename(consumers.offlineObservation), ...consumers.diagnosticOnly].sort();
  assert.deepEqual(actual, classified);
  assert.equal(new Set(classified).size, classified.length);
  assert.deepEqual(consumers.diagnosticOnly, [...consumers.diagnosticOnly].sort());
  assert.equal(consumers.claims.classificationGrantsAuthority, false);
  assert.equal(consumers.claims.diagnosticAdmission, "NOT_AUTHORIZED");
  assert.deepEqual(consumers.referenceTopology.services, ["PostgreSQL", "OpenSearch", "Redis", "SeaweedFS"]);
  assert.ok(consumers.referenceTopology.helpers.includes("AWS_CLI_S3"));
  assert.ok(consumers.referenceTopology.isolatedDiagnostics.includes("TRIVY_SCANNER"));
});

test("only the closed supported broker imports authority and historical diagnostic commands never call the supported session", () => {
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".mjs"))) {
    const source = fs.readFileSync(path.join(directory, name), "utf8");
    if (/from ["']\.\/admission-authority\.mjs["']/u.test(source)) assert.equal(name, "admission-broker.mjs");
    if (consumers.diagnosticOnly.includes(name)) assert.doesNotMatch(source, /admission-authority|runPostgresSupportedSession/u);
  }
  for (const name of fs.readdirSync(".github/workflows").filter(name => /postgres.*\.yml$/u.test(name))) {
    const source = fs.readFileSync(path.join(".github/workflows", name), "utf8");
    for (const match of source.matchAll(/node scripts\/postgres-image\/([a-z0-9-]+\.mjs)/gu)) {
      assert.ok(consumers.diagnosticOnly.includes(match[1]), `${name} introduces an unclassified execution route`);
    }
  }
});
