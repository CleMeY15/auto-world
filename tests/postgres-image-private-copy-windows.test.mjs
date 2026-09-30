import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";

// Linux CI skips this native Windows lane; the actual Windows run must have zero skips.
const native = { skip: process.platform !== "win32" };
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repository, "scripts/postgres-image/private-copy-windows.cs");
const entrypoint = path.join(repository, "scripts/postgres-image/private-copy-windows.ps1");
const powershell = process.platform === "win32"
  ? path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe")
  : "pwsh";
const parent = path.join(process.env.USERPROFILE ?? repository, "AppData", "Local", "Temp", `auto-world-private-copy-fixture-${randomBytes(12).toString("hex")}`);
const candidate = Buffer.from([0, 255, 128, 1, 13, 10, 2, 0, 254, 3, 4, 5, 6, 7]);
const retention = Buffer.from('{"fixture":true}\n');
const input = Buffer.concat([candidate, retention]);
const publication = Buffer.from('{"kind":"NONSENSITIVE_FIXTURE","state":"VERIFIED"}\n');
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const scope = () => randomBytes(12).toString("hex");
const directory = (id) => path.join(parent, `copy-${id}`);
let sid;

function command(body, bytes = Buffer.alloc(0)) {
  return spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", body], {
    input: bytes, timeout: 30_000, maxBuffer: 128 * 1024,
    windowsHide: true, cwd: repository,
  });
}
function configuration(candidateHash = hash(candidate), configuredParent = parent) {
  return `$pins=[AutoWorld.PrivateCopy.Pin[]]@([AutoWorld.PrivateCopy.Pin]::new('candidate.tar',${candidate.length},${quote(candidateHash)}),[AutoWorld.PrivateCopy.Pin]::new('retention-receipt.json',${retention.length},${quote(hash(retention))}));$config=[AutoWorld.PrivateCopy.Configuration]::new(${quote(configuredParent)},${quote(sid)},${quote(sid)},'copy-',$pins);`;
}
function invoke(operation, id, bytes = Buffer.alloc(0), options = {}) {
  const body = `$ErrorActionPreference='Stop';try{Add-Type -Path ${quote(source)};${configuration(options.candidateHash, options.parent)}${options.setup ?? ""}$result=[AutoWorld.PrivateCopy.Native]::Execute($config,${quote(operation)},${quote(id)},[Console]::OpenStandardInput(),${options.output ?? "[Console]::OpenStandardOutput()"},${options.sha ? quote(options.sha) : "[NullString]::Value"},${options.size ?? 0},${options.fileId ? quote(options.fileId) : "[NullString]::Value"},${options.directoryFileId ? quote(options.directoryFileId) : "[NullString]::Value"});if(${quote(operation)} -cne 'Export'){[Console]::Out.WriteLine(($result|ConvertTo-Json -Depth 12 -Compress))};exit 0}catch{[Console]::Error.WriteLine($_.Exception.GetBaseException().Message);exit 1}`;
  return command(body, bytes);
}
function success(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  return JSON.parse(result.stdout.toString());
}
function failure(result, reason) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr.toString());
  assert.match(result.stderr.toString(), reason);
}
function receive(id = scope()) {
  const proof = success(invoke("Receive", id, input));
  return { id, proof };
}
function prepare(id) { return success(invoke("PreparePublish", id)); }
function identity(preparation) {
  return { fileId: preparation.file.fileId, directoryFileId: preparation.directoryFileId };
}

before(() => {
  if (process.platform !== "win32") return;
  const created = success(command(`$ErrorActionPreference='Stop';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetSecurityDescriptorSddlForm('O:'+$sid+'D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)');if([IO.Directory]::Exists(${quote(parent)})){throw 'exists'};[IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new(${quote(parent)}),$acl);[Console]::Out.WriteLine((@{sid=$sid}|ConvertTo-Json -Compress));`));
  sid = created.sid;
});

test("native private copy receives binary bytes, seals stable identities and exports exact bytes", native, () => {
  const { id, proof } = receive();
  assert.deepEqual(Object.keys(proof).sort(), ["directory", "directoryFileId", "files", "kind", "ntfs", "ownerSid", "protectedAcl", "reparse", "state", "volumeSerial"].sort());
  assert.equal(proof.kind, "WINDOWS_PRIVATE_COPY_PROOF_V1");
  assert.equal(proof.state, "SEALED");
  assert.equal(proof.directory, directory(id));
  assert.equal(proof.ownerSid, sid);
  assert.equal(proof.protectedAcl, true);
  assert.equal(proof.ntfs, true);
  assert.equal(proof.reparse, false);
  assert.match(proof.directoryFileId, /^[a-f0-9]{16}$/);
  assert.match(proof.volumeSerial, /^[a-f0-9]{8}$/);
  assert.deepEqual(proof.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })), [
    { name: "candidate.tar", size: candidate.length, sha256: hash(candidate) },
    { name: "retention-receipt.json", size: retention.length, sha256: hash(retention) },
  ]);
  for (const file of proof.files) {
    assert.equal(file.ownerSid, sid); assert.equal(file.protectedAcl, true); assert.equal(file.nlink, 1);
    assert.match(file.fileId, /^[a-f0-9]{16}$/);
  }
  assert.deepEqual(success(invoke("Seal", id)), proof);
  const exported = invoke("Export", id);
  assert.equal(exported.status, 0, exported.stderr.toString());
  assert.equal(exported.stderr.length, 0);
  assert.deepEqual(exported.stdout, input);
});

