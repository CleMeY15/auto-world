import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearInterval, setInterval } from "node:timers";
import test from "node:test";
import { validatePostgresGosuReportInventory } from "../scripts/postgres-image/audit-policy.mjs";
import { collectPostgresSourceInventory, validatePostgresSourceInventory, validatePostgresSourceInventoryAcknowledgement,
  postgresSourceInventoryFailureDiagnostic, validatePostgresSourceInventoryFailureDiagnostic } from "../scripts/postgres-image/source-inventory.mjs";
import { POSTGRES_SOURCE_INVENTORY_PIN as PIN, POSTGRES_SOURCE_INVENTORY_CLAIMS as CLAIMS } from "../scripts/postgres-image/source-inventory-policy.mjs";

const rootSource = fileURLToPath(new URL("../", import.meta.url));
const clone = (v) => globalThis.structuredClone(v);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (v) => Buffer.from(JSON.stringify(v));
const property = (name, value) => ({ name: "aquasecurity:trivy:" + name, value });
const gosu = "github.com/tianon/gosu";
const dependencies = ["github.com/moby/sys/user@v0.1.0", "golang.org/x/sys@v0.1.0", "stdlib@v1.26.8"];
function reports() {
  const subject = PIN.expected.subject; const layer = subject.diffIds.at(-1);
  const apk = [{ Name: ".postgresql-rundeps", Version: "20260917.213131" }, { Name: "gosu", Version: "1.19-r5", SrcName: "gosu", SrcVersion: "1.19-r5", Licenses: ["Apache-2.0"] }];
  for (let i = 0; i < 44; i++) apk.push({ Name: `fixture${String(i).padStart(2, "0")}`, Version: "1.0-r0", SrcName: `origin${String(i % 34).padStart(2, "0")}`, SrcVersion: "1.0-r0", Licenses: i === 0 ? ["MIT", "BSD-2-Clause"] : ["MIT"] });
  const go = dependencies.map((entry) => { const at = entry.lastIndexOf("@"); return { Name: entry.slice(0, at), Version: entry.slice(at + 1) }; });
  go.push({ Name: gosu, ID: gosu, Relationship: "root", AnalyzedBy: "gobinary", DependsOn: [...dependencies] });
  const libraries = [];
  for (const [type, list] of [["alpine", apk], ["gobinary", go]]) for (const pkg of list) {
    const purl = type === "alpine" ? `pkg:apk/alpine/${pkg.Name}@${pkg.Version}?arch=x86_64&distro=3.24.2` : `pkg:golang/${pkg.Name}${pkg.Version ? "@" + pkg.Version : ""}`;
    pkg.ID ??= pkg.Name + (pkg.Version ? "@" + pkg.Version : ""); pkg.Identifier = { PURL: purl, UID: "opaque-fixture-uid" }; pkg.Layer = { DiffID: layer };
    libraries.push({ type: "library", name: pkg.Name, ...(pkg.Version ? { version: pkg.Version } : {}), purl, "bom-ref": purl,
      ...(Object.hasOwn(pkg, "Licenses") ? { licenses: pkg.Licenses.map((id) => ({ license: { id } })) } : {}),
      properties: [property("PkgType", type), property("PkgID", pkg.ID), property("LayerDiffID", layer),
        ...(pkg.SrcName ? [property("SrcName", pkg.SrcName), property("SrcVersion", pkg.SrcVersion)] : [])] });
  }
  return { vulnerabilityReport: { SchemaVersion: 2, Trivy: { Version: "0.74.0-autoworld.2" }, CreatedAt: "2000-01-01T00:00:00Z", ArtifactType: "container_image", ArtifactName: subject.artifactName,
    Metadata: { ImageID: subject.imageId, RepoTags: [subject.tag], DiffIDs: clone(subject.diffIds), ImageConfig: { os: subject.os, architecture: subject.architecture, rootfs: { type: "layers", diff_ids: clone(subject.diffIds) } },
      OS: { Family: "alpine", Name: "3.24.2" } }, Results: [{ Target: `${subject.artifactName} (alpine 3.24.2)`, Class: "os-pkgs", Type: "alpine", Packages: apk },
      { Target: "usr/bin/gosu", Class: "lang-pkgs", Type: "gobinary", Packages: go }] },
  cyclonedxReport: { bomFormat: "CycloneDX", specVersion: "1.7", version: 1, metadata: { component: { type: "container", name: subject.artifactName } }, components: [...libraries,
    { type: "application", name: "usr/bin/gosu", properties: [property("Type", "gobinary"), property("Class", "lang-pkgs")] },
    { type: "operating-system", name: "alpine", version: "3.24.2", properties: [property("Type", "alpine"), property("Class", "os-pkgs")] }],
  dependencies: [{ ref: "pkg:golang/" + gosu, dependsOn: dependencies.map((v) => "pkg:golang/" + v) }] }, expected: clone(PIN.expected) };
}
const validate = (pair) => validatePostgresGosuReportInventory(pair);
const component = (pair, name) => pair.cyclonedxReport.components.find((v) => v.name === name);
const pkg = (pair, name) => pair.vulnerabilityReport.Results.flatMap((v) => v.Packages).find((v) => v.Name === name);
function coherentLicenseMutation(pair) { pkg(pair, "fixture00").Licenses = ["BSD-3-Clause"]; component(pair, "fixture00").licenses = [{ license: { name: "BSD-3-Clause" } }]; }

