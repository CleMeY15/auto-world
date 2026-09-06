export const workspaceBoundary = {
  name: "@auto-world/connector-sdk",
  kind: "connector-sdk",
  status: "active",
} as const;

export { runConnector, systemScheduler } from "./engine.js";
export {
  decodeJsonPage,
} from "./json.js";
export {
  parseAdapterFetchResult,
  parseConnectorRunRequest,
  parseMappedPageDraft,
  parseStoreResult,
} from "./validation.js";
export {
  reduceAttemptCompletion,
  reduceAttemptReservation,
} from "./runtime-state.js";
export type * from "./types.js";
