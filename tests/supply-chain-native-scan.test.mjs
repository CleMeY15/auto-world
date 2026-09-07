import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeScanArguments, parseNativeScanArgs } from "../scripts/supply-chain/native-scan.mjs";

test("native runner CLI exposes only the fixed Linux audit operation", () => {
  assert.deepEqual(parseNativeScanArgs([]), { mode: "scan" });
  for (const args of [["--enable"], ["--subject", "other"], ["upload"]]) {
    assert.throws(() => parseNativeScanArgs(args), { code: "native_scan_arguments_refused" });
  }
});
test("scanner commands freeze databases, stay offline and retain full JSON packages", () => {
  const cyclonedx = nativeScanArguments("cyclonedx", "/owned/cache");
  const json = nativeScanArguments("json", "/owned/cache");
  for (const args of [cyclonedx, json]) {
    for (const flag of ["--skip-db-update", "--skip-java-db-update", "--offline-scan", "--quiet", "--scanners", "vuln"]) {
      assert.ok(args.includes(flag));
    }
    assert.equal(args.at(-1), "subject");
    assert.equal(args.includes("--output"), false);
  }
  assert.equal(cyclonedx.includes("--list-all-pkgs"), false);
  assert.equal(json.includes("--list-all-pkgs"), true);
  for (const format of ["sarif", "table", ""]) assert.throws(() => nativeScanArguments(format, "/owned/cache"));
});