test("pure historical inventory has exactly fifty identities, preserves declarations, and grants structural parity only", () => {
  const value = validate(reports());
  assert.equal(value.state, "PARITY_VERIFIED"); assert.deepEqual(value.counts, { jsonResultCount: 2, packageCount: 50, apkPackageCount: 46, goPackageCount: 4,
    sbomComponentCount: 52, libraryComponentCount: 50, applicationComponentCount: 1, osComponentCount: 1, namedApkOriginCount: 35, virtualApkCount: 1 });
  const item = value.packages.find((v) => v.name === "fixture00");
  assert.deepEqual(item.declarations, { json: { present: true, values: ["MIT", "BSD-2-Clause"] },
    cyclonedx: { present: true, values: [{ license: { id: "MIT" } }, { license: { id: "BSD-2-Clause" } }] }, textParity: "RAW_DECLARED_TEXT_MATCH" });
  assert.equal(item.sourceBinding, "NOT_ESTABLISHED"); assert.equal(value.packages.find((v) => v.name === gosu).version, null);
  assert.deepEqual(value.goDependencies, { ref: "pkg:golang/" + gosu, dependsOn: ["pkg:golang/github.com/moby/sys/user@v0.1.0", "pkg:golang/golang.org/x/sys@v0.1.0", "pkg:golang/stdlib@v1.26.8"] });
  assert.deepEqual(value.virtualApk, { name: ".postgresql-rundeps", version: "20260917.213131", state: "UNRESOLVED_SYNTHETIC" });
  assert.equal(value.nonPackageComponents.length, 2); assert.ok(Object.isFrozen(value.packages[0].declarations)); assert.equal(value.currentness, undefined);
});
test("pure parity permits coherent two-report mutation while preserving exact id versus name and absent versus empty representations", () => {
  const pair = reports(); coherentLicenseMutation(pair); const value = validate(pair);
  assert.deepEqual(value.packages.find((v) => v.name === "fixture00").declarations.cyclonedx.values, [{ license: { name: "BSD-3-Clause" } }]);
  const absent = value.packages.find((v) => v.name === "stdlib"); assert.deepEqual(absent.declarations.json, { present: false, values: null });
  pkg(pair, "stdlib").Licenses = []; const empty = validate(pair).packages.find((v) => v.name === "stdlib");
  assert.deepEqual(empty.declarations.json, { present: true, values: [] }); assert.equal(empty.declarations.textParity, "SINGLE_REPORT_DECLARATION");
});
test("report-only source declarations are kept without inventing absent CycloneDX properties", () => {
  const pair = reports(); component(pair, "fixture10").properties = component(pair, "fixture10").properties.filter((v) => !v.name.endsWith(":SrcName") && !v.name.endsWith(":SrcVersion"));
  pkg(pair, "fixture10").SrcVersion = "changed-json-declaration";
  const value = validate(pair); assert.equal(value.packages.find((v) => v.name === "fixture10").origin.version, "changed-json-declaration");
});
test("metadata, target, component, identity, PURL, layer and dependency substitutions fail closed", () => {
  const mutations = [
    (p) => { p.expected.subject.imageId = [p.expected.subject.imageId]; }, (p) => { p.expected.packageCount = [50]; },
    (p) => { p.expected.packages = []; }, (p) => { p.vulnerabilityReport.Metadata.RepoTags[0] += "wrong"; },
    (p) => { p.vulnerabilityReport.Metadata.ImageConfig.architecture = "arm64"; }, (p) => { p.vulnerabilityReport.Results.pop(); },
    (p) => { p.cyclonedxReport.components.pop(); }, (p) => { component(p, "fixture00").type = "unknown"; },
    (p) => { p.vulnerabilityReport.Results[0].Packages.push(clone(pkg(p, "gosu"))); },
    (p) => { component(p, "fixture00").purl += "&unexpected=1"; }, (p) => { component(p, "fixture00").properties[1].value = "wrong"; },
    (p) => { pkg(p, "fixture00").Layer.DiffID = p.expected.subject.diffIds[0]; },
    (p) => { component(p, "fixture00").properties.push(clone(component(p, "fixture00").properties[0])); },
    (p) => { pkg(p, gosu).Version = "1.19"; }, (p) => { p.cyclonedxReport.dependencies[0].dependsOn.pop(); },
    (p) => { pkg(p, ".postgresql-rundeps").SrcName = "postgresql"; pkg(p, ".postgresql-rundeps").SrcVersion = "17.11"; },
    (p) => { component(p, "fixture00").licenses[0].license.id = "changed-only-one-report"; },
    (p) => { component(p, "fixture00").licenses = [{ expression: "MIT AND BSD-2-Clause" }]; },
    (p) => { pkg(p, "fixture00").Licenses.push("MIT"); }, (p) => { component(p, "fixture00").properties[4].value = "different-source-version"; },
    (p) => { p.vulnerabilityReport.Results[1].Target = "usr/local/bin/gosu"; },
  ];
  for (const mutate of mutations) { const pair = reports(); mutate(pair); assert.throws(() => validate(pair), { message: "postgres_gosu_audit_invalid" }); }
});
test("accessors, hidden keys, Symbols, holes and coercion fail before getter evaluation", () => {
  let reads = 0;
  for (const alter of [
    (p) => Object.defineProperty(p.expected, "packageCount", { enumerable: true, get() { reads++; return 50; } }),
    (p) => Object.defineProperty(p.expected, "private", { value: true }), (p) => { p.expected[Symbol("private")] = true; },
    (p) => { delete p.cyclonedxReport.components[3]; }, (p) => { p.cyclonedxReport.components.extra = true; },
    (p) => { pkg(p, "fixture00").Licenses[0] = ["MIT"]; },
  ]) { const pair = reports(); alter(pair); assert.throws(() => validate(pair), { message: "postgres_gosu_audit_invalid" }); }
  assert.equal(reads, 0);
});
test("unknown Proxy exceptions are masked without reading exception message getters", () => {
  let reads = 0; const error = new Error(); Object.defineProperty(error, "message", { get() { reads++; throw new Error("private fixture"); } });
  const value = new Proxy({}, { getPrototypeOf() { throw error; } });
  assert.throws(() => validate(value), { message: "postgres_gosu_audit_invalid" }); assert.equal(reads, 0);
});
test("failure diagnostics are bounded and cleanup uncertainty cannot become confirmed", () => {
  let reads = 0; const alternating = { get message() { reads++; return reads === 1 ? "postgres_source_inventory_file_changed" : "private"; }, phase: "REPORTS", cleanup: "CONFIRMED" };
  assert.deepEqual(postgresSourceInventoryFailureDiagnostic(alternating), { code: "postgres_source_inventory_file_changed", phase: "REPORTS", cleanup: "CONFIRMED" }); assert.equal(reads, 1);
  for (const value of [null, new Error("private fixture"), { get message() { throw new Error("private"); } }])
    assert.deepEqual(postgresSourceInventoryFailureDiagnostic(value), { code: "postgres_source_inventory_operation_failed", phase: "CONTEXT", cleanup: "UNVERIFIED" });
  assert.deepEqual(postgresSourceInventoryFailureDiagnostic({ message: "postgres_source_inventory_cleanup_uncertain", phase: "CLEANUP", cleanup: "CONFIRMED" }),
    { code: "postgres_source_inventory_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNVERIFIED" });
  assert.throws(() => validatePostgresSourceInventoryFailureDiagnostic({ code: "postgres_source_inventory_cleanup_uncertain", phase: "CLEANUP", cleanup: "CONFIRMED" }));
});
test("malformed collector input and actual unsupported actors refuse without a destination", async () => {
  await assert.rejects(collectPostgresSourceInventory({}), { message: "postgres_source_inventory_arguments_invalid" });
  if (process.platform !== "linux" || process.getuid() !== 1000 || process.getgid() !== 1000) {
    const nonce = "a".repeat(24);
    await assert.rejects(collectPostgresSourceInventory({ workspace: PIN.workspace, recipeRevision: "a".repeat(40), executionId: PIN.executionPrefix + nonce,
      directory: path.posix.join(PIN.parent, PIN.directoryPrefix + nonce) }), { message: "postgres_source_inventory_requires_native_actor" });
  }
});
const metadata = (file) => { const s = fs.lstatSync(file, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }; };
const write = (file, bytes, mode = 0o600) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, bytes, { mode, flag: "wx" }); };
function git(directory, args) { const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, timeout: 10000, maxBuffer: 16384, encoding: "utf8",
  env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" } });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, ""); return result.stdout.trim(); }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-source-inventory-fixture-"))); fs.chmodSync(root, 0o700); const own = metadata(root);
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.equal(metadata(root).ino, own.ino); assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-source-inventory-fixture-"))); fs.rmSync(root, { recursive: true }); });
  const workspace = path.join(root, "workspace"); const parent = path.join(root, "private"); const audit = path.join(root, "audit");
  for (const dir of [workspace, parent, audit]) fs.mkdirSync(dir, { mode: dir === parent ? 0o750 : 0o700 }); fs.chmodSync(parent, 0o750);
  git(workspace, ["init", "--quiet", "--template="]);
  const pair = reports(); const bytes = [encode(pair.vulnerabilityReport), encode(pair.cyclonedxReport)];
  const reportPins = PIN.reports.map((file, i) => { write(path.join(audit, file.name), bytes[i]); return { ...file, size: bytes[i].length, sha256: hash(bytes[i]) }; });
  const materialPins = PIN.materials.map((file, i) => { const b = Buffer.from(`harmless fixture material ${i}\n`); write(path.join(workspace, file.source), b); return { ...file, size: b.length, sha256: hash(b) }; });
  git(workspace, ["add", "--all"]); git(workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "harmless material fixture"]);
  const recipeRevision = git(workspace, ["rev-parse", "HEAD"]); const nonce = randomBytes(12).toString("hex"); const pin = { ...clone(PIN), workspace, parent, auditDirectory: audit,
    parentIdentity: Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map((key) => [key, metadata(parent)[key]])), reports: reportPins, materials: materialPins };
  const input = { workspace, recipeRevision, executionId: PIN.executionPrefix + nonce, directory: path.join(parent, pin.directoryPrefix + nonce) };
  return { root, input, pin, pair };
}
const nativeActor = process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000 &&
  JSON.stringify(process.getgroups()) === "[1000]" && /^Groups:[ \t]*$/mu.test(fs.readFileSync("/proc/self/status", "utf8")) && /^NoNewPrivs:[ \t]+1$/mu.test(fs.readFileSync("/proc/self/status", "utf8"));
