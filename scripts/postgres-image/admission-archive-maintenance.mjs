import { createHash } from "node:crypto";
import fs from "node:fs";
import { posix as path } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";

import publicAcceptance from "../../infra/postgres-image/complete-private-copy-acceptance.json" with { type: "json" };

const ERROR = "postgres_admission_archive_invalid";
const ROOT = "/opt/auto-world/postgres-admission";
const LOCATOR_KIND = "POSTGRES_ADMISSION_ARCHIVE_LOCATOR_V1";
const FAST_KIND = "POSTGRES_ADMISSION_ARCHIVE_FAST_V1";
const FULL_KIND = "POSTGRES_ADMISSION_ARCHIVE_FULL_V1";
const ROOT_ROLES = Object.freeze(["evidenceCopy", "evidenceRetrieve", "controlCopy", "controlRetrieve"]);
const CONTROL_ROLES = Object.freeze(["p1Policy", "p5Policy", "launchPlan", "rootAcknowledgement", "controlManifest",
  "terminalManifest", "postAckJournal"]);
const LOCATOR_KEYS = Object.freeze(["schemaVersion", "kind", "admissionGeneration", "controls", "roots", "imageArchive"]);
const CONTROL_KEYS = Object.freeze(["role", "path", "size", "sha256", "nativeIdentity", "parentIdentity"]);
const ROOT_KEYS = Object.freeze(["role", "path", "lane", "operation", "rootIdentity", "objectsDirectoryIdentity",
  "reservationsDirectoryIdentity", "counts", "objects"]);
const OBJECT_KEYS = Object.freeze(["sha256", "size", "nativeIdentity"]);
const FILE_NATIVE_KEYS = Object.freeze(["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]);
const DIRECTORY_NATIVE_KEYS = Object.freeze(["dev", "ino", "uid", "gid", "mode"]);
const COUNT_KEYS = Object.freeze(["references", "objects", "bytes", "reservations"]);
const IMAGE_KEYS = Object.freeze(["referenceId", "rootRole", "size", "sha256"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const MAX_LOCATOR_BYTES = 1024 * 1024;
const MAX_CONTROL_BYTES = 4 * 1024 * 1024;
const MAX_OBJECTS = 4096;
const CHUNK_BYTES = 1024 * 1024;
const FULL_VALIDITY_MS = 24 * 60 * 60 * 1000;
const MAINTENANCE_KIND = "POSTGRES_ADMISSION_ARCHIVE_MAINTENANCE_INPUT_V1";
const MAINTENANCE_KEYS = Object.freeze(["schemaVersion", "kind", "generationRoot", "generationRootSha256", "command",
  "policy", "supportStartedAt", "supportEndsAt", "archiveUntil"]);
const PIN_KEYS = Object.freeze(["size", "sha256"]);
const SOURCE_FILE = fileURLToPath(import.meta.url);
const POLICY_FILE = fileURLToPath(new URL("../../infra/postgres-image/admission-policy.json", import.meta.url));
const PUBLIC_ACCEPTANCE_IDENTITY = Object.freeze({ bytes: 4604,
  sha256: "9079ccb664f39d54296fcb4a4ae1287c6bfe116db7518d18ee0a4db4cb8e438b" });
const P1_POLICY_IDENTITY = Object.freeze({ bytes: 731542,
  sha256: "f4857beebba7df2f474e3385c38a69f7cfa0bec330d3d3f65ed7795255de871c" });
const contexts = new WeakMap();

function fail(check = "contract") { const error = new Error(ERROR); error.diagnostic = freeze({ check }); throw error; }
function need(value, check) { if (!value) fail(check); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function exact(value, keys) {
  need(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
  need(ownKeys.length === keys.length && ownKeys.every(key => typeof key === "string" && keys.includes(key)));
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key]; need(descriptor?.enumerable === true && Object.hasOwn(descriptor, "value"));
    return [key, descriptor.value];
  }));
}
function array(value, maximum) {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= maximum);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  need(Reflect.ownKeys(descriptors).length === value.length + 1 && descriptors.length?.value === value.length);
  return Array.from({ length: value.length }, (_unused, index) => {
    const descriptor = descriptors[String(index)]; need(descriptor?.enumerable === true && Object.hasOwn(descriptor, "value"));
    return descriptor.value;
  });
}
function positiveInteger(value) { need(Number.isSafeInteger(value) && value > 0); return value; }
function nonnegativeInteger(value) { need(Number.isSafeInteger(value) && value >= 0); return value; }
function digest(value) { need(typeof value === "string" && SHA256.test(value)); return value; }
function normalizedPath(value) {
  need(typeof value === "string" && value.startsWith("/opt/auto-world/") && value.length <= 4096 && !value.includes("//")
    && !/[\0\r\n\\]/u.test(value) && !value.split("/").some(part => part === "." || part === ".."));
  return value;
}
function identity(value, keys) {
  const result = exact(value, keys);
  need(DECIMAL.test(result.dev) && DECIMAL.test(result.ino) && Number.isSafeInteger(result.uid) && result.uid >= 0
    && Number.isSafeInteger(result.gid) && result.gid >= 0 && Number.isSafeInteger(result.mode) && result.mode >= 0 && result.mode <= 0o7777);
  return result;
}
function directoryIdentity(value) { return identity(value, DIRECTORY_NATIVE_KEYS); }
function fileIdentity(value, size) {
  const result = identity(value, FILE_NATIVE_KEYS);
  need(result.nlink === 1 && result.size === size && DECIMAL.test(result.mtimeNs) && DECIMAL.test(result.ctimeNs));
  return result;
}
function statFile(value) {
  return { dev: String(value.dev), ino: String(value.ino), uid: Number(value.uid), gid: Number(value.gid),
    mode: Number(value.mode & 0o7777n), nlink: Number(value.nlink), size: Number(value.size),
    mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) };
}
function statDirectory(value) {
  const file = statFile(value); return Object.fromEntries(DIRECTORY_NATIVE_KEYS.map(key => [key, file[key]]));
}
function identityKey(value) { return `${value.dev}:${value.ino}`; }
function canonical(value) { return Buffer.from(`${JSON.stringify(value)}\n`, "utf8"); }

