import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { namespaceTransitionIdentity } from "../scripts/postgres-image/gosu-derivative-build-v1.mjs";
import {
  GOSU_PUBLIC_FILES_V1, assertInitiallyAbsentOwnedChild, canonicalJson, canonicalSbom, compareBuildReceipts, moduleClosure, parseGosuBuildInfo,
  parseActionArtifactDigest, parseUpstreamTestJson, reviewedIdentities, validateBuildReceipt, validateControls, validateCutoffDocument, validateSemanticDocuments,
} from "../scripts/postgres-image/gosu-derivative-controls-v1.mjs";

const lock = JSON.parse(await readFile(new URL("../infra/postgres-image/materials/gosu-derivative-lock-v1.json", import.meta.url)));
const reviewed = await reviewedIdentities();
const id = (digit = "a", bytes = 1) => ({ bytes, sha256: digit.repeat(64) });
const clone = (value) => JSON.parse(JSON.stringify(value));
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const DEFAULT_GODEBUG = "asynctimerchan=1,containermaxprocs=0,cryptocustomrand=1,decoratemappings=0,gotestjsonbuildtext=1,gotypesalias=0,httpcookiemaxnum=0,httplaxcontentlength=1,httpmuxgo121=1,httpservecontentkeepheaders=1,httpservecontentmaxranges=1,multipathtcp=0,panicnil=1,randseednop=0,rsa1024min=0,tls10server=1,tls3des=1,tlsmlkem=0,tlsrsakex=1,tlssecpmlkem=0,tlssha1=1,tlsunsafeekm=1,updatemaxprocs=0,urlmaxqueryparams=0,urlstrictcolons=0,winreadlinkvolume=0,winsymlink=0,x509keypairleaf=0,x509negativeserial=1,x509rsacrt=0,x509sha256skid=0,x509usepolicies=0";
// Explicitly synthetic Gosu-shaped fixture; settings mirror the authenticated Go 1.26.9 diagnostic.
const SYNTHETIC_GOSU_BUILD_INFO = [
  "./gosu: go1.26.9", "\tpath\tgithub.com/tianon/gosu", "\tmod\tgithub.com/tianon/gosu\t(devel)\t",
  ...lock.modules.map((item) => `\tdep\t${item.path}\t${item.version}\t${item.zip.h1}`),
  "\tbuild\t-buildmode=exe", "\tbuild\t-compiler=gc", "\tbuild\t-trimpath=true",
  `\tbuild\tDefaultGODEBUG=${DEFAULT_GODEBUG}`, "\tbuild\tCGO_ENABLED=0", "\tbuild\tGOARCH=amd64",
  "\tbuild\tGOOS=linux", "\tbuild\tGOAMD64=v1", "",
].join("\n");
function receipt(repeat) {
  const files = Object.fromEntries(GOSU_PUBLIC_FILES_V1.filter((item) => !["build-receipt.json", "controls.json"].includes(item)).map((item) => [item, id()]));
  Object.assign(files, { "materials/gosu-commit.tar.gz": { bytes: lock.source.bytes, sha256: lock.source.sha256 }, "materials/go-compiler.tar.gz": { bytes: lock.compiler.bytes, sha256: lock.compiler.sha256 }, "materials/go-source.tar.gz": { bytes: lock.goSource.bytes, sha256: lock.goSource.sha256 }, "materials/gosu.go.mod": lock.source.goMod, "materials/gosu.go.sum": lock.source.goSum }); for (const item of lock.modules) for (const kind of ["zip", "mod", "info"]) files[`materials/${item[kind].file}`] = { bytes: item[kind].bytes, sha256: item[kind].sha256 };
  const binary = id("d", 123); files.gosu = binary;
  return { kind: "POSTGRES_GOSU_DERIVATIVE_BUILD_RECEIPT_V1", state: "PREPARATION_ONLY", authority: "NOT_AUTHORIZED", supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null, repeat, component: lock.component, lock: clone(reviewed.lock), ci: { runId: "123", runAttempt: "1", headSha: "a".repeat(40), job: `build_${repeat}` }, source: { commit: lock.source.commit, archive: { bytes: lock.source.bytes, sha256: lock.source.sha256 }, vcsStamping: "DISABLED" }, compiler: { version: lock.compiler.identity, archive: { bytes: lock.compiler.bytes, sha256: lock.compiler.sha256 } }, node: { version: "v22.23.2", executable: clone(reviewed.node) }, helper: clone(reviewed.helper), environment: { nodeOptionsEmpty: true, nodePathEmpty: true, goEnvOff: true, goToolchainLocal: true, goWorkOff: true, goFlagsEmpty: true }, networkCutoff: { checks: { namespaceChanged: true, loopbackDown: true, routesEmpty: true, ordinaryIdentity: true, zeroCapabilities: true, noNewPrivileges: true }, evidence: { namespaceTransition: id("1", 40), status: id("2", 512), routes: id("3", 128), loopbackFlags: id("4", 7) } }, build: { package: lock.build.package, flags: lock.build.flags, goos: lock.build.goos, goarch: lock.build.goarch, cgoEnabled: lock.build.cgoEnabled, mainVersion: "(devel)", vcs: false }, tests: { count: 0, passed: 0, skipped: 0, failed: 0, packagesPassed: 1, packagesSkipped: 0, functionalValidation: "NOT_ESTABLISHED" }, binary, files, claims: { preparation: "REPRODUCIBLE_SOURCE_PREPARATION_ONLY", candidateAdmission: "NOT_AUTHORIZED", vulnerabilityClearance: "NOT_ESTABLISHED", functionalValidation: "NOT_ESTABLISHED", actualTestCount: 0 } };
}

