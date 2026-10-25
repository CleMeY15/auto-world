import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Authority comes from these independently reviewed byte identities, never a
// candidate's state field. The private policy/receipt remain outside public CI.
export const CORE_EVIDENCE = Object.freeze({
  acceptance: Object.freeze({ bytes: 2553,
    sha256: "63ba6e33b16e5bbb7e9327e466349c1bf044f44b9bcf11506b6e44fada0e23dd" }),
  inventory: Object.freeze({ bytes: 399783,
    sha256: "2986e7d0bbbed5a25dedd21ef5841aed64317a77172d487c101bd2baad7452fd" }),
});
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const freeze = value => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export function validatePostgresCoreEvidenceAcceptanceBytes(acceptanceBytes, inventoryBytes) {
  for (const [bytes, expected] of [[acceptanceBytes, CORE_EVIDENCE.acceptance],
    [inventoryBytes, CORE_EVIDENCE.inventory]]) {
    if (!Buffer.isBuffer(bytes) || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error("postgres_core_evidence_acceptance_invalid");
    }
  }
  // JSON is parsed only after complete byte authentication. The reviewed bytes
  // carry closed schemas, all group digests and the closed native ACK projection.
  return freeze({ acceptance: JSON.parse(acceptanceBytes.toString("utf8")),
    inventory: JSON.parse(inventoryBytes.toString("utf8")) });
}

export function loadPostgresCoreEvidenceAcceptance() {
  return validatePostgresCoreEvidenceAcceptanceBytes(
    readFileSync(new URL("../../infra/postgres-image/core-evidence-acceptance.json", import.meta.url)),
    readFileSync(new URL("../../infra/postgres-image/core-evidence-inventory.json", import.meta.url)),
  );
}