function validateGenerationRoot(generationRoot) {
  need(generationRoot.evidence?.p1 && isDeepStrictEqual(generationRoot.evidence.p1.policy, P1_POLICY_IDENTITY));
  const expectedP5 = { acceptance: PUBLIC_ACCEPTANCE_IDENTITY, recipeRevision: publicAcceptance.recipeRevision,
    completePolicy: publicAcceptance.completePolicy, launchPlan: publicAcceptance.launchPlan,
    counts: { ...publicAcceptance.counts, controlReferences: 44 }, proofs: publicAcceptance.proofs };
  need(isDeepStrictEqual(generationRoot.evidence.p5, expectedP5));
  const files = array(generationRoot.executionFiles, 128).map(value => {
    const item = exact(value, ["path", "size", "sha256"]);
    need(typeof item.path === "string" && /^[a-z0-9][a-z0-9./-]{0,255}$/u.test(item.path) && !item.path.startsWith("/")
      && !item.path.includes("//") && !item.path.split("/").some(part => part === "." || part === ".."));
    positiveInteger(item.size); digest(item.sha256); return item;
  });
  need(files.length > 0 && files.every((item, index) => index === 0 || files[index - 1].path < item.path));
  return sha256(canonical(files));
}
function validateLocatorBindings(locator, generationRoot) {
  const p5 = generationRoot.evidence.p5;
  const expected = new Map([["p1Policy", generationRoot.evidence.p1.policy], ["p5Policy", p5.completePolicy],
    ["launchPlan", p5.launchPlan], ["rootAcknowledgement", p5.proofs.rootAcknowledgement],
    ["controlManifest", p5.proofs.controlManifest], ["terminalManifest", p5.proofs.terminalManifest],
    ["postAckJournal", p5.proofs.postAckJournal]]);
  need(locator.controls.every(item => isDeepStrictEqual({ bytes: item.size, sha256: item.sha256 }, expected.get(item.role))),
    "public_private_binding");
}

