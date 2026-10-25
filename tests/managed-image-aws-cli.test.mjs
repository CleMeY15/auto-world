import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recipe = readFileSync(new URL("../infra/managed-images/Dockerfile.aws-cli", import.meta.url), "utf8");
const lock = JSON.parse(readFileSync(new URL("../infra/managed-images/lock.json", import.meta.url), "utf8"));
const baseDigest = "sha256:25fea7c13a5b32ac8bde048af1cd286e41f07d5d37e6649f23c14a6f9bf284d9";
const releasever = "2023.12.20261026";
const guid = "762fda855b4bc601a07d99c19a1a9ff82429e78f450f59450cd12522ec5b7ae6";
const repomdSha256 = "0c790663fd4779e47e261b22155386c82927f2d2c15e0bb90ff6501db0dee1b5";
const expectedRpms = new Map([
  ["curl-minimal", "0:8.21.0-5.amzn2023.0.3"],
  ["libcurl-minimal", "0:8.21.0-5.amzn2023.0.3"],
  ["libcap", "0:2.73-1.amzn2023.0.8"],
  ["pcre2", "0:10.40-1.amzn2023.0.5"],
  ["pcre2-syntax", "0:10.40-1.amzn2023.0.5"],
  ["python3", "0:3.9.25-1.amzn2023.0.11"],
  ["python3-libs", "0:3.9.25-1.amzn2023.0.11"],
]);

// Source-contract checks complement the actual DNF, image and S3 checks in Linux CI.
function assertMaterials(source, materials = lock) {
  assert.equal(materials.state, "DIAGNOSTIC_ONLY_NOT_ADMITTED");
  assert.equal(materials.platform, "linux/amd64");
  assert.equal(materials.candidates.find(({ role }) => role === "aws-cli").baseDigest, baseDigest);
  assert.equal(materials.amazonLinux.releasever, releasever);
  assert.equal(materials.amazonLinux.repositoryGuid, guid);
  assert.equal(materials.amazonLinux.repomdSha256, repomdSha256);
  assert.ok(source.includes(`FROM amazon/aws-cli@${baseDigest} AS aws-cli-updated\n`));
  assert.ok(source.includes(`repo=https://cdn.amazonlinux.com/al2023/core/guids/${guid}/x86_64/\n`));
  assert.ok(source.includes(`printf '%s  %s\\n' ${repomdSha256} "$evidence/repomd.xml" | sha256sum -c -`));
  assert.ok(source.indexOf("| sha256sum -c -") < source.indexOf("\ndnf --releasever="));
  assert.match(source, /curl --fail --location --proto '=https' --tlsv1\.2 "\$\{repo\}repodata\/repomd\.xml"/u);
}

function assertTransaction(source) {
  assert.match(source, /set -euo pipefail/u);
  const commands = source.replace(/\\\r?\n\s*/gu, " ").split(/\r?\n/u);
  const transaction = commands.filter((line) => line.startsWith("dnf --releasever="));
  assert.equal(transaction.length, 1);
  for (const option of [
    `--releasever=${releasever}`, "--disablerepo='*'", "--enablerepo=amazonlinux",
    "--setopt=amazonlinux.mirrorlist=", '--setopt="amazonlinux.baseurl=$repo"',
    "--setopt=amazonlinux.gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-amazon-linux-2023",
    "--setopt=amazonlinux.gpgcheck=1", "--setopt=gpgcheck=1", "--refresh --best upgrade -y",
  ]) assert.ok(transaction[0].includes(option), `required transaction option: ${option}`);
  assert.match(transaction[0], / upgrade -y +2>&1 \| tee "\$evidence\/dnf-upgrade\.txt"$/u);
  assert.doesNotMatch(commands.filter((line) => !line.startsWith("#")).join("\n"), /(?:--nogpgcheck|gpgcheck=(?:0|false)|--allowerasing|--skip-broken|\blatest\b|\bdowngrade\b)/u);
  assert.match(source, /test -s \/etc\/pki\/rpm-gpg\/RPM-GPG-KEY-amazon-linux-2023/u);
  assert.equal(commands.filter((line) => line.startsWith("dnf ")).length, 3);
  assert.match(source, /dnf history info last > "\$evidence\/dnf-transaction\.txt"/u);
}

function assertCorrections(source) {
  const assertions = [...source.matchAll(/test "\$\(rpm -q --qf '%\{EPOCHNUM\}:%\{VERSION\}-%\{RELEASE\}\\n' ([a-z0-9-]+)\)" = '([^']+)'/gu)];
  assert.deepEqual(new Map(assertions.map(([, name, evr]) => [name, evr])), expectedRpms);
  assert.equal(assertions.length, expectedRpms.size);
  assert.ok(source.indexOf("upgrade -y") < source.indexOf("test \"$(rpm -q"));
}

