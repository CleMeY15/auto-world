import { readFile, stat } from "node:fs/promises";
import { reviewDetailClaims } from "./detail-review.mjs";
import { extractLeboncoinDomObservation, MAX_SNAPSHOT_BYTES } from "./extract.mjs";

const usage = "Usage: node connectors/leboncoin-spike/replay.mjs SNAPSHOT.json --expected-url URL --expected-id ID [--review]";
const args = process.argv.slice(2);
const review = args.at(-1) === "--review";
if (review) args.pop();
const flags = new Map();
if (args.length === 5) {
  for (let index = 1; index < args.length; index += 2) flags.set(args[index], args[index + 1]);
}
if (args.length !== 5 || flags.size !== 2 || !flags.has("--expected-url") || !flags.has("--expected-id")) {
  process.stderr.write(`${usage}\n`);
  process.exitCode = 2;
} else {
  try {
    const info = await stat(args[0]);
    if (!info.isFile() || info.size > MAX_SNAPSHOT_BYTES) throw new Error("invalid_file");
    const result = extractLeboncoinDomObservation(await readFile(args[0]), {
      expectedUrl: flags.get("--expected-url"), expectedListingId: flags.get("--expected-id"),
    });
    const output = review && result.status === "listing" ? { ...result, review_notes: reviewDetailClaims(result) } : result;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (result.status !== "listing") process.exitCode = 1;
    else if (!result.core_fields_observed) process.exitCode = 2;
    else if (result.issues.length > 0) process.exitCode = 1;
  } catch {
    process.stderr.write("Observation file could not be read or exceeds the replay limit.\n");
    process.exitCode = 2;
  }
}

