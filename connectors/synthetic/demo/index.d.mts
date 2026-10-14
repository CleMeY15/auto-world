import type {
  ConnectorAdapterPort,
  ConnectorMode,
  ConnectorPorts,
  ConnectorRunLimits,
  ConnectorRunResult,
} from "@auto-world/connector-sdk";
import type { SourceRegistry } from "@auto-world/source-registry";
import type { TaxonomyReleaseReferenceV1, TaxonomyReleaseV1 } from "@auto-world/vehicle-taxonomy";

export interface SyntheticCorpusFile {
  readonly name: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface SyntheticCorpusManifest {
  readonly schemaVersion: 1;
  readonly fixtureVersion: "synthetic-search-v1";
  readonly source: {
    readonly sourceId: "src_sdk_synthetic";
    readonly territory: "FR";
    readonly acquisitionMethod: "feed";
    readonly scopeId: "scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414";
  };
  readonly files: Readonly<Record<string, SyntheticCorpusFile>>;
}

export type SyntheticScenarioName =
  | "contradictory"
  | "empty"
  | "malformed"
  | "partialFull"
  | "partialInterrupted"
  | "transientFailure"
  | "valid"
  | "withdrawnBaseline"
  | "withdrawnDelta";

export type SyntheticDescriptionScenarioName =
  | "descriptionBaseline"
  | "descriptionDelta"
  | "descriptionOmittedDelta"
  | "descriptionPagination";

export interface SyntheticDescriptionCorpusManifest {
  readonly schemaVersion: 2;
  readonly fixtureVersion: "synthetic-description-v2";
  readonly taxonomyRelease: TaxonomyReleaseReferenceV1;
  readonly source: SyntheticCorpusManifest["source"];
  readonly files: Readonly<Record<string, SyntheticCorpusFile>>;
}

export interface SyntheticRunOverrides {
  readonly invocationKey?: string;
  readonly limits?: Partial<ConnectorRunLimits>;
  readonly mode?: ConnectorMode;
}

export interface SyntheticHarness {
  readonly alerts: readonly Readonly<{ code: "synthetic_connector_circuit_open"; count: 1 }>[];
  readonly ports: ConnectorPorts;
  registry: SourceRegistry;
  readonly storage: { snapshot(): unknown };
  readonly telemetry: readonly unknown[];
  readonly trace: readonly string[];
  run(
    scenarioName?: SyntheticScenarioName,
    overrides?: SyntheticRunOverrides,
    signal?: AbortSignal,
  ): Promise<ConnectorRunResult>;
}

export interface SyntheticDescriptionHarness extends Omit<SyntheticHarness, "run"> {
  run(
    scenarioName?: SyntheticDescriptionScenarioName,
    overrides?: SyntheticRunOverrides,
    signal?: AbortSignal,
  ): Promise<ConnectorRunResult>;
}

export const SYNTHETIC_CORPUS_MANIFEST: SyntheticCorpusManifest;
export const SYNTHETIC_SCENARIOS: Readonly<Record<SyntheticScenarioName, readonly Readonly<Record<string, unknown>>[]>>;
export const SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST: SyntheticDescriptionCorpusManifest;
export const SYNTHETIC_DESCRIPTION_SCENARIOS: Readonly<Record<SyntheticDescriptionScenarioName, readonly Readonly<Record<string, unknown>>[]>>;
export const SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE: TaxonomyReleaseReferenceV1;
export const SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE: TaxonomyReleaseV1;
export function createCorpusAdapter(scenarioName: SyntheticScenarioName, trace?: string[]): ConnectorAdapterPort;
export function createDescriptionCorpusAdapter(scenarioName: SyntheticDescriptionScenarioName, trace?: string[]): ConnectorAdapterPort;
export function createSyntheticHarness(options?: Readonly<Record<string, unknown>>): SyntheticHarness;
export function createSyntheticDescriptionHarness(options?: Readonly<Record<string, unknown>>): SyntheticDescriptionHarness;
export function parseSyntheticDescriptionPageV2(input: unknown): Readonly<{
  taxonomyRelease: TaxonomyReleaseReferenceV1;
  sdkDraft: Readonly<{ items: readonly Readonly<Record<string, unknown>>[] }>;
  descriptions: readonly Readonly<Record<string, unknown>>[];
}>;
export function inspectSyntheticDescriptionRaw(bytes: Uint8Array, descriptor: SyntheticCorpusFile): ReturnType<typeof parseSyntheticDescriptionPageV2>;
