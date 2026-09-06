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

export const findHighConfidenceSecrets = (contents) =>
  highConfidenceSecretPatterns
    .filter(({ pattern }) => pattern.test(contents))
    .map(({ id }) => id);
