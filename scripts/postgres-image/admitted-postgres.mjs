import { readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import {
  postgresAdmissionFailureDiagnostic,
  runPostgresSupportedSession,
  validatePostgresAdmissionFailureDiagnostic,
  validatePostgresSupportedSessionInput,
  validatePostgresSupportedSessionResult,
} from "./admission-broker.mjs";

const INPUT_CAP = 256;

export {
  postgresAdmissionFailureDiagnostic,
  runPostgresSupportedSession,
  validatePostgresAdmissionFailureDiagnostic,
  validatePostgresSupportedSessionInput,
  validatePostgresSupportedSessionResult,
};

async function main() {
  let input;
  let intent = "SERVICE";
  try {
    const raw = Buffer.alloc(INPUT_CAP + 1);
    let length = 0;
    while (length <= INPUT_CAP) {
      const count = readSync(0, raw, length, raw.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length < 2 || length > INPUT_CAP) throw new Error("postgres_admission_arguments_invalid");
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(0, length)));
    intent = typeof input?.intent === "string" ? input.intent : intent;
    const result = await runPostgresSupportedSession(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const diagnostic = postgresAdmissionFailureDiagnostic(error, intent);
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