function assertCliPreserved(source) {
  assert.doesNotMatch(source, /^(?:USER|ENTRYPOINT|CMD|WORKDIR|ADD|ENV)\s/imu);
  assert.equal([...source.matchAll(/^COPY /gmu)].length, 1);
  assert.match(source, /test "\$\(cut -d ' ' -f1 "\$evidence\/aws-version-before\.txt"\)" = aws-cli\/2\.38\.5/u);
  for (const side of ["before", "after"]) {
    assert.ok(source.includes(`find /usr/local/aws-cli -xdev -printf '%p\\t%y\\t%m\\t%U\\t%G\\t%s\\t%l\\n' | LC_ALL=C sort > "$evidence/cli-tree-${side}.tsv"`));
    assert.ok(source.includes(`find /usr/local/aws-cli -xdev -type f -exec sha256sum '{}' + | LC_ALL=C sort > "$evidence/cli-files-${side}.sha256"`));
    assert.ok(source.includes(`/usr/local/bin/aws /usr/local/bin/aws_completer > "$evidence/cli-launchers-${side}.tsv"`));
    assert.ok(source.includes(`/usr/local/bin/aws --version > "$evidence/aws-version-${side}.txt" 2>&1`));
  }
  assert.ok(source.includes("for inventory in cli-tree.tsv cli-files.sha256 cli-launchers.tsv aws-version.txt; do"));
  assert.ok(source.includes('prefix=${inventory%.*}\n    suffix=${inventory##*.}'));
  assert.ok(source.includes('before=$(sha256sum "$evidence/$prefix-before.$suffix")'));
  assert.ok(source.includes('after=$(sha256sum "$evidence/$prefix-after.$suffix")'));
  assert.ok(source.includes('test "${before%% *}" = "${after%% *}"'));
  assert.ok(source.indexOf("for inventory in ") > source.indexOf("upgrade -y"));
  assert.doesNotMatch(source, /^cmp /mu);
  for (const [name, extension] of [["cli-tree", "tsv"], ["cli-files", "sha256"], ["cli-launchers", "tsv"], ["aws-version", "txt"]]) {
    assert.ok(source.indexOf(`"$evidence/${name}-before.${extension}"`) < source.indexOf("\ndnf --releasever="));
    assert.ok(source.indexOf(`"$evidence/${name}-after.${extension}"`) > source.indexOf("upgrade -y"));
  }
  assert.match(source, /FROM aws-cli-updated AS runtime\nLABEL /u);
}

test("AWS recipe binds the immutable source and dated repository to the managed lock", () => {
  assertMaterials(recipe);
  for (const changed of [recipe.replaceAll(baseDigest, `sha256:${"a".repeat(64)}`), recipe.replaceAll(guid, "b".repeat(64)), recipe.replaceAll(repomdSha256, "c".repeat(64))]) {
    assert.throws(() => assertMaterials(changed));
  }
  const changedLock = JSON.parse(JSON.stringify(lock));
  changedLock.candidates.find(({ role }) => role === "aws-cli").baseDigest = `sha256:${"d".repeat(64)}`;
  assert.throws(() => assertMaterials(recipe, changedLock));
});

test("AWS recipe enforces one full coherent DNF transaction with inherited official signing key", () => {
  assertTransaction(recipe);
  for (const changed of [
    recipe.replace("--setopt=amazonlinux.gpgcheck=1", "--setopt=amazonlinux.gpgcheck=0"),
    recipe.replace("--setopt=gpgcheck=1", "--nogpgcheck"),
    recipe.replace("--refresh --best upgrade -y", "--refresh --best upgrade curl-minimal -y"),
    recipe.replace(`--releasever=${releasever}`, "--releasever=latest"),
    recipe.replace("--setopt=amazonlinux.mirrorlist=", ""),
    recipe.replace("set -euo pipefail", "set -eu"),
  ]) assert.throws(() => assertTransaction(changed));
});

test("all seven measured RPM corrections use exact epoch, version and release assertions", () => {
  assertCorrections(recipe);
  for (const [name, evr] of expectedRpms) {
    const line = `test "$(rpm -q --qf '%{EPOCHNUM}:%{VERSION}-%{RELEASE}\\n' ${name})" = '${evr}'`;
    assert.throws(() => assertCorrections(recipe.replace(line, "")), `missing ${name}`);
    assert.throws(() => assertCorrections(recipe.replace(line, line.replace(evr, "0:0.0-1"))), `stale ${name}`);
  }
});

test("CLI bytes, links, permissions, notices and version are compared across the actual upgrade", () => {
  assertCliPreserved(recipe);
  for (const changed of [
    recipe.replace("cli-tree.tsv cli-files.sha256 cli-launchers.tsv aws-version.txt", "cli-tree.tsv aws-version.txt"),
    recipe.replace('test "${before%% *}" = "${after%% *}"', ""),
    recipe.replace('after=$(sha256sum "$evidence/$prefix-after.$suffix")', 'after=$(sha256sum "$evidence/$prefix-before.$suffix")'),
    `${recipe}\nENTRYPOINT ["/bin/sh"]\n`, `${recipe}\nUSER 1000\n`,
    `${recipe}\nCOPY replacement /usr/local/aws-cli/\n`,
  ]) assert.throws(() => assertCliPreserved(changed));
});

test("text-only evidence target exports inventories, while the default runtime inherits the corrected base", () => {
  assert.match(recipe, /FROM scratch AS evidence\nCOPY --from=aws-cli-updated \/usr\/share\/auto-world\/managed-images\/aws-cli\/ \/\n/u);
  assert.match(recipe, /FROM aws-cli-updated AS runtime[\s\S]+io\.auto-world\.aws-cli\.authority="diagnostic-only-not-admitted"\s*$/u);
  for (const side of ["before", "after"]) {
    assert.ok(recipe.includes(`rpm -qa --qf '%{NAME}\\t%{EPOCHNUM}:%{VERSION}-%{RELEASE}\\t%{ARCH}\\n' | LC_ALL=C sort > "$evidence/rpm-${side}.tsv"`));
  }
  assert.ok(recipe.includes('dnf history info last > "$evidence/dnf-transaction.txt"'));
  assert.ok(recipe.includes('dnf clean all\nBUILD'));
  assert.doesNotMatch(recipe, /(?:docker (?:push|login)|cosign|supportUntil|admittedAt)/u);
});
