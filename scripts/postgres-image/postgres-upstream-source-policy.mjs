import { POSTGRES_GOSU_SOURCE_PIN } from "./gosu-source-policy.mjs";

const freeze = value => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const digest = "0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93";

// These complete public archive pins do not authenticate Git objects or binaries.
// The separately reviewed native byte preparation is not retention acceptance.
export const POSTGRES_UPSTREAM_SOURCE_PIN = freeze({
  workspace: POSTGRES_GOSU_SOURCE_PIN.workspace,
  node: POSTGRES_GOSU_SOURCE_PIN.node,
  parent: POSTGRES_GOSU_SOURCE_PIN.parent,
  parentIdentity: POSTGRES_GOSU_SOURCE_PIN.parentIdentity,
  subject: POSTGRES_GOSU_SOURCE_PIN.subject,
  directoryPrefix: `pg-postgres-upstream-source-retention-${digest}-`,
  executionPrefix: "local-postgres-upstream-source-retention-",
  inputDirectory: "/home/autoworld/pg-public-upstream-inputs-0045bdab-20261001-df069da5d9ed2b2c7ae04a71",
  inputDirectoryIdentity: { dev: "2096", ino: "112812", uid: 1000, gid: 1000, mode: 0o700 },
  inspector: {
    source: "scripts/postgres-image/postgres-source-notices-inspect.py",
    core: {
      source: "scripts/postgres-image/source-notices-inspect.py", size: 24671,
      sha256: "f7b37bc47729c65653cf03fd6b93e8bd6dec7b48027b544469c559dde0c4724c",
    },
  },
  python: {
    executable: POSTGRES_GOSU_SOURCE_PIN.python.executable,
    version: POSTGRES_GOSU_SOURCE_PIN.python.version,
    arguments: ["-I", "-S", "-B", "/proc/self/fd/7"],
    trust: POSTGRES_GOSU_SOURCE_PIN.python.trust,
    transitiveStdlibClosure: "NOT_INDEPENDENTLY_AUTHENTICATED",
    files: [
      ...POSTGRES_GOSU_SOURCE_PIN.python.files,
      { source: "/usr/lib/python3.12/bz2.py", size: 11847, mode: 0o644,
        sha256: "76ab3252924e71e859d7d90e8d3db13b6554975cfcac0fdadced4de7f8779330" },
      { source: "/usr/lib/python3.12/lib-dynload/_bz2.cpython-312-x86_64-linux-gnu.so", size: 32112, mode: 0o644,
        sha256: "eff8df23cdc54d38ce9ca600d07c21ccfd7f22bd52a0720e599e6828d3e2eb76" },
    ],
  },
  archives: [
    {
      role: "POSTGRES_UPSTREAM_SOURCE", name: "postgresql-17.11.tar.bz2", size: 21787224,
      sha256: "dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979",
      sourceUrl: "https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2",
      entries: 7718, uncompressedBytes: 135730425, decodedTarBytes: 141578240,
      selectedFiles: [
        { path: "COPYRIGHT", size: 1198,
          sha256: "3d6af92ff8a4c2cdf69afb1cf44edea727922f5cd0cf8b5f72b11cdecac8fdfd" },
      ],
      missingSelectedFiles: ["LICENSE", "NOTICE"],
      bindings: { version: "17.11", root: "postgresql-17.11", symlinks: [] },
    },
    {
      role: "DOCKER_LIBRARY_POSTGRES_SOURCE",
      name: "docker-library-postgres-2603e26e245e558218728ee14e0a42dcb020dc7f.tar.gz", size: 56252,
      sha256: "c452a880f58c62bc0738a266ff67e3c9656f33547da9d757563874daf5ab9200",
      sourceUrl: "https://codeload.github.com/docker-library/postgres/tar.gz/2603e26e245e558218728ee14e0a42dcb020dc7f",
      entries: 122, uncompressedBytes: 680576, decodedTarBytes: 768000,
      selectedFiles: [
        { path: "17/alpine3.24/Dockerfile", size: 8145,
          sha256: "03484c8058b53c342cf407d476e45539dc44ffe468e66241bbd7c9e369166e81" },
        { path: "17/alpine3.24/docker-ensure-initdb.sh", size: 2317,
          sha256: "922ade6b23a312e65023349b36e873752b15ff38ae4c0ae461d74451e104f312" },
        { path: "17/alpine3.24/docker-entrypoint.sh", size: 14577,
          sha256: "9c440299ae04a0a79d55b8bf03307036d890a40979d2fb698073c9050d4b20a5" },
        { path: "LICENSE", size: 1084,
          sha256: "87ffd2c45e3f90cfa3407b5c40ef8333e87c3e875e4895f8b64df758198deafc" },
      ],
      missingSelectedFiles: ["COPYRIGHT", "NOTICE"],
      bindings: {
        commit: "2603e26e245e558218728ee14e0a42dcb020dc7f",
        root: "postgres-2603e26e245e558218728ee14e0a42dcb020dc7f",
        pgVersion: "17.11",
        pgSourceSha256: "dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979",
        symlinks: [],
      },
    },
  ],
});

export const postgresUpstreamSourceLimits = freeze({
  operationMs: 300000, commandMs: 90000, cleanupMs: 10000, inspectionMs: 90000, outputMs: 10000,
  sourceBytes: 40 * 1024 ** 2, inputBytes: 48 * 1024 ** 2,
  inspectionBytes: 256 * 1024, receiptBytes: 128 * 1024,
  acknowledgementBytes: 16 * 1024, reservedDiskBytes: 1024 ** 3,
});

export const POSTGRES_UPSTREAM_SOURCE_CLAIMS = freeze({
  historicalIntegrity: "VERIFIED", retainedScope: "TWO_FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES",
  sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED", layerCoverage: "NOT_ESTABLISHED",
  binarySourceReproducibility: "NOT_ESTABLISHED", gitObjectAuthentication: "NOT_ESTABLISHED",
  currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED", legalCompliance: "NOT_EVALUATED",
  closure: "INCOMPLETE", admission: "NOT_AUTHORIZED", signing: "NOT_ATTEMPTED",
  supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
});

export const POSTGRES_UPSTREAM_SOURCE_PREFLIGHT_CLAIMS = freeze({
  ...POSTGRES_UPSTREAM_SOURCE_CLAIMS,
  historicalIntegrity: "NOT_ESTABLISHED", retainedScope: "NONE",
  inspection: "VERIFIED", retention: "NOT_ATTEMPTED",
});
