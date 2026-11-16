import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "scripts", "scanner", "retention-private-copy-windows.cs");
const wrapper = path.join(root, "scripts", "scanner", "retention-private-copy-windows.ps1");
// Only the synthetic fixture host may vary in CI. Production retains its exact pinned host.
const pwsh = process.env.AUTO_WORLD_TEST_PWSH
  ?? "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe";
if (windows && !path.win32.isAbsolute(pwsh)) throw new Error("scanner_retention_test_host_invalid");
const sidSystem = "S-1-5-18";

const fixture = String.raw`param(
  [string]$Source, [string]$Root, [string]$Operation,
  [string]$InnerTarSha256, [long]$InnerTarBytes,
  [string]$VolumeSerial, [string]$DirectoryFileId, [string]$TarFileId,
  [string]$SidecarSha256, [long]$SidecarBytes, [string]$SidecarFileId,
  [string]$Phase, [string]$RestoreNonce, [string]$RestoreManifestSha256, [long]$RestoreManifestBytes)
$ErrorActionPreference = 'Stop'
try {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($Operation -ceq 'PrepareRoot') {
    [System.IO.Directory]::CreateDirectory($Root) | Out-Null
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($sid)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    $allow = [System.Security.AccessControl.AccessControlType]::Allow
    $full = [System.Security.AccessControl.FileSystemRights]::FullControl
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, $full, $inheritance, $propagation, $allow))
    $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($systemSid, $full, $inheritance, $propagation, $allow))
    [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.DirectoryInfo]::new($Root), $security)
    exit 0
  }
  Add-Type -LiteralPath $Source
  $config = [AutoWorld.ScannerRetentionPrivateCopy.Configuration]::new($Root, $sid.Value, $sid.Value, 'scanner')
  if ([String]::IsNullOrEmpty($VolumeSerial)) { $VolumeSerial = [NullString]::Value }
  if ([String]::IsNullOrEmpty($DirectoryFileId)) { $DirectoryFileId = [NullString]::Value }
  if ([String]::IsNullOrEmpty($TarFileId)) { $TarFileId = [NullString]::Value }
  if ([String]::IsNullOrEmpty($SidecarSha256)) { $SidecarSha256 = [NullString]::Value }
  if ([String]::IsNullOrEmpty($SidecarFileId)) { $SidecarFileId = [NullString]::Value }
  if ($Operation -ceq 'InspectRestore') {
    $result = [AutoWorld.ScannerRetentionPrivateCopy.Native]::InspectRestore(
      $config, $Phase, [Console]::OpenStandardInput(), $InnerTarSha256, $RestoreNonce,
      $RestoreManifestSha256, $RestoreManifestBytes, $VolumeSerial, $DirectoryFileId)
  } elseif ($Operation -ceq 'CleanupRestore') {
    $result = [AutoWorld.ScannerRetentionPrivateCopy.Native]::CleanupRestore(
      $config, [Console]::OpenStandardInput(), $InnerTarSha256, $RestoreNonce,
      $RestoreManifestSha256, $RestoreManifestBytes, $VolumeSerial, $DirectoryFileId)
  } else {
    $result = [AutoWorld.ScannerRetentionPrivateCopy.Native]::Execute(
      $config, $Operation, [Console]::OpenStandardInput(), [Console]::OpenStandardOutput(),
      $InnerTarSha256, $InnerTarBytes, $VolumeSerial, $DirectoryFileId, $TarFileId,
      $SidecarSha256, $SidecarBytes, $SidecarFileId)
  }
  if ($Operation -cne 'ExportTar') { [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 12 -Compress)) }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const tarName = (hash, part = false) => `scanner-closure-v0.76.2-sha256-${hash}.tar${part ? ".part" : ""}`;
const sidecarName = (hash, part = false) => `scanner-closure-v0.76.2-sha256-${hash}.sidecar.json${part ? ".part" : ""}`;

function createFixture(context) {
  const temporaryRoot = path.join(process.env.USERPROFILE, "AppData", "Local", "Temp");
  const temporary = mkdtempSync(path.join(temporaryRoot, "auto-world-scanner-copy-"));
  const owned = path.join(temporary, "owned");
  const script = path.join(temporary, "fixture.ps1");
  writeFileSync(script, fixture, { encoding: "utf8", flag: "wx" });
  const prepared = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script,
    "-Source", source, "-Root", owned, "-Operation", "PrepareRoot"], { encoding: "utf8", windowsHide: true });
  assert.equal(prepared.status, 0, prepared.stderr);
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  return { owned, script };
}

function invoke(state, operation, input, values, maxBuffer = 2 * 1024 * 1024) {
  const fields = {
    InnerTarSha256: values.innerTarSha256,
    InnerTarBytes: values.innerTarBytes,
    VolumeSerial: values.volumeSerial ?? "",
    DirectoryFileId: values.directoryFileId ?? "",
    TarFileId: values.tarFileId ?? "",
    SidecarSha256: values.sidecarSha256 ?? "",
    SidecarBytes: values.sidecarBytes ?? 0,
    SidecarFileId: values.sidecarFileId ?? "",
  };
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", state.script,
    "-Source", source, "-Root", state.owned, "-Operation", operation];
  for (const [key, value] of Object.entries(fields)) args.push(`-${key}`, String(value));
  return spawnSync(pwsh, args, { input, maxBuffer, windowsHide: true });
}

function invokeRestore(state, phase, input, values) {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", state.script,
    "-Source", source, "-Root", state.owned, "-Operation", "InspectRestore",
    "-Phase", phase, "-InnerTarSha256", values.innerTarSha256, "-RestoreNonce", values.nonce,
    "-RestoreManifestSha256", values.manifestSha256, "-RestoreManifestBytes", String(values.manifestBytes),
    "-VolumeSerial", values.volumeSerial ?? "", "-DirectoryFileId", values.directoryFileId ?? ""];
  return spawnSync(pwsh, args, { input, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
}

function invokeCleanup(state, input, values) {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", state.script,
    "-Source", source, "-Root", state.owned, "-Operation", "CleanupRestore",
    "-InnerTarSha256", values.innerTarSha256, "-RestoreNonce", values.nonce,
    "-RestoreManifestSha256", values.manifestSha256, "-RestoreManifestBytes", String(values.manifestBytes),
    "-VolumeSerial", values.volumeSerial, "-DirectoryFileId", values.directoryFileId];
  return spawnSync(pwsh, args, { input, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
}

function staged(context, payload = Buffer.from("scanner tar fixture\n", "utf8")) {
  const state = createFixture(context);
  const values = { innerTarSha256: sha256(payload), innerTarBytes: payload.length };
  const result = invoke(state, "StageTar", payload, values);
  assert.equal(result.status, 0, result.stderr.toString());
  const proof = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(proof.kind, "SCANNER_RETENTION_PRIVATE_COPY_V1");
  assert.equal(proof.state, "STAGED");
  assert.deepEqual(Object.keys(proof), ["kind", "state", "directory", "tar"]);
  Object.assign(values, {
    volumeSerial: proof.directory.volumeSerial,
    directoryFileId: proof.directory.fileId,
    tarFileId: proof.tar.fileId,
  });
  return { state, values, payload, proof };
}

function committed(context) {
  const value = staged(context, Buffer.from("scanner tar fixture with exact bytes\n", "utf8"));
  const sidecar = Buffer.from('{"schemaVersion":1,"state":"COMMITTED"}\n', "utf8");
  Object.assign(value.values, { sidecarSha256: sha256(sidecar), sidecarBytes: sidecar.length });
  const result = invoke(value.state, "CommitPair", sidecar, value.values);
  assert.equal(result.status, 0, result.stderr.toString());
  const proof = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(proof.state, "COMMITTED");
  assert.equal(proof.tar.fileId, value.values.tarFileId);
  assert.match(proof.directory.flush, /^(?:SUPPORTED_SUCCEEDED|UNSUPPORTED)$/u);
  Object.assign(value.values, { sidecarFileId: proof.sidecar.fileId });
  return { ...value, sidecar, proof };
}

test("the fixed wrapper pins the reviewed source and PowerShell host without a configurable destination", () => {
  const text = readFileSync(wrapper, "utf8");
  assert.match(text, /powershell\\pwsh\.exe/u);
  assert.match(text, /PSVersion\.ToString\(\) -cne '7\.6\.9'/u);
  assert.match(text, /301360/u);
  assert.match(text, /2a6769a3330dc1084d0154bfde7d164ab750ca7f700f313f9d417c1be78b2233/u);
  const sourceBytes = readFileSync(source);
  assert.match(text, new RegExp(String.raw`Length -ne ${sourceBytes.length}\b`, "u"));
  assert.match(text, new RegExp(sha256(sourceBytes), "u"));
  assert.match(text, /Add-Type -LiteralPath \$expectedSource/u);
  assert.doesNotMatch(text, /-OutputAssembly/u);
  assert.match(text, /Console\]::Out\.Write\(\(\(\$result \| ConvertTo-Json/u);
  assert.doesNotMatch(text, /Console\]::Out\.WriteLine/u);
  assert.doesNotMatch(text, /['"]-(?:Root|Path|Directory)['"]/u);
  assert.match(text, /C:\\Users\\Administrator\\Documents\\ChatGPT\\Auto-world\\\.omx\\private-archive/u);
});

test("StageTar, CommitPair, InspectPair and ExportTar preserve one pair identity and exact bytes", { skip: !windows }, (context) => {
  const value = committed(context);
  const inspected = invoke(value.state, "InspectPair", value.sidecar, value.values);
  assert.equal(inspected.status, 0, inspected.stderr.toString());
  const proof = JSON.parse(inspected.stdout.toString("utf8"));
  assert.equal(proof.state, "INSPECTED");
  assert.equal(proof.directory.fileId, value.values.directoryFileId);
  assert.equal(proof.tar.fileId, value.values.tarFileId);
  assert.equal(proof.sidecar.fileId, value.values.sidecarFileId);

  const exported = invoke(value.state, "ExportTar", Buffer.alloc(0), value.values);
  assert.equal(exported.status, 0, exported.stderr.toString());
  assert.deepEqual(exported.stdout, value.payload);
  assert.equal(existsSync(path.join(value.state.owned, "scanner", tarName(value.values.innerTarSha256))), true);
  assert.equal(existsSync(path.join(value.state.owned, "scanner", sidecarName(value.values.innerTarSha256))), true);
});

test("exclusive creation and final-name checks never overwrite existing bytes", { skip: !windows }, (context) => {
  const value = staged(context);
  const repeated = invoke(value.state, "StageTar", value.payload, value.values);
  assert.notEqual(repeated.status, 0);

  const sidecar = Buffer.from("{}\n", "utf8");
  Object.assign(value.values, { sidecarSha256: sha256(sidecar), sidecarBytes: sidecar.length });
  const finalTar = path.join(value.state.owned, "scanner", tarName(value.values.innerTarSha256));
  const sentinel = Buffer.from("do not replace", "utf8");
  writeFileSync(finalTar, sentinel, { flag: "wx" });
  const committedResult = invoke(value.state, "CommitPair", sidecar, value.values);
  assert.notEqual(committedResult.status, 0);
  assert.deepEqual(readFileSync(finalTar), sentinel);
  assert.equal(existsSync(path.join(value.state.owned, "scanner", tarName(value.values.innerTarSha256, true))), true);
});

test("StageTar retains scoped incomplete parts for short, overrun and hash-mismatched input", { skip: !windows }, (context) => {
  const cases = [
    { input: Buffer.from("short"), expected: Buffer.from("short plus") },
    { input: Buffer.from("overrun"), expected: Buffer.from("overru") },
    { input: Buffer.from("wrong hash"), expected: Buffer.from("other hash") },
  ];
  for (const item of cases) {
    const state = createFixture(context);
    const hash = sha256(item.expected);
    const result = invoke(state, "StageTar", item.input, { innerTarSha256: hash, innerTarBytes: item.expected.length });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(state.owned, "scanner", tarName(hash, true))), true);
  }
});

test("reparse scanner directories and hardlinked staged files are refused", { skip: !windows }, (context) => {
  const state = createFixture(context);
  const target = path.join(state.owned, "target");
  mkdirSync(target);
  symlinkSync(target, path.join(state.owned, "scanner"), "junction");
  const payload = Buffer.from("reparse", "utf8");
  const reparse = invoke(state, "StageTar", payload, { innerTarSha256: sha256(payload), innerTarBytes: payload.length });
  assert.notEqual(reparse.status, 0);

  const value = staged(context, Buffer.from("hardlink", "utf8"));
  const stagedPath = path.join(value.state.owned, "scanner", tarName(value.values.innerTarSha256, true));
  linkSync(stagedPath, `${stagedPath}.extra`);
  const sidecar = Buffer.from("{}\n", "utf8");
  Object.assign(value.values, { sidecarSha256: sha256(sidecar), sidecarBytes: sidecar.length });
  const hardlink = invoke(value.state, "CommitPair", sidecar, value.values);
  assert.notEqual(hardlink.status, 0);
});

test("a tar promoted without the sidecar commit marker remains an incomplete pair", { skip: !windows }, (context) => {
  const value = staged(context, Buffer.from("interrupted commit", "utf8"));
  const scanner = path.join(value.state.owned, "scanner");
  renameSync(path.join(scanner, tarName(value.values.innerTarSha256, true)), path.join(scanner, tarName(value.values.innerTarSha256)));
  const sidecar = Buffer.from("{}\n", "utf8");
  Object.assign(value.values, { sidecarSha256: sha256(sidecar), sidecarBytes: sidecar.length, sidecarFileId: "0".repeat(16) });
  const inspected = invoke(value.state, "InspectPair", sidecar, value.values);
  assert.notEqual(inspected.status, 0);
  assert.equal(existsSync(path.join(scanner, sidecarName(value.values.innerTarSha256))), false);
});

test("wrong retained identities or sidecar bytes cannot inspect or export a committed pair", { skip: !windows }, (context) => {
  const value = committed(context);
  const wrongSidecar = Buffer.from('{"schemaVersion":1,"state":"ALTERED"}\n', "utf8");
  const wrongBytes = invoke(value.state, "InspectPair", wrongSidecar, value.values);
  assert.notEqual(wrongBytes.status, 0);
  const wrongIdentity = invoke(value.state, "ExportTar", Buffer.alloc(0), { ...value.values, tarFileId: "0".repeat(16) });
  assert.notEqual(wrongIdentity.status, 0);
});

test("InspectRestore creates one derived empty directory then validates the exact closed 50-file inventory", { skip: !windows }, (context) => {
  const base = staged(context, Buffer.from("restore identity", "utf8"));
  const policy = JSON.parse(readFileSync(path.join(root, "infra", "scanner", "retention.json"), "utf8"));
  const paths = policy.closure.members.map((member) => member.path).filter((item) => item !== "scanner-closure/restore-manifest.json");
  const files = paths.map((item) => {
    const content = item.endsWith(".stdout.txt") ? Buffer.alloc(0) : Buffer.from(`fixture:${item}\n`, "utf8");
    return { path: item, class: "TEST_ONLY", bytes: content.length, sha256: sha256(content), content };
  });
  const manifestRecords = files.map((file) => ({ path: file.path, class: file.class, bytes: file.bytes, sha256: file.sha256 }));
  const manifest = Buffer.from(`${JSON.stringify({ files: manifestRecords })}\n`, "utf8");
  const values = { innerTarSha256: base.values.innerTarSha256, nonce: "1".repeat(32), manifestSha256: sha256(manifest), manifestBytes: manifest.length };
  const empty = invokeRestore(base.state, "EMPTY", Buffer.alloc(0), values);
  assert.equal(empty.status, 0, empty.stderr.toString());
  const emptyProof = JSON.parse(empty.stdout.toString("utf8"));
  assert.equal(emptyProof.phase, "EMPTY");
  Object.assign(values, { volumeSerial: emptyProof.directory.volumeSerial, directoryFileId: emptyProof.directory.fileId });
  const output = path.join(base.state.owned, "scanner", `restore-${values.innerTarSha256}-${values.nonce}`);
  for (const file of files) {
    const destination = path.join(output, ...file.path.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.content, { flag: "wx" });
  }
  const manifestPath = path.join(output, "scanner-closure", "restore-manifest.json");
  writeFileSync(manifestPath, manifest, { flag: "wx" });
  const sealed = invokeRestore(base.state, "SEALED", manifest, values);
  assert.equal(sealed.status, 0, sealed.stderr.toString());
  const proof = JSON.parse(sealed.stdout.toString("utf8"));
  assert.equal(proof.phase, "SEALED");
  assert.equal(proof.files, 50);
  assert.equal(proof.manifest.sha256, values.manifestSha256);

  writeFileSync(path.join(output, "unexpected.txt"), "unexpected", { flag: "wx" });
  const unexpected = invokeRestore(base.state, "SEALED", manifest, values);
  assert.notEqual(unexpected.status, 0);
  rmSync(path.join(output, "unexpected.txt"));
  const firstFile = path.join(output, ...files[0].path.split("/"));
  const extraHardlink = `${firstFile}.hardlink`;
  linkSync(firstFile, extraHardlink);
  const hardlink = invokeRestore(base.state, "SEALED", manifest, values);
  assert.notEqual(hardlink.status, 0);
  const refusedCleanup = invokeCleanup(base.state, manifest, values);
  assert.notEqual(refusedCleanup.status, 0);
  assert.equal(existsSync(output), true);
  rmSync(extraHardlink);
  const cleaned = invokeCleanup(base.state, manifest, values);
  assert.equal(cleaned.status, 0, cleaned.stderr.toString());
  assert.equal(JSON.parse(cleaned.stdout.toString("utf8")).phase, "CLEANED");
  assert.equal(existsSync(output), false);
});

test("the native restore allowlist is exactly the policy's 49 non-manifest paths", () => {
  const policy = JSON.parse(readFileSync(path.join(root, "infra", "scanner", "retention.json"), "utf8"));
  const expected = policy.closure.members.map((member) => member.path).filter((item) => item !== "scanner-closure/restore-manifest.json");
  const text = readFileSync(source, "utf8");
  const match = text.match(/static readonly string\[\] RestorePaths=new string\[\]\{(?<body>[\s\S]*?)\n\s{4}\};/u);
  assert.ok(match);
  const actual = [...match.groups.body.matchAll(/"([^"]+)",/gu)].map((item) => item[1]);
  assert.deepEqual(actual, expected);
});

test("native source contains only the fixed relative no-replace pair operations", () => {
  const text = readFileSync(source, "utf8");
  assert.match(text, /FileRenameInformation=10/u);
  assert.match(text, /Root=parent\.DangerousGetHandle\(\)/u);
  assert.match(text, /Marshal\.WriteByte\(value,0,0\)/u);
  assert.match(text, /StageTar.*CommitPair.*InspectPair.*ExportTar/u);
  assert.doesNotMatch(text, /HttpClient|WebRequest|Socket|Process\.Start|docker|ghcr|curl/iu);
  assert.equal((text.match(/NtSetInformationFile\(handle,out status,value,\(uint\)size,FileRenameInformation\)/gu) ?? []).length, 1);
  assert.equal(sidSystem, "S-1-5-18");
});
