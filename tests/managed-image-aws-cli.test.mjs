import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportManagedTextEvidence } from "../scripts/scanner/official-audit.mjs";
import test from "node:test";

const recipe = readFileSync(new URL("../infra/managed-images/Dockerfile.aws-cli", import.meta.url), "utf8");
const lock = JSON.parse(readFileSync(new URL("../infra/managed-images/lock.json", import.meta.url), "utf8"));
const baseDigest = "sha256:eb3b4742dbfd983bcb79e2df22fbcfde9ad5b3f8277ff1d4050bd7f9cdd9c090";
const releasever = "2023.12.20261112";
const guid = "707b7dfd96f868bd1650473d34d918a106283766d54260bc446abe9beefb6523";
const repomdSha256 = "ae00370d0a8a2e73ea7751cdf7417b07d72e6672674eb55a50f74d52ac9834fe";
const expectedRpms = new Map([
  ["curl-minimal", "0:8.21.0-5.amzn2023.0.5"],
  ["libcurl-minimal", "0:8.21.0-5.amzn2023.0.5"],
  ["glibc", "0:2.34-231.amzn2023.0.6"],
  ["glibc-common", "0:2.34-231.amzn2023.0.6"],
  ["glibc-minimal-langpack", "0:2.34-231.amzn2023.0.6"],
  ["libcap", "0:2.73-1.amzn2023.0.8"],
  ["pcre2", "0:10.40-1.amzn2023.0.5"],
  ["pcre2-syntax", "0:10.40-1.amzn2023.0.5"],
  ["python3", "0:3.9.25-1.amzn2023.0.11"],
  ["python3-libs", "0:3.9.25-1.amzn2023.0.11"],
  ["rpm", "0:4.16.1.3-29.amzn2023.0.10"],
  ["rpm-libs", "0:4.16.1.3-29.amzn2023.0.10"],
  ["rpm-build-libs", "0:4.16.1.3-29.amzn2023.0.10"],
  ["rpm-sign-libs", "0:4.16.1.3-29.amzn2023.0.10"],
  ["python3-rpm", "0:4.16.1.3-29.amzn2023.0.10"],
  ["sqlite-libs", "0:3.40.0-1.amzn2023.0.9"],
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
  assert.ok(source.includes(`'amazon/aws-cli@${baseDigest}' > "$evidence/base-image.txt"`));
  assert.ok(source.includes(`repo=https://cdn.amazonlinux.com/al2023/core/guids/${guid}/x86_64/\n`));
  assert.ok(source.includes(`printf '%s  %s\\n' ${repomdSha256} "$evidence/repomd.xml" | sha256sum -c -`));
  assert.ok(source.indexOf("| sha256sum -c -") < source.indexOf("\nset -- --releasever="));
  assert.match(source, /curl --fail --location --proto '=https' --tlsv1\.2 "\$\{repo\}repodata\/repomd\.xml"/u);
}

function assertTransaction(source) {
  assert.match(source, /set -euo pipefail/u);
  const commands = source.replace(/\\\r?\n\s*/gu, " ").split(/\r?\n/u);
  const transaction = commands.filter((line) => line.startsWith("set -- --releasever="));
  assert.equal(transaction.length, 1);
  for (const option of [
    `--releasever=${releasever}`, "--disablerepo='*'", "--enablerepo=amazonlinux",
    "--setopt=amazonlinux.skip_if_unavailable=0", "--setopt=amazonlinux.mirrorlist=", '--setopt="amazonlinux.baseurl=$repo"',
    "--setopt=amazonlinux.gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-amazon-linux-2023",
    "--setopt=amazonlinux.gpgcheck=1", "--setopt=gpgcheck=1", "--refresh --best upgrade -y",
  ]) assert.ok(transaction[0].includes(option), `required transaction option: ${option}`);
  assert.ok(transaction[0].endsWith(" --refresh --best upgrade -y"));
  assert.ok(source.includes(`printf '%s\\n' "$*" > "$evidence/dnf-command.txt"\ndnf "$@" 2>&1 | tee "$evidence/dnf-upgrade.txt"\ncapture_history after`));
  assert.doesNotMatch(commands.filter((line) => !line.startsWith("#")).join("\n"), /(?:--nogpgcheck|gpgcheck=(?:0|false)|--allowerasing|--skip-broken|\blatest\b|\bdowngrade\b)/u);
  assert.match(source, /test -s \/etc\/pki\/rpm-gpg\/RPM-GPG-KEY-amazon-linux-2023/u);
  assert.equal(commands.filter((line) => line.trimStart().startsWith("dnf ")).length, 3);
  assert.ok(source.includes("export LC_ALL=C"));
  assert.ok(source.includes("SELECT MAX(id) FROM trans"));
  assert.ok(source.includes(`dnf --disablerepo='*' history info "$id" > "$evidence/dnf-history-$side.txt"`));
  assert.ok(source.includes(`printf '%s\\n' "$id" > "$evidence/dnf-history-$side-id.txt"`));
  assert.ok(source.indexOf("\ncapture_history before\n") >= 0 && source.indexOf("capture_history before") < source.indexOf("set -- --releasever="));
}

function assertCorrections(source) {
  const assertions = [...source.matchAll(/test "\$\(rpm -q --qf '%\{EPOCHNUM\}:%\{VERSION\}-%\{RELEASE\}\\n' ([a-z0-9-]+)\)" = '([^']+)'/gu)];
  assert.deepEqual(new Map(assertions.map(([, name, evr]) => [name, evr])), expectedRpms);
  assert.equal(assertions.length, expectedRpms.size);
  const checks = [...source.matchAll(/^assert_fixed_evrs$/gmu)];
  assert.equal(checks.length, 2);
  assert.ok(source.includes("assert_fixed_evrs() {\n    test \"$(rpm -q"));
  assert.ok(checks[0].index < source.indexOf("dnf \"$@\"") && checks[1].index > source.indexOf("dnf \"$@\""));
}

function assertCliPreserved(source) {
  assert.doesNotMatch(source, /^(?:USER|ENTRYPOINT|CMD|WORKDIR|ADD|ENV)\s/imu);
  assert.equal([...source.matchAll(/^COPY /gmu)].length, 1);
  assert.match(source, /test "\$\(cut -d ' ' -f1 "\$evidence\/aws-version-before\.txt"\)" = aws-cli\/2\.41\.0/u);
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
    assert.ok(source.indexOf(`"$evidence/${name}-before.${extension}"`) < source.indexOf("\nset -- --releasever="));
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
    recipe.replace("--setopt=amazonlinux.skip_if_unavailable=0", ""),
    recipe.replace("capture_history before", "capture_history after"),
    recipe.replace("dnf \"$@\"", "dnf upgrade"),
    recipe.replace("SELECT MAX(id) FROM trans", "SELECT MIN(id) FROM trans"),
    recipe.replace("set -euo pipefail", "set -eu"),
  ]) assert.throws(() => assertTransaction(changed));
});

