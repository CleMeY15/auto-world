import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { evaluatePolicyEligibility } from "../dist/index.js";

const admissionPath = "/etc/aw-private-web/catalog-admission.json";
const publication = {
  territory: "FR",
  acquisitionMethod: "crawl",
  audience: "consumer",
  fields: ["source_listing_id", "url", "description", "mileage", "price", "media"],
};
const privateGalleryMaxAgeSeconds = 30 * 24 * 60 * 60;
const admissionKeys = [
  "version", "site", "audience", "sourceId", "registryRevision", "registrySha256",
  "evidenceRef", "evidenceSha256", "domBatchIds", "rustExportSha256",
];

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function validIds(ids, format) {
  return Array.isArray(ids) && ids.length <= 256 && new Set(ids).size === ids.length
    && ids.every(id => typeof id === "string" && format.test(id));
}

export function catalogPublicationGrant(registryBytes, admissionBytes, evidenceBytes, now) {
  const registry = JSON.parse(registryBytes);
  const admission = JSON.parse(admissionBytes);
  const decision = evaluatePolicyEligibility(registry, publication, now);
  if (!decision.success || !decision.data.eligible || decision.data.sourceId !== "src_leboncoin_fr") {
    return null;
  }
  const { authorization, retention, media } = decision.data.policy;
  if (media.mode !== "reference") return null;
  if (!admission || Object.keys(admission).length !== admissionKeys.length
      || !admissionKeys.every(key => Object.hasOwn(admission, key))
      || admission.version !== 1 || admission.site !== "autofind.tech" || admission.audience !== "consumer"
      || admission.sourceId !== decision.data.sourceId || admission.registryRevision !== decision.data.revision
      || admission.registrySha256 !== sha256(registryBytes) || admission.evidenceRef !== authorization.basisRef
      || !evidenceBytes?.length || admission.evidenceSha256 !== sha256(evidenceBytes)
      || admission.evidenceSha256 === admission.registrySha256
      || !validIds(admission.domBatchIds, /^[0-9a-f]{32}$/)
      || !validIds(admission.rustExportSha256, /^[0-9a-f]{64}$/)
      || admission.domBatchIds.length + admission.rustExportSha256.length === 0) {
    return null;
  }
  return {
    validFrom: authorization.validFrom,
    validUntil: authorization.validUntil,
    normalizedSeconds: retention.normalizedSeconds,
    // Reference-mode mediaSeconds in the registry governs copies of image bytes.
    // URL lifetimes are also limited by each observation's stored deadline in SQL.
    mediaSeconds: Math.min(privateGalleryMaxAgeSeconds, retention.normalizedSeconds),
    domBatchIds: admission.domBatchIds,
    rustExportSha256: admission.rustExportSha256,
  };
}

function operatorControls(metadata) {
  return metadata.uid === 0 && (metadata.mode & 0o022) === 0;
}

export async function protectedBytes(path, limit) {
  if (!isAbsolute(path) || resolve(path) !== path || typeof constants.O_NOFOLLOW !== "number") throw new Error();
  // Check ancestry from the trusted root downwards before opening the final component.
  const directories = [];
  for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) directories.unshift(dir);
  for (const directory of ["/", ...directories]) {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || !operatorControls(metadata)) throw new Error();
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || !operatorControls(metadata) || metadata.size === 0 || metadata.size > limit) {
      throw new Error();
    }
    // Operator revisions are installed by atomic rename; read from the verified inode.
    const bytes = await file.readFile();
    if (bytes.length !== metadata.size) throw new Error();
    return bytes;
  } finally {
    await file.close();
  }
}

if (import.meta.main) {
  try {
    const paths = process.argv.slice(2);
    if (paths.length !== 3 || new Set(paths).size !== 3 || paths[1] !== admissionPath) throw new Error();
    const [registry, admission, evidence] = await Promise.all([
      protectedBytes(paths[0], 16 * 1024 * 1024),
      protectedBytes(paths[1], 64 * 1024),
      protectedBytes(paths[2], 16 * 1024 * 1024),
    ]);
    const grant = catalogPublicationGrant(registry, admission, evidence, new Date().toISOString());
    if (!grant) throw new Error();
    console.log(JSON.stringify(grant));
  } catch {
    console.error("catalog_publication_unavailable");
    process.exitCode = 1;
  }
}
