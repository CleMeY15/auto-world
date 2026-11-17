// Internal subprocess entry point: one explicit config and up to 100 literal
// Git files. Keep official rules, source handling, formatter and secret masking.
try {
  const { createEngine } = await import("@secretlint/node");
  const { selectSecretlintFiles } = await import("./secretlint-file-selection.mjs");
  const [option, configFilePath, ...files] = process.argv.slice(2);
  if (option !== "--secretlintrc" || !configFilePath || files.length === 0 || files.length > 100) {
    throw new Error("Expected --secretlintrc <config> and 1–100 literal files");
  }
  const cwd = process.cwd();
  // Load configuration before selection, including all-ignored batches.
  const engine = await createEngine({
    cwd, configFilePath, formatter: "stylish", color: true,
    terminalLink: true, maskSecrets: true,
  });
  const { ok, items } = await selectSecretlintFiles(files, { cwd });
  if (!ok) throw new Error("Not found target files");
  const result = await engine.executeOnFiles({ filePathList: items });
  if (result.output) console.log(result.output);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 2;
}