test("all required RPM corrections use exact epoch, version and release assertions", () => {
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
  assert.ok(recipe.includes('python3 - "$evidence" > "$evidence/dnf-transaction.txt"'));
  assert.ok(recipe.includes('dnf clean all\nBUILD'));
  assert.doesNotMatch(recipe, /(?:docker (?:push|login)|cosign|supportUntil|admittedAt)/u);
});

const noopLog = "Dependencies resolved.\nNothing to do.\nComplete!\n";
const transactionLog = [
  "Dependencies resolved.", "Transaction Summary", "Running transaction check",
  "Running transaction test", "Running transaction", "Complete!", "",
].join("\n");
const upgradeCommand = [
  `--releasever=${releasever}`, "--disablerepo=*", "--enablerepo=amazonlinux",
  "--setopt=amazonlinux.skip_if_unavailable=0", "--setopt=amazonlinux.mirrorlist=",
  `--setopt=amazonlinux.baseurl=https://cdn.amazonlinux.com/al2023/core/guids/${guid}/x86_64/`,
  "--setopt=amazonlinux.gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-amazon-linux-2023",
  "--setopt=amazonlinux.gpgcheck=1", "--setopt=gpgcheck=1", "--refresh --best upgrade -y",
].join(" ");
function historyReport(id, command, packages) {
  return [
    `Transaction ID : ${id}`, "End time       : Wed Nov 18 12:00:00 2026 (1 seconds)",
    "Return-Code    : Success", `Command Line   : ${command}`, "Packages Altered:", ...packages, "",
  ].join("\n");
}
const inherited = historyReport(1, "install -y less groff findutils jq", ["    Install jq-1.7-1.x86_64 @amazonlinux"]);
const updated = historyReport(2, upgradeCommand, [
  "    Upgrade  example-1:2.0-1.x86_64 @amazonlinux", "    Upgraded example-1.0-1.x86_64   @@System",
  "    Install  example-dep-1.0-1.noarch @amazonlinux",
]);
const beforeRpms = "example\t0:1.0-1\tx86_64\ngpg-pubkey\t0:key-date\t(none)\n";
const afterRpms = "example\t1:2.0-1\tx86_64\nexample-dep\t0:1.0-1\tnoarch\ngpg-pubkey\t0:key-date\t(none)\n";
function dnfFixture(transaction) {
  return {
    "dnf-command.txt": upgradeCommand + "\n",
    "dnf-history-before-id.txt": "1\n", "dnf-history-before.txt": inherited,
    "dnf-history-after-id.txt": transaction ? "2\n" : "1\n", "dnf-history-after.txt": transaction ? updated : inherited,
    "rpm-before.tsv": beforeRpms, "rpm-after.tsv": transaction ? afterRpms : beforeRpms,
    "dnf-upgrade.txt": transaction ? transactionLog : noopLog,
  };
}

