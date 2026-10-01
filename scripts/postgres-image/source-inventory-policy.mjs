import { POSTGRES_PRIVATE_EVIDENCE_PIN } from "./private-evidence-policy.mjs";

const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const digest = "0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93";

// Independently authenticated historical report bytes; no report selects these pins.
export const POSTGRES_SOURCE_INVENTORY_PIN = freeze({
  workspace: "/opt/auto-world/checkouts/pr108-nonroot",
  node: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node",
  parent: "/home/autoworld",
  parentIdentity: { dev: "2096", ino: "1188", uid: 1000, gid: 1000, mode: 0o750 },
  directoryPrefix: `pg-declared-source-inventory-${digest}-`,
  executionPrefix: "local-source-inventory-",
  subject: `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:${digest}`,
  expected: {
    packageCount: 50,
    subject: {
      artifactName: "/candidate/saved.tar",
      imageId: "sha256:8453b2e3ea76734a5c5df6cd8bf17799880c4ed974e2e136dbf849254f96cdda",
      configDigest: "sha256:8453b2e3ea76734a5c5df6cd8bf17799880c4ed974e2e136dbf849254f96cdda",
      diffIds: [
        "sha256:74d97c428c51a828f9051a7a40a53ff1fc99e54fc30323ce36760701b0b7f711",
        "sha256:199b85bb67b34ec56ca3679a640cad26c482694949d478875ad803bfad29f113",
        "sha256:1b1c5f60fe610883c371803e933d0eb9d31dfe8ae9c1a5299e2516c6757eb2d9",
        "sha256:507f0fcc5e5565bd8f7a584202000685ebfaa7ebda9b9d436289bc1004fb4ce8",
        "sha256:34f5e4927b447367ecd2367ae94e56d654a30b9e244b9396ac628d5bcf90a5cf",
        "sha256:d006a4a663e7362cd4ae34ed8bf9a851ac9e99c359d8b1f143b1fccc0ad3e8fe",
        "sha256:42a506b7d4dafcf6fb679a5c2e4de60153ebca613bbfad36b833053eb92cd047",
        "sha256:149a42a2d36a8dc846e4624af2c7c2766d1cac31300c9f8392ca050d137ed217",
        "sha256:f81d67057ca8ee3ee1f538cdb7b128e05b4e2727e1c50686633d8b5158793fe2",
        "sha256:b69834c94476d5cb5d6561d3529668949fa3d28bd745a937bcec2f66eadebb72",
        "sha256:d438b225a8977c23dd26527e196bdff21f4565ec24f22b931aa69aaf38a2df24",
        "sha256:90b3a336de1c13f00f45fbf3e985e3366ad191aa9919864ac946f735d965e092",
      ],
      tag: "aw-postgres-gosu:09413d17b500a1fe5bae9ce0",
      os: "linux", architecture: "amd64", osFamily: "alpine", osVersion: "3.24.2",
    },
  },
  auditDirectory: "/home/autoworld/postgres-candidate-remote-audit-36673766454/reports",
  auditReference: { recipeRevision: "5186a241f9ab28add4098648aa4bc56d36b5e6dc", runId: "36673766454" },
  reports: [
    { role: "PACKAGE_REPORT", name: "candidate-vulnerabilities.json", size: 103337,
      sha256: "9cb9a560ec4c86e00110ffb6a85849843f457f37f6e95c36f589158d20014cfd" },
    { role: "SBOM", name: "candidate-sbom.cdx.json", size: 76609,
      sha256: "ec611993dae03e0a3902f28a759ec0b209ad43ba952013b5c4ffd6575189a185" },
  ],
  materials: POSTGRES_PRIVATE_EVIDENCE_PIN.publicFiles.filter((file) => file.source.startsWith("infra/postgres-image/materials/")),
  nonApkRuntime: {
    name: "PostgreSQL", version: "17.11", sourceBinding: "NOT_ESTABLISHED", noticeBinding: "NOT_ESTABLISHED",
    proofReference: { verification: "REFERENCE_AUTHENTICATED_BY_DISTINCT_REVIEW", readDuringCollection: false,
      recipeRevision: "70c396301808bf89652b1ba408d9aff282340483", size: 81500,
      sha256: "ff8c49950216a2de33f1e3a6566d1be662a4436f7d136ac2a7d252e21ab1c617" },
  },
});

export const postgresSourceInventoryLimits = freeze({
  operationMs: 300000, gitCommandMs: 90000, reportBytes: 128 * 1024,
  materialBytes: 4 * 1024 ** 2, inputBytes: 4 * 1024 ** 2,
  inventoryBytes: 128 * 1024, acknowledgementBytes: 16 * 1024,
  reservedDiskBytes: 1024 * 1024, outputMs: 10000,
});

export const POSTGRES_SOURCE_INVENTORY_CLAIMS = freeze({
  historicalIntegrity: "VERIFIED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED",
  sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED", legalCompliance: "NOT_EVALUATED",
  closure: "INCOMPLETE", admission: "NOT_AUTHORIZED", signing: "NOT_ATTEMPTED",
  supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
});