test("receipt closes preparation authority, null dates, runtime/helper identities and zero-test truth", () => {
  const value = receipt(1); assert.deepEqual(validateBuildReceipt(value, lock, reviewed), value); const receiptBytes = Buffer.from(canonicalJson(value)); assert.equal(validateControls({ kind: "POSTGRES_GOSU_DERIVATIVE_CONTROLS_V1", state: "PREPARATION_ONLY", authority: "NOT_AUTHORIZED", supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null, valid: true, receipt: { bytes: receiptBytes.length, sha256: createHash("sha256").update(receiptBytes).digest("hex") }, files: value.files }, value), true); const comparison = compareBuildReceipts(value, receipt(2), lock, reviewed, { leftTar: id("1", 100), rightTar: id("2", 100), leftArtifact: "3".repeat(64), rightArtifact: "4".repeat(64) }); assert.equal(comparison.authority, "NOT_AUTHORIZED"); assert.equal(comparison.functionalValidation, "NOT_ESTABLISHED"); assert.equal(comparison.ci.headSha, "a".repeat(40));
});

test("receipt accepts exact empty route evidence and rejects inconsistent empty identities", () => {
  const empty = receipt(1); empty.networkCutoff.evidence.routes = { bytes: 0, sha256: EMPTY_SHA256 };
  assert.deepEqual(validateBuildReceipt(empty, lock, reviewed), empty);
  for (const routes of [
    { bytes: 0, sha256: "3".repeat(64) },
    { bytes: 1, sha256: EMPTY_SHA256 },
    { bytes: 1024 * 1024 + 1, sha256: "3".repeat(64) },
    { bytes: -1, sha256: EMPTY_SHA256 },
  ]) {
    const value = receipt(1); value.networkCutoff.evidence.routes = routes;
    assert.throws(() => validateBuildReceipt(value, lock, reviewed), /gosu_receipt_network_invalid/u);
  }
});