test("receive is exclusive and rejects truncated, extra and wrong-hash bytes while preserving failure files", native, () => {
  const { id } = receive();
  failure(invoke("Receive", id, input), /windows_private_copy_open_failed/);
  assert.deepEqual(readFileSync(path.join(directory(id), "candidate.tar")), candidate);
  for (const bytes of [input.subarray(0, 4), input.subarray(0, input.length - 1), Buffer.concat([input, Buffer.from([0])])]) {
    const failedId = scope(); failure(invoke("Receive", failedId, bytes), /windows_private_copy_bytes_invalid/);
    assert.equal(existsSync(directory(failedId)), true);
    assert.equal(existsSync(path.join(directory(failedId), "copy-receipt.json")), false);
  }
  const wrong = scope();
  failure(invoke("Receive", wrong, input, { candidateHash: "0".repeat(64) }), /windows_private_copy_bytes_invalid/);
  assert.deepEqual(readFileSync(path.join(directory(wrong), "candidate.tar")), candidate);
});

test("prepared publication slot is empty, exclusive and bound to directory and file IDs", native, () => {
  const { id, proof } = receive(); const prepared = prepare(id);
  assert.equal(prepared.kind, "WINDOWS_PRIVATE_COPY_PREPARATION_V1");
  assert.equal(prepared.state, "PREPARED");
  assert.equal(prepared.directoryFileId, proof.directoryFileId);
  assert.equal(prepared.file.size, 0); assert.equal(prepared.file.sha256, hash(Buffer.alloc(0)));
  assert.equal(statSync(path.join(directory(id), "copy-receipt.json")).size, 0);
  failure(invoke("PreparePublish", id), /windows_private_copy_open_failed/);
  for (const wrong of [{ ...identity(prepared), fileId: "0".repeat(16) }, { ...identity(prepared), directoryFileId: "0".repeat(16) }]) {
    failure(invoke("Publish", id, publication, { ...wrong, sha: hash(publication), size: publication.length }), /windows_private_copy_identity_invalid/);
    assert.equal(statSync(path.join(directory(id), "copy-receipt.json")).size, 0);
  }
  const published = success(invoke("Publish", id, publication, { ...identity(prepared), sha: hash(publication), size: publication.length }));
  assert.equal(published.kind, "WINDOWS_PRIVATE_COPY_PUBLICATION_V1"); assert.equal(published.state, "PUBLISHED");
  assert.equal(published.file.fileId, prepared.file.fileId); assert.equal(published.directoryFileId, prepared.directoryFileId);
  assert.equal(published.file.sha256, hash(publication));
  assert.deepEqual(readFileSync(path.join(directory(id), "copy-receipt.json")), publication);
  failure(invoke("Publish", id, publication, { ...identity(prepared), sha: hash(publication), size: publication.length }), /windows_private_copy_identity_invalid/);
  assert.deepEqual(readFileSync(path.join(directory(id), "copy-receipt.json")), publication);
});

test("publication failure removes only the known prepared file; root can abort a late failed acknowledgement", native, () => {
  for (const bytes of [publication.subarray(0, 3), Buffer.concat([publication, Buffer.from([0])]), Buffer.alloc(publication.length, 0)]) {
    const { id } = receive(); const prepared = prepare(id);
    failure(invoke("Publish", id, bytes, { ...identity(prepared), sha: hash(publication), size: publication.length }), /windows_private_copy_bytes_invalid/);
    assert.equal(existsSync(path.join(directory(id), "copy-receipt.json")), false);
    assert.equal(success(invoke("AbortPublish", id, Buffer.alloc(0), identity(prepared))).state, "NOT_PRESENT");
    success(invoke("Seal", id));
  }
  const { id } = receive(); const prepared = prepare(id);
  success(invoke("Publish", id, publication, { ...identity(prepared), sha: hash(publication), size: publication.length }));
  failure(invoke("AbortPublish", id, Buffer.alloc(0), { ...identity(prepared), fileId: "0".repeat(16) }), /windows_private_copy_identity_invalid/);
  assert.deepEqual(readFileSync(path.join(directory(id), "copy-receipt.json")), publication);
  assert.equal(success(invoke("AbortPublish", id, Buffer.alloc(0), identity(prepared))).state, "REMOVED");
  assert.equal(existsSync(path.join(directory(id), "copy-receipt.json")), false);
  assert.deepEqual(readFileSync(path.join(directory(id), "candidate.tar")), candidate);
});

