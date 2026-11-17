import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCANNER_RETENTION, canonicalJsonBytes, sha256, validateRetentionPolicyBytes,
} from "../scripts/scanner/retention-policy.mjs";

const policyBytes = readFileSync(new URL("../infra/scanner/retention.json", import.meta.url));

test("retention policy rejects substitutions and cannot grant authority through mutation", () => {
  assert.equal(validateRetentionPolicyBytes(policyBytes).state, "PRIVATE_READ_VERIFIED_NOT_ADMITTED");
  const changed = Buffer.from(policyBytes);
  changed[100] ^= 1;
  for (const bytes of [changed, policyBytes.subarray(1), Buffer.concat([policyBytes, Buffer.from("\n")]), policyBytes.toString()]) {
    assert.throws(() => validateRetentionPolicyBytes(bytes), /policy_identity_invalid/u);
  }
  assert.throws(() => { SCANNER_RETENTION.claims.admitted = true; }, TypeError);
  assert.throws(() => { SCANNER_RETENTION.observations.bootstrapSubject = "chosen"; }, TypeError);
  assert.throws(() => { SCANNER_RETENTION.observations.publisher.runId = "chosen"; }, TypeError);
  assert.deepEqual(
    Object.fromEntries(Object.entries(SCANNER_RETENTION.observations).filter(([, value]) => value === null)),
    { localCopy: null, localRestore: null },
  );
  assert.throws(() => { SCANNER_RETENTION.readProof.packageSettings.visibility = "Private"; }, TypeError);
  assert.throws(() => { SCANNER_RETENTION.readProof.bootstrapOutcome.cleanup = "FAILED"; }, TypeError);
  assert.equal(SCANNER_RETENTION.claims.forkAccessTest, "SKIPPED_BY_USER");
  assert.equal(SCANNER_RETENTION.claims.forkIsolation, "NOT_VERIFIED");
  for (const key of ["retained", "restored", "admitted", "scannerExecuted"]) assert.equal(SCANNER_RETENTION.claims[key], false);
  assert.equal(SCANNER_RETENTION.claims.supportStart, null);
  assert.equal(SCANNER_RETENTION.claims.supportEnd, null);
});

test("closed policy preserves all fifty reviewed origins and exact physical TAR order", () => {
  const plan = readFileSync(new URL("../roadmap/plans/TASK-0005-scanner-retention.md", import.meta.url));
  assert.equal(plan.length, SCANNER_RETENTION.approvedPlan.bytes);
  assert.equal(sha256(plan), SCANNER_RETENTION.approvedPlan.sha256);
  const rows = [...plan.toString("utf8").matchAll(/^\| \d{2} \| `([^`]+)` \| `([^`]+)` \| (.*?) \| `([^`]+)` \| `([^`]+)` \|$/gmu)];
  const members = SCANNER_RETENTION.closure.members;
  assert.equal(rows.length, 50);
  assert.equal(members.length, 50);
  assert.deepEqual(members.map((member) => member.path), members.map((member) => member.path).sort());
  const counts = {};
  assert.deepEqual(rows[10].slice(1), ["scanner-closure/inventory/go-build-info.txt", "PUBLISHER_FRESH",
    "fixed Go tool reads row01 at exact `/home/runner/work/_temp/trivy-provenance/bin/trivy`; it does not execute Trivy",
    "37019", "a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b"]);
  for (const [index, member] of members.entries()) {
    const [, memberPath, origin, source, bytes, digest] = rows[index];
    assert.equal(member.path, memberPath);
    assert.equal(member.origin, origin);
    // The authenticated amendment changes only the inventory's raw byte identity.
    assert.equal(member.bytes, index === 10 ? 37057 : bytes === "UNBOUND" ? null : Number(bytes));
    assert.equal(member.sha256, index === 10
      ? "d11460976d702309229ce77f78631eff0ad7a20d52ac4ae0d046ab738ad8d2c9"
      : digest === "UNBOUND" ? null : digest);
    if (index === 10) assert.equal(member.capBytes, 37057);
    assert.equal(member.headerMode, member.path === "scanner-closure/binary/trivy" ? 0o555 : 0o444);
    assert.ok(member.capBytes >= (member.bytes ?? 0));
    if (member.sourcePath !== null) assert.equal(source, `\`${member.sourcePath}\``);
    else assert.equal(member.producer, source);
    counts[origin] = (counts[origin] ?? 0) + 1;
  }
  assert.deepEqual(counts, { PUBLISHER_FRESH: 17, QUALIFIED_REPO_BLOB: 18, QUALIFICATION_ARTIFACT: 11,
    DETERMINISTIC_QUALIFIED_PROBE: 1, GENERATED_POSTCONDITION: 3 });
  const expanded = members.reduce((sum, member) => sum + member.capBytes, 0);
  assert.equal(expanded, 468322443);
  assert.equal(SCANNER_RETENTION.closure.expandedCapBytes, expanded);
  const tar = expanded + members.length * 1024 + 1024;
  assert.equal(SCANNER_RETENTION.closure.tarCapBytes, tar);
  assert.equal(tar, 468374667);
  assert.equal(tar + 1048576, 469423243);
  assert.equal(SCANNER_RETENTION.closure.publisherPeakBytes,
    2 * expanded + 6 * tar + 134217728 + 2 * 67108864 + 1048576);
  assert.equal(SCANNER_RETENTION.closure.localPeakBytes,
    expanded + 4 * tar + 134217728 + 2 * 65536 + 262144);
  assert.equal(SCANNER_RETENTION.closure.publisherRequiredFreeBytes, Math.ceil(SCANNER_RETENTION.closure.publisherPeakBytes * 1.25));
  assert.equal(SCANNER_RETENTION.closure.localRequiredFreeBytes, Math.ceil(SCANNER_RETENTION.closure.localPeakBytes * 1.25));
  assert.equal(SCANNER_RETENTION.closure.publisherRequiredFreeBytes, 5020471150);
  assert.equal(SCANNER_RETENTION.closure.localRequiredFreeBytes, 3095540069);
});

