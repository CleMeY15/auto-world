# Full OpenSearch distribution comparison inputs

TASK-0005/A, implementation lane for PR257, Codex gpt-6.2-astra / ultra, isolated local checkout from 6e1609cfa0f2f366d5d66ddd3bef4e229d4ab4db. Scope and acceptance follow the [approved V3 contract](../../../roadmap/plans/TASK-0005-opensearch-3.10-comparison.md), SHA-256 e657b0d95d050c53b4afe53838e0f986dbe2cd61f99915fe3b6a797c5a9f7a5f. This lane owns the inventory reader, its Node tests and these inputs. The parent owns transport, command eligibility, source/main qualification and review.

The three historical JSON files are exact archive members under data-foundation-audit/ in artifact 14436050679 of push 44321947040, attempt 1, main 5d0599cdeb3589b0c2ab0e42778769c9ad771b32. The archive SHA-256 is 838d34d5ecbfc9b423342e47e39120be6ccad3908cbf8809a880cce074e1ea0b. The receipt retains the original 110 ordered blockers. The other seven files are the approved public research bytes. The earlier 3.9 OCI objects live in the adjacent upstream-20261118 directory.

The source evidence identifies the core tag at b9f09249b4a9922f0d0bc5bb8f62f90cf95e5eea and the maintainer build manifests at e9a16a55b7c3973736992477a7064e7af4bd8d06. Package metadata in matched-82.json retains the enclosing JAR and the evidence for each coordinate, including Maven Central byte correspondence for Snappy. Source-to-binary reproducibility and admission remain unqualified.

The local check is `node --test tests/scanner-official-opensearch-inventory.test.mjs`. It replays the original old distribution and uses synthetic candidate reports. Only the parent CI run can measure actual candidate coverage and policy. Rollback removes the additive comparator and its references while preserving the historical failure.

## Audit integration

Await `buildOpenSearchComparison` with parsed, authenticated pairs and the ordered per-role blocker arrays from the unwaived evaluator. Role-free evaluator objects and checkpoint objects tagged `opensearch` or `opensearch-candidate` respectively are accepted. Use `openSearchHistoricalInputsMatch(inputs)` on the current authenticated scanner and database payload records. Passing the same records as the optional `currentInputs` field adds both sides of each identity comparison to the delta and checks the supplied boolean. With just the required boolean, per-file drift detail stays in the caller's receipts. The transport retains exact current report byte hashes, command evidence, cleanup, and frozen-input checks.

Package and finding deltas use indices into the ordered rows on each side. Rows retain the original result and occurrence indices. Each package points to its CycloneDX component index. Historical package indices use the ordered packages in the archived JSON. Unmatched rows, unmapped candidate findings and undetected static JARs remain visible. Absence of a scanner advisory cannot establish remediation. The floor check is independent of advisory visibility.