function parseControl(value) {
  const result = exact(value, CONTROL_KEYS); need(CONTROL_ROLES.includes(result.role)); normalizedPath(result.path);
  nonnegativeInteger(result.size); need(result.size <= MAX_CONTROL_BYTES); digest(result.sha256);
  result.nativeIdentity = fileIdentity(result.nativeIdentity, result.size); result.parentIdentity = directoryIdentity(result.parentIdentity);
  const expectedMode = ["p1Policy", "launchPlan"].includes(result.role) ? 0o400 : 0o600;
  need(result.nativeIdentity.uid === 0 && result.nativeIdentity.gid === 0 && result.nativeIdentity.mode === expectedMode
    && result.parentIdentity.uid === 0 && result.parentIdentity.gid === 0 && result.parentIdentity.mode === 0o700);
  return result;
}
function parseObject(value) {
  const result = exact(value, OBJECT_KEYS); digest(result.sha256); nonnegativeInteger(result.size);
  result.nativeIdentity = fileIdentity(result.nativeIdentity, result.size);
  need(result.nativeIdentity.uid === 0 && result.nativeIdentity.gid === 0 && result.nativeIdentity.mode === 0o600);
  return result;
}
function parseRoot(value) {
  const result = exact(value, ROOT_KEYS); need(ROOT_ROLES.includes(result.role)); normalizedPath(result.path);
  need(["EVIDENCE", "CONTROL"].includes(result.lane) && ["COPY", "RETRIEVE"].includes(result.operation));
  result.rootIdentity = directoryIdentity(result.rootIdentity);
  result.objectsDirectoryIdentity = directoryIdentity(result.objectsDirectoryIdentity);
  result.reservationsDirectoryIdentity = directoryIdentity(result.reservationsDirectoryIdentity);
  for (const identityValue of [result.rootIdentity, result.objectsDirectoryIdentity, result.reservationsDirectoryIdentity]) {
    need(identityValue.uid === 0 && identityValue.gid === 0 && identityValue.mode === 0o700);
  }
  result.counts = exact(result.counts, COUNT_KEYS); for (const item of Object.values(result.counts)) nonnegativeInteger(item);
  need(result.counts.reservations === 0 && result.counts.objects <= MAX_OBJECTS);
  result.objects = array(result.objects, MAX_OBJECTS).map(parseObject);
  need(result.objects.length === result.counts.objects && result.objects.every((item, index) => index === 0
    || result.objects[index - 1].sha256 < item.sha256));
  need(result.objects.reduce((sum, item) => sum + item.size, 0) === result.counts.bytes);
  return result;
}
function parseLocator(value, generation) {
  const result = exact(value, LOCATOR_KEYS);
  need(result.schemaVersion === 1 && result.kind === LOCATOR_KIND && result.admissionGeneration === generation);
  result.controls = array(result.controls, CONTROL_ROLES.length).map(parseControl);
  need(isDeepStrictEqual(result.controls.map(item => item.role), CONTROL_ROLES));
  result.roots = array(result.roots, ROOT_ROLES.length).map(parseRoot);
  need(isDeepStrictEqual(result.roots.map(item => item.role), ROOT_ROLES));
  need(isDeepStrictEqual(result.roots.map(item => [item.lane, item.operation]),
    [["EVIDENCE", "COPY"], ["EVIDENCE", "RETRIEVE"], ["CONTROL", "COPY"], ["CONTROL", "RETRIEVE"]]));
  const imageArchive = exact(result.imageArchive, IMAGE_KEYS);
  need(imageArchive.referenceId === "original-candidate.tar" && imageArchive.rootRole === "evidenceCopy");
  nonnegativeInteger(imageArchive.size); digest(imageArchive.sha256); result.imageArchive = imageArchive;
  const expectedCounts = [[1094, 840, 1023937063], [1094, 840, 1023937063], [44, 43, 139006319], [44, 43, 139006319]];
  need(result.roots.every((root, index) => isDeepStrictEqual(
    [root.counts.references, root.counts.objects, root.counts.bytes], expectedCounts[index])));
  for (const [left, right] of [[result.roots[0], result.roots[1]], [result.roots[2], result.roots[3]]]) {
    need(isDeepStrictEqual(left.objects.map(item => [item.sha256, item.size]), right.objects.map(item => [item.sha256, item.size])));
  }
  const imageObject = result.roots[0].objects.find(item => item.sha256 === imageArchive.sha256);
  need(imageObject?.size === imageArchive.size);
  return freeze(result);
}