test("receipt rejects unknown/prototype/private data, weakened boundary, flags and reproduction mismatch", () => {
  const mutations = [
    (x) => { x.unknown = true; }, (x) => { Object.setPrototypeOf(x, { polluted: true }); }, (x) => { x.supportStartsAt = "2026-01-01"; },
    (x) => { x.node.version = "v22.22.0"; }, (x) => { x.helper.build.sha256 = "x".repeat(64); }, (x) => { x.environment.nodeOptionsEmpty = false; },
    (x) => { x.networkCutoff.checks.zeroCapabilities = false; }, (x) => { x.networkCutoff.evidence.routes.bytes = 0; }, (x) => { x.build.flags = ["-trimpath"]; }, (x) => { x.claims.candidateAdmission = "AUTHORIZED"; },
    (x) => { x.claims.note = "C:\\Users\\secret"; },
  ];
  for (const mutate of mutations) { const value = receipt(1); mutate(value); assert.throws(() => validateBuildReceipt(value, lock, reviewed), /gosu_/u); }
  const right = receipt(2); right.binary.sha256 = "e".repeat(64); assert.throws(() => compareBuildReceipts(receipt(1), right, lock, reviewed, { leftTar: id("1", 100), rightTar: id("2", 100), leftArtifact: "3".repeat(64), rightArtifact: "4".repeat(64) }), /gosu_reproducibility_mismatch/u);
  const coordinatedHelper = receipt(1); coordinatedHelper.helper.build = id("9", 9); const forgedReview = clone(reviewed); forgedReview.helper.build = coordinatedHelper.helper.build; assert.throws(() => validateBuildReceipt(coordinatedHelper, lock, forgedReview), /gosu_receipt_review_identity_missing/u);
  const mutatedLock = clone(lock); mutatedLock.compiler.observedArchive.unknown = 1; const coordinatedLock = receipt(1); coordinatedLock.lock = id("8", 8); const forgedLockReview = clone(reviewed); forgedLockReview.lock = coordinatedLock.lock; assert.throws(() => validateBuildReceipt(coordinatedLock, mutatedLock, forgedLockReview), /gosu_lock_shape_invalid/u);
  for (const mutate of [(x) => { x.sumdb = "off"; }, (x) => { x.source.url = "https://example.invalid/gosu"; }, (x) => { x.modules[0].proxyBase = "https://example.invalid/module"; }, (x) => { x.build.flags = ["-trimpath"]; }]) { const changed = clone(lock); mutate(changed); assert.throws(() => validateBuildReceipt(receipt(1), changed, reviewed), /gosu_lock_(?:contract|review_binding)_invalid/u); }
});

test("review handles cannot rewrite their private byte-derived snapshot", async () => {
  const handle = await reviewedIdentities(); const original = receipt(1); assert.deepEqual(validateBuildReceipt(original, lock, handle), original);
  handle.lock.bytes = 1; handle.lock = id("5", 5); handle.lockValue.source.commit = "b".repeat(40); handle.lockValue = { forged: true }; handle.node.sha256 = "6".repeat(64); handle.node = id("6", 6); handle.helper.build.sha256 = "7".repeat(64); handle.helper = { build: id("7", 7), controls: id("8", 8), archives: id("9", 9) };
  assert.deepEqual(validateBuildReceipt(original, lock, handle), original);
  for (const mutate of [(x) => { x.lock = id("5", 5); }, (x) => { x.node.executable = id("6", 6); }, (x) => { x.helper = clone(handle.helper); }, (x) => { x.source.commit = "b".repeat(40); }]) { const forged = receipt(1); mutate(forged); assert.throws(() => validateBuildReceipt(forged, lock, handle), /gosu_receipt_(?:lock|node|helper|source)_invalid/u); }
  for (const mutate of [(x) => { x.source.commit = "b".repeat(40); }, (x) => { x.source.root = "gosu-forged"; }, (x) => { x.source.url = "https://example.invalid/gosu"; }]) { const forgedLock = clone(lock); mutate(forgedLock); assert.throws(() => validateBuildReceipt(original, forgedLock, handle), /gosu_lock_(?:contract|review_binding)_invalid/u); }
  await assert.rejects(reviewedIdentities(new URL("../infra/postgres-image/materials/gosu-derivative-lock-v1.json", import.meta.url)), /gosu_receipt_review_arguments_invalid/u);
});

