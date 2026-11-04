import { TextDecoder } from "node:util";

const MiB = 1024 ** 2;
const CONTAINER_NAME = /^aw-official-[a-f0-9-]{36}$/u;
const OWNER = /^[a-f0-9-]{36}$/u;
const ID = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const TAG = /^[a-z0-9][a-z0-9._/-]{0,191}:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;
const LABEL = "io.auto-world.scanner-official";
const fail = (code) => { throw new Error(code); };

function text(bytes) {
  if (typeof bytes === "string") return bytes;
  if (!Buffer.isBuffer(bytes)) return "";
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return ""; }
}

function successful(result) {
  return result && !result.error && result.status === 0 && result.signal === null;
}

function absent(result, kind, target) {
  if (kind === "image") return validateOwnedImageAbsence(result, target);
  if (!result || result.error || result.status !== 1 || result.signal !== null || !["", "[]\n"].includes(text(result.stdout))) return false;
  const message = text(result.stderr).trim();
  const expected = [`Error response from daemon: No such container: ${target}`, `Error: No such object: ${target}`];
  return expected.includes(message);
}

export function validateOwnedImageAbsence(result, reference) {
  if (!(TAG.test(reference ?? "") || IMAGE_ID.test(reference ?? "")) || !result || result.error || result.status !== 1 ||
      result.signal !== null || !["", "[]\n"].includes(text(result.stdout))) return false;
  const message = text(result.stderr).trim();
  return [`Error response from daemon: No such image: ${reference}`, `Error: No such image: ${reference}`,
    `Error response from daemon: No such object: ${reference}`, `Error: No such object: ${reference}`].includes(message);
}

function parsedInspect(result) {
  if (!successful(result) || text(result.stderr) !== "") fail("scanner_owned_docker_cleanup_uncertain");
  let value;
  try { value = JSON.parse(text(result.stdout)); } catch { fail("scanner_owned_docker_cleanup_uncertain"); }
  if (!Array.isArray(value) || value.length !== 1) fail("scanner_owned_docker_cleanup_uncertain");
  return value[0];
}

function containerIdentity(result, entry) {
  const value = parsedInspect(result);
  if (value?.Name !== `/${entry.name}` || !ID.test(value.Id ?? "") || value.Config?.Labels?.[LABEL] !== entry.owner ||
      entry.id !== null && value.Id !== entry.id) fail("scanner_owned_docker_cleanup_owner_mismatch");
  return value.Id;
}

function imageIdentity(result, entry, tagPresent) {
  const value = parsedInspect(result);
  const tags = value?.RepoTags == null ? [] : value.RepoTags;
  if (!IMAGE_ID.test(value?.Id ?? "") || value.Config?.Labels?.[LABEL] !== entry.owner ||
      entry.id !== null && value.Id !== entry.id || !Array.isArray(tags) ||
      (tagPresent ? tags.length !== 1 || tags[0] !== entry.tag : tags.length !== 0)) fail("scanner_owned_docker_cleanup_owner_mismatch");
  return value.Id;
}

function attach(first, error) {
  if (!first) return error;
  if (first === error || first.cleanupErrors?.includes(error)) return first;
  (first.cleanupErrors ??= []).push(error);
  return first;
}

