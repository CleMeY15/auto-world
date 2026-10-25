import { PRIVATE_COPY_PIN } from "./private-copy-policy.mjs";

// Independently reviewed PR119/120 bytes. Parsed receipts never select these expectations.
export const COLD_LOAD_PIN = Object.freeze({
  original: PRIVATE_COPY_PIN,
  directory: "/home/autoworld/pg-private-reimport-BW3BmA",
  copyRecipeRevision: "2eda0dbf031d6eb3e1f1c486c68facf326a62e76",
  copyExecutionId: "local-copy-bc66fe4853e3a67e0a3497cb",
  copyReceiptFile: "/mnt/c/Users/Administrator/Documents/ChatGPT/Auto-world/.omx/private-archive/"
    + "postgres-0045bdab5483336d-copy-bc66fe4853e3a67e0a3497cb/copy-receipt.json",
  copyReceiptBytes: 26_562,
  copyReceiptSha256: "764c1c7d1b2f50b0c66fba894cb31e892134ab8327e2f3e56df921180989235d",
  imageId: "sha256:8453b2e3ea76734a5c5df6cd8bf17799880c4ed974e2e136dbf849254f96cdda",
  tag: "aw-postgres-gosu:b68df0be74e29101c808d0ab",
  node: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node",
  policyFile: "infra/postgres-image/candidate-remote.json",
});