test("Actions artifact digest accepts the pinned action bare SHA-256 output only", () => {
  const digest = "a".repeat(64); assert.equal(parseActionArtifactDigest(digest), digest); for (const invalid of [`sha256:${digest}`, digest.toUpperCase(), "a".repeat(63), `${digest} `]) assert.throws(() => parseActionArtifactDigest(invalid), /gosu_compare_environment_invalid/u);
});

test("cutoff evidence is closed and hash-bound to the receipt", () => {
  const value = receipt(1); const document = { kind: "GOSU_NETWORK_CUTOFF_V1", checks: value.networkCutoff.checks, evidence: value.networkCutoff.evidence }; assert.equal(validateCutoffDocument(Buffer.from(canonicalJson(document)), value), true);
  for (const mutate of [(x) => { x.evidence.routes.sha256 = "f".repeat(64); }, (x) => { x.evidence.namespaceTransition.raw = "net:[1]"; }, (x) => { delete x.evidence.status; }]) { const forged = clone(document); mutate(forged); assert.throws(() => validateCutoffDocument(Buffer.from(canonicalJson(forged)), value), /gosu_cutoff_invalid/u); }
});

test("namespace transition evidence binds both private operands without exposing either", () => {
  const first = namespaceTransitionIdentity("net:[123]", "net:[456]"); const changedOriginal = namespaceTransitionIdentity("net:[124]", "net:[456]"); const changedCurrent = namespaceTransitionIdentity("net:[123]", "net:[457]"); assert.equal(first.bytes, 26); assert.notEqual(first.sha256, changedOriginal.sha256); assert.notEqual(first.sha256, changedCurrent.sha256); assert.deepEqual(Object.keys(first), ["bytes", "sha256"]); assert.throws(() => namespaceTransitionIdentity("net:[123]", "net:[123]"), /gosu_offline_network_invalid/u);
});

test("test event parser distinguishes tests from package events and rejects missing/failing terminals", () => {
  const zero = parseUpstreamTestJson('{"Action":"start","Package":"github.com/tianon/gosu"}\n{"Action":"pass","Package":"github.com/tianon/gosu"}\n'); assert.equal(zero.run, 0); assert.equal(zero.functionalValidation, "NOT_ESTABLISHED");
  const one = parseUpstreamTestJson('{"Action":"start","Package":"p"}\n{"Action":"run","Package":"p","Test":"TestOne"}\n{"Action":"pass","Package":"p","Test":"TestOne"}\n{"Action":"pass","Package":"p"}\n'); assert.equal(one.run, 1); assert.equal(one.passed, 1);
  assert.throws(() => parseUpstreamTestJson('{"Action":"run","Package":"p","Test":"TestOne"}\n'), /gosu_tests_invalid/u);
  assert.throws(() => parseUpstreamTestJson('{"Action":"start","Package":"p"}\n{"Action":"run","Package":"p","Test":"TestOne"}\n{"Action":"fail","Package":"p","Test":"TestOne"}\n{"Action":"fail","Package":"p"}\n'), /gosu_tests_failed/u);
  assert.throws(() => parseUpstreamTestJson('{"Action":"mystery","Package":"p"}\n'), /gosu_tests_invalid/u);
  for (const invalid of ["", '{"Action":"output","Package":"p"}\n', '{"Action":"run","Package":"p","Test":"TestOne"}\n{"Action":"pass","Package":"p","Test":"TestOne"}\n']) assert.throws(() => parseUpstreamTestJson(invalid), /gosu_tests_invalid/u);
});

