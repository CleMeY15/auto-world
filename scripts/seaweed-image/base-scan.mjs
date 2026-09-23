import { isDeepStrictEqual } from "node:util";
import { scanGzipLayer } from "./archive.mjs";
import { baseMaterialIdentities, validateBaseMaterials } from "./plan.mjs";

const MAX_COMPRESSED = 256 * 1024 ** 2;
const MAX_RAW = 2 * 1024 ** 3;
const MAX_MEMBERS = 100_000;
const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = (reason) => { throw new Error(`seaweed_base_${reason}`); };
const comparePath = (a, b) => a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0;

function ancestors(name) {
  const parts = name.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

// This pure overlay helper accepts scanner inventories. Its returned references
// are observations, not authentication or authority for a future content replay.
export function mergeLayerInventories(layers) {
  if (!Array.isArray(layers) || layers.length > 10) fail("layer_set_invalid");
  const model = new Map();
  let count = 0;
  for (const [layerIndex, layer] of layers.entries()) {
    if (!Array.isArray(layer?.members) || !/^sha256:[a-f0-9]{64}$/u.test(layer.compressedDigest)) fail("layer_invalid");
    const seen = new Set();
    let ordinal = 0;
    let expectedOffset = 0;
    for (const member of layer.members) {
      if (++count > MAX_MEMBERS) fail("member_limit_exceeded");
      const entry = member?.entry;
      if (!entry || typeof entry.path !== "string" ||
          !/^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[\x21-\x7e]+(?<!\/)$/u.test(entry.path) ||
          entry.path.split("/").some((part) => part.startsWith(".wh.")) ||
          !["file", "directory", "symlink"].includes(entry.type)) fail("entry_invalid");
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_RAW ||
          (entry.type !== "file" && entry.size !== 0) || member.memberOrdinal !== ordinal ||
          member.uncompressedHeaderOffset !== expectedOffset || member.uncompressedDataOffset !== expectedOffset + 512) fail("reference_invalid");
      ordinal += 1;
      expectedOffset += 512 + Math.ceil(entry.size / 512) * 512;
      if (expectedOffset > MAX_RAW) fail("reference_invalid");
      if (seen.has(entry.path)) fail("duplicate_member");
      seen.add(entry.path);
      if (ancestors(entry.path).some((name) => model.has(name) && model.get(name).entry.type !== "directory")) fail("non_directory_ancestor");
      if (model.has(entry.path) && model.get(entry.path).entry.type !== entry.type) fail("type_collision");
      model.set(entry.path, {
        layerIndex, compressedDigest: layer.compressedDigest,
        memberOrdinal: member.memberOrdinal,
        uncompressedHeaderOffset: member.uncompressedHeaderOffset,
        uncompressedDataOffset: member.uncompressedDataOffset,
        entry: copy(entry),
      });
    }
  }
  for (const reference of model.values()) {
    for (const name of ancestors(reference.entry.path)) {
      if (!model.has(name)) fail("missing_directory_ancestor");
      if (model.get(name).entry.type !== "directory") fail("non_directory_ancestor");
    }
  }
  return [...model.values()].sort(comparePath);
}

export async function scanPinnedBase({ baseMaterials, openBlob }) {
  // Authenticate all metadata before invoking caller-controlled I/O.
  const base = validateBaseMaterials(baseMaterials);
  if (typeof openBlob !== "function") fail("opener_invalid");
  if (base.manifest.layers.reduce((sum, layer) => sum + layer.size, 0) > MAX_COMPRESSED) fail("compressed_limit_exceeded");
  const layers = [];
  let rawBytes = 0;
  let memberCount = 0;
  for (const [layerIndex, descriptor] of base.manifest.layers.entries()) {
    const input = await openBlob(Object.freeze({ layerIndex, descriptor: Object.freeze({ ...descriptor }) }));
    const result = await scanGzipLayer({ input, descriptor: { size: descriptor.size, digest: descriptor.digest },
      diffId: base.config.rootfs.diff_ids[layerIndex], maxRawBytes: MAX_RAW - rawBytes, maxMembers: MAX_MEMBERS - memberCount });
    if (result.compressedSize !== descriptor.size || result.compressedDigest !== descriptor.digest ||
        result.diffId !== base.config.rootfs.diff_ids[layerIndex]) fail("layer_identity_invalid");
    rawBytes += result.uncompressedSize;
    memberCount += result.members.length;
    layers.push(result);
  }
  const members = mergeLayerInventories(layers);
  const expected = [...base.entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!isDeepStrictEqual(members.map(({ entry }) => entry), expected)) fail("inventory_mismatch");
  return {
    kind: "PUBLIC_BASE_REPLAY_INDEX_V1", authority: "PREPARATION_ONLY",
    materials: copy(baseMaterialIdentities),
    totals: { compressedBytes: layers.reduce((sum, layer) => sum + layer.compressedSize, 0), rawBytes, memberCount, visibleEntries: members.length },
    layers: layers.map(({ compressedSize, compressedDigest, uncompressedSize, diffId, members: entries }, layerIndex) =>
      ({ layerIndex, compressedSize, compressedDigest, uncompressedSize, diffId, memberCount: entries.length })),
    members,
  };
}
