import type { ConnectorAdapterPort, ConnectorRunResult } from "@auto-world/connector-sdk";
import {
  createCorpusAdapter,
  createSyntheticHarness,
  SYNTHETIC_CORPUS_MANIFEST,
} from "@auto-world/synthetic-connector/demo";

const adapter: ConnectorAdapterPort = createCorpusAdapter("valid");
const harness = createSyntheticHarness();
const run: Promise<ConnectorRunResult> = harness.run("empty", { invocationKey: "typed-empty" });
const scope: string = SYNTHETIC_CORPUS_MANIFEST.source.scopeId;

// @ts-expect-error unknown scenarios cannot select arbitrary files
createCorpusAdapter("external-file");
// @ts-expect-error fixture metadata is immutable
SYNTHETIC_CORPUS_MANIFEST.fixtureVersion = "changed";
// @ts-expect-error the corpus harness cannot select another source or scope
harness.run("valid", { sourceId: "src_other" });

void adapter;
void run;
void scope;
