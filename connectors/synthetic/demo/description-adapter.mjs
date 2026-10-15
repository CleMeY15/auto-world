import "./guard.mjs";

import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { parseSyntheticDescriptionPageV2 } from "./description.mjs";
import {
  SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST,
  SYNTHETIC_DESCRIPTION_SCENARIOS,
} from "./manifest.mjs";

function fixtureError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireNotAborted(signal) {
  if (signal.aborted) throw fixtureError("synthetic_fixture_cancelled");
}

export function createDescriptionCorpusAdapter(scenarioName, trace = []) {
  if (!Object.hasOwn(SYNTHETIC_DESCRIPTION_SCENARIOS, scenarioName)) {
    throw fixtureError("synthetic_fixture_scenario_unknown");
  }
  const scenario = SYNTHETIC_DESCRIPTION_SCENARIOS[scenarioName];
  return {
    async fetchPage(input) {
      trace.push(`fixture.fetch:${scenarioName}:${input.pageOrdinal}:${input.attempt}`);
      requireNotAborted(input.signal);
      const step = scenario[input.pageOrdinal];
      if (!step) return { success: false, failure: { kind: "terminal" } };
      const descriptor = SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.files[step.file];
      if (descriptor.byteLength > input.maxResponseBytes) return { success: false, failure: { kind: "terminal" } };
      const handle = openSync(new URL(`./corpus/${descriptor.name}`, import.meta.url), "r");
      let bytes;
      try {
        const bounded = new Uint8Array(descriptor.byteLength + 1);
        let offset = 0;
        while (offset < bounded.byteLength) {
          requireNotAborted(input.signal);
          const bytesRead = readSync(handle, bounded, offset, bounded.byteLength - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        bytes = bounded.subarray(0, offset);
      } finally {
        closeSync(handle);
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== descriptor.byteLength || sha256 !== descriptor.sha256) {
        throw fixtureError("synthetic_fixture_digest_mismatch");
      }
      return { success: true, page: {
        pageIdentity: `${SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.fixtureVersion}:${descriptor.name}`,
        bytes,
        nextCursor: step.nextCursor,
        complete: step.complete,
      } };
    },
    async mapPage(input) {
      trace.push(`fixture.map:${scenarioName}`);
      requireNotAborted(input.signal);
      const parsed = parseSyntheticDescriptionPageV2(input.decoded);
      requireNotAborted(input.signal);
      return parsed.sdkDraft;
    },
  };
}
