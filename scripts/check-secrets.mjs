import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findHighConfidenceSecrets } from "./secret-patterns.mjs";

const secretlintBinary = fileURLToPath(new URL("./secretlint-files.mjs", import.meta.url));
const configPath = path.resolve(".secretlintrc.json");
const candidateFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((file) => file.length > 0 && existsSync(file));

if (candidateFiles.length === 0) {
  throw new Error("Secret scan resolved zero repository files.");
}

const highConfidenceFindings = [];
for (const file of candidateFiles) {
  const contents = readFileSync(file);
  if (contents.includes(0)) {
    continue;
  }

  for (const rule of findHighConfidenceSecrets(contents.toString("utf8"), { file })) {
    highConfidenceFindings.push(`${file}: ${rule}`);
  }
}

if (highConfidenceFindings.length > 0) {
  console.error("High-confidence secret signatures detected:");
  for (const finding of highConfidenceFindings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

for (let offset = 0; offset < candidateFiles.length; offset += 100) {
  const files = candidateFiles.slice(offset, offset + 100);
  const result = spawnSync(
    process.execPath,
    [secretlintBinary, "--secretlintrc", configPath, ...files],
    { encoding: "utf8" },
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Secretlint passed for ${candidateFiles.length} repository files.`);
