import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runOfficialImageAudits } from "../scripts/scanner/official-audit.mjs";

const release = JSON.parse(readFileSync(new URL("../infra/scanner/official-release.json", import.meta.url)));
const workflow = JSON.parse(readFileSync(new URL("../.github/workflows/data-foundation-audit.yml", import.meta.url)));
const oldPlatform = "sha256:25fea7c13a5b32ac8bde048af1cd286e41f07d5d37e6649f23c14a6f9bf284d9";
const newPlatform = "sha256:eb3b4742dbfd983bcb79e2df22fbcfde9ad5b3f8277ff1d4050bd7f9cdd9c090";
const oldId = "sha256:e84d8cf62bb8820751a8575e8d60a55735bb561e53db1f5d44e7c8ab1d147c6e";
const newId = "sha256:25c7966f5a6c335934d4a1b75584e12c3495a038df0848359d586d669821ffa4";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// RPM identities from the complete old report in 44267312226/1. Optional fourth
// and fifth columns override the default x86_64 architecture and zero epoch.
const oldRpms = `alternatives 1.15 2.amzn2023.0.2
amazon-linux-repo-cdn 2023.12.20261021 0.amzn2023 noarch
audit-libs 3.1.5 1.amzn2023.0.2
basesystem 11 11.amzn2023.0.2 noarch
bash 5.2.15 1.amzn2023.0.2
bzip2-libs 1.0.8 6.amzn2023.0.2
ca-certificates 2025.2.76 1.0.amzn2023.0.3 noarch
coreutils-single 8.32 30.amzn2023.0.5
crypto-policies 20260224 1.gitea0f072.amzn2023.0.6 noarch
curl-minimal 8.21.0 5.amzn2023.0.2
dnf 4.14.0 1.amzn2023.0.9 noarch
dnf-data 4.14.0 1.amzn2023.0.9 noarch
elfutils-default-yama-scope 0.188 3.amzn2023.0.3 noarch
elfutils-libelf 0.188 3.amzn2023.0.3
elfutils-libs 0.188 3.amzn2023.0.3
expat 2.8.3 1.amzn2023.0.1
file-libs 5.39 7.amzn2023.0.4
filesystem 3.14 5.amzn2023.0.3
findutils 4.8.0 2.amzn2023.0.2 x86_64 1
gawk 5.1.0 3.amzn2023.0.4
gdbm-libs 1.19 2.amzn2023.0.2 x86_64 1
glib2 2.82.2 771.amzn2023
glibc 2.34 231.amzn2023.0.5
glibc-common 2.34 231.amzn2023.0.5
glibc-minimal-langpack 2.34 231.amzn2023.0.5
gmp 6.2.1 2.amzn2023.0.2 x86_64 1
gnupg2-minimal 2.3.7 1.amzn2023.0.9
gpg-pubkey d832c631 6515c85e None
gpgme 1.23.2 182.amzn2023.0.1
grep 3.8 1.amzn2023.0.4
groff 1.22.4 7.amzn2023.0.2
groff-base 1.22.4 7.amzn2023.0.2
jq 1.8.1 60.amzn2023
json-c 0.14 8.amzn2023.0.2
keyutils-libs 1.6.3 1.amzn2023.0.2
krb5-libs 1.21.3 8.amzn2023.0.2
less 608 2.amzn2023.0.2
libacl 2.4.0 1.amzn2023.0.1
libarchive 3.7.4 2.amzn2023.0.4
libassuan 2.5.5 1.amzn2023.0.2
libattr 2.5.1 3.amzn2023.0.2
libblkid 2.37.4 1.amzn2023.0.6
libcap 2.73 1.amzn2023.0.7
libcap-ng 0.8.2 4.amzn2023.0.2
libcom_err 1.46.5 2.amzn2023.0.2
libcomps 0.1.20 1.amzn2023
libcurl-minimal 8.21.0 5.amzn2023.0.2
libdnf 0.69.0 8.amzn2023.0.9
libffi 3.4.4 1.amzn2023.0.1
libgcc 14.2.1 7.amzn2023.0.2
libgcrypt 1.10.2 1.amzn2023.0.3
libgomp 14.2.1 7.amzn2023.0.2
libgpg-error 1.42 1.amzn2023.0.2
libidn2 2.3.2 1.amzn2023.0.5
libmodulemd 2.13.0 2.amzn2023.0.2
libmount 2.37.4 1.amzn2023.0.6
libnghttp2 1.59.0 3.amzn2023.0.2
libpsl 0.21.5 1.amzn2023.0.1
librepo 1.14.5 2.amzn2023.0.2
libreport-filesystem 2.15.2 2.amzn2023.0.2 noarch
libselinux 3.4 5.amzn2023.0.2
libsepol 3.4 3.amzn2023.0.3
libsigsegv 2.13 2.amzn2023.0.2
libsmartcols 2.37.4 1.amzn2023.0.6
libsolv 0.7.22 1.amzn2023.0.5
libstdc++ 14.2.1 7.amzn2023.0.2
libtasn1 4.19.0 1.amzn2023.0.6
libunistring 0.9.10 10.amzn2023.0.2
libuuid 2.37.4 1.amzn2023.0.6
libverto 0.3.2 1.amzn2023.0.2
libxcrypt 4.4.33 7.amzn2023
libxml2 2.10.4 1.amzn2023.0.21
libyaml 0.2.5 5.amzn2023.0.2
libzstd 1.5.5 1.amzn2023.0.1
lua-libs 5.4.4 3.amzn2023.0.2
lz4-libs 1.9.4 1.amzn2023.0.3
mpfr 4.1.0 7.amzn2023.0.2
ncurses 6.6 1.amzn2023.0.1
ncurses-base 6.6 1.amzn2023.0.1 noarch
ncurses-libs 6.6 1.amzn2023.0.1
npth 1.6 6.amzn2023.0.2
oniguruma 6.9.7.1 1.amzn2023.0.2
openssl-fips-provider-latest 3.5.8 1.amzn2023.0.3 x86_64 1
openssl-libs 3.5.8 1.amzn2023.0.3 x86_64 1
p11-kit 0.24.1 2.amzn2023.0.3
p11-kit-trust 0.24.1 2.amzn2023.0.3
paper 2.3 2.amzn2023.0.3
pcre2 10.40 1.amzn2023.0.4
pcre2-syntax 10.40 1.amzn2023.0.4 noarch
perl-AutoLoader 5.74 477.amzn2023.0.10 noarch
perl-B 1.80 477.amzn2023.0.10
perl-Carp 1.50 458.amzn2023.0.2 noarch
perl-Class-Struct 0.66 477.amzn2023.0.10 noarch
perl-Data-Dumper 2.191 522.amzn2023.0.3
perl-Digest 1.20 1.amzn2023.0.2 noarch
perl-Digest-MD5 2.59 521.amzn2023.0.2
perl-DynaLoader 1.47 477.amzn2023.0.10
perl-Encode 3.21 520.amzn2023.0.2 x86_64 4
perl-Errno 1.30 477.amzn2023.0.10
perl-Exporter 5.79 520.amzn2023.0.1 noarch
perl-Fcntl 1.13 477.amzn2023.0.10
perl-File-Basename 2.85 477.amzn2023.0.10 noarch
perl-File-Copy 2.34 477.amzn2023.0.10 noarch
perl-File-Path 2.18 2.amzn2023.0.2 noarch
perl-File-Temp 0.231.200 2.amzn2023.0.1 noarch 1
perl-File-stat 1.09 477.amzn2023.0.10 noarch
perl-FileHandle 2.03 477.amzn2023.0.10 noarch
perl-Getopt-Long 2.58 521.amzn2023.0.1 noarch 1
perl-Getopt-Std 1.12 477.amzn2023.0.10 noarch
perl-HTTP-Tiny 0.092 2.amzn2023.0.3 noarch
perl-IO 1.43 477.amzn2023.0.10
perl-IO-Socket-IP 0.43 522.amzn2023.0.1 noarch
perl-IO-Socket-SSL 2.075 1.amzn2023.0.3 noarch
perl-IPC-Open3 1.21 477.amzn2023.0.10 noarch
perl-IPC-Run3 0.049 5.amzn2023.0.1 noarch
perl-MIME-Base64 3.16 2.amzn2023.0.3
perl-NDBM_File 1.15 477.amzn2023.0.10
perl-Net-SSLeay 1.94 3.amzn2023.0.5
perl-POSIX 1.94 477.amzn2023.0.10
perl-PathTools 3.78 459.amzn2023.0.3
perl-Pod-Escapes 1.07 458.amzn2023.0.2 noarch 1
perl-Pod-Perldoc 3.28.01 459.amzn2023.0.3 noarch
perl-Pod-Simple 3.42 2.amzn2023.0.2 noarch 1
perl-Pod-Usage 2.01 2.amzn2023.0.2 noarch 4
perl-Scalar-List-Utils 1.56 459.amzn2023.0.3 x86_64 4
perl-SelectSaver 1.02 477.amzn2023.0.10 noarch
perl-Socket 2.032 1.amzn2023.0.4 x86_64 4
perl-Storable 3.37 522.amzn2023.0.3 x86_64 1
perl-Symbol 1.08 477.amzn2023.0.10 noarch
perl-Term-ANSIColor 5.01 459.amzn2023.0.2 noarch
perl-Term-Cap 1.17 458.amzn2023.0.2 noarch
perl-Text-ParseWords 3.30 458.amzn2023.0.2 noarch
perl-Text-Tabs+Wrap 2021.0726 1.amzn2023.0.1 noarch
perl-Time-HiRes 1.9764 460.amzn2023.0.3 x86_64 4
perl-Time-Local 1.300 5.amzn2023.0.2 noarch 2
perl-URI 5.18 1.amzn2023.0.1 noarch
perl-base 2.27 477.amzn2023.0.10 noarch
perl-constant 1.33 459.amzn2023.0.2 noarch
perl-if 0.60.800 477.amzn2023.0.10 noarch
perl-interpreter 5.32.1 477.amzn2023.0.10 x86_64 4
perl-libnet 3.13 2.amzn2023.0.2 noarch
perl-libs 5.32.1 477.amzn2023.0.10 x86_64 4
perl-locale 1.09 477.amzn2023.0.10 noarch
perl-mro 1.23 477.amzn2023.0.10
perl-overload 1.31 477.amzn2023.0.10 noarch
perl-overloading 0.02 477.amzn2023.0.10 noarch
perl-parent 0.238 458.amzn2023.0.2 noarch 1
perl-podlators 4.14 458.amzn2023.0.2 noarch 1
perl-subs 1.03 477.amzn2023.0.10 noarch
perl-vars 1.05 477.amzn2023.0.10 noarch
popt 1.18 6.amzn2023.0.2
psutils 2.05 1.amzn2023.0.2 noarch
publicsuffix-list-dafsa 20260116 1.amzn2023.0.1 noarch
python3 3.9.25 1.amzn2023.0.9
python3-dnf 4.14.0 1.amzn2023.0.9 noarch
python3-gpg 1.23.2 182.amzn2023.0.1
python3-hawkey 0.69.0 8.amzn2023.0.9
python3-libcomps 0.1.20 1.amzn2023
python3-libdnf 0.69.0 8.amzn2023.0.9
python3-libs 3.9.25 1.amzn2023.0.9
python3-pip-wheel 21.3.1 2.amzn2023.0.22 noarch
python3-rpm 4.16.1.3 29.amzn2023.0.8
python3-setuptools-wheel 59.6.0 2.amzn2023.0.6 noarch
readline 8.1 2.amzn2023.0.2
rpm 4.16.1.3 29.amzn2023.0.8
rpm-build-libs 4.16.1.3 29.amzn2023.0.8
rpm-libs 4.16.1.3 29.amzn2023.0.8
rpm-sign-libs 4.16.1.3 29.amzn2023.0.8
sed 4.8 7.amzn2023.0.2
setup 2.13.7 3.amzn2023.0.2 noarch
sqlite-libs 3.40.0 1.amzn2023.0.8
system-release 2023.12.20261021 0.amzn2023 noarch
tzdata 2026e 1.amzn2023.0.1 noarch
xz-libs 5.2.5 9.amzn2023.0.2
yum 4.14.0 1.amzn2023.0.9 noarch
zlib 1.2.11 33.amzn2023.0.6`.split("\n").map((line) => {
  const [Name, Version, Release, Arch = "x86_64", epoch = "0"] = line.split(" ");
  return { Name, Version, Release, Arch, Epoch: Number(epoch) };
});

