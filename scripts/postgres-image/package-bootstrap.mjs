import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const MiB = 1024 * 1024;

export const POSTGRES_PACKAGE_BOOTSTRAP = Object.freeze({
  workflowPath: ".github/workflows/postgres-package-bootstrap.yml",
  scriptPath: "scripts/postgres-image/package-bootstrap.mjs",
  readerPath: "scripts/postgres-image/package-private-read.mjs",
  repository: "CleMeY15/auto-world",
  image: "ghcr.io/clemey15/auto-world-postgres-gosu",
  owner: "CleMeY15",
  outputDirectory: "postgres-package-bootstrap",
  branchUrl: "https://api.github.com/repos/CleMeY15/auto-world/branches/main",
  platform: "linux/amd64",
  payloadPath: "bootstrap.txt",
  payload: "auto-world-postgres-gosu-package-bootstrap-v1\n",
  sourceUrl: "https://github.com/CleMeY15/auto-world",
  description: "Harmless Auto World PostgreSQL gosu package bootstrap; not a runtime image",
  imageSizeLimit: 4 * MiB,
  dockerfile: [
    "FROM scratch",
    "LABEL org.opencontainers.image.source=\"https://github.com/CleMeY15/auto-world\"",
    "LABEL org.opencontainers.image.description=\"Harmless Auto World PostgreSQL gosu package bootstrap; not a runtime image\"",
    "COPY bootstrap.txt /bootstrap.txt",
    "",
  ].join("\n"),
  authenticatedFiles: Object.freeze([
    ".github/workflows/postgres-package-bootstrap.yml",
    "scripts/postgres-image/package-private-read.mjs",
    "scripts/postgres-image/package-bootstrap.mjs",
    "scripts/package-bootstrap/registry-proof.mjs",
    "scripts/package-bootstrap/prepare.mjs",
  ]),
  retired: true,
});

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function runPostgresPackageBootstrap() {
  throw new Error("postgres_package_bootstrap_retired");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { runPostgresPackageBootstrap(); }
  catch {
    console.error("postgres_package_bootstrap_failed:postgres_package_bootstrap_retired");
    process.exitCode = 1;
  }
}