function closeAll(handles) {
  let uncertain = false;
  for (const fd of handles.splice(0).reverse()) try { fs.closeSync(fd); } catch { uncertain = true; }
  need(!uncertain);
}
function openDirectory(directory, expected, handles, protectedAncestor = false) {
  const named = fs.lstatSync(directory, { bigint: true });
  need(named.isDirectory() && !named.isSymbolicLink());
  const actual = statDirectory(named);
  if (expected) need(isDeepStrictEqual(actual, expected));
  else need(actual.uid === 0 && actual.gid === 0 && (actual.mode & 0o022) === 0);
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); handles.push(fd);
  need(isDeepStrictEqual(statDirectory(fs.fstatSync(fd, { bigint: true })), actual));
  if (protectedAncestor) need((actual.mode & 0o022) === 0);
  return { fd, identity: actual };
}
function holdProtectedChain(target, handles) {
  normalizedPath(`${target}/guard`); const parts = target.split("/").filter(Boolean); let current = "";
  for (const part of parts) { current += `/${part}`; openDirectory(current, null, handles, true); }
}
function fileGuard(file, fd, expected) {
  const named = fs.lstatSync(file, { bigint: true }), opened = fs.fstatSync(fd, { bigint: true });
  need(named.isFile() && !named.isSymbolicLink());
  need(isDeepStrictEqual(statFile(named), expected) && isDeepStrictEqual(statFile(opened), expected));
}
function readExactFile(file, expected, handles, maximum, secondRead = true) {
  need(expected.size <= maximum); holdProtectedChain(path.dirname(file), handles);
  const parent = openDirectory(path.dirname(file), expected.parentIdentity, handles);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); handles.push(fd); fileGuard(file, fd, expected.nativeIdentity);
  const read = () => {
    const bytes = Buffer.alloc(expected.size), extra = Buffer.alloc(1); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, Math.min(CHUNK_BYTES, bytes.length - offset), offset); need(count > 0); offset += count; }
    need(fs.readSync(fd, extra, 0, 1, offset) === 0 && sha256(bytes) === expected.sha256); fileGuard(file, fd, expected.nativeIdentity); return bytes;
  };
  const bytes = read(); if (secondRead) need(read().equals(bytes));
  need(isDeepStrictEqual(statDirectory(fs.fstatSync(parent.fd, { bigint: true })), expected.parentIdentity)); return bytes;
}
function readRootOwnedFile(file, maximum) {
  const handles = [];
  try {
    holdProtectedChain(path.dirname(file), handles); const parent = openDirectory(path.dirname(file), null, handles, true);
    const named = fs.lstatSync(file, { bigint: true }); need(named.isFile() && !named.isSymbolicLink());
    const expected = statFile(named); need(expected.uid === 0 && expected.gid === 0 && expected.mode === 0o400
      && expected.nlink === 1 && expected.size > 0 && expected.size <= maximum);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); handles.push(fd); fileGuard(file, fd, expected);
    const read = () => {
      const bytes = Buffer.alloc(expected.size), extra = Buffer.alloc(1); let offset = 0;
      while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, Math.min(CHUNK_BYTES, bytes.length - offset), offset); need(count > 0); offset += count; }
      need(fs.readSync(fd, extra, 0, 1, offset) === 0); fileGuard(file, fd, expected); return bytes;
    };
    const bytes = read(); need(read().equals(bytes));
    need(isDeepStrictEqual(statDirectory(fs.fstatSync(parent.fd, { bigint: true })), statDirectory(fs.lstatSync(path.dirname(file), { bigint: true }))));
    return { bytes, size: bytes.length, sha256: sha256(bytes) };
  } catch (error) { if (error?.message === ERROR) throw error; fail("root_file"); } finally { closeAll(handles); }
}
function locatorBinding(generationRoot) {
  need(generationRoot !== null && typeof generationRoot === "object" && Object.getPrototypeOf(generationRoot) === Object.prototype);
  const generation = positiveInteger(generationRoot.admissionGeneration);
  const binding = exact(generationRoot.archiveLocator, ["schemaVersion", "size", "sha256"]);
  need(binding.schemaVersion === 1); positiveInteger(binding.size); need(binding.size <= MAX_LOCATOR_BYTES); digest(binding.sha256);
  return { generation, binding, generationRootSha256: sha256(canonical(generationRoot)),
    executionFilesSha256: validateGenerationRoot(generationRoot) };
}
function loadLocator(generationRoot) {
  const { generation, binding, generationRootSha256, executionFilesSha256 } = locatorBinding(generationRoot), handles = [];
  const locatorPath = `${ROOT}/generation-${generation}.json`;
  try {
    for (const ancestor of ["/", "/opt", "/opt/auto-world", ROOT]) openDirectory(ancestor, null, handles, true);
    const expected = { path: locatorPath, size: binding.size, sha256: binding.sha256,
      nativeIdentity: null, parentIdentity: null };
    const named = fs.lstatSync(locatorPath, { bigint: true });
    need(named.isFile() && !named.isSymbolicLink()); expected.nativeIdentity = statFile(named);
    need(expected.nativeIdentity.uid === 0 && expected.nativeIdentity.gid === 0 && expected.nativeIdentity.mode === 0o400
      && expected.nativeIdentity.nlink === 1 && expected.nativeIdentity.size === binding.size);
    expected.parentIdentity = statDirectory(fs.lstatSync(ROOT, { bigint: true }));
    const bytes = readExactFile(locatorPath, expected, handles, MAX_LOCATOR_BYTES);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), parsed = JSON.parse(text);
    need(bytes.equals(canonical(parsed)));
    const locator = parseLocator(parsed, generation); validateLocatorBindings(locator, generationRoot);
    return { locator, locatorPath, locatorIdentity: expected.nativeIdentity,
      generationRootSha256, executionFilesSha256 };
  } catch { fail(); } finally { closeAll(handles); }
}

