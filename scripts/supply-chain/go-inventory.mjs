import { assertClosedObject } from "./strict-json.mjs";
import { policyError } from "./process.mjs";

const MAIN_MODULES = Object.freeze({
  oras: "oras.land/oras",
  cosign: "github.com/sigstore/cosign/v3",
  trivy: "github.com/aquasecurity/trivy",
});

const fail = (code) => { throw policyError(code); };

function parseModuleLine(line, prefix) {
  const fields = line.slice(prefix.length).trim().split(/\s+/u);
  if (fields.length < 2 || fields.length > 3 || fields.some((field) => field.length === 0)) fail("go_build_info_invalid");
  return { path: fields[0], version: fields[1], ...(fields[2] ? { sum: fields[2] } : {}) };
}

function packageKey(name, version) {
  return `${name}@${version}`;
}

// Build information is captured by the builder. The module lock is independently
// collected from the source closure; neither Trivy report is an input here.
export function deriveGoInventory({ tool, buildInfo, lockedModules, goVersion = "1.26.8" }) {
  const mainModule = MAIN_MODULES[tool];
  if (!mainModule || !Array.isArray(buildInfo) || buildInfo.length === 0 || buildInfo.length > 100_000 ||
      !Array.isArray(lockedModules) || lockedModules.length === 0 || lockedModules.length > 200_000 ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(goVersion)) fail("go_inventory_input_invalid");
  const locked = new Map();
  for (const entry of lockedModules) {
    assertClosedObject(entry, ["path", "version", "sum", "goModSum", "zipSha256", "zipSize"]);
    if (typeof entry.path !== "string" || typeof entry.version !== "string") fail("go_module_lock_invalid");
    locked.set(packageKey(entry.path, entry.version), entry);
  }

  let programPath;
  let rawMain;
  const dependencies = [];
  let pendingDependency;
  for (const line of buildInfo) {
    if (typeof line !== "string" || line.length === 0 || line.length > 16_384) fail("go_build_info_invalid");
    if (line.startsWith("path\t")) {
      if (programPath !== undefined) fail("go_build_info_invalid");
      programPath = line.slice(5);
      pendingDependency = undefined;
    } else if (line.startsWith("mod\t")) {
      if (rawMain !== undefined) fail("go_build_info_invalid");
      rawMain = parseModuleLine(line, "mod\t");
      pendingDependency = undefined;
    } else if (line.startsWith("dep\t")) {
      pendingDependency = { ...parseModuleLine(line, "dep\t") };
      dependencies.push(pendingDependency);
    } else if (line.startsWith("=>\t")) {
      if (!pendingDependency || pendingDependency.replace) fail("go_build_info_invalid");
      pendingDependency.replace = parseModuleLine(line, "=>\t");
    } else if (line.startsWith("build\t")) {
      pendingDependency = undefined;
    } else {
      fail("go_build_info_invalid");
    }
  }

  if (programPath !== `${mainModule}/cmd/${tool}` || rawMain?.path !== mainModule || rawMain.version !== "(devel)") {
    fail("go_main_identity_mismatch");
  }
  const packages = [{ name: mainModule, version: "" }, { name: "stdlib", version: `v${goVersion.replace(/[-+].*$/u, "")}` }];
  const replacements = [];
  for (const dependency of dependencies) {
    const originalLock = locked.get(packageKey(dependency.path, dependency.version));
    if (!originalLock || dependency.sum !== undefined && dependency.sum !== originalLock.sum) fail("go_dependency_lock_mismatch");
    const effective = dependency.replace ?? dependency;
    const effectiveLock = locked.get(packageKey(effective.path, effective.version));
    if (dependency.replace && (!effectiveLock || effective.sum !== undefined && effective.sum !== effectiveLock.sum)) fail("go_replacement_lock_mismatch");
    packages.push({ name: effective.path, version: effective.version });
    if (dependency.replace) replacements.push({ original: { path: dependency.path, version: dependency.version }, effective: { path: effective.path, version: effective.version } });
  }
  const keys = packages.map((entry) => packageKey(entry.name, entry.version));
  if (new Set(keys).size !== keys.length) fail("go_inventory_duplicate");
  return Object.freeze({
    programPath,
    mainModule: Object.freeze({ path: rawMain.path, rawVersion: rawMain.version, reportVersion: "" }),
    packages: Object.freeze(packages.map(Object.freeze)),
    replacements: Object.freeze(replacements.map((entry) => Object.freeze(entry))),
  });
}
