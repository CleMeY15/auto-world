import { execFileSync } from "node:child_process";

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 64 * 1024;
const OBJECT_ID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

function readIdentity(checkout, execute, command) {
  const options = {
    cwd: checkout,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  };
  const revision = execute(command, ["rev-parse", "HEAD"], options).trim();
  const tree = execute(command, ["rev-parse", "HEAD^{tree}"], options).trim();
  const status = execute(command, ["status", "--porcelain"], options);
  if (!OBJECT_ID.test(revision) || !OBJECT_ID.test(tree) || revision.length !== tree.length) {
    throw new Error("source_identity_invalid");
  }
  return Object.freeze({ sourceRevision: revision, sourceTree: tree, sourceDirty: status.trim() !== "" });
}

export function sourceIdentity(checkout, {
  execute = execFileSync,
  platform = process.platform,
  environment = process.env,
} = {}) {
  if (typeof checkout !== "string" || checkout.trim() === "") throw new Error("source_identity_unavailable");
  try {
    return readIdentity(checkout, execute, "git");
  } catch {
    const isWsl = platform === "linux" && environment !== null && typeof environment === "object"
      && typeof environment.WSL_DISTRO_NAME === "string"
      && environment.WSL_DISTRO_NAME.trim() !== "";
    if (isWsl) {
      try { return readIdentity(checkout, execute, "git.exe"); }
      catch { /* expose only the fixed evidence error */ }
    }
    throw new Error("source_identity_unavailable");
  }
}