function reports(ref, scenario) {
  const old = ref.endsWith(oldPlatform), current = ref.endsWith(newPlatform);
  const digest = ref.split("@")[1];
  const id = old ? oldId : newId;
  const purl = "pkg:oci/aws-cli@" + digest + "?arch=amd64&repository_url=index.docker.io%2Famazon%2Faws-cli";
  const props = (name, value) => ({ name: "aquasecurity:trivy:" + name, value });
  const rpms = old || current ? oldRpms.map((p) => ({ ...p })) : [{ Name: "fixture", Version: "1" }];
  const python = { Name: "prompt_toolkit", Version: "3.0.51",
    FilePath: "usr/local/aws-cli/v2/" + (old ? "2.38.5" : "2.41.0") + "/dist/prompt_toolkit-3.0.51.dist-info/METADATA" };
  if (current) {
    rpms.find((p) => p.Name === "curl-minimal").Version += ".1";
    if (scenario !== "missing-new-rpm") rpms.push({ Name: "perl-Unicode-Normalize", Version: "1", Arch: "noarch" });
    if (scenario === "lost-new-package") rpms.splice(3, 1);
  }
  if (old && scenario === "lost-old-package") rpms.splice(3, 1);
  const evr = (pkg) => (pkg.Epoch ? pkg.Epoch + ":" : "") + pkg.Version + (pkg.Release ? "-" + pkg.Release : "");
  const finding = (v, pkg) => ({ VulnerabilityID: v, PkgName: pkg.Name, InstalledVersion: evr(pkg), Severity: "HIGH", FixedVersion: "2" });
  let vulns = [];
  if (old && scenario !== "clean-old") vulns = ["CVE-2026-92392", "CVE-B", "CVE-2026-92392"].map((v) => finding(v, rpms.find((p) => p.Name === "curl-minimal")));
  if (old && scenario === "unrelated-old") vulns[0].VulnerabilityID = vulns[2].VulnerabilityID = "CVE-OTHER";
  if (current && !["all-current-clean", "clean-five-bad-control"].includes(scenario)) vulns = ["CVE-2026-92392", "CVE-C"].map((v) => finding(v, rpms.find((p) => p.Name === "curl-minimal")));
  const OS = { Family: "amazon", Name: old ? "2023.12.20261021 (Amazon Linux)" : "2023.12.20261112 (Amazon Linux)" };
  const results = [{ Class: "os-pkgs", Target: ref + " (amazon " + OS.Name + ")", Type: "amazon", Packages: rpms, Vulnerabilities: vulns }];
  if (old || current) results.push({ Class: "lang-pkgs", Type: "python-pkg", Target: "Python", Packages: [python] });
  const json = { SchemaVersion: 2, Trivy: { Version: "0.76.2" }, CreatedAt: new Date().toISOString(), ArtifactName: ref,
    ArtifactType: "container_image", Metadata: { ImageID: id, Reference: ref, RepoDigests: [ref], ImageConfig: { os: "linux", architecture: "amd64" }, OS },
    Results: results };
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { type: "container", name: ref, purl, "bom-ref": purl,
    properties: [props("Reference", ref), props("RepoDigest", ref), props("ImageID", id)] } }, components: [
    { type: "operating-system", name: OS.Family, version: OS.Name, "bom-ref": "os", properties: [props("Class", "os-pkgs"), props("Type", "amazon")] },
    ...results.flatMap((r) => r.Packages.map((pkg) => ({ type: "library", name: pkg.Name, version: evr(pkg),
      "bom-ref": pkg.Name, properties: [props("PkgType", r.Type)] })))], dependencies: [] };
  if (old && ["wrong-config", "clean-five-bad-control"].includes(scenario)) json.Metadata.ImageID = newId;
  if (old && scenario === "wrong-sbom") sbom.metadata.component.properties[2].value = newId;
  if (old && scenario === "swapped") json.ArtifactName = "amazon/aws-cli@" + newPlatform;
  return { json, sbom };
}

