import { COLD_LOAD_PIN } from "./cold-load-policy.mjs";

// Independently reviewed original bytes; parsed evidence cannot choose its own pins.
export const POSTGRES_RUNTIME_RESTORE_PIN = Object.freeze({
  ...COLD_LOAD_PIN,
  purpose: "POSTGRES_RUNTIME_SQL_RESTORE",
  priorColdLoad: Object.freeze({
    file: "/var/tmp/aw-cl-NqQrTO/receipt.json",
    size: 59_779,
    sha256: "a686e2bece45448dd81778eea03083519795bcc49d72c58228fed048ea1f9411",
    recipeRevision: "cf702598081863335bd36801713adc5022541d73",
    executionId: "local-cold-load-35ae05a70312ef7fedfe5105",
    nonce: "35ae05a70312ef7fedfe5105",
  }),
  runtimePolicy: Object.freeze({
    file: "infra/postgres-image/candidate-runtime.json",
    size: 4_447,
    sha256: "2ce820b577674c127dbf8fa4c5cc0cbfc1957234b432a34efb1f9d68f063dbb5",
  }),
  auditDirectory: "/home/autoworld/postgres-candidate-remote-audit-36673766454/reports",
  auditReceiptSha256: "93c7a582105c7e56aaa5091a4d589cb701ecebc64a9527d8eff40d684252cfbb",
  auditRecipeRevision: "5186a241f9ab28add4098648aa4bc56d36b5e6dc",
  auditRunId: "36673766454",
});

export const postgresRuntimeRestoreLimits = Object.freeze({
  supervisorMs: 20 * 60_000,
  engineMs: 15 * 60_000,
  cleanupMs: 2 * 60_000,
  daemonCleanupMs: 25_000,
  receiptBytes: 128 * 1024,
  auditGrantMaxAgeMs: 5_000,
  dumpBytes: 16 * 1024 ** 2,
});
