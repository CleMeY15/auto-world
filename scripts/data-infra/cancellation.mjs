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

export async function withCancellation(action) {
  const controller = new globalThis.AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    return await context.run({ signal: controller.signal }, action);
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