test("seal rejects a changed file, unsafe ACL, hardlink and a reparse ancestor", native, () => {
  const changed = receive();
  success(command(`[IO.File]::WriteAllBytes(${quote(path.join(directory(changed.id), "candidate.tar"))},[byte[]]@(1,2,3));[Console]::Out.WriteLine('{}')`));
  failure(invoke("Seal", changed.id), /windows_private_copy_bytes_invalid/);
  const acl = receive();
  success(command(`$ErrorActionPreference='Stop';$file=${quote(path.join(directory(acl.id), "candidate.tar"))};$acl=Get-Acl -LiteralPath $file;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'Read','Allow'));Set-Acl -LiteralPath $file -AclObject $acl;[Console]::Out.WriteLine('{}')`));
  failure(invoke("Seal", acl.id), /windows_private_copy_acl_invalid/);
  const linked = receive();
  success(command(`$ErrorActionPreference='Stop';$null=New-Item -ItemType HardLink -Path ${quote(path.join(directory(linked.id), "extra-link"))} -Target ${quote(path.join(directory(linked.id), "candidate.tar"))};[Console]::Out.WriteLine('{}')`));
  failure(invoke("Seal", linked.id), /windows_private_copy_identity_invalid/);
  const target = receive(); const junction = path.join(parent, `junction-${scope()}`);
  success(command(`$ErrorActionPreference='Stop';$null=New-Item -ItemType Junction -Path ${quote(junction)} -Target ${quote(directory(target.id))};[Console]::Out.WriteLine('{}')`));
  failure(invoke("Seal", scope(), Buffer.alloc(0), { parent: junction }), /windows_private_copy_open_failed/);
});

test("full export reread detects metadata mutation and held handles prevent rename", native, () => {
  const actor = `public sealed class PrivateCopyFixtureActor : System.IO.MemoryStream {
    public string Target; public bool Rename, Blocked, Acted;
    public override void Write(byte[] bytes,int offset,int count) {
      if(!Acted){Acted=true;if(Rename){try{System.IO.File.Move(Target,Target+".moved");}catch(System.IO.IOException){Blocked=true;}}
        else System.IO.File.SetAttributes(Target,System.IO.File.GetAttributes(Target)|System.IO.FileAttributes.Hidden);}
      base.Write(bytes,offset,count);
    }
  }`;
  const mutation = receive();
  const setup = `Add-Type -TypeDefinition ${quote(actor)};$actor=[PrivateCopyFixtureActor]::new();$actor.Target=${quote(path.join(directory(mutation.id), "candidate.tar"))};`;
  failure(invoke("Export", mutation.id, Buffer.alloc(0), { setup, output: "$actor" }), /windows_private_copy_identity_changed/);
  const rename = receive();
  const result = command(`$ErrorActionPreference='Stop';Add-Type -Path ${quote(source)};Add-Type -TypeDefinition ${quote(actor)};${configuration()}$actor=[PrivateCopyFixtureActor]::new();$actor.Target=${quote(path.join(directory(rename.id), "candidate.tar"))};$actor.Rename=$true;$null=[AutoWorld.PrivateCopy.Native]::Execute($config,'Export',${quote(rename.id)},[IO.Stream]::Null,$actor,[NullString]::Value,0,[NullString]::Value,[NullString]::Value);[Console]::Out.WriteLine((@{blocked=$actor.Blocked;sha=${quote(hash(input))};actual=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($actor.ToArray())).ToLowerInvariant()}|ConvertTo-Json -Compress));`);
  const proof = success(result); assert.equal(proof.blocked, true); assert.equal(proof.actual, proof.sha);
  assert.equal(existsSync(path.join(directory(rename.id), "candidate.tar.moved")), false);
});

test("production entrypoint has a closed argument gate and never emits raw exceptions", native, () => {
  for (const args of [[], ["-Operation", "Receive", "-Scope", "bad"], ["-Operation", "Receive", "-Scope", scope(), "-Parent", parent], ["-Operation", "Publish", "-Scope", scope()], ["-Operation", "AbortPublish", "-Scope", scope(), "-ExpectedFileId", "0".repeat(16), "-ExpectedDirectoryFileId", "bad"]]) {
    const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-File", entrypoint, ...args], { windowsHide: true, timeout: 30_000, maxBuffer: 65536 });
    assert.equal(result.status, 1); assert.equal(result.stdout.length, 0);
    assert.deepEqual(JSON.parse(result.stderr.toString()), { state: "INCOMPLETE", code: "windows_private_copy_incomplete" });
  }
});
