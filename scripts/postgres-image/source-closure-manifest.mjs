import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import materialsJson from "../../infra/postgres-image/source-closure-materials.json" with { type: "json" };

const KIND = "POSTGRES_SOURCE_CLOSURE_MATERIALS_V1";
const SUBJECT = "ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93";
// Independently reviewed preparatory data, not a digest chosen by the caller.
const CANONICAL_SHA256 = "3ce9a629c3f9aa037a8ffa4d3ff60c7fe42272937b72cc82e59e04f7ba2358f3";
const ERROR = "postgres_source_closure_manifest_invalid";
const TOP_KEYS = ["kind", "subject", "materials", "claims"];
const MATERIAL_KEYS = ["id", "role", "origin", "commit", "path", "url", "expected"];
const EXPECTED_KEYS = ["sha256", "sha512", "gitBlobSha1", "size", "gitMode", "gitType"];
const CLAIMS = Object.freeze({
  authority: "DECLARED_MATERIAL_EXPECTATIONS_ONLY", historicalIntegrity: "NOT_ESTABLISHED",
  sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED", layerCoverage: "NOT_ESTABLISHED",
  legalCompliance: "NOT_EVALUATED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED",
  admission: "NOT_AUTHORIZED", retentionAccepted: false, signing: "NOT_ATTEMPTED",
  supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
});
const COUNTS = Object.freeze({ APORTS_RECIPE: 34, SOURCE_ARCHIVE: 35, SOURCE_PATCH: 147,
  SOURCE_AUX: 84, INSTALL_HOOK: 20, TRIGGER: 2, GO_STDLIB_SOURCE: 1 });
const SOURCE_ROLES = ["SOURCE_ARCHIVE", "SOURCE_PATCH", "SOURCE_AUX"];
const HOOK_ROLES = ["INSTALL_HOOK", "TRIGGER"];
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,191}$/;
const LEAF = /^[A-Za-z0-9_][A-Za-z0-9._+@-]{0,191}$/;
const ORIGIN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Initial declared URL hosts only. This does not authorize arbitrary redirects.
export const allowedSourceHosts = Object.freeze([
  "busybox.net", "dev.alpinelinux.org", "dev.gentoo.org", "dl.google.com", "download.gnome.org",
  "ftp.gnu.org", "ftp.samba.org", "gcc.gnu.org", "git.kernel.org", "github.com",
  "gitlab.alpinelinux.org", "invisible-mirror.net", "musl.libc.org", "raw.githubusercontent.com",
  "salsa.debian.org", "web.mit.edu", "www.iana.org", "www.kernel.org", "www.openldap.org",
  "www.thrysoee.dk", "zlib.net",
]);

const fail = () => { throw new Error(ERROR); };
const hash = (value, pattern) => typeof value === "string" && pattern.test(value);
const positiveSize = value => Number.isSafeInteger(value) && value > 0;
const freeze = value => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

// Read data descriptors once; never run getters, coercions or serialization hooks.
function record(value, keys) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) fail();
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) fail();
    result[key] = descriptor.value;
  }
  return result;
}

function materialArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== 324 || descriptors.length?.value !== 323) fail();
  const result = [];
  for (let index = 0; index < 323; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) fail();
    result.push(descriptor.value);
  }
  return result;
}

function sourceUrl(value) {
  if (typeof value !== "string" || value.length > 1024 || !/^[!-~]+$/.test(value)
    || /[%\\]/.test(value)) fail();
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
    || !allowedSourceHosts.includes(url.hostname) || url.href !== value || url.pathname.includes("//")) fail();
  return url;
}

