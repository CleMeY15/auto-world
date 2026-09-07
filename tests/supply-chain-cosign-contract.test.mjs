import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJsonBuffer } from "../scripts/supply-chain/strict-json.mjs";
import {
  assertCosignRuntime,
  classifyCosignFailure,
  parseCosignArguments,
  validateNetworkNamespaceSnapshot,
  validateSignatureLedger,
} from "../scripts/supply-chain/cosign-airgap.mjs";

const code = (expected) => (error) => error?.code === expected;
const hash = (character) => character.repeat(64);

test("Cosign airgap accepts only its fixed absolute candidate contract", () => {
  const parsed = parseCosignArguments([
    "--binary", "/tmp/cosign", "--binary-sha256", hash("a"),
    "--source", "/tmp/cosign-source.tar", "--source-sha256", hash("b"),
    "--workspace", "/tmp/owned", "--output", "/tmp/owned/cosign-airgap-result.json",
  ]);
  assert.equal(parsed.binary_sha256, hash("a"));
  assert.throws(() => parseCosignArguments([
    "--binary", "cosign", "--binary-sha256", hash("a"),
    "--source", "/tmp/source", "--source-sha256", hash("b"),
    "--workspace", "/tmp/owned", "--output", "/tmp/owned/result.json",
  ]), code("cosign_arguments_refused"));
  assert.throws(() => parseCosignArguments([
    "--binary", "/tmp/cosign", "--binary-sha256", hash("A"),
    "--source", "/tmp/source", "--source-sha256", hash("b"),
    "--workspace", "/tmp/owned", "--output", "/tmp/owned/result.json",
  ]), code("cosign_arguments_refused"));
});

test("Cosign airgap refuses non-Linux and non-Actions execution", () => {
  assert.throws(() => assertCosignRuntime("win32", { GITHUB_ACTIONS: "true" }), code("cosign_runtime_refused"));
  assert.throws(() => assertCosignRuntime("linux", {}), code("cosign_runtime_refused"));
  assert.doesNotThrow(() => assertCosignRuntime("linux", { GITHUB_ACTIONS: "true" }));
});

test("network namespace proof accepts loopback only and rejects host routes", () => {
  const ipv4Header = "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n";
  assert.deepEqual(validateNetworkNamespaceSnapshot(["lo"], ipv4Header, ""), {
    interfaces: ["lo"], ipv4NonLoopbackRoutes: 0, ipv6NonLoopbackRoutes: 0, status: "isolated",
  });
  assert.throws(() => validateNetworkNamespaceSnapshot(["eth0", "lo"], ipv4Header, ""),
    code("cosign_network_namespace_invalid"));
  assert.throws(() => validateNetworkNamespaceSnapshot(["lo"], `${ipv4Header}eth0 00000000 0100007F\n`, ""),
    code("cosign_network_namespace_invalid"));
});

test("Cosign failures are accepted only for the expected local reason", () => {
  assert.equal(classifyCosignFailure("wrong_key", Buffer.from("signature verification failed")), "signature_invalid");
  assert.equal(classifyCosignFailure("tampered_subject", Buffer.from("invalid signature")), "signature_invalid");
  assert.equal(classifyCosignFailure("missing_key", Buffer.from("open /owned/missing.pub: no such file")), "key_missing");
  assert.throws(() => classifyCosignFailure("wrong_key", Buffer.from("dial tcp: connection refused")),
    code("cosign_negative_wrong_reason"));
  assert.throws(() => classifyCosignFailure("missing_key", Buffer.from("generic failure")),
    code("cosign_negative_wrong_reason"));
});

test("copied signature ledger binds identities and refuses revocation", () => {
  const expected = {
    bundleSha256: hash("a"), keySha256: hash("b"), sourceSha256: hash("c"), subjectSha256: hash("d"),
  };
  const ledger = (status = "active") => canonicalJsonBuffer({
    entries: [{ ...expected, status }], schemaVersion: 1,
  });
  assert.deepEqual(validateSignatureLedger(ledger(), expected), { status: "active" });
  assert.throws(() => validateSignatureLedger(Buffer.from(ledger("revoked")), expected), code("cosign_ledger_revoked"));
  assert.throws(() => validateSignatureLedger(ledger(), { ...expected, bundleSha256: hash("e") }),
    code("cosign_ledger_identity_mismatch"));
  assert.throws(() => validateSignatureLedger(Buffer.from(`${ledger().toString("utf8")}\n`), expected),
    code("cosign_ledger_noncanonical"));
});
