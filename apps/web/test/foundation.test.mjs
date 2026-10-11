import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("prerenders a disclosed French component preview with no listing payload", () => {
  const html = readFileSync(".next/server/app/index.html", "utf8");
  assert.match(html, /lang="fr"/u);
  assert.match(html, /Aperçu de l’interface/u);
  assert.match(html, /Aucune annonce ni recherche réelle/u);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/u);
  assert.doesNotMatch(html, /<img(?:\s|>)/u);
  assert.doesNotMatch(html, /sourceListingId|connectorRunId|snapshotId|legalStatus/u);
});

test("production traces exclude connectors, data authority and test fixtures", () => {
  const traces = readdirSync(".next/server/app", { recursive: true }).filter((file) => file.endsWith(".nft.json"));
  assert.ok(traces.length > 0, "a production trace must exist");
  for (const trace of traces) {
    const files = JSON.parse(readFileSync(path.join(".next/server/app", trace), "utf8")).files;
    assert.ok(files.length > 0);
    for (const file of files) {
      assert.doesNotMatch(file.replaceAll("\\", "/"), /connectors\/|services\/|source-registry|vehicle-schema|\/test\//u);
    }
  }
});