function snapshotMaterial(value) {
  const item = record(value, MATERIAL_KEYS);
  item.expected = record(item.expected, EXPECTED_KEYS);
  const proof = item.expected;
  if (typeof item.id !== "string" || !ID.test(item.id) || typeof item.role !== "string"
    || !Object.hasOwn(COUNTS, item.role) || typeof item.path !== "string") fail();
  const url = sourceUrl(item.url);
  if (item.role === "GO_STDLIB_SOURCE") {
    if (item.id !== "go1.24.6" || item.origin !== null || item.commit !== null
      || item.path !== "go1.24.6.src.tar.gz" || !hash(proof.sha256, SHA256) || !positiveSize(proof.size)
      || proof.sha512 !== null || proof.gitBlobSha1 !== null || proof.gitMode !== null || proof.gitType !== null) fail();
    return item;
  }
  if (typeof item.origin !== "string" || !ORIGIN.test(item.origin) || !hash(item.commit, SHA1)) fail();
  const [category, origin, leaf, ...rest] = item.path.split("/");
  if (!["main", "community"].includes(category) || origin !== item.origin || typeof leaf !== "string"
    || !LEAF.test(leaf) || leaf === "." || leaf === ".." || rest.length) fail();
  const rawUrl = `https://raw.githubusercontent.com/alpinelinux/aports/${item.commit}/${item.path}`;
  if (url.hostname === "raw.githubusercontent.com" && item.url !== rawUrl) fail();
  if (item.role === "APORTS_RECIPE") {
    if (item.id !== `recipe-${item.origin}` || leaf !== "APKBUILD" || item.url !== rawUrl
      || !hash(proof.sha256, SHA256) || !positiveSize(proof.size) || proof.sha512 !== null
      || proof.gitBlobSha1 !== null || proof.gitMode !== null || proof.gitType !== null) fail();
  } else if (SOURCE_ROLES.includes(item.role)) {
    if (item.id !== `material-${item.origin}-${leaf.replaceAll("@", "-at-")}` || !hash(proof.sha512, SHA512)
      || proof.sha256 !== null || proof.gitBlobSha1 !== null || proof.size !== null
      || proof.gitMode !== null || proof.gitType !== null) fail();
  } else if (HOOK_ROLES.includes(item.role)) {
    // Git mode120000 authenticates the symlink blob bytes, never its target.
    if (item.id !== `hook-${item.origin}-${leaf}` || item.url !== rawUrl || !hash(proof.gitBlobSha1, SHA1)
      || !positiveSize(proof.size) || !["100644", "100755", "120000"].includes(proof.gitMode)
      || proof.gitType !== "blob" || proof.sha256 !== null || proof.sha512 !== null) fail();
  }
  return item;
}

function snapshot(value) {
  const result = record(value, TOP_KEYS);
  if (result.kind !== KIND || result.subject !== SUBJECT) fail();
  result.claims = record(result.claims, Object.keys(CLAIMS));
  if (Object.keys(CLAIMS).some(key => result.claims[key] !== CLAIMS[key])) fail();
  result.materials = materialArray(result.materials).map(snapshotMaterial);
  const ids = new Set(); const paths = new Set(); const digests = new Set(); const recipes = new Map();
  const counts = Object.fromEntries(Object.keys(COUNTS).map(role => [role, 0]));
  let previous = "";
  for (const item of result.materials) {
    const id = item.id.toLowerCase(); const path = `${item.origin}/${item.commit}/${item.path}`;
    if (item.id <= previous || ids.has(id) || paths.has(path)) fail();
    previous = item.id; ids.add(id); paths.add(path); counts[item.role]++;
    if (item.role === "APORTS_RECIPE") recipes.set(item.origin, item);
    if (SOURCE_ROLES.includes(item.role)) {
      if (digests.has(item.expected.sha512)) fail();
      digests.add(item.expected.sha512);
    }
  }
  if (!isDeepStrictEqual(counts, COUNTS) || recipes.size !== 34) fail();
  for (const item of result.materials) {
    if (item.role === "APORTS_RECIPE" || item.role === "GO_STDLIB_SOURCE") continue;
    const recipe = recipes.get(item.origin);
    if (!recipe || recipe.commit !== item.commit || recipe.path.split("/")[0] !== item.path.split("/")[0]) fail();
  }
  return result;
}

const reviewed = freeze(snapshot(materialsJson));
if (createHash("sha256").update(JSON.stringify(reviewed)).digest("hex") !== CANONICAL_SHA256) fail();

export function loadPostgresSourceClosureManifest() { return reviewed; }

// Pure validation: the caller cannot replace even a coherently changed URL/pin/commit.
export function validatePostgresSourceClosureManifest(value) {
  try {
    const result = snapshot(value);
    if (!isDeepStrictEqual(result, reviewed)) fail();
    return freeze(result);
  } catch { fail(); }
}