async function audit(t, scenario) {
  const output = mkdtempSync(path.join(import.meta.dirname, "aws-comparator-test-"));
  t.after(() => rmSync(output, { recursive: true }));
  const receipt = { commands: [] }, calls = [], checks = [];
  const cleanFive = ["all-current-clean", "clean-five-bad-control"].includes(scenario);
  const config = { ...release, images: release.images.map((image) => image.role !== "aws-cli" ? image : {
    ...image, version: "2.41.0", manifestDigest: "sha256:c5d442efed03350a3c3d7a42b23f42a8e7b76acf5dbb4b021f2641bcd36680ea",
    platform: { ...image.platform, digest: newPlatform },
  }) };
  const command = (exe, args, { file }) => {
    assert.equal(exe, "/usr/bin/docker");
    const ref = args.at(-1), old = ref.endsWith(oldPlatform);
    const json = args[args.indexOf("--format") + 1] === "json";
    if (old) {
      assert.equal(receipt.reports.length, 5);
      const checkpoint = readFileSync(path.join(output, receipt.fiveImageEvidence.file));
      assert.equal(sha(checkpoint), receipt.fiveImageEvidence.sha256);
      assert.deepEqual(JSON.parse(checkpoint), { reports: receipt.reports, blockers: receipt.blockers, rejections: receipt.rejections });
      for (const entry of receipt.reports) {
        const hash = sha(readFileSync(path.join(output, "image-" + entry.role + ".json")));
        assert.equal(entry.report[0].sha256, hash);
      }
    }
    calls.push(args);
    const record = { exitCode: 0, error: null, signal: null, ownedContainerAbsent: true };
    receipt.commands.push(record);
    const pair = reports(ref, scenario);
    const stdout = Buffer.from(JSON.stringify(json ? pair.json : pair.sbom));
    if (!(old && !json && scenario === "missing")) writeFileSync(file, stdout, { flag: "wx" });
    if (old && !json && scenario === "oversized-sbom") truncateSync(file, 64 * 1024 ** 2 + 1);
    if (old && scenario === "no-absence-proof") delete record.ownedContainerAbsent;
    if (old && scenario === "scanner-error") { record.exitCode = 1; throw new Error("scanner_official_command_failed"); }
    if (old && scenario === "cleanup-error") { record.ownedContainerAbsent = false; throw new Error("scanner_official_cleanup_uncertain"); }
    if (old && json && scenario === "substituted-bytes") return Buffer.concat([stdout, Buffer.from("\n")]);
    return stdout;
  };
  const run = runOfficialImageAudits({ config, receipt, output, localImages: new Map(), carrier: "aquasec/trivy@sha256:" + "a".repeat(64),
    cache: path.join(output, "cache"), scanner: path.join(output, "scanner"), command,
    beforeScan: async (image) => { checks.push(["before", image.role]); },
    afterScan: async (image) => {
      checks.push(["after", image.role]);
      if (image.role === "aws-cli-previous" && scenario === "db-drift") throw new Error("scanner_frozen_input_changed");
      if (image.role === "aws-cli-previous" && scenario === "candidate-drift") writeFileSync(path.join(output, "image-aws-cli.json"), "{}");
    },
  });
  if (scenario === "all-current-clean") await run;
  else if (cleanFive) await assert.rejects(run, /^Error: scanner_aws_subject_invalid$/u);
  else await assert.rejects(run, /^Error: scanner_official_images_blocked$/u);
  assert.equal(receipt.reports.length, 5);
  assert.equal(receipt.runtimeSubjects.length, 5);
  for (const entry of receipt.reports) {
    for (const [i, suffix] of [".json", ".cdx.json"].entries()) {
      const file = path.join(output, "image-" + entry.role + suffix);
      if (scenario === "candidate-drift" && entry.role === "aws-cli" && i === 0) continue;
      const bytes = readFileSync(file);
      assert.deepEqual(entry.report[i], { size: bytes.length, sha256: sha(bytes) });
    }
  }
  assert.equal(receipt.blockers.length, cleanFive ? 0 : 2);
  assert.deepEqual(receipt.blockers.map((entry) => entry.vulnerabilityId), cleanFive ? [] : ["CVE-2026-92392", "CVE-C"]);
  assert.equal(receipt.rejections.length, cleanFive ? 0 : 1);
  return { receipt, comparison: receipt.awsComparator, calls, checks, output };
}

