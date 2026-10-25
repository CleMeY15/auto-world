import { COLD_LOAD_PIN } from "./cold-load-policy.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN } from "./runtime-restore-policy.mjs";

const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const file = (source, size, sha256) => ({ name: source, source, size, sha256 });

// Independent reviewed byte/recipe expectations. Copied JSON never selects its own pins.
export const POSTGRES_PRIVATE_EVIDENCE_PIN = freeze({
  purpose: "POSTGRES_PRIVATE_EVIDENCE_INTAKE",
  workspace: "/opt/auto-world/checkouts/pr108-nonroot",
  parent: "/home/autoworld",
  directoryPrefix: "pg-private-evidence-0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93-",
  ownerUid: 1000,
  ownerGid: 1000,
  subject: "ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93",
  candidate: { imageId: COLD_LOAD_PIN.imageId, tag: COLD_LOAD_PIN.tag },
  original: COLD_LOAD_PIN.original,
  importDirectory: COLD_LOAD_PIN.directory,
  copyReceiptFile: COLD_LOAD_PIN.copyReceiptFile,
  copyReceipt: { size: COLD_LOAD_PIN.copyReceiptBytes, sha256: COLD_LOAD_PIN.copyReceiptSha256 },
  auditDirectory: POSTGRES_RUNTIME_RESTORE_PIN.auditDirectory,
  policyFiles: {
    candidate: "infra/postgres-image/candidate-remote.json",
    runtime: "infra/postgres-image/candidate-runtime.json",
    lock: "infra/postgres-image/lock.json",
  },
  publicFiles: [
    file("infra/postgres-image/candidate-runtime.json", 4447, "2ce820b577674c127dbf8fa4c5cc0cbfc1957234b432a34efb1f9d68f063dbb5"),
    file("infra/postgres-image/candidate-remote.json", 4848, "4dab1fdb15d6a522c8aa64ccd14c81a1c504e188609f395f62dc4a49ab56ce51"),
    file("infra/postgres-image/lock.json", 3273, "31c293b64423aa6eb241b840b6f2187b9632f9334fb60ec8e1c02be806f583c3"),
    file("infra/postgres-image/Dockerfile", 1705, "a7efa706b746a73de653301a76b88eac94b24f971ad74eba7e70b995201eaf4b"),
    file("infra/postgres-image/candidate-publication-receipt.json", 22970, "d0cad244921e91229027c625440aa654624f1e754a975901b5b9a763135d3287"),
    file("infra/scanner/scanner-lock.json", 6886, "7d8b09739a3d1b79e11cb12e4fbf7433aded0a5dc1bbb9104f8dd973620c1251"),
    file("infra/postgres-image/materials/gosu-1.19-r5.apk", 830337, "cd51335dcbc412f28088452a2407ff13e01dce9e11718feee4beec69cf2ebcad"),
    file("infra/postgres-image/materials/APKINDEX-v3.24-community-x86_64.tar.gz", 2517261, "87d288609457bab7c5dd63f13e3ebda73511adfedafebd9226dac4e55f3c69f3"),
    file("infra/postgres-image/materials/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub", 800, "207e4696d3c05f7cb05966aee557307151f1f00217af4143c1bcaf33b8df733f"),
    file("infra/postgres-image/materials/APKBUILD-1e1aed58b7720fcb6b1859043d543b33019d8c4f", 825, "e8ebdfafcedf25013b39055c83171936109c9ffb4c0262d8aef4139e0a481192"),
    file("infra/postgres-image/materials/provenance.json", 2836, "42c2700a73a76ffe44436143474d2edafd2a02d5890d87fff3b33eae5d0af577"),
  ],
  recipes: {
    publication: "b93b0c76ec76abe283d66a17fa62eab7e580e679",
    audit: "5186a241f9ab28add4098648aa4bc56d36b5e6dc",
    runtime: "a1e0cad8dda48ffd335d205203aaff61841bd9f9",
    retention: "2c6fa14e4fee676afd1942a8dea57e8ca3cbba4e",
    copy: "2eda0dbf031d6eb3e1f1c486c68facf326a62e76",
    cold: "cf702598081863335bd36801713adc5022541d73",
    sql: "70c396301808bf89652b1ba408d9aff282340483",
  },
  requiredMissing: [
    "ROOT_COLD_LOAD_RECEIPT", "ROOT_SQL_RESTORE_RECEIPT", "SQL_DUMP", "EXTERNAL_SOFTWARE_SOURCE_NOTICES",
    "OFFICIAL_ATTESTATION_BUNDLE", "SECOND_WINDOWS_EVIDENCE_COPY",
  ],
});

export const postgresPrivateEvidenceLimits = freeze({
  operationMs: 15 * 60_000,
  gitCommandMs: 90_000,
  bundleBytes: 512 * 1024 ** 2,
  auxiliaryRepositoryBytes: 512 * 1024 ** 2,
  staticFileBytes: 16 * 1024 ** 2,
  receiptBytes: 128 * 1024,
  reservedDiskBytes: 2 * 1024 ** 3,
});

export function postgresPrivateEvidenceBlobPins(recipeRevision, pin = POSTGRES_PRIVATE_EVIDENCE_PIN) {
  if (typeof recipeRevision !== "string" || !/^[0-9a-f]{40}$/u.test(recipeRevision)) throw new Error("postgres_private_evidence_recipe_invalid");
  const dockerfile = pin.publicFiles.find((item) => item.source === "infra/postgres-image/Dockerfile");
  if (!dockerfile) throw new Error("postgres_private_evidence_recipe_invalid");
  return freeze([
    ...Object.values(pin.recipes).map((revision) => ({ recipeRevision: revision, path: dockerfile.source, size: dockerfile.size, sha256: dockerfile.sha256 })),
    ...pin.publicFiles.map((item) => ({ recipeRevision, path: item.source, size: item.size, sha256: item.sha256 })),
  ]);
}