function pinMap(locator) { return new Map(locator.controls.map(item => [item.role, item])); }
function parseJson(bytes) { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { fail(); } }
function pinProjection(value) { return Object.fromEntries(["path", "size", "sha256", "nativeIdentity", "parentIdentity"].map(key => [key, value[key]])); }
function verifyControlGraph(locator, values) {
  const pins = pinMap(locator), p1 = values.p1Policy, p5 = values.p5Policy, launch = values.launchPlan;
  const ack = values.rootAcknowledgement, control = values.controlManifest, terminal = values.terminalManifest, journal = values.postAckJournal;
  need(p1?.kind === "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1" && p5?.kind === "POSTGRES_COMPLETE_PRIVATE_COPY_POLICY_V1"
    && typeof p1.subject === "string" && p1.subject === p5.subject && p5.corePolicySha256 === pins.get("p1Policy").sha256, "p1_p5");
  need(Array.isArray(p1.retrieval?.references), "p1_retrieval");
  const source = p1.retrieval.references.filter(item => item?.referenceId === locator.imageArchive.referenceId);
  need(source.length === 1 && source[0].size === locator.imageArchive.size && source[0].sha256 === locator.imageArchive.sha256, "image_archive");
  need(ack?.kind === "POSTGRES_COMPLETE_PRIVATE_COPY_ROOT_ACK_V1" && ack.state === "SECOND_COMPLETE_PRIVATE_COPY_VERIFIED"
    && ack.completePolicySha256 === pins.get("p5Policy").sha256 && ack.launchPlanSha256 === pins.get("launchPlan").sha256, "ack");
  need(isDeepStrictEqual(ack.controlManifest, pinProjection(pins.get("controlManifest")))
    && isDeepStrictEqual(ack.terminalManifest, pinProjection(pins.get("terminalManifest"))), "ack_pins");
  need(control?.kind === "POSTGRES_LAUNCH_CONTROL_POLICY_V1"
    && control.policySha256 === pins.get("p5Policy").sha256 && control.launchPlanSha256 === pins.get("launchPlan").sha256, "control");
  need(terminal?.kind === "POSTGRES_COMPLETE_PRIVATE_COPY_TERMINAL_V1"
    && terminal.completePolicySha256 === pins.get("p5Policy").sha256 && terminal.launchPlanSha256 === pins.get("launchPlan").sha256, "terminal");
  need(journal?.kind === "POSTGRES_COMPLETE_PRIVATE_COPY_POST_ACK_JOURNAL_V1"
    && journal.completePolicySha256 === pins.get("p5Policy").sha256 && journal.launchPlanSha256 === pins.get("launchPlan").sha256
    && isDeepStrictEqual(journal.rootAck, ack) && isDeepStrictEqual(journal.controlManifest, control)
    && isDeepStrictEqual(journal.terminalManifest, terminal), "journal_graph");
  need(isDeepStrictEqual(journal.proofs?.rootAck, pinProjection(pins.get("rootAcknowledgement")))
    && isDeepStrictEqual(journal.proofs?.controlManifest, pinProjection(pins.get("controlManifest")))
    && isDeepStrictEqual(journal.proofs?.terminalManifest, pinProjection(pins.get("terminalManifest")))
    && isDeepStrictEqual(journal.proofs?.completePolicy, pinProjection(pins.get("p5Policy")))
    && isDeepStrictEqual(journal.proofs?.launchPlan, pinProjection(pins.get("launchPlan"))), "journal_pins");
  need(isDeepStrictEqual(ack.generationPairs, terminal.evidence && terminal.control ? { evidence: terminal.evidence, control: terminal.control } : null), "generation_pairs");
  const expectedPairs = locator.roots.map(root => root.counts);
  need(isDeepStrictEqual(expectedPairs.map(item => [item.objects, item.reservations, item.bytes, item.references]),
    [[840, 0, 1023937063, 1094], [840, 0, 1023937063, 1094], [43, 0, 139006319, 44], [43, 0, 139006319, 44]]), "generation_counts");
  need(launch !== null && typeof launch === "object", "launch");
}