test("recovery policy binds the exact ordered-reviewed amendment and consumed predecessor", () => {
  assert.deepEqual(SCANNER_RETENTION.approvedRecoveryPlan, {
    file: "roadmap/plans/TASK-0005-publisher-inventory-recovery.md", bytes: 17013,
    sha256: "eb7d3c7bc80a8c9fbab11e935426d790ebd9bf46311379497ca4eba111d18de4",
    architectReviewSha256: "5b582b1d8f2dac024728e2b1013e00bbafcf32d66bd9120ed53c15e700614472",
    criticReviewSha256: "942b70215eff73179b1f3cc19623044f0762ae1732f0ff08d49c29f69ace7ad0",
  });
  const amendment = readFileSync(new URL(`../${SCANNER_RETENTION.approvedRecoveryPlan.file}`, import.meta.url));
  assert.equal(amendment.length, SCANNER_RETENTION.approvedRecoveryPlan.bytes);
  assert.equal(sha256(amendment), SCANNER_RETENTION.approvedRecoveryPlan.sha256);
  assert.deepEqual(SCANNER_RETENTION.publisher.recovery, {
    workflowId: 420550475, runNumber: 2, runAttempt: 1,
    predecessor: {
      runId: "43988267108", runNumber: 1, runAttempt: 1,
      headSha: "5ecdee7b32bac22429f6a3fb8ce86b13accaa1da", headTree: "aa443b71420d2d05a5877bea9d20a8abbc78ffe9",
      jobId: 133721943829, artifactId: 14286078082, artifactName: "scanner-retention-publisher-43988267108-1",
      artifactDigest: "sha256:bad3839ebf36ebac5d1a085bcfa241cf966c83d8c51b6ebb9821d5f36592c1b9",
      artifactBytes: 923, receiptBytes: 1433,
      receiptSha256: "47caab8dad1160a43dd27b6cb32c111133c651bd6ed29ed25fbc1c7d6da980b2",
      createdAt: "2026-11-17T00:31:49Z", expiresAt: "2026-12-01T00:31:48Z",
    },
  });
  const native = SCANNER_RETENTION.local;
  const wrapper = readFileSync(new URL(`../${native.wrapper.file}`, import.meta.url));
  const helper = readFileSync(new URL(`../${native.helper.file}`, import.meta.url));
  for (const [value, identity] of [[wrapper, native.wrapper], [helper, native.helper]]) {
    assert.equal(value.length, identity.bytes);
    assert.equal(sha256(value), identity.sha256);
  }
  assert.match(wrapper.toString(), /\$innerTarBytes -gt 468374667/u);
  assert.match(helper.toString(), /const long TarCap=468374667,SidecarCap=65536/u);
  assert.match(helper.toString(), /total>468322443/u);
});

