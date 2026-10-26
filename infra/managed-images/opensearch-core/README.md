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
Gradle statuses, original logs and natively generated JUnit XML. The targeted upstream checksum
files are generated during CI; their new JAR bytes and success are not asserted
in advance. Full core REST tests use the upstream `rest-api-spec` selection.
The upstream [settings](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/settings.gradle#L171-L173)
rename library projects: the four x-content task locators therefore use
`:libs:opensearch-x-content`. The physical directory stays `libs/x-content`,
including its `licenses` and `build/test-results/test` directories. Other selected
projects keep their original names. JUnit evidence retains the task-specific
directories for `test`, `yamlRestTest` and `internalClusterTest`.

`test-output-capture.gradle` applies only to the three
`:server:internalClusterTest` invocations. For that task it asks Gradle not to
duplicate standard output/error inside JUnit XML, then preserves every public
`TestOutputEvent` message in a separate natural descriptor/stream file. It does
not rewrite XML, split streams or infer an origin that Gradle did not provide.
Each `unfixed`, `seeded-fixed` and `full` phase has a fresh directory under
`test-output/`, an indexed SHA256 manifest and an atomically published
`complete.status`. A malformed field, lifecycle/identity inconsistency, late
event, I/O failure, open writer or exceeded descriptor/event/file/byte bound
removes completion, writes `capture-invalid.status` where the directory identity
is still owned, and emits a fixed integrity sentinel. `build-core.sh` rejects
that sentinel independently of the expected failing RED task exit. The two
controls produce one native XML each; the full invocation produces three native
class XML files. Other test tasks keep their existing report configuration.
After each Gradle process, `verify-test-output-manifest.gradle` uses the same
authenticated wrapper and its bundled `JsonSlurper` to validate the fixed
schema and phase/task identity, exact regular-file closure, descriptor/parent
graph, UTF-8 streams, byte/event/file totals and every stream SHA256 before the
phase gate can pass. It accepts no caller-supplied root, task or output path.

Before upstream tests, `verify-test-output-capture.sh` runs the exact init source
concatenated with an inert fixture tail through the authenticated Gradle 9.7.1
wrapper and builder JDK. A composite-build scope probe first proves that the init
registers capture only in the root build while an included build without the
selected server task sees the same valid phase and remains untouched. It then
covers direct event/lifecycle/boundary cases plus
actual successful and expected-failing `Test` task `afterExecute` finalization.
The fixture has no external dependency and runs no candidate service or image.
Only its fixed summary, original Gradle logs/statuses and two valid integration
captures are exported; negative-case directories remain private to the builder.
Each direct, manifest-validator and integration subprocess publishes its original
log and exit code before result checks; their fixed public locations start as
`NOT_RUN`. A fixed-enum `last-subcase.status` records
the last running, passed or failed guard without copying raw paths or errors into
the outer fixture log. Partial exits remove the owned temporary negative manifest
tree while retaining any already-validated positive capture and the original
subprocess evidence.
This native fixture is Linux CI evidence and is not executed by the Windows Node
regression test. The current Windows run has 11 cases: seven pass and four
Linux-only cases remain explicitly skipped.

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

The snapshot test-source adjustment is limited to OpenSearch's mock repository
fixture at pinned commit `4ee42a94e87f66fbf1e62a9871b1b87f91e02472`. It suppresses only the
no-argument `listBlobs()` fault sentinel at the exact `snapshot_shard_paths`
container when a default-false setting is enabled by
`testSnapshotFileFailureDuringSnapshot`. Prefix listings, reads, writes, child
paths, other paths and the fixture's default behavior retain fault injection;
production repository code is unchanged. The original failure is retained in
[main run 40240788182](https://github.com/CleMeY15/auto-world/actions/runs/40240788182).

The build first applies the test-class patch and requires a deterministic
single-test failure with the fixed scope-control marker while `MockRepository`
is pristine. It then applies the separately authenticated mock-fixture patch,
requires the same scope control plus the original failed-seed test to pass, and
finally forces the complete selected internal-cluster suite with an ordinary
random seed. Control XML and logs stay under `controls/`; only the final 16 XML
reports and at least 1,735 test cases populate `junit/` and its release count.
The phase-specific natural output streams remain under `test-output/` and are
required before any of those causal/full gates can pass.

On 25 October 2026 the three initial Windows fixture executions failed before
functional validation: Git Bash could not fork (`0xC0000142`, resource temporarily
unavailable), and each invocation timed out. No Windows repair was attempted.
Those three execution cases are explicitly Linux-only platform exclusions,
new to this increment. The five contract/syntax cases execute locally. All eight
must pass on Linux with no exclusion before implementation acceptance.

The current snapshot-scope increment expands that file to ten cases. Six
contract/syntax cases execute on Windows and four functional fixture cases keep
the explicit Windows exclusion above; all ten must execute and pass on Linux.

Run 40203365441 stopped in base preparation with exit127. Its bounded stderr
tail does not retain the originating command-error line. The retained M1 OS
inventory for this exact base includes GNU tar1.34 but no findutils, BusyBox or
Toybox; the recipe's first inventory previously invoked `find`. This strongly
supports the missing-command diagnosis without claiming the original error
text was observed. The inventory now uses the existing GNU tar, and the strict
empty-plugin check uses Bash globbing including hidden entries. No package was
added.

Run 40206325488 completed base preparation and exported its evidence, establishing
the GNU tar/DNF correction. Gradle preparation then failed because the original
`:libs:x-content:updateShas` locator did not exist. No upstream JUnit results or
core runtime image were produced. The four library task locators now use the
upstream's renamed project; actual Gradle/test/image success still requires CI.
