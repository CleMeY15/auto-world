import {
  chmodSync, existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, rmSync, unlinkSync,
} from "node:fs";
import path from "node:path";

const WORK_NAME = "auto-world-seaweed-source-diagnostic";
const REMOVABLE_ENTRIES = new Map([
  ["go.tar.gz", "file"],
  ["restored-source", "directory"],
  ["bin", "directory"],
  ["baseline-bin", "directory"],
  ["baseline-gocache", "directory"],
  ["tmp", "directory"],
]);

function checkedDirectory(directory) {
  const resolved = path.resolve(directory);
  if (!existsSync(resolved)) throw new Error("seaweed_cleanup_path_invalid");
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved) throw new Error("seaweed_cleanup_path_invalid");
  return resolved;
}

function checkedWork(work, root) {
  const parent = checkedDirectory(root);
  const target = path.resolve(work);
  if (target !== path.join(parent, WORK_NAME) || !existsSync(target)) throw new Error("seaweed_cleanup_path_invalid");
  const info = lstatSync(target);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(target) !== target) throw new Error("seaweed_cleanup_path_invalid");
  return target;
}

function removeEntry(entry) {
  const info = lstatSync(entry);
  if (info.isSymbolicLink()) {
    unlinkSync(entry);
    return;
  }
  if (info.isDirectory()) {
    chmodSync(entry, 0o700);
    for (const child of readdirSync(entry, { withFileTypes: true })) {
      const childPath = path.join(entry, child.name);
      if (child.isSymbolicLink()) unlinkSync(childPath);
      else removeEntry(childPath);
    }
    rmdirSync(entry);
    return;
  }
  if (info.nlink > 1) {
    unlinkSync(entry);
    return;
  }
  chmodSync(entry, 0o600);
  rmSync(entry, { force: false });
}

export function removeOwnedTree(work, root = "/tmp") {
  const target = checkedWork(work, root);
  removeEntry(target);
}

export function removeOwnedWorkEntry(work, name, root = path.dirname(path.resolve(work))) {
  const target = checkedWork(work, root);
  const expectedType = REMOVABLE_ENTRIES.get(name);
  if (!expectedType || path.basename(name) !== name) throw new Error("seaweed_cleanup_entry_invalid");
  const entry = path.join(target, name);
  if (!existsSync(entry)) throw new Error("seaweed_cleanup_entry_invalid");
  const info = lstatSync(entry);
  if (info.isSymbolicLink() || (expectedType === "file" ? !info.isFile() : !info.isDirectory()) || realpathSync(entry) !== entry) {
    throw new Error("seaweed_cleanup_entry_invalid");
  }
  removeEntry(entry);
}

export function workTreeBytes(directory, cap) {
  const root = checkedDirectory(directory);
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error("seaweed_work_tree_invalid");
  let total = 0;
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const entry = path.join(current, name);
      const info = lstatSync(entry);
      if (info.isDirectory() && !info.isSymbolicLink()) walk(entry);
      else {
        total += info.size;
        if (!Number.isSafeInteger(total) || total > cap) throw new Error("seaweed_artifact_budget_exceeded");
      }
    }
  };
  walk(root);
  return total;
}
