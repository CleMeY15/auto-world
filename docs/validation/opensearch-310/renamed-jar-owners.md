# Physical JAR owners between OpenSearch 3.9 and 3.10

PR257 research, 18 November 2026. Codex gpt-6.2-astra / ultra, isolated checkout at `6fb9d12315c3d589828c354e4b3592bbf22461b8`. The [schema-1 reference](renamed-jar-owners.json) is 195,019 bytes, SHA-256 `1221378495abb4d59a7be667029a305fc5bd0df5ea05e7a58168947d814f71b3`. Scope is the full Linux/amd64 distribution and the physical owners detected by the historical Java report. Scanner execution and operational acceptance belong to the parent under the [V3 plan](../../../roadmap/plans/TASK-0005-opensearch-3.10-comparison.md).

| Historical owners absent by exact path | Old owners | Old package occurrences | Of which owners outside matched-82 | Their package occurrences |
| --- | ---: | ---: | ---: | ---: |
| Replacement with per-copy coordinate evidence | 320 | 374 | 280 | 298 |
| Known physical successor with ambiguous publication version | 10 | 10 | 10 | 10 |
| Standalone SQL copy removed | 1 | 1 | 1 | 1 |
| Total | 331 | 385 | 291 | 309 |

## Offline audit procedure

1. Use the [archived 3.9 originals](README.md). Group all 988 Java package rows by the outer path ending at the first `.jar`, retaining the original package index and full inner path. Join the 890 distinct owners to [jar-paths.json](jar-paths.json) by exact path. The 559 surviving paths account for 603 rows. Every remaining owner occurs once across the three arrays. The coordinate names in each proved replacement reproduce the old owner's complete multiset.
2. Verify the sizes and SHA-256 of the seven compressed layers in manifest order (1,160,663,754 bytes total). Stream-decompress each through SHA-256 to EOF, including tar padding, and compare to the [config DiffID](3.10.0-config.json) at that index. Check tar names for whiteouts, duplicate JAR paths and link entries ending in `.jar`. All 949 paths were unique regular files in layer 3 (zero based), digest `sha256:4b22fdab5b5d70fe865dfd695d8ea0511b3e787942d0eb8b4735f2d1e56e1d18`, DiffID `sha256:06f01e1cc3d2aa861ff7ddac38a05afffce325a252b83dfd95ae7fbcc77d7117`. Their set equals the pinned path inventory.
3. Read each outer JAR in memory, hash its bytes, record size and path, and memoize ZIP metadata by SHA-256. There were 571 distinct outer contents and one additional nested JAR content. Inspect main manifests (unfold continuation lines), all embedded Maven properties, project POMs (including parent group/version), and nested JARs. Maven dependency declarations alone do not establish an embedded copy. Preserve distinct owners even for identical bytes. The bounded successful pass used one process, a five-minute timeout, 1,900,000 KiB virtual memory limit, 512 MiB maximum outer member (largest observed 304,246,626 bytes), 192 MiB nested member, four nesting levels, under 100,000 ZIP entries per archive and under 4 MiB per metadata member. Local memoized metadata occupied 896,162 bytes. The first pass stopped at the initial 192 MiB outer limit.
4. Search the candidate inventory by artifact and inspect the same directory, classifier, Maven group and aggregate membership. Netty native classifiers have separate paths. Jackson 2 and 3 coexist in SQL and Security under distinct groups. A matching coordinate in another plugin cannot substitute for a lost copy. Validate each candidate path/size/digest and intersect its package evidence with the historical owner's coordinates. Compare every applicable matched-82 anchor, including Snappy's prior Central byte correspondence, against that selection. Preserve JAR identity and every one of the 37 coordinate/version pairs in the [OpenSAML witness](opensaml-candidate-maven.json), SHA-256 `42618c9c2f56573088d487ccfff064756b1d62c85d5be64c08e0332022c82146`.

Among the 374 validated occurrences, 235 have matching embedded Maven properties. These include all five Notifications Core SPI packages, all three Nimbus packages, both JCTools packages in each of five Netty Common copies and both embedded libraries in Job Scheduler SPI. Another 83 use artifact-specific manifest identity and version. For OpenSearch these are the matching group, project title, implementation version and source origin. For Lucene use the group, subproject and specification version plus the implementation version prefix. For ASM, Bouncy Castle and Reactor use the corresponding bundle identity and implementation version. The archived OpenSearch version catalog (14,451 bytes, SHA-256 `dac447554c4a6e66e5477ef315ce0025f5cd9eed23dfe0ea8b69abfdea4d72c5`) corroborates the ASM and Bouncy Castle coordinates. The Scala Jackson module retains the historical scanner name declared in its manifest, alongside its vendor and implementation version.

## Publication evidence and uncertainty

The remaining 56 validated occurrences use exact Central JAR SHA-256 correspondence. For the following artifact IDs use the group and version from the row. Replace dots in the group with slashes and append `/<artifact>/<version>/<artifact>-<version>.jar.sha256` to the Maven repository root. Each checked response was exactly the 64 lowercase ASCII hex digits in the row's JAR digest, without a newline. This fully specifies the response bytes and their hash. Checks were targeted by historical coordinate and ambiguous or absent internal identity, once per distinct publication. The committed table is usable offline. [Maven Central](https://repo.maven.apache.org/maven2/)

