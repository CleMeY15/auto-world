import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage();

export function operationSignal() {
  return context.getStore()?.signal;
}

// Cleanup/recovery gets its own explicit time budget and must survive the first
// cooperative cancellation. A forcibly killed process/host cannot make that guarantee.
export function protectedRecovery(action) {
  return context.run({ signal: undefined }, action);
}

export async function withCancellation(action, { processExit = false } = {}) {
  const controller = new globalThis.AbortController();
  const interrupt = () => controller.abort("SIGINT");
  const terminate = () => controller.abort("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await context.run({ signal: controller.signal }, action);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    if (processExit && controller.signal.aborted) process.exitCode = controller.signal.reason === "SIGINT" ? 130 : 143;
  }
}