const gitVersion = process.platform === "linux" ? spawnSync("/usr/bin/git", ["--version"], { encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } }).stdout.trim() : null;
if (nativeActor && gitVersion === "git version 2.43.0") {
  test("PARTIAL_HELPER_PROOF native seven-file inventory keeps historical declarations and closes all FDs before its single ACK callback", async (t) => {
    const f = fixture(t); let callbacks = 0;
    const result = await collectPostgresSourceInventory(f.input, { result: (ack) => { callbacks++; assert.equal(ack.descriptorsClosed, true);
      for (const name of fs.readdirSync("/proc/self/fd")) { let target; try { target = fs.readlinkSync("/proc/self/fd/" + name); } catch { continue; } assert.ok(!target.startsWith(f.root)); }
    } }, { pin: f.pin });
    assert.equal(callbacks, 1); const expected = { recipeRevision: f.input.recipeRevision, executionId: f.input.executionId, directory: f.input.directory };
    assert.deepEqual(validatePostgresSourceInventoryAcknowledgement(result, expected), result);
    const file = path.join(f.input.directory, "inventory.json"); const bytes = fs.readFileSync(file);
    assert.equal(hash(bytes), result.inventory.sha256); assert.deepEqual(metadata(file), result.inventory.identity);
    const value = validatePostgresSourceInventory(JSON.parse(bytes), f.input, f.pin);
    assert.deepEqual(value.claims, CLAIMS); assert.deepEqual(value.nonApkRuntime, PIN.nonApkRuntime); assert.equal(value.lowerLayers.state, "UNVERIFIED");
    assert.equal(value.reports.length, 2); assert.equal(value.materials.length, 5); assert.ok(value.materials.every((v) => v.state === "AVAILABLE_NOT_FULL_SOURCE"));
    assert.deepEqual(fs.readdirSync(f.input.directory), ["inventory.json"]); assert.equal(metadata(f.pin.parent).mode, 0o750);
    for (const mutate of [(v) => { v.claims.currentness = "VERIFIED"; }, (v) => { v.claims.supportStartedAt = "2000-01-01T00:00:00Z"; },
      (v) => { v.inventory.packages[0].sourceBinding = "VERIFIED"; }, (v) => { v.materials[0].state = "FULL_SOURCE"; }, (v) => { v.lowerLayers.state = "VERIFIED"; },
      (v) => { v.reports[0].identity.ino = [v.reports[0].identity.ino]; }, (v) => { v.nonApkRuntime.proofReference.readDuringCollection = true; },
      (v) => { v.inventory.counts.packageCount = 51; }, (v) => { v.inventory.apkOrigins.pop(); }, (v) => { v.private = "fixture"; }]) {
      const bad = clone(value); mutate(bad); assert.throws(() => validatePostgresSourceInventory(bad, f.input, f.pin));
    }
    const hidden = clone(value); Object.defineProperty(hidden.claims, "closure", { value: hidden.claims.closure, enumerable: false }); assert.throws(() => validatePostgresSourceInventory(hidden, f.input, f.pin));
    const badAck = clone(result); badAck.descriptorsClosed = false; assert.throws(() => validatePostgresSourceInventoryAcknowledgement(badAck, expected));
  });
  test("coherent double-report pure mutation is refused by independent native byte pins before publication", async (t) => {
    const f = fixture(t); coherentLicenseMutation(f.pair); assert.equal(validate(f.pair).state, "PARITY_VERIFIED");
    for (const [i, value] of [f.pair.vulnerabilityReport, f.pair.cyclonedxReport].entries()) fs.writeFileSync(path.join(f.pin.auditDirectory, f.pin.reports[i].name), encode(value));
    await assert.rejects(collectPostgresSourceInventory(f.input, {}, { pin: f.pin }), { message: "postgres_source_inventory_file_changed" }); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("native material substitution, link, wrong parent profile and destination collisions deny success", async (t) => {
    for (const alteration of [
      (f) => fs.writeFileSync(path.join(f.input.workspace, f.pin.materials[0].source), "changed"),
      (f) => fs.chmodSync(f.pin.parent, 0o700),
      (f) => { fs.mkdirSync(f.input.directory, { mode: 0o700 }); write(path.join(f.input.directory, "foreign"), Buffer.from("foreign")); },
      (f) => { const file = path.join(f.pin.auditDirectory, f.pin.reports[0].name); fs.renameSync(file, file + ".held"); fs.symlinkSync(file + ".held", file); },
      (f) => fs.linkSync(path.join(f.pin.auditDirectory, f.pin.reports[0].name), path.join(f.pin.auditDirectory, "extra-link")),
    ]) { const f = fixture(t); alteration(f); await assert.rejects(collectPostgresSourceInventory(f.input, {}, { pin: f.pin })); assert.equal(fs.existsSync(path.join(f.input.directory, "inventory.json")), false); }
  });
  test("ACK writer rejection retires only known own inventory after all closes, preserving sources and folder", async (t) => {
    const f = fixture(t); const before = f.pin.reports.map((v) => metadata(path.join(f.pin.auditDirectory, v.name))); let calls = 0;
    await assert.rejects(collectPostgresSourceInventory(f.input, { result: () => { calls++; throw new Error("private output fixture"); } }, { pin: f.pin }),
      (e) => { assert.deepEqual(postgresSourceInventoryFailureDiagnostic(e), { code: "postgres_source_inventory_output_failed", phase: "OUTPUT", cleanup: "CONFIRMED" }); return true; });
    assert.equal(calls, 1); assert.deepEqual(fs.readdirSync(f.input.directory), []); assert.deepEqual(f.pin.reports.map((v) => metadata(path.join(f.pin.auditDirectory, v.name))), before);
  });
  test("aborting a never-settling ACK writer is bounded and retires the known own manifest", async (t) => {
    const f = fixture(t); const controller = new globalThis.AbortController(); let calls = 0;
    await assert.rejects(collectPostgresSourceInventory({ ...f.input, signal: controller.signal }, { result: () => {
      calls++; controller.abort(); return new Promise(() => {});
    } }, { pin: f.pin }), (error) => { assert.deepEqual(postgresSourceInventoryFailureDiagnostic(error),
      { code: "postgres_source_inventory_output_failed", phase: "OUTPUT", cleanup: "CONFIRMED" }); return true; });
    assert.equal(calls, 1); assert.deepEqual(fs.readdirSync(f.input.directory), []);
  });
  test("an actual report change during postpublication Git observation refuses success", async (t) => {
    const f = fixture(t); let changed = false;
    const timer = setInterval(() => { if (!changed && fs.existsSync(path.join(f.input.directory, "inventory.json"))) {
      changed = true; fs.writeFileSync(path.join(f.pin.auditDirectory, f.pin.reports[0].name), "late fixture change");
    } }, 1);
    try { await assert.rejects(collectPostgresSourceInventory(f.input, {}, { pin: f.pin }), { message: "postgres_source_inventory_file_changed" }); }
    finally { clearInterval(timer); }
    assert.equal(changed, true); assert.deepEqual(fs.readdirSync(f.input.directory), []);
  });
  test("injected post-close failure stays uncertain even after proven own manifest retirement", async (t) => {
    const f = fixture(t); const original = fs.closeSync; let injected = false; const publication = path.join(f.input.directory, "inventory.json");
    t.mock.method(fs, "closeSync", (fd) => { let target; try { target = fs.readlinkSync("/proc/self/fd/" + fd); } catch { /* A helper may close its own descriptor. */ }
      original(fd); if (!injected && target === publication) { injected = true; throw new Error("injected post-close fixture"); }
    }); syncBuiltinESMExports();
    try { await assert.rejects(collectPostgresSourceInventory(f.input, {}, { pin: f.pin }), (error) => {
      assert.deepEqual(postgresSourceInventoryFailureDiagnostic(error), { code: "postgres_source_inventory_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNVERIFIED" }); return true;
    }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(injected, true); assert.deepEqual(fs.readdirSync(f.input.directory), []);
  });
  test("late same-inode inventory change is retired but a foreign substituted inode is preserved uncertain", async (t) => {
    for (const foreign of [false, true]) { const f = fixture(t);
      await assert.rejects(collectPostgresSourceInventory(f.input, { result: () => { const file = path.join(f.input.directory, "inventory.json");
        if (foreign) { fs.renameSync(file, file + ".old"); write(file, Buffer.from("foreign")); } else fs.writeFileSync(file, "changed same inode");
        throw new Error("output failure fixture"); } }, { pin: f.pin }),
      (e) => { assert.equal(postgresSourceInventoryFailureDiagnostic(e).cleanup, foreign ? "UNVERIFIED" : "CONFIRMED"); return true; });
      assert.equal(fs.existsSync(path.join(f.input.directory, "inventory.json")), foreign);
    }
  });
  test("aborted native input and unsafe Git context refuse without publication", async (t) => {
    const f = fixture(t); const controller = new globalThis.AbortController(); controller.abort();
    await assert.rejects(collectPostgresSourceInventory({ ...f.input, signal: controller.signal }, {}, { pin: f.pin }), { message: "postgres_source_inventory_aborted" });
    assert.equal(fs.existsSync(f.input.directory), false); fs.writeFileSync(path.join(f.input.workspace, ".git/objects/info/alternates"), "/nonexistent\n");
    await assert.rejects(collectPostgresSourceInventory(f.input, {}, { pin: f.pin })); assert.equal(fs.existsSync(f.input.directory), false);
  });
} else if (nativeActor) {
  test(`positive native Git2.43 suite unavailable on actual ${gitVersion}`, { skip: true }, () => {});
  test("actual unsupported Git default helper refuses fully valid harmless inventory fixture before destination", async (t) => {
    const f = fixture(t);
    await assert.rejects(collectPostgresSourceInventory(f.input, {}, { pin: f.pin }), (error) => {
      assert.deepEqual(postgresSourceInventoryFailureDiagnostic(error), { code: "postgres_source_inventory_git_invalid", phase: "SOURCE", cleanup: "CONFIRMED" }); return true;
    }); assert.equal(fs.existsSync(f.input.directory), false);
  });
} else {
  test("native fixture suite requires actual Linux1000:1000 cleared groups and NNP1", { skip: true }, () => {});
}
if (process.platform === "linux" && process.getuid() === 0) {
  test("root bootstrap exercises harmless native default helpers as actual1000:1000 with cleared groups/caps and NNP1", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-source-inventory-bootstrap-"))); const own = metadata(root); fs.chmodSync(root, 0o755);
    try {
      fs.cpSync(path.join(rootSource, "scripts"), path.join(root, "scripts"), { recursive: true }); fs.mkdirSync(path.join(root, "tests"), { mode: 0o755 }); fs.chmodSync(path.join(root, "tests"), 0o755);
      const file = path.join(root, "tests/postgres-source-inventory.test.mjs"); fs.copyFileSync(fileURLToPath(import.meta.url), file); fs.chmodSync(file, 0o644);
      const publicModes = (directory) => { for (const leaf of fs.readdirSync(directory)) { const current = path.join(directory, leaf); const s = fs.lstatSync(current);
        assert.equal(s.isSymbolicLink(), false); assert.ok(current.startsWith(root + "/")); if (s.isDirectory()) { fs.chmodSync(current, 0o755); publicModes(current); }
        else { assert.equal(s.isFile(), true); fs.chmodSync(current, 0o644); } } }; publicModes(path.join(root, "scripts")); fs.chmodSync(path.join(root, "scripts"), 0o755);
      const result = spawnSync("/usr/bin/setpriv", ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", process.execPath, "--test", file],
        { cwd: root, timeout: 120000, encoding: "utf8", maxBuffer: 256 * 1024, env: { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" } });
      assert.equal(result.error, undefined); assert.equal(result.stderr, ""); assert.equal(result.status, 0, result.stdout); assert.match(result.stdout, /# fail 0\n/u);
      assert.ok(result.stdout.includes("PARTIAL_HELPER_PROOF native seven-file inventory") || result.stdout.includes("actual unsupported Git default helper refuses"));
    } finally { assert.equal(fs.realpathSync(root), root); assert.equal(metadata(root).ino, own.ino); assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-source-inventory-bootstrap-"))); fs.rmSync(root, { recursive: true }); }
  });
}
