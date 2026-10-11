import type {
  ConnectorAdapterPort,
  ConnectorMode,
  ConnectorPorts,
  ConnectorRunLimits,
  ConnectorRunResult,
} from "@auto-world/connector-sdk";
import type { SourceRegistry } from "@auto-world/source-registry";

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

export const SYNTHETIC_CORPUS_MANIFEST: SyntheticCorpusManifest;
export const SYNTHETIC_SCENARIOS: Readonly<Record<SyntheticScenarioName, readonly Readonly<Record<string, unknown>>[]>>;
export function createCorpusAdapter(scenarioName: SyntheticScenarioName, trace?: string[]): ConnectorAdapterPort;
export function createSyntheticHarness(options?: Readonly<Record<string, unknown>>): SyntheticHarness;
