import "./guard.mjs";

export const SYNTHETIC_CORPUS_MANIFEST = Object.freeze({
  schemaVersion: 1,
  fixtureVersion: "synthetic-search-v1",
  source: Object.freeze({
    sourceId: "src_sdk_synthetic",
    territory: "FR",
    acquisitionMethod: "feed",
    scopeId: "scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414",
  }),
  files: Object.freeze({
    contradictory: Object.freeze({ name: "contradictory.json", byteLength: 350, sha256: "3bed08fb3b69e29be670c911576efb41b58ae948910e1d277f138490ce3b39b6" }),
    empty: Object.freeze({ name: "empty.json", byteLength: 13, sha256: "e813d564bccbeefe1db875d1c9abb55d63c52b639acc61134a5f1d19cc489b67" }),
    malformed: Object.freeze({ name: "malformed.json", byteLength: 104, sha256: "9262de3d264e7a50e98131c3a9971a294270df241c24de1e4db448f050ae72c1" }),
    partialFinal: Object.freeze({ name: "partial-final.json", byteLength: 170, sha256: "03c4f78831b52bb3b9e7a4fb2897a33ea9c3e898df45451162970e9d92c14340" }),
    partialFirst: Object.freeze({ name: "partial-first.json", byteLength: 179, sha256: "8b3769f01cc7e69b1a56f501d65bd2f135ad8c2a17896aacd2cdae6b3127449a" }),
    valid: Object.freeze({ name: "valid.json", byteLength: 255, sha256: "0c5d016067bccdd96dadd8f0663b36223fc80fe1f33ea152316e9833dc84c9ec" }),
    withdrawnBaseline: Object.freeze({ name: "withdrawn-baseline.json", byteLength: 258, sha256: "e344ff16fe58227b8b630aa081854f4e7aa64be7f797d24e202849fd4e24073f" }),
    withdrawnDelta: Object.freeze({ name: "withdrawn-delta.json", byteLength: 78, sha256: "925ec9b2464ff543a1301a9a7a422c8da8ab6961835cdfae1a65e824491d46bc" }),
  }),
});

const pages = (...steps) => Object.freeze(steps.map((step) => Object.freeze(step)));

export const SYNTHETIC_SCENARIOS = Object.freeze({
  contradictory: pages({ file: "contradictory", complete: true, nextCursor: "fixture-contradictory-v1" }),
  empty: pages({ file: "empty", complete: true, nextCursor: "fixture-empty-v1" }),
  malformed: pages({ file: "malformed", complete: true, nextCursor: null }),
  partialFull: pages(
    { file: "partialFirst", complete: false, nextCursor: "fixture-partial-page-2" },
    { file: "partialFinal", complete: true, nextCursor: "fixture-partial-v1" },
  ),
  partialInterrupted: pages(
    { file: "partialFirst", complete: false, nextCursor: "fixture-partial-page-2" },
    { failure: "terminal" },
  ),
  transientFailure: pages({ failure: "transient" }),
  valid: pages({ file: "valid", complete: true, nextCursor: "fixture-valid-v1" }),
  withdrawnBaseline: pages({ file: "withdrawnBaseline", complete: true, nextCursor: "fixture-withdrawn-baseline-v1" }),
  withdrawnDelta: pages({ file: "withdrawnDelta", complete: true, nextCursor: "fixture-withdrawn-delta-v1" }),
});