function inspectRoot(root, handles, full) {
  holdProtectedChain(path.dirname(root.path), handles);
  const rootHandle = openDirectory(root.path, root.rootIdentity, handles);
  const objectsPath = path.join(root.path, "objects"), reservationsPath = path.join(root.path, "identity-reservations");
  const objectsHandle = openDirectory(objectsPath, root.objectsDirectoryIdentity, handles);
  const reservationsHandle = openDirectory(reservationsPath, root.reservationsDirectoryIdentity, handles);
  need(isDeepStrictEqual(fs.readdirSync(root.path).sort(), ["identity-reservations", "objects"]));
  need(isDeepStrictEqual(fs.readdirSync(reservationsPath), []));
  const names = root.objects.map(item => `${item.sha256}.blob`);
  need(isDeepStrictEqual(fs.readdirSync(objectsPath).sort(), names));
  const objectProofs = [];
  for (const object of root.objects) {
    const file = path.join(objectsPath, `${object.sha256}.blob`), named = fs.lstatSync(file, { bigint: true });
    need(named.isFile() && !named.isSymbolicLink() && isDeepStrictEqual(statFile(named), object.nativeIdentity));
    if (full) {
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); handles.push(fd); fileGuard(file, fd, object.nativeIdentity);
      const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(CHUNK_BYTES, Math.max(1, object.size))); let offset = 0;
      while (offset < object.size) { const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, object.size - offset), offset); need(count > 0); hash.update(buffer.subarray(0, count)); offset += count; }
      need(fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) === 0 && hash.digest("hex") === object.sha256); fileGuard(file, fd, object.nativeIdentity);
      fs.closeSync(fd); handles.splice(handles.indexOf(fd), 1);
    }
    objectProofs.push({ sha256: object.sha256, size: object.size });
  }
  need(isDeepStrictEqual(statDirectory(fs.fstatSync(rootHandle.fd, { bigint: true })), root.rootIdentity)
    && isDeepStrictEqual(statDirectory(fs.fstatSync(objectsHandle.fd, { bigint: true })), root.objectsDirectoryIdentity)
    && isDeepStrictEqual(statDirectory(fs.fstatSync(reservationsHandle.fd, { bigint: true })), root.reservationsDirectoryIdentity));
  return freeze({ role: root.role, references: root.counts.references, objects: root.counts.objects, bytes: root.counts.bytes,
    membershipSha256: sha256(canonical(objectProofs)) });
}
function verify(context, full) {
  const state = contexts.get(context); need(state && Object.isFrozen(context)); const handles = [];
  try {
    const values = {};
    for (const pin of state.locator.controls) values[pin.role] = parseJson(readExactFile(pin.path, pin, handles, MAX_CONTROL_BYTES));
    verifyControlGraph(state.locator, values);
    const nativeIds = new Set(), roots = [];
    for (const root of state.locator.roots) {
      for (const identityValue of [root.rootIdentity, root.objectsDirectoryIdentity, root.reservationsDirectoryIdentity,
        ...root.objects.map(item => item.nativeIdentity)]) {
        const key = identityKey(identityValue); need(!nativeIds.has(key)); nativeIds.add(key);
      }
      roots.push(inspectRoot(root, handles, full));
    }
    const sourceRoot = state.locator.roots[0], imageObject = sourceRoot.objects.find(item => item.sha256 === state.locator.imageArchive.sha256);
    state.imageSource = freeze({ path: path.join(sourceRoot.path, "objects", `${imageObject.sha256}.blob`), size: imageObject.size,
      sha256: imageObject.sha256, nativeIdentity: imageObject.nativeIdentity, parentIdentity: sourceRoot.objectsDirectoryIdentity });
    state.fastVerified = true;
    const base = { admissionGeneration: state.locator.admissionGeneration, generationRootSha256: state.generationRootSha256,
      archiveLocatorSha256: state.archiveLocatorSha256, executionFilesSha256: state.executionFilesSha256,
      roots, imageArchive: { size: imageObject.size, sha256: imageObject.sha256 },
      claims: { readOnly: true, objectPayloadParsed: false, runtimeAuthority: "NOT_GRANTED", admission: "NOT_AUTHORIZED" } };
    if (!full) return freeze({ kind: FAST_KIND, state: "VERIFIED", scope: "LEASE_IDENTITY_ONLY", ...base });
    state.fullVerified = true; const completedAt = new Date(), validUntil = new Date(completedAt.getTime() + FULL_VALIDITY_MS);
    return freeze({ kind: FULL_KIND, state: "VERIFIED", scope: "COMPLETE_ARCHIVE_HEALTH", completedAt: completedAt.toISOString(),
      validUntil: validUntil.toISOString(), ...base });
  } catch (error) { if (error?.message === ERROR) throw error; fail("operation"); } finally { closeAll(handles); }
}

