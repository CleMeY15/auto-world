import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const retainedRuns = [
  {
    id: "36341060453",
    originals: [
      ["audit-receipt.json", 176153, "395527097c249b308307f3277b35060d8e1a3440bb3be317ad9e7bffb24c0e72"],
      ["database-evidence.json", 2145, "005b3dd17da2c18058291da1893e55ccc0fcfe2be6f6ab483d770d9f36566d74"],
    ],
  },
  {
    id: "36342206206",
    originals: [
      ["audit-receipt.json", 117661, "612d8739ce5b81f76ad61966982aabe09489ed3633ce440675a7e1b6c0a5bb3d"],
      ["database-evidence.json", 2145, "060e146018b082d2477027501ea8c0b9240b412355786a0abc7ecc3e97857c91"],
    ],
  },
  {
    id: "36343617867",
    originals: [
      ["audit-receipt.json", 101834, "aeed3a9cff72fecbd6a2d2db96dff49e3bdd0ecf9f623b1e1392e4f53cc9217b"],
      ["database-evidence.json", 2143, "ba5fbb5802e0c9d15bbc9afd813aee880b9e2481d173b9614584745488e07335"],
    ],
    vulnerabilityManifest: "d8bfe8310279f602b71117ffd7ab2d73b5f467112069bc192ef8b5e5e4cc51d6",
  },
];

test("retained native audit evidence preserves original bytes and derived index bindings for every run", () => {
  for (const run of retainedRuns) {
    const root = new URL(`../docs/validation/service-image-audits/${run.id}/`, import.meta.url);
    const identities = JSON.parse(readFileSync(new URL("extracted-json-identities.json", root), "utf8"));
    const originals = [
      ...run.originals,
      ...["before", "after"].flatMap((phase) => [
        [`database-java-${phase}-manifest.json`, 624, "e5922bfd4ec2aafa93226148b28f8cce4df87557544ed1bbc80a5b24d218d123"],
        [`database-vulnerability-${phase}-manifest.json`, 616,
          run.vulnerabilityManifest ?? "4567b9f40c2dc13ead24d5e314563033a890a06b21fd6cb526e7236bfd0f0a72"],
      ]),
    ];
    for (const [name, size, digest] of originals) {
      const bytes = readFileSync(new URL(name, root));
      assert.equal(bytes.length, size, `${run.id}/${name}`);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, `${run.id}/${name}`);
      assert.deepEqual(identities.filter((identity) => identity.name === name),
        [{ name, bytes: size, sha256: digest }], `${run.id}/${name}`);
    }
    for (const database of ["java", "vulnerability"]) {
      assert.deepEqual(readFileSync(new URL(`database-${database}-before-manifest.json`, root)),
        readFileSync(new URL(`database-${database}-after-manifest.json`, root)), `${run.id}/${database}`);
    }
  }
});