test("the raw orchestration preserves five decisions before comparing two complete AWS reports on identical scan options", async (t) => {
  const { receipt, comparison, calls, checks, output } = await audit(t, "red");
  assert.equal(receipt.fiveImageResult, "rejected");
  assert.equal(comparison.qualification, "passed");
  assert.equal(comparison.oldPolicy, "blocked");
  assert.deepEqual(comparison.commandIndices, [11, 12]);
  assert.deepEqual(comparison.control.blockers.map((entry) => entry.vulnerabilityId), ["CVE-2026-92392", "CVE-B", "CVE-2026-92392"]);
  assert.deepEqual(checks.slice(-2), [["before", "aws-cli-previous"], ["after", "aws-cli-previous"]]);
  for (let i = 0; i < 2; ++i) {
    assert.deepEqual(calls[8 + i].slice(0, -1), calls[10 + i].slice(0, -1));
    assert.equal(calls[8 + i].at(-1), "amazon/aws-cli@" + newPlatform);
    assert.equal(calls[10 + i].at(-1), "amazon/aws-cli@" + oldPlatform);
    const file = path.join(output, i ? "image-aws-cli-previous.cdx.json" : "image-aws-cli-previous.json");
    assert.equal(sha(readFileSync(file)), comparison.control.reports[0].report[i].sha256);
  }
  const delta = readFileSync(path.join(output, comparison.delta.file));
  assert.equal(sha(delta), comparison.delta.sha256);
  assert.equal(delta.length, comparison.delta.size);
  const evidence = JSON.parse(delta);
  assert.deepEqual(evidence.findings, { matched: [[0, 0]], removed: [1, 2], added: [1] });
  assert.notEqual(evidence.old.findings[0].installedVersion, evidence.current.findings[0].installedVersion);
  assert.equal(evidence.old.packages.length, 177);
  assert.equal(evidence.current.packages.length, 178);
  const curl = oldRpms.findIndex((p) => p.Name === "curl-minimal");
  assert.deepEqual(evidence.packages.removed, [curl, 176]);
  assert.deepEqual(evidence.packages.added, [curl, 176, 177]);
  assert.deepEqual(evidence.missingInventory, []);
  assert.equal(evidence.history.orderedBlockers.length, 49);
  assert.deepEqual(evidence.historicalToOld.matched, [[0, 0]]);
  assert.equal(evidence.historicalToOld.removed.length, 48);
  assert.deepEqual(evidence.historicalToOld.added, [1, 2]);
  const upload = Object.values(workflow.jobs).flatMap((job) => job.steps).find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.if, "${{ always() }}");
  const globs = upload.with.path.split("\n").filter((p) => p.startsWith("${{ runner.temp }}/data-foundation-audit/")).map((p) => path.basename(p));
  for (const name of [receipt.fiveImageEvidence.file, "image-aws-cli-previous.json", "image-aws-cli-previous.cdx.json", comparison.delta.file]) {
    assert.ok(globs.some((glob) => path.matchesGlob(name, glob)));
  }
});