export function createOwnedDockerCleanupRegistry({ execute, budget, ownerLabel = LABEL } = {}) {
  if (typeof execute !== "function" || budget != null && typeof budget.cleanupCommandTimeoutMs !== "function" || ownerLabel !== LABEL) {
    fail("scanner_owned_docker_cleanup_arguments_invalid");
  }
  const containers = new Map(), images = new Map();
  const history = { containers: new Map(), images: new Map() };
  let cleanupStarted = false;
  let firstFailure;

  const call = (args, cap) => {
    let budgetError, timeoutMs;
    try {
      timeoutMs = budget == null ? cap : budget.cleanupCommandTimeoutMs(cap);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("scanner_owned_time_budget_refused");
      timeoutMs = Math.min(cap, timeoutMs);
    }
    catch (error) { budgetError = error; timeoutMs = Math.min(cap, 5_000); }
    let result, commandError;
    try { result = execute(args, { timeoutMs, maxBytes: MiB }); }
    catch (error) { commandError = error; }
    return { result, budgetError, commandError };
  };

  const operation = (args, cap, errors) => {
    const response = call(args, cap);
    if (response.budgetError) errors.push(response.budgetError);
    if (response.commandError) errors.push(response.commandError);
    return response.result;
  };

  const record = (kind, entry, errors, absentValue) => {
    const records = history[kind === "container" ? "containers" : "images"], key = kind === "container" ? entry.name : entry.tag;
    const previous = records.get(key);
    if (errors.length) firstFailure ??= errors[0];
    const value = Object.freeze({ ...(kind === "container" ? { name: entry.name } : { tag: entry.tag }), owner: entry.owner, id: entry.id,
      attempted: true, absent: absentValue, failure: previous?.failure ?? errors[0]?.message?.slice(0, 256) ?? null,
      budgetFailure: previous?.budgetFailure === true || errors.some((error) => error?.message === "scanner_owned_time_budget_refused") });
    records.set(key, value);
    return value;
  };

  const finish = (errors, evidence) => {
    if (!errors.length) return evidence;
    const first = errors.slice(1).reduce(attach, errors[0]);
    first.ownedCleanup = snapshot();
    throw first;
  };

  const cleanupContainerEntry = (entry) => {
    const errors = [];
    let inspected = operation(["container", "inspect", entry.name], 15_000, errors);
    let id = entry.id;
    if (absent(inspected, "container", entry.name) && id !== null) inspected = operation(["container", "inspect", id], 15_000, errors);
    if (absent(inspected, "container", entry.name) || id !== null && absent(inspected, "container", id)) {
      const nameAbsent = absent(operation(["container", "inspect", entry.name], 15_000, errors), "container", entry.name);
      const idAbsent = id === null || absent(operation(["container", "inspect", id], 15_000, errors), "container", id);
      const evidence = record("container", entry, errors, nameAbsent && idAbsent);
      if (!evidence.absent) errors.push(new Error("scanner_owned_docker_cleanup_uncertain"));
      return finish(errors, evidence);
    }
    try { id = containerIdentity(inspected, entry); }
    catch (error) { errors.push(error); return finish(errors, record("container", entry, errors, false)); }
    entry.id ??= id;
    const removed = operation(["container", "rm", "--force", id], 30_000, errors);
    if (!successful(removed) && !absent(removed, "container", id)) errors.push(new Error("scanner_owned_docker_cleanup_uncertain"));
    const nameAbsent = absent(operation(["container", "inspect", entry.name], 15_000, errors), "container", entry.name);
    const idAbsent = absent(operation(["container", "inspect", id], 15_000, errors), "container", id);
    if (!nameAbsent || !idAbsent) errors.push(new Error("scanner_owned_docker_cleanup_uncertain"));
    return finish(errors, record("container", entry, errors, nameAbsent && idAbsent));
  };

  const cleanupImageEntry = (entry) => {
    const errors = [];
    let inspected = operation(["image", "inspect", entry.tag], 15_000, errors);
    let id = entry.id, tagPresent = !absent(inspected, "image", entry.tag);
    if (!tagPresent && id !== null) inspected = operation(["image", "inspect", id], 15_000, errors);
    if (!tagPresent && (id === null || absent(inspected, "image", id))) {
      const tagAbsent = absent(operation(["image", "inspect", entry.tag], 15_000, errors), "image", entry.tag);
      const idAbsent = id === null || absent(operation(["image", "inspect", id], 15_000, errors), "image", id);
      const evidence = record("image", entry, errors, tagAbsent && idAbsent);
      if (!evidence.absent) errors.push(new Error("scanner_owned_docker_cleanup_uncertain"));
      return finish(errors, evidence);
    }
    try { id = imageIdentity(inspected, entry, tagPresent); }
    catch (error) { errors.push(error); return finish(errors, record("image", entry, errors, false)); }
    entry.id ??= id;
    if (tagPresent) {
      const removedTag = operation(["image", "rm", entry.tag], 30_000, errors);
      if (!successful(removedTag) && !absent(removedTag, "image", entry.tag)) errors.push(new Error("scanner_owned_docker_cleanup_uncertain"));
    }
    let idResult = operation(["image", "inspect", id], 15_000, errors);
    if (!absent(idResult, "image", id)) {
      try { imageIdentity(idResult, entry, false); }
      catch (error) { errors.push(error); return finish(errors, record("image", entry, errors, false)); }
      const removedId = operation(["image", "rm", id], 30_000, errors);
      if (!successful(removedId) && !absent(removedId, "image", id)) errors.push(new Error("scanner_owned_docker_cleanup_uncertain"));
    }
    const tagAbsent = absent(operation(["image", "inspect", entry.tag], 15_000, errors), "image", entry.tag);
    const idAbsent = absent(operation(["image", "inspect", id], 15_000, errors), "image", id);
    if (!tagAbsent || !idAbsent) errors.push(new Error("scanner_owned_docker_cleanup_uncertain"));
    return finish(errors, record("image", entry, errors, tagAbsent && idAbsent));
  };

  function snapshot() {
    const values = (registry, records, kind) => [...registry.values()].map((entry) => records.get(kind === "container" ? entry.name : entry.tag) ??
      Object.freeze({ ...(kind === "container" ? { name: entry.name } : { tag: entry.tag }), owner: entry.owner, id: entry.id,
        attempted: false, absent: false, failure: null, budgetFailure: false }));
    const containerValues = values(containers, history.containers, "container"), imageValues = values(images, history.images, "image");
    const all = [...containerValues, ...imageValues];
    const failure = firstFailure?.message?.slice(0, 256) ?? all.find((entry) => entry.failure !== null)?.failure ?? null;
    return Object.freeze({ attempted: cleanupStarted, absent: cleanupStarted && all.every((entry) => entry.attempted && entry.absent),
      containers: Object.freeze(containerValues), images: Object.freeze(imageValues), failure,
      budgetFailure: all.some((entry) => entry.budgetFailure) });
  }

  const registerContainer = ({ name, owner, id = null } = {}) => {
    if (!CONTAINER_NAME.test(name ?? "") || !OWNER.test(owner ?? "") || id !== null && !ID.test(id)) fail("scanner_owned_docker_cleanup_arguments_invalid");
    const previous = containers.get(name);
    if (previous && (previous.owner !== owner || previous.id !== id && id !== null)) fail("scanner_owned_docker_cleanup_registry_conflict");
    if (previous && previous.id === null) previous.id = id;
    else if (!previous) containers.set(name, { name, owner, id });
  };
  const registerImage = ({ tag, owner, id = null } = {}) => {
    if (!TAG.test(tag ?? "") || !OWNER.test(owner ?? "") || id !== null && !IMAGE_ID.test(id)) fail("scanner_owned_docker_cleanup_arguments_invalid");
    const previous = images.get(tag);
    if (previous && (previous.owner !== owner || previous.id !== id && id !== null)) fail("scanner_owned_docker_cleanup_registry_conflict");
    if (previous && previous.id === null) previous.id = id;
    else if (!previous) images.set(tag, { tag, owner, id });
  };
  const bindContainerId = (name, id) => registerContainer({ ...containers.get(name), name, id });
  const bindImageId = (tag, id) => registerImage({ ...images.get(tag), tag, id });
  const cleanupContainer = (name) => {
    cleanupStarted = true;
    const entry = containers.get(name);
    if (!entry) fail("scanner_owned_docker_cleanup_registry_missing");
    return cleanupContainerEntry(entry);
  };
  const cleanupAll = () => {
    cleanupStarted = true;
    let first = firstFailure;
    for (const entry of [...containers.values()].reverse()) try { cleanupContainerEntry(entry); } catch (error) { first = attach(first, error); }
    for (const entry of [...images.values()].reverse()) try { cleanupImageEntry(entry); } catch (error) { first = attach(first, error); }
    if (first) { first.ownedCleanup = snapshot(); throw first; }
    return snapshot();
  };
  return Object.freeze({ registerContainer, registerImage, bindContainerId, bindImageId, cleanupContainer, cleanupAll, snapshot });
}