test("build-info parser requires truthful devel main, exact closure, platform and no VCS stamping", () => {
  assert.equal(parseGosuBuildInfo(SYNTHETIC_GOSU_BUILD_INFO, lock).main.version, "(devel)");
  const firstDependency = lock.modules[0]; const dependency = `\tdep\t${firstDependency.path}\t${firstDependency.version}\t${firstDependency.zip.h1}`;
  const invalid = [
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOOS=linux\n", "\tbuild\t-ldflags=-d\n\tbuild\tGOOS=linux\n"),
    SYNTHETIC_GOSU_BUILD_INFO.replace(`\tbuild\tDefaultGODEBUG=${DEFAULT_GODEBUG}\n`, ""),
    SYNTHETIC_GOSU_BUILD_INFO.replace(DEFAULT_GODEBUG, `${DEFAULT_GODEBUG}x`),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOAMD64=v1\n", ""),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOAMD64=v1", "\tbuild\tGOAMD64=v2"),
    ...["GOEXPERIMENT=arenas", "GOFIPS140=v1.0.0", "UNKNOWN=value"].map((setting) => SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOOS=linux\n", `\tbuild\t${setting}\n\tbuild\tGOOS=linux\n`)),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tpath\tgithub.com/tianon/gosu\n", ""),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tpath\tgithub.com/tianon/gosu\n", "\tpath\tgithub.com/tianon/gosu\n\tpath\tgithub.com/tianon/gosu\n"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tmod\tgithub.com/tianon/gosu\t(devel)\t\n", ""),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tmod\tgithub.com/tianon/gosu\t(devel)\t\n", "\tmod\tgithub.com/tianon/gosu\t(devel)\t\n\tmod\tgithub.com/tianon/gosu\t(devel)\t\n"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOOS=linux\n", ""),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOOS=linux\n", "\tbuild\tGOOS=linux\n\tbuild\tGOOS=linux\n"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tpath\tgithub.com/tianon/gosu", "\tpath\tgithub.com/tianon/gosu\textra"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tmod\tgithub.com/tianon/gosu\t(devel)\t", "\tmod\tgithub.com/tianon/gosu\t(devel)\t\textra"),
    SYNTHETIC_GOSU_BUILD_INFO.replace(dependency, `${dependency}\textra`),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOOS=linux", "\tbuild\tGOOS=linux\textra"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tmod\tgithub.com/tianon/gosu\t(devel)\t", "\tmod\tgithub.com/tianon/gosu\t(devel)"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tmod\tgithub.com/tianon/gosu\t(devel)\t", "\tmod\tgithub.com/tianon/gosu\t(devel)\tnonempty"),
    SYNTHETIC_GOSU_BUILD_INFO.replace(dependency, `\tdep\t${firstDependency.path}\t${firstDependency.version}`),
    SYNTHETIC_GOSU_BUILD_INFO.replace("GOOS=linux", 'GOOS="linux"'),
    SYNTHETIC_GOSU_BUILD_INFO.replace("GOOS=linux", 'GOOS=linux"'),
    SYNTHETIC_GOSU_BUILD_INFO.replace("GOOS=linux", 'GOOS="linux'),
    SYNTHETIC_GOSU_BUILD_INFO.slice(0, -1), `${SYNTHETIC_GOSU_BUILD_INFO}\n`,
    SYNTHETIC_GOSU_BUILD_INFO.replace("\n\tdep", "\n\n\tdep"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\n\tdep", "\r\n\tdep"), `${SYNTHETIC_GOSU_BUILD_INFO.slice(0, -1)}\0\n`,
    SYNTHETIC_GOSU_BUILD_INFO.replace("go1.26.9", "go1.26.8"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tpath\tgithub.com/tianon/gosu", "\tpath\tgithub.com/example/gosu"),
    SYNTHETIC_GOSU_BUILD_INFO.replace("\tmod\tgithub.com/tianon/gosu\t(devel)\t", "\tmod\tgithub.com/tianon/gosu\tv1.19\t"),
    SYNTHETIC_GOSU_BUILD_INFO.replace(firstDependency.zip.h1, "h1:forged"),
  ];
  for (const text of invalid) assert.throws(() => parseGosuBuildInfo(text, lock), /gosu_build_info_invalid/u);
  for (const key of ["vcs", "vcs.revision"]) {
    const vcs = SYNTHETIC_GOSU_BUILD_INFO.replace("\tbuild\tGOOS=linux", `\tbuild\tUNKNOWN=value\n\tbuild\t${key}=git`);
    assert.throws(() => parseGosuBuildInfo(vcs, lock), /^Error: gosu_build_info_vcs_invalid$/u);
  }
  const alteredReceipt = receipt(1); alteredReceipt.build.flags = ["-trimpath"];
  assert.throws(() => validateBuildReceipt(alteredReceipt, lock, reviewed), /gosu_receipt_build_invalid/u);
});

