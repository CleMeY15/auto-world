import { POSTGRES_SOURCE_INVENTORY_PIN } from "./source-inventory-policy.mjs";

const freeze = value => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const digest = "0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93";
const apacheLicense = { path: "LICENSE", size: 11358, sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" };
const patents = { path: "PATENTS", size: 1303, sha256: "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc" };

// Acquisition URLs describe the independently reviewed public preparation.
// The fixed local byte pins, never archive filenames or report instructions,
// authenticate what this historical retention diagnostic accepts.
export const POSTGRES_GOSU_SOURCE_PIN = freeze({
  workspace: POSTGRES_SOURCE_INVENTORY_PIN.workspace,
  node: POSTGRES_SOURCE_INVENTORY_PIN.node,
  parent: POSTGRES_SOURCE_INVENTORY_PIN.parent,
  parentIdentity: POSTGRES_SOURCE_INVENTORY_PIN.parentIdentity,
  subject: POSTGRES_SOURCE_INVENTORY_PIN.subject,
  directoryPrefix: `pg-gosu-source-retention-${digest}-`,
  executionPrefix: "local-gosu-source-retention-",
  inputDirectory: "/home/autoworld/pg-public-source-inputs-0045bdab-20261001-a2d74eb60d0a9697f9e3b7cf",
  // Reviewed native preparation remains a byte-copy prerequisite only.
  inputDirectoryIdentity: { dev: "2096", ino: "112771", uid: 1000, gid: 1000, mode: 0o700 },
  recipe: {
    source: "infra/postgres-image/materials/APKBUILD-1e1aed58b7720fcb6b1859043d543b33019d8c4f",
    size: 825, sha256: "e8ebdfafcedf25013b39055c83171936109c9ffb4c0262d8aef4139e0a481192",
  },
  inspector: { source: "scripts/postgres-image/source-notices-inspect.py" },
  python: {
    executable: "/usr/bin/python3.12", version: "3.12.3",
    arguments: ["-I", "-S", "-B", "/proc/self/fd/7"],
    trust: "EXISTING_ROOT_OWNED_SYSTEM_RUNTIME_AND_STDLIB",
    transitiveStdlibClosure: "NOT_INDEPENDENTLY_AUTHENTICATED",
    files: [
      { source: "/usr/bin/python3.12", size: 8020928, mode: 0o755,
        sha256: "e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f" },
      { source: "/usr/lib/python3.12/json/__init__.py", size: 14020, mode: 0o644,
        sha256: "d5d41e2c29049515d295d81a6d40b4890fbec8d8482cfb401630f8ef2f77e4d5" },
      { source: "/usr/lib/python3.12/base64.py", size: 20602, mode: 0o755,
        sha256: "65c70b5b6361c6f7a71ecc2df0f55315474b669221dd8d81d7c1ae8d56748ada" },
    ],
  },
  archives: [
    {
      role: "GOSU_SOURCE", name: "gosu-1.19.tar.gz", size: 17622,
      sha256: "cd9719b775dbfedae53923c9b0dc792b66d42c51e0b36652ed6f747fbadc0164",
      sourceUrl: "https://codeload.github.com/tianon/gosu/tar.gz/refs/tags/1.19",
      selectedFiles: [apacheLicense,
        { path: "go.mod", size: 110, sha256: "0475f1708db81d718b633faf2d9dd64695037eabdc8562125060607bcb01b2ba" },
        { path: "go.sum", size: 318, sha256: "2a8f3fb6adb84839bbb9999f12f1416fb86c184135aaa1c2e489b35203c08346" }],
      missingSelectedFiles: ["NOTICE"],
      bindings: {
        sha512: "00ef15d982eb58d62cf67c6517d9560bb92cff5d1347f16b03e03bb3a6da08f2b85e8c3e6c23ae644f174f8da8e9154dcfe4ee379f894882e92b3602d7d079ed",
        root: "gosu-1.19", paxCommit: "6456aaa0f3c854d199d0f037f068eb97515b7513",
        symlinks: [{ path: ".dockerignore", target: ".gitignore", followed: false }],
      },
    },
    {
      role: "MOBY_USER_MODULE_SOURCE", name: "moby-sys-user-v0.1.0.zip", size: 13793,
      sha256: "85178932dc13b1c404c32e1b9f68fe88bf0b43e57dda39f24c45113e0bcf00ee",
      sourceUrl: "https://proxy.golang.org/github.com/moby/sys/user/@v/v0.1.0.zip",
      selectedFiles: [apacheLicense,
        { path: "go.mod", size: 74, sha256: "91a578705d847c83a40f0e3149724863961cef2b2d7ca4262b40cefe487eff03" }],
      missingSelectedFiles: ["NOTICE", "PATENTS"],
      bindings: { module: "github.com/moby/sys/user", version: "v0.1.0",
        h1: "h1:WmZ93f5Ux6het5iituh9x2zAG7NFY9Aqi49jjE1PaQg=",
        goModH1: "h1:fKJhFOnsCN6xZ5gSfbM6zaHGgDJMrqt9/reuj4T7MmU=" },
    },
    {
      role: "X_SYS_MODULE_SOURCE", name: "golang-x-sys-v0.1.0.zip", size: 1861264,
      sha256: "e7cbe58ed3745ba63d482fe82603119bd635f9a5dd914ed95a4c1826fdcf54a7",
      sourceUrl: "https://proxy.golang.org/golang.org/x/sys/@v/v0.1.0.zip",
      selectedFiles: [
        { path: "LICENSE", size: 1479, sha256: "2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067" }, patents,
        { path: "go.mod", size: 33, sha256: "f033333096fe198f3151deed93f2deba74e50bbfe7739134045bc3b7ce4a5024" }],
      missingSelectedFiles: ["NOTICE"],
      bindings: { module: "golang.org/x/sys", version: "v0.1.0",
        h1: "h1:kunALQeHf1/185U1i0GOB/fy1IPRDDpuoOOqRReG57U=",
        goModH1: "h1:oPkhp1MJrh7nUepCBck5+mAzfO9JrbApNNgaTdGDITg=" },
    },
    {
      role: "GO_STDLIB_SOURCE", name: "go1.26.8.src.tar.gz", size: 34150120,
      sha256: "4e39b98e42f946fa05ac8bc5b71877df97dbdb7cbb1a777b541667ad7117fd2e",
      sourceUrl: "https://dl.google.com/go/go1.26.8.src.tar.gz",
      selectedFiles: [
        { path: "LICENSE", size: 1453, sha256: "911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad" }, patents,
        { path: "VERSION", size: 35, sha256: "25b231b380ff42bb887b29e7c2eb176167820f3416665cd4fbc2d3b116bc417d" }],
      missingSelectedFiles: ["NOTICE"],
      bindings: { version: "go1.26.8", root: "go", symlinks: [] },
    },
  ],
});

export const postgresGosuSourceLimits = freeze({
  operationMs: 300000, commandMs: 90000, cleanupMs: 10000, inspectionMs: 90000, outputMs: 10000,
  sourceBytes: 40 * 1024 ** 2, inputBytes: 48 * 1024 ** 2,
  inspectionBytes: 256 * 1024, receiptBytes: 128 * 1024,
  acknowledgementBytes: 16 * 1024, reservedDiskBytes: 1024 ** 3,
});

export const POSTGRES_GOSU_SOURCE_CLAIMS = freeze({
  historicalIntegrity: "VERIFIED", retainedScope: "FOUR_DECLARED_GOSU_GO_SOURCE_ARCHIVES_AND_SELECTED_ORIGINAL_TEXTS",
  sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED", layerCoverage: "NOT_ESTABLISHED",
  binarySourceReproducibility: "NOT_ESTABLISHED", gitObjectAuthentication: "NOT_ESTABLISHED",
  currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED", legalCompliance: "NOT_EVALUATED",
  closure: "INCOMPLETE", admission: "NOT_AUTHORIZED", signing: "NOT_ATTEMPTED",
  supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
});