function verifyFixture(context, files) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "aw-dnf-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "evidence");
  mkdirSync(source);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(source, name), bytes);
  const validator = recipe.match(/<<'VERIFY_DNF'\n([\s\S]+?)\nVERIFY_DNF\n/u)[1];
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-I", "-B", "-", source], {
    encoding: "utf8", input: validator, timeout: 10000, windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  return { result, source, destination: path.join(root, "export") };
}

for (const transaction of [false, true]) {
  test(`actual DNF evidence classifier and text exporter accept a verified ${transaction ? "transaction" : "no-op"}`, (context) => {
    const files = dnfFixture(transaction);
    const { result, source, destination } = verifyFixture(context, files);
    assert.equal(result.status, 0, result.stderr);
    const expected = [
      `outcome=${transaction ? "TRANSACTION" : "NO_OP"}`, "previousHistoryId=1",
      `currentHistoryId=${transaction ? 2 : 1}`, `upgradeTransactionId=${transaction ? 2 : "none"}`, "",
    ].join("\n");
    assert.equal(result.stdout.replaceAll("\r\n", "\n"), expected);
    files["dnf-transaction.txt"] = result.stdout;
    writeFileSync(path.join(source, "dnf-transaction.txt"), result.stdout);
    const records = exportManagedTextEvidence(source, destination);
    assert.deepEqual(records.map(({ path: name }) => name).sort(), Object.keys(files).sort());
    for (const [name, bytes] of Object.entries(files)) assert.equal(readFileSync(path.join(destination, name), "utf8"), bytes);
  });
}

const refusals = [
  [false, "dnf-history-before.txt", "", "missing or ambiguous history field"],
  [false, "dnf-command.txt", "", "missing upgrade command"],
  [false, "dnf-history-after.txt", updated, "wrong history identity"],
  [false, "dnf-history-after.txt", inherited.replace("less groff", "some other"), "history changed under the same ID"],
  [false, "dnf-history-after.txt", inherited.replace("Success", "** Aborted **"), "incomplete history"],
  [false, "rpm-after.tsv", afterRpms, "inventory changed without a transaction"],
  [false, "dnf-upgrade.txt", "Complete!\n", "missing or ambiguous dependency resolution"],
  [false, "dnf-upgrade.txt", "Transaction Summary\n" + noopLog, "conflicting no-op output"],
  [true, "dnf-upgrade.txt", noopLog, "conflicting transaction output"],
  [true, "dnf-upgrade.txt", transactionLog.replace("Complete!", "Error"), "upgrade did not complete"],
  [true, "dnf-history-after-id.txt", "3\n", "wrong history identity"],
  [true, "dnf-history-after.txt", updated.replace(upgradeCommand, "install -y example"), "unrelated transaction"],
  [true, "dnf-history-after.txt", updated.replace("    Upgrade ", " ** Upgrade "), "unfinished or missing package actions"],
  [true, "dnf-history-after.txt", updated.replace("Upgrade ", "Downgrade "), "unexpected package action"],
  [true, "dnf-history-after.txt", updated.replace("@amazonlinux", "@other"), "unexpected source repository"],
  [true, "dnf-history-after.txt", updated.replace("Upgrade ", "Install "), "unpaired package upgrade"],
  [true, "rpm-after.tsv", beforeRpms, "transaction actions disagree"],
  [true, "rpm-after.tsv", afterRpms.replace("example-dep\t0:1.0-1\tnoarch\n", ""), "transaction actions disagree"],
];
test("actual DNF classifier refuses stale, incomplete and conflicting captures", (context) => {
  for (const [transaction, name, bytes, reason] of refusals) {
    const files = { ...dnfFixture(transaction), [name]: bytes };
    const { result } = verifyFixture(context, files);
    assert.equal(result.status, 1, `expected refusal for ${name}: ${reason}`);
    assert.ok(result.stderr.includes("DNF evidence: " + reason), result.stderr);
    assert.equal(result.stdout, "");
  }
});