test("qualification profile authenticates the selected reports and preserves the accepted full ZIP inventory", () => {
  const qualification = SCANNER_RETENTION.qualification;
  const bytes = readFileSync(new URL(`../infra/scanner/${qualification.zipProfile.file}`, import.meta.url));
  assert.equal(bytes.length, 170198);
  assert.equal(sha256(bytes), qualification.zipProfile.sha256);
  const profile = JSON.parse(bytes);
  assert.equal(profile.entryCount, 689);
  assert.equal(profile.entries.length, profile.entryCount);
  assert.equal(profile.entries.reduce((sum, entry) => sum + entry.bytes, 0), 49888165);
  assert.equal(new Set(profile.entries.map((entry) => entry.path.toLowerCase())).size, 689);
  assert.equal(profile.artifactId, qualification.artifact.id);
  assert.equal(profile.artifactDigest, qualification.artifact.digest);
  assert.equal(profile.headSha, qualification.headSha);
  assert.equal(qualification.sourceMappings.length, 11);
  for (const mapping of qualification.sourceMappings) {
    const entry = profile.entries.find((item) => item.path === mapping.sourcePath);
    assert.ok(entry);
    assert.equal(entry.bytes, mapping.bytes);
    assert.equal(entry.sha256, mapping.sha256);
    const member = SCANNER_RETENTION.closure.members.find((item) => item.path === mapping.closurePath);
    assert.equal(member.bytes, mapping.bytes);
    assert.equal(member.sha256, mapping.sha256);
  }
});

test("bootstrap is the fixed harmless two-file context with bounded resource projection", () => {
  const bootstrap = SCANNER_RETENTION.bootstrap;
  assert.equal(bootstrap.payload.bytes, 48);
  assert.equal(bootstrap.recipe.bytes, 227);
  for (const material of [bootstrap.payload, bootstrap.recipe]) {
    assert.equal(Buffer.byteLength(material.text), material.bytes);
    assert.equal(sha256(material.text), material.sha256);
  }
  assert.equal(bootstrap.payload.bytes + bootstrap.recipe.bytes, 275);
  assert.match(bootstrap.recipe.text, /^FROM scratch\nCOPY bootstrap.txt \/bootstrap.txt\n/u);
  assert.doesNotMatch(bootstrap.recipe.text, /^(?:ADD|RUN)\s/gmu);
  assert.equal(bootstrap.requiredFreeBytes, Math.ceil(bootstrap.projectedPeakBytes * 1.25));
  assert.equal(bootstrap.contextCapBytes, 4096);
  assert.equal(bootstrap.registryCapBytes, 4194304);
  assert.equal(bootstrap.receiptCapBytes, 65536);
});

