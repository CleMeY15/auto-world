export const EC_PACKAGE = "github.com/seaweedfs/seaweedfs/weed/worker/tasks/erasure_coding";
export const EC_TESTS = Object.freeze([
  "TestEcEncodeLeavesRightFilesAndRemovesStubAndSource",
  "TestEcEncodeJulorLayoutConverges",
]);

export function ecTestArguments() {
  return ["test", "-json", "-count=1", "-p=2", "-run", `^(${EC_TESTS.join("|")})$`, "./weed/worker/tasks/erasure_coding"];
}

// A nonzero ordinary test result is evidence, never acceptance. Missing, skipped,
// duplicated or contradictory terminal events cannot become a passing preflight.
export function summarizeEcPreflight(stdout, status) {
  const invalid = () => ({ result: "INVALID", exitStatus: Number.isInteger(status) ? status : null, tests: [] });
  if (!Buffer.isBuffer(stdout) || stdout.length < 1 || stdout.length > 64 * 1024 ** 2 || ![0, 1].includes(status)) return invalid();
  const tests = new Map(); let packageResult;
  try {
    for (const line of new TextDecoder("utf-8", { fatal: true }).decode(stdout).trim().split("\n")) {
      const event = JSON.parse(line);
      if (!event || event.Package !== EC_PACKAGE) return invalid();
      if (!["pass", "fail", "skip"].includes(event.Action)) continue;
      if (typeof event.Test === "string") {
        const parent = event.Test.split("/", 1)[0];
        if (!EC_TESTS.includes(parent)) return invalid();
        if (event.Test !== parent) {
          if (event.Action !== "pass") return invalid();
          continue;
        }
        if (tests.has(parent)) return invalid();
        tests.set(parent, event.Action);
      } else {
        if (packageResult) return invalid();
        packageResult = event.Action;
      }
    }
  } catch { return invalid(); }
  if (tests.size !== EC_TESTS.length || [...tests.values()].includes("skip")) return invalid();
  const failed = [...tests.values()].includes("fail");
  if (packageResult !== (failed ? "fail" : "pass") || status !== (failed ? 1 : 0)) return invalid();
  return { result: failed ? "FAILED" : "PASSED", exitStatus: status, tests: EC_TESTS.map((name) => ({ name, result: tests.get(name) })) };
}

export function requireEcPreflight(baseline, corrected) {
  if (baseline?.result !== "PASSED" || corrected?.result !== "PASSED") throw new Error("seaweed_ec_preflight_failed");
}
import { TextDecoder } from "node:util";