export function loadPostgresAdmissionArchiveContext(generationRoot) {
  const loaded = loadLocator(generationRoot);
  const context = freeze({ kind: "POSTGRES_ADMISSION_ARCHIVE_CONTEXT_V1", admissionGeneration: loaded.locator.admissionGeneration,
    generationRootSha256: loaded.generationRootSha256, archiveLocatorSha256: generationRoot.archiveLocator.sha256 });
  contexts.set(context, { ...loaded, archiveLocatorSha256: generationRoot.archiveLocator.sha256,
    fastVerified: false, fullVerified: false, imageSource: null }); return context;
}

export function verifyPostgresAdmissionArchiveFast(context) { return verify(context, false); }
export function verifyPostgresAdmissionArchiveFull(context) { return verify(context, true); }

export function getPostgresAdmissionImageArchiveSource(context) {
  const state = contexts.get(context); need(state?.fastVerified && state.imageSource); return state.imageSource;
}

function date(value) {
  need(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value));
  const time = Date.parse(`${value}T00:00:00Z`), parsed = new Date(time);
  need(Number.isFinite(time) && parsed.toISOString().slice(0, 10) === value); return parsed;
}
function anniversary(value) {
  const result = new Date(Date.UTC(value.getUTCFullYear() + 1, value.getUTCMonth(), value.getUTCDate()));
  if (result.getUTCMonth() !== value.getUTCMonth()) result.setUTCDate(0); return result;
}
function maintenancePin(value) {
  const result = exact(value, PIN_KEYS); positiveInteger(result.size); digest(result.sha256); return result;
}
function loadMaintenanceInput(generation) {
  const inputPath = `${ROOT}/maintenance-generation-${generation}.json`, sidecarPath = `${ROOT}/maintenance-generation-${generation}.sha256`;
  const sidecar = readRootOwnedFile(sidecarPath, 65); need(sidecar.size === 65 && /^[a-f0-9]{64}\n$/u.test(sidecar.bytes.toString("ascii")));
  const expectedSha256 = sidecar.bytes.toString("ascii", 0, 64), source = readRootOwnedFile(inputPath, MAX_LOCATOR_BYTES);
  need(source.sha256 === expectedSha256); const value = parseJson(source.bytes); need(source.bytes.equals(canonical(value)));
  const input = exact(value, MAINTENANCE_KEYS);
  need(input.schemaVersion === 1 && input.kind === MAINTENANCE_KIND && input.generationRoot?.admissionGeneration === generation);
  digest(input.generationRootSha256); need(input.generationRootSha256 === sha256(canonical(input.generationRoot)));
  input.command = maintenancePin(input.command); input.policy = maintenancePin(input.policy);
  const started = date(input.supportStartedAt), ended = date(input.supportEndsAt), archived = date(input.archiveUntil);
  need(ended.getTime() === anniversary(started).getTime() && archived.getTime() === ended.getTime() + 365 * 24 * 60 * 60 * 1000);
  const command = readRootOwnedFile(SOURCE_FILE, 1024 * 1024), policy = readRootOwnedFile(POLICY_FILE, 1024 * 1024);
  need(isDeepStrictEqual({ size: command.size, sha256: command.sha256 }, input.command)
    && isDeepStrictEqual({ size: policy.size, sha256: policy.sha256 }, input.policy));
  return input;
}
function cliArguments(argv) {
  need(Array.isArray(argv) && argv.length === 4 && argv[0] === "--generation" && /^(?:[1-9][0-9]*)$/u.test(argv[1])
    && argv[2] === "--mode" && ["FAST", "FULL"].includes(argv[3]));
  return { generation: positiveInteger(Number(argv[1])), mode: argv[3] };
}
async function main() {
  try {
    const { generation, mode } = cliArguments(process.argv.slice(2)), input = loadMaintenanceInput(generation);
    const context = loadPostgresAdmissionArchiveContext(input.generationRoot);
    const report = mode === "FAST" ? verifyPostgresAdmissionArchiveFast(context) : verifyPostgresAdmissionArchiveFull(context);
    process.stdout.write(canonical(report));
  } catch (error) {
    const failure = freeze({ kind: "POSTGRES_ADMISSION_ARCHIVE_FAILURE_V1", state: "FAILED",
      reason: error?.message === ERROR ? ERROR : "postgres_admission_archive_operation_failed",
      runtimeAuthority: "NOT_GRANTED", admission: "NOT_AUTHORIZED" });
    process.stderr.write(canonical(failure)); process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