- Minimal manifests or differing group: alerting-spi, common-utils, opensearch-ml-client, opensearch-ml-common, opensearch-security-spi.
- Internal project titles differing from published artifacts: opensearch-agent-bootstrap, opensearch, opensearch-agent-policy, opensearch-launchers, opensearch-plugin-cli, aggs-matrix-stats-client, lang-mustache-client, opensearch-scripting-painless-spi, mapper-extras-client, opensearch-rest-client, reindex-client, parent-join-client, percolator-client, rank-eval-client, autotagging-commons-spi, rule-framework, transport-grpc-spi, transport-netty4-client, opensearch-geospatial.

For the Remote Metadata SDK, the same procedure returned identical digest bytes for three publication labels per artifact. Each 3.9 CycloneDX component's SHA-1 also equals Central's 3.10.0.0 JAR SHA-1 (40 ASCII hex digits from the analogous `.sha1` URL). The archives have only a manifest-format version. Each unresolved row names the same-directory candidate first and gives its size, digest, layer and the other physical copies. A scanner can still identify the historical version from identical contents. Preserve these rows as unresolved for a unique version obligation; a package reported elsewhere cannot discharge them.

| org.opensearch artifact | Copies | Attested publication labels with identical SHA-256 | Historical and 3.10 publication SHA-1 |
| --- | ---: | --- | --- |
| opensearch-remote-metadata-sdk | 4 | 3.7.0.0, 3.9.0.0, 3.10.0.0 | 103bad1d49215eab3dbfcef3b6f179a11688ba23 |
| opensearch-remote-metadata-sdk-aos-client | 2 | 3.3.0.0, 3.9.0.0, 3.10.0.0 | 2c362c4b5f4e41053ba053cf814d6434efa5398d |
| opensearch-remote-metadata-sdk-ddb-client | 2 | 3.7.0.0, 3.9.0.0, 3.10.0.0 | f9655b92f29dc3fa08debe7cfdafe488f5fc0a42 |
| opensearch-remote-metadata-sdk-remote-client | 2 | 3.7.0.0, 3.9.0.0, 3.10.0.0 | e8d9499ea97ba23baa71f08689db78881397c221 |

## SQL standalone removal

The historical SQL component's SHA-1 is `25ea2e8b0c338a877313bd4672d3fe056ea78f0d`. The published jsr305 3.0.2 JAR matches it, is 19,936 bytes and has the SHA-256 recorded in `removed`. All 108 SQL JARs were compared by content and Maven metadata. Three standalone copies survive in ML, Notifications and Performance Analyzer, and two embedded copies survive in Security Analytics Commons and OpenSAML. The JSON identifies all five by physical path, size, layer and SHA-256. [Published jsr305 JAR](https://repo.maven.apache.org/maven2/com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar)

The SQL Guava upgrade is independently visible in the historic and candidate bytes and the archived release notes (62,051 bytes, SHA-256 `d0c49f2908bbfc7cc0fa8efc28cfabac8d6bc2b317636b21a49158bd2abdb7c5`, SQL change 5918). The old Guava JRE runtime variant explicitly requires jsr305 3.0.2. The new JRE runtime variant drops that edge and declares JSpecify. SQL ships jspecify-1.0.1.jar, 3,064 bytes, SHA-256 `070d75f261fe4c5b8202508366715f7f2d4660f88c8ef7e6d3575e48c9683b66`. This evidence supports removal of the standalone SQL owner. The scope excludes claims about all relocated annotation classes or the cause of every dependency-resolution decision.

| Official Guava metadata | Bytes | SHA-256 |
| --- | ---: | --- |
| [33.3.0-jre Gradle module](https://repo.maven.apache.org/maven2/com/google/guava/guava/33.3.0-jre/guava-33.3.0-jre.module) | 7,499 | d5621eac0e19eea7dd218eb354c47263e7ee693e9de3bad25054b704649deb1c |
| [33.7.2-jre Gradle module](https://repo.maven.apache.org/maven2/com/google/guava/guava/33.7.2-jre/guava-33.7.2-jre.module) | 7,121 | 7170b42bdc6a9cbfd78a2142d6dfb423473503c584bedbae85d24359dca5029f |
| [33.3.0-jre POM](https://repo.maven.apache.org/maven2/com/google/guava/guava/33.3.0-jre/guava-33.3.0-jre.pom) | 9,304 | d3cbd0518eafab6a978bb6ca3ff98333ddfe736784b6bfdc499543f0c9723f84 |
| [33.7.2-jre POM](https://repo.maven.apache.org/maven2/com/google/guava/guava/33.7.2-jre/guava-33.7.2-jre.pom) | 9,732 | 5d1501a97230f90df54ea33164831a61c6714a8b2a4c6a04e90bb729581bbabc |

The existing historical inventory suite passed 19/19 in this checkout. This static reference measures physical evidence. Current scanner coverage, policy, source/main qualification and admission remain with the operational lane. Revert this evidence commit together with any dependent reader pin if the reference is superseded.
