import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("production traces exclude connectors, data authority and test fixtures", () => {
  const traces = readdirSync(".next/server/app", { recursive: true }).filter((file) => file.endsWith(".nft.json"));
  assert.ok(traces.length > 0, "a production trace must exist");
  for (const trace of traces) {
    const files = JSON.parse(readFileSync(path.join(".next/server/app", trace), "utf8")).files;
    assert.ok(files.length > 0);
    for (const file of files) {
      const normalized = file.replaceAll("\\", "/");
      assert.doesNotMatch(normalized, /connectors\/|services\/|source-registry|\/test\/|\/test-support\//u);
      if (normalized.includes("vehicle-schema")) {
        assert.match(normalized, /packages\/vehicle-schema\/(?:package\.json|dist\/(?:index|parsers|types|validation)\.js)$/u);
      }
      if (normalized.includes("demo-search-contract")) {
        assert.match(normalized, /packages\/demo-search-contract\/(?:package\.json|dist\/(?:index|parsers|types|validation)\.js)$/u);
      }
    }
  }
});
