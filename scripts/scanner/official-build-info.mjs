import { TextDecoder } from "node:util";

const MAIN_PATH = "github.com/aquasecurity/trivy";
const SOURCE_COMMIT = "e713f67f7d54decdcd9b3132c9751833dcced698";
const MODULE_VERSION = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]*)?(?:\+[a-zA-Z0-9][a-zA-Z0-9.-]*)?$/u;

function invalid() {
  throw new Error("scanner_official_go_build_info_invalid");
}

function moduleFields(fields) {
  if (![4, 5].includes(fields.length) || fields[2].length > 1024 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._~+-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._~+-]*)*$/u.test(fields[2]) ||
      !fields[2].split("/")[0].includes(".") ||
      (fields[4] && !/^h1:[a-zA-Z0-9+/]{43}=$/u.test(fields[4]))) invalid();
  return { path: fields[2], version: fields[3], sum: fields[4] ?? "" };
}

// Parse the standard `go version -m` text, not a claim of binary provenance.
// Archive identity and upstream attestation remain the caller's responsibility.
// The authenticated 0.76.1 binary has this exact dirty marker; no other dirty
// build is authorized by accepting its measured metadata here.
export function parseOfficialGoBuildInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 4 * 1024 ** 2) invalid();
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { invalid(); }
  if (["\0", "\v", "\f"].some((character) => text.includes(character))) invalid();
  const lines = text.replaceAll("\r\n", "\n").replace(/\n$/u, "").split("\n");
  if (lines.length > 5000 || !/^[^\t\r\n]{1,4096}: go1\.27\.3$/u.test(lines.shift() ?? "")) invalid();
  let binaryPathSeen = false;
  let main = null;
  const dependencies = new Map();
  const settings = new Map();
  for (const line of lines) {
    const fields = line.split("\t");
    if (fields[0] !== "" || line.length > 16_384 || /\r/u.test(line)) invalid();
    if (fields[1] === "path") {
      if (fields.length !== 3 || binaryPathSeen || fields[2] !== `${MAIN_PATH}/cmd/trivy`) invalid();
      binaryPathSeen = true;
    } else if (fields[1] === "mod") {
      const module = moduleFields(fields);
      if (main || module.path !== MAIN_PATH || module.version !== "v0.76.1+dirty") invalid();
      main = module;
    } else if (fields[1] === "dep") {
      const module = moduleFields(fields);
      if (!MODULE_VERSION.test(module.version) || module.path === MAIN_PATH || dependencies.has(module.path)) invalid();
      dependencies.set(module.path, module);
    } else if (fields[1] === "build") {
      if (fields.length !== 3) invalid();
      const match = /^([-a-zA-Z0-9_.]+)=(.*)$/u.exec(fields[2]);
      if (!match || settings.has(match[1])) invalid();
      const value = match[2];
      if (["\0", "\r", "\n"].some((character) => value.includes(character))) invalid();
      settings.set(match[1], value);
    } else invalid(); // Includes all module replacements and unknown record kinds.
  }
  if (!binaryPathSeen || !main || dependencies.size < 100 || dependencies.size > 4096 ||
      dependencies.get("google.golang.org/grpc")?.version !== "v1.84.0" ||
      dependencies.get("golang.org/x/net")?.version !== "v0.60.0" ||
      settings.get("GOOS") !== "linux" || settings.get("GOARCH") !== "amd64" || settings.get("CGO_ENABLED") !== "0") invalid();
  const sourceSettings = [...settings.keys()].filter((key) => key === "vcs" || key.startsWith("vcs."));
  if (sourceSettings.some((key) => !["vcs", "vcs.revision", "vcs.modified", "vcs.time"].includes(key)) ||
      settings.get("vcs") !== "git" || settings.get("vcs.revision") !== SOURCE_COMMIT ||
      settings.get("vcs.modified") !== "true") invalid();
  const sourceTime = settings.get("vcs.time");
  if (sourceTime !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(sourceTime) ||
      !Number.isFinite(Date.parse(sourceTime)) || new Date(sourceTime).toISOString() !== sourceTime.replace("Z", ".000Z"))) invalid();
  return {
    stdlib: { path: "stdlib", version: "v1.27.3" }, main,
    dependencies: [...dependencies.values()].sort((left, right) => left.path.localeCompare(right.path, "en")),
    settings: Object.fromEntries(settings),
  };
}
