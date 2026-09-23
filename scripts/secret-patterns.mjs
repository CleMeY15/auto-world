import { createHash } from "node:crypto";

export const highConfidenceSecretPatterns = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
  },
  {
    id: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/u,
  },
  {
    id: "openai-api-key",
    pattern: /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{32,}\b/u,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  },
];

export const findHighConfidenceSecrets = (contents, { file } = {}) => {
  // Immutable upstream test bytes contain exactly two occurrences of AWS's
  // documented example: https://docs.aws.amazon.com/sdkref/latest/guide/feature-static-credentials.html
  // Secretlint still scans the original file; no other path or content is exempt.
  const example = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
  if (file === "tests/fixtures/seaweed-source/upstream/weed/credential/credential_test.go" &&
      Buffer.byteLength(contents) === 9321 && contents.split(example).length === 3 &&
      createHash("sha256").update(contents).digest("hex") === "4dbc7dcaa2f1e391499a141222dc9ebbb1ff52c6dc20ef1f2b3c0e560a3e3251") {
    contents = contents.replaceAll(example, "PUBLIC_AWS_DOCUMENTATION_EXAMPLE");
  }
  return highConfidenceSecretPatterns
    .filter(({ pattern }) => pattern.test(contents))
    .map(({ id }) => id);
};
