import { withCancellation } from "../data-infra/cancellation.mjs";
import { parseArguments, runServer } from "../prototype-application/server.mjs";
import { prepareWebApplication, openWebApplication } from "./runtime.mjs";

try {
  const args = process.argv.slice(2);
  if (parseArguments(args).port !== 3211) throw new Error("prototype_web_fixed_port_required");
  await withCancellation(() => runServer(args, {
    prepareApplication: prepareWebApplication,
    openApplication: openWebApplication,
    emit(value) {
      console.log(JSON.stringify(value.event === "prototype_application_ready"
        ? { ...value, webUrl: "http://127.0.0.1:3111/demo" } : value));
    },
  }), { processExit: true });
} catch {
  console.error(JSON.stringify({ event: "prototype_web_failed", code: "prototype_web_start_failed" }));
  if (!process.exitCode) process.exitCode = 1;
}