test("retained semantics reject a forged CycloneDX document even when its receipt identity is coordinated", async () => {
  const value = receipt(1);
  const forged = canonicalSbom(lock, value.binary); forged.metadata.forged = true; const sbomBody = Buffer.from(canonicalJson(forged)); value.files["sbom.cdx.json"] = { bytes: sbomBody.length, sha256: createHash("sha256").update(sbomBody).digest("hex") };
  const bodies = new Map([["version.txt", { body: Buffer.from("1.19 (go1.26.9 on linux/amd64; gc)\n") }], ["build-info.txt", { body: Buffer.from(SYNTHETIC_GOSU_BUILD_INFO) }], ["module-closure.json", { body: Buffer.from(canonicalJson(moduleClosure(lock))) }], ["sbom.cdx.json", { body: sbomBody }]]);
  await assert.rejects(validateSemanticDocuments(bodies, value, lock), /gosu_sbom_invalid/u);
});

test("owned paths must be initially absent direct children and reject occupied targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-")); try { const target = await assertInitiallyAbsentOwnedChild(root, "aw-gosu-preparation-1"); assert.equal(target, path.join(await import("node:fs/promises").then((fs) => fs.realpath(root)), "aw-gosu-preparation-1")); await import("node:fs/promises").then((fs) => fs.mkdir(target)); await assert.rejects(assertInitiallyAbsentOwnedChild(root, "aw-gosu-preparation-1"), /gosu_owned_target_occupied/u); await assert.rejects(assertInitiallyAbsentOwnedChild(root, "other"), /gosu_owned_path_invalid/u); } finally { await rm(root, { recursive: true, force: true }); }
});

test("owned path validation rejects a symbolic ancestor", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gosu-symlink-")); const alias = path.join(root, "alias"); try { const actual = path.join(root, "actual"); await mkdir(actual); try { await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir"); } catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { context.skip("symlink privilege unavailable"); return; } throw error; } await assert.rejects(assertInitiallyAbsentOwnedChild(alias, "aw-gosu-preparation-1"), /gosu_owned_path_invalid/u); } finally { await unlink(alias).catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test("preparer source requires clean Node/Go environment and a real netns privilege drop", async () => {
  const source = await readFile(new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url), "utf8");
  for (const expected of ["sudo", "unshare", "--net", "setpriv", "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "CapEff", "CapBnd", "CapAmb", "NoNewPrivs", "GOPROXY", "off", "NODE_OPTIONS", "NODE_PATH"]) assert.equal(source.includes(expected), true, expected);
  assert.doesNotMatch(source, /docker\s+(?:build|push)|gh\s+workflow\s+run|packages:\s*write/u);
});

test("a real Linux child in the parent network namespace is rejected", { skip: process.platform !== "linux" }, () => {
  const moduleUrl = new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url).href; const program = `const m=await import(${JSON.stringify(moduleUrl)});const same=await m.readNetworkNamespaceIdentity();await m.assertNetworkNamespaceChanged(same);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], { encoding: "utf8" }); assert.notEqual(result.status, 0); assert.match(result.stderr, /gosu_offline_network_invalid/u);
});

test("lock keeps exact distinct originals and records observed Go archive measures", () => {
  assert.equal(lock.source.bytes, 17631); assert.equal(lock.source.sha256, "33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b"); assert.equal(lock.compiler.observedArchive.entries, 16712); assert.equal(lock.compiler.observedArchive.regularBytes, 232610743); assert.equal(lock.goSource.observedArchive.entries, 16686); assert.equal(lock.goSource.observedArchive.regularBytes, 145201405); assert.deepEqual(lock.modules.map((item) => item.zip.bytes), [13793, 1861264]);
});
