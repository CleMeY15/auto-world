# OpenSearch core diagnostic recipe

Build context is the repository root. Targets are `runtime` and `evidence` in
`../Dockerfile.opensearch-core`. Root CI owns tool audits, builds and image scans.
No local Java/Docker execution is needed for the preparation regression tests.

The public Git source is fixed at commit
`4ee42a94e87f66fbf1e62a9871b1b87f91e02472`. `fixtures/libs.versions.toml` is an
inert, exact 14,417-byte copy of that commit's catalogue for preparation tests;
it is never copied into a build. `jackson.patch` shows the entire four-key delta.
The shell preparation verifies original and resulting full-file SHA256 values.
Fixture source: [upstream catalogue](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/gradle/libs.versions.toml),
under the upstream project's Apache-2.0 licence.

`build-core.sh` authenticates the upstream wrapper, prepares the new checksum
files with `updateShas`, and keeps licence/third-party checks enabled. It retains
Gradle statuses, original logs and JUnit XML. The targeted upstream checksum
files are generated during CI; their new JAR bytes and success are not asserted
in advance. Full core REST tests use the upstream `rest-api-spec` selection.

Target `runtime` rejects a nonzero `build.exit-code`. Target `evidence` exports
text/XML under `opensearch/build/` and `opensearch/base/`, including failed Gradle
results, without exporting sources, candidate binaries or archives. Preparation
failures before Gradle remain hard build failures visible in Buildx logs.

The base's complete JDK is moved outside the replaced tree and restored without
changing its contents, links, modes or ownership. Inventories cover those fields
with GNU tar's verbose text listing and SHA256 of its entire deterministic GNU
tar stream. Only mtime is normalized to epoch zero; timestamp preservation is
not claimed. The stream is never stored as an archive. The final image retains `/managed-evidence/`,
including `jdk-restored.txt`, `runtime-java-version.txt` and
`runtime-java-properties.txt`; CI can retrieve them from its newly owned image.
The runtime target also prints the actual Java version and requires Java 21+.
The evidence target is independent of the final runtime gate and contains the
base/preparation evidence, not an assertion that restoration/runtime succeeded.

Actual CI must still establish compiler eligibility, Gradle/dependency checks,
all upstream test results/counts, final runtime behavior and complete image
audits. These inputs do not publish or admit an image or activate support.

On 25 October 2026 the three initial Windows fixture executions failed before
functional validation: Git Bash could not fork (`0xC0000142`, resource temporarily
unavailable), and each invocation timed out. No Windows repair was attempted.
Those three execution cases are explicitly Linux-only platform exclusions,
new to this increment. The five contract/syntax cases execute locally. All eight
must pass on Linux with no exclusion before implementation acceptance.

Run 40203365441 stopped in base preparation with exit127. Its bounded stderr
tail does not retain the originating command-error line. The retained M1 OS
inventory for this exact base includes GNU tar1.34 but no findutils, BusyBox or
Toybox; the recipe's first inventory previously invoked `find`. This strongly
supports the missing-command diagnosis without claiming the original error
text was observed. The inventory now uses the existing GNU tar, and the strict
empty-plugin check uses Bash globbing including hidden entries. No package was
added. A new real CI run is still required to establish this correction.
