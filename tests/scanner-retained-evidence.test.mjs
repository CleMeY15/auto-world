import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../docs/validation/service-image-audits/36341060453/", import.meta.url);

test("retained native audit evidence preserves original bytes and derived index bindings", () => {
  const identities = JSON.parse(readFileSync(new URL("extracted-json-identities.json", root), "utf8"));
  const originals = [
    ["audit-receipt.json", 176153, "395527097c249b308307f3277b35060d8e1a3440bb3be317ad9e7bffb24c0e72"],
    ["database-evidence.json", 2145, "005b3dd17da2c18058291da1893e55ccc0fcfe2be6f6ab483d770d9f36566d74"],
    ...["before", "after"].flatMap((phase) => [
      [`database-java-${phase}-manifest.json`, 624, "e5922bfd4ec2aafa93226148b28f8cce4df87557544ed1bbc80a5b24d218d123"],
      [`database-vulnerability-${phase}-manifest.json`, 616, "4567b9f40c2dc13ead24d5e314563033a890a06b21fd6cb526e7236bfd0f0a72"],
    ]),
  ];
  for (const [name, size, digest] of originals) {
    const bytes = readFileSync(new URL(name, root));
    assert.equal(bytes.length, size, name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, name);
    assert.deepEqual(identities.filter((identity) => identity.name === name),
      [{ name, bytes: size, sha256: digest }], name);
  }
  for (const database of ["java", "vulnerability"]) {
    assert.deepEqual(readFileSync(new URL(`database-${database}-before-manifest.json`, root)),
      readFileSync(new URL(`database-${database}-after-manifest.json`, root)));
  }
});
