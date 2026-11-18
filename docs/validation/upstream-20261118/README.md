# Upstream evidence, 18 November 2026

`original-findings.json` retains every original blocker object, order and
multiplicity from raw run44242537598/attempt1/source2d204. Each enriched row
joins to the actual original vulnerability by role/target/CVE/package/installed
and fixed version, using an ordered queue for duplicate occurrences. No row
is a disposition or an acceptance. Full original ZIP and receipt hashes plus
report hashes are recorded in the matrix. Original non-secret reports remain in
the parent retained evidence, untouched. The independent matrix research also
verified REPORT, manifest and envelope hashes supplied in the user handoff and
full equality with raw44221570845/44112446032/44083655074.

## Actual causes and distinct coverage

243 occurrences, 73 distinct CVEs: PostgreSQL26, OpenSearch166, Redis0,
SeaweedFS2, AWSCLI49. Every original finding has a published fixed version;
none is waived. OS/package layer and package path come from the original scanner,
not inferred from names.

- PostgreSQL26: Gosu's embedded Go1.24.6. Latest official Gosu1.20 still embeds
  that compiler. Existing managed compilation uses1.27.3; its main-component
  lookup remains unavailable. Source binding alone is not vulnerability absence.
- OpenSearch84 and AWSCLI49: Amazon RPM families curl, glibc, libcap, OpenSSL,
  pcre2, Python, pip, rpm and sqlite. Existing managed recipes apply the coherent
  signed11/12 repository transaction. These recipes do not repair old layers.
- OpenSearch82 Java: Jackson2 core/databind44; Jackson3 core/databind23; Guava9;
  LZ4/JLine one each; jsoup/Snappy two each. **76 occur in upstream plugins**,
  absent from the managed minimal profile. Their absence is not a correction or
  qualification of the full upstream distribution. The six remaining library/
  module occurrences are addressed by the existing managed Jackson/Guava patches.
- SeaweedFS2: go-jose4.1.5→4.1.6 and x/net0.61.0→0.62.0, already in the managed
  executable. Main advisory lookup and Rust binary inventory/equivalence remain
  unavailable/unestablished.498/590 are source-lock package counts only.
- Redis: no original blocker; no new coverage inferred from that old report.

The full per-occurrence fixed versions and official sources are in the matrix.
Independent read-only research actually fetched the26 Go advisory pages,36
Amazon CVE pages and maintainer advisory pages for every Java/Seaweed family.
Those online observations establish publication/availability, not an accepted
new image scan or independently authenticated source-to-binary equivalence.

## Current primary-source observations

[Go release history](https://go.dev/doc/devel/release) now lists1.27.4 with
security fixes; do not describe1.27.3 as the current patch. A new compiler would
need its own exact-source/binary/qualification and native-test review.
[AL2023 release11/17](https://docs.aws.amazon.com/linux/al2023/release-notes/relnotes-2023.12.20261117.html)
exists; its changes do not update the package families of these133 old RPM
occurrences. New packages in a candidate must still receive a complete scan.

[Official OpenSearch3.9 tag metadata](https://hub.docker.com/v2/repositories/opensearchproject/opensearch/tags/3.9.0)
exposes a rebuild15November. Raw registry index/platform/config bytes here are
hash-linked by `provenance.json`; no access token is stored. The platform base
history declares AL2023.12.20261112, but the application layer also differs.
Image labels do not authenticate its source commit or establish unchanged JDK.
The stopped-image JDK prerequisite in the reviewed plan precedes execution.

[OpenSearch3.10](https://github.com/opensearch-project/OpenSearch/releases),
[Seaweed4.54](https://github.com/seaweedfs/seaweedfs/releases/tag/4.54) and
[AWSCLI2.41](https://raw.githubusercontent.com/aws/aws-cli/v2/CHANGELOG.rst)
are available alternatives, not selected or qualified here. Seaweed4.54 adds
another Rust helper (`weed-vector`), requiring additional complete coverage.
PostgreSQL17.12-alpine3.24 still resolves to the original selected bytes.

Support dates, admission and signer/source/binary equivalence remain unestablished.
No publisher, Nexus transfer, public deployment or real data is authorized.
