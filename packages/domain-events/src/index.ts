export const workspaceBoundary = {
  name: "@auto-world/domain-events",
  kind: "package",
  status: "active",
} as const;

export {
  checkObservationChangeEvidence,
  parseDomainEventId,
  parseObservationChangeEvent,
} from "./parsers.js";

export type {
  DomainEventId,
  DomainEventTypeV1,
  ObservationChangeEventV1,
  ObservationChangeEvidenceV1,
} from "./types.js";