test("a measured old policy refusal contributes zero blockers to five clean subjects", async (t) => {
  const { receipt, comparison } = await audit(t, "all-current-clean");
  assert.equal(receipt.fiveImageResult, "passed");
  assert.equal(comparison.qualification, "passed");
});

for (const [scenario, reason] of [
  ["missing", /ENOENT/], ["wrong-config", /scanner_aws_subject_invalid/], ["wrong-sbom", /scanner_aws_subject_invalid/],
  ["swapped", /scanner_official_sbom_invalid/], ["scanner-error", /scanner_official_command_failed/],
  ["cleanup-error", /scanner_official_cleanup_uncertain/], ["clean-old", /scanner_aws_unexpected_control/],
  ["lost-old-package", /scanner_aws_inventory_loss/], ["lost-new-package", /scanner_aws_inventory_loss/],
  ["oversized-sbom", /scanner_snapshot_invalid/], ["no-absence-proof", /scanner_aws_control_execution_invalid/],
  ["substituted-bytes", /scanner_frozen_input_changed/],
  ["missing-new-rpm", /scanner_aws_inventory_loss/], ["unrelated-old", /scanner_aws_unexpected_control/],
  ["db-drift", /scanner_frozen_input_changed/], ["candidate-drift", /scanner_frozen_input_changed/],
]) {
  test("five-subject refusal survives comparator failure: " + scenario, async (t) => {
    const { comparison, calls } = await audit(t, scenario);
    assert.equal(comparison.qualification, "failed");
    assert.match(comparison.reason, reason);
    if (scenario === "cleanup-error" || scenario === "scanner-error") assert.equal(calls.length, 11);
    if (scenario === "clean-old") assert.equal(comparison.oldPolicy, "clean");
  });
}

test("operational comparator failure rejects a run with five clean current subjects", async (t) => {
  const { receipt, comparison } = await audit(t, "clean-five-bad-control");
  assert.equal(receipt.fiveImageResult, "passed");
  assert.equal(comparison.qualification, "failed");
  assert.equal(comparison.reason, "scanner_aws_subject_invalid");
});