test("read proof fixes the reviewed bootstrap, outcome and package settings tuple", () => {
  const readProof = SCANNER_RETENTION.readProof;
  assert.equal(readProof.workflow, ".github/workflows/scanner-retention-package-read.yml");
  assert.equal(readProof.job, "read-proof");
  assert.equal(readProof.platform, "linux/amd64");
  assert.equal(readProof.payloadPath, "/bootstrap.txt");
  assert.equal(readProof.registryCapBytes, SCANNER_RETENTION.bootstrap.registryCapBytes);
  assert.equal(readProof.receiptCapBytes, 65536);
  assert.equal(readProof.operationTimeoutMs, 240_000);
  assert.equal(readProof.cleanupTimeoutMs, 60_000);
  assert.equal(readProof.receiptReserveMs, 10_000);
  assert.equal(readProof.operationTimeoutMs + readProof.cleanupTimeoutMs + readProof.receiptReserveMs, 310_000);
  assert.deepEqual(Object.keys(readProof.bootstrap), [
    "runId", "runAttempt", "headSha", "headTree", "artifactId", "artifactName", "artifactDigest",
    "receiptBytes", "receiptSha256", "tag", "subject", "manifestDigest", "manifestBytes",
    "childManifestDigest", "childManifestBytes", "configBytes", "layerBytes",
  ]);
  assert.deepEqual(readProof.bootstrap, {
    runId: "42712603501",
    runAttempt: 1,
    headSha: "ff9edab3fb94417e216bdd70d93846ad32024ec8",
    headTree: "2ecf1c4c2f258376f2d59bcc3b8eb3f81674f032",
    artifactId: 13717120609,
    artifactName: "scanner-retention-bootstrap-42712603501-1",
    artifactDigest: "sha256:ecefba4de8786320599da58450a79347d1e224a2416297a2ae2e7bac474cbc33",
    receiptBytes: 2665,
    receiptSha256: "d80c35dec4b7938fdb57b1c3028f850431c0fc54768ff4f40b3a4218fed96e03",
    tag: "ghcr.io/clemey15/auto-world-scanner-closure:bootstrap-v1-run-42712603501",
    subject: "ghcr.io/clemey15/auto-world-scanner-closure@sha256:4d3bbf4b6b397254a470193dadd6265989379a472e0508adb05ede68dca4786f",
    manifestDigest: "sha256:4d3bbf4b6b397254a470193dadd6265989379a472e0508adb05ede68dca4786f",
    manifestBytes: 524,
    childManifestDigest: null,
    childManifestBytes: null,
    configBytes: 1037,
    layerBytes: 145,
  });
  assert.deepEqual(readProof.bootstrapOutcome, {
    runConclusion: "failure",
    receiptResult: "FAILED",
    publication: "PUBLISHED_UNADMITTED",
    authenticatedReadback: "PASSED",
    cleanup: "PASSED",
    failedPhase: "no_local_image_retained",
  });
  assert.deepEqual(Object.keys(readProof.packageSettings), [
    "packageId", "visibility", "repository", "inheritance", "actionsGrant", "proofSha256",
  ]);
  assert.deepEqual(readProof.packageSettings, {
    packageId: 16732127,
    visibility: "Private",
    repository: "CleMeY15/auto-world",
    inheritance: true,
    actionsGrant: "ADMIN",
    proofSha256: "799071c5ed9453d11bf2a7df2195c584fbdd6cd8e46f54aabceee54b97493a84",
  });
  assert.deepEqual(SCANNER_RETENTION.observations, {
    bootstrapSubject: readProof.bootstrap.subject,
    packageId: readProof.packageSettings.packageId,
    packageVisibility: readProof.packageSettings.visibility,
    packageConfiguration: {
      repository: readProof.packageSettings.repository,
      inheritance: readProof.packageSettings.inheritance,
      actionsGrant: readProof.packageSettings.actionsGrant,
      proofSha256: readProof.packageSettings.proofSha256,
    },
    anonymousRead: "AUTHORIZATION_DENIED",
    authorizedRead: "PASSED",
    publisher: {
      runId: "44009258503", runAttempt: 1, runNumber: 2,
      headSha: "9b8996413fbc32bdd9a9bbafdce57e8c38da0cff", headTree: "a72ae1e1f406f2d4c1ba6ce2472233e96b7b73bc",
      artifactId: 14296495446, artifactName: "scanner-retention-publisher-44009258503-1",
      artifactDigest: "sha256:a69744c9c8a75c9d676fbfeeb0b2cee3f442a852b30129d604f3804e805e1197",
      artifactBytes: 1478, receiptBytes: 3294,
      receiptSha256: "d38e27d05f221935a9a45ee0221d0b2ec984e7c19ba59629df2cee130c87a237",
    },
    localCopy: null,
    localRestore: null,
  });
});

test("canonical receipts retain field order, exact UTF-8 and one LF and refuse lossy values", () => {
  const expected = Buffer.from('{"b":2,"a":[true,null,"é"]}\n');
  assert.deepEqual(canonicalJsonBytes({ b: 2, a: [true, null, "é"] }, expected.length), expected);
  assert.throws(() => canonicalJsonBytes({ b: 2, a: [true, null, "é"] }, expected.length - 1), /json_cap_exceeded/u);
  const cyclic = {}; cyclic.self = cyclic;
  let getterReads = 0;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
  const hidden = Object.defineProperty({}, "value", { value: 1 });
  const hiddenLength = Object.defineProperty({}, "length", { value: 1 });
  const sparse = []; sparse[1] = true;
  for (const value of [undefined, NaN, Infinity, -0, 1.5, 2 ** 53, 1n, Symbol("x"), cyclic,
    getter, hidden, hiddenLength, sparse, new Date(), { toJSON() { return {}; } }, { [Symbol("x")]: 1 }, { x: undefined }]) {
    assert.throws(() => canonicalJsonBytes(value, 1024), /json_invalid/u);
  }
  assert.equal(getterReads, 0);
});

test("canonical receipts reject proxies before any reflective or serialization trap runs", () => {
  let traps = 0;
  const proxy = new Proxy({ value: 1 }, {
    get() { traps += 1; return 2; },
    getPrototypeOf() { traps += 1; return Object.prototype; },
    ownKeys() { traps += 1; return ["value"]; },
    getOwnPropertyDescriptor() { traps += 1; return { value: 1, enumerable: true, configurable: true }; },
  });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [proxy, { nested: proxy }, [proxy], revoked.proxy]) {
    assert.throws(() => canonicalJsonBytes(value, 1024), /json_invalid/u);
  }
  assert.equal(traps, 0);
});
