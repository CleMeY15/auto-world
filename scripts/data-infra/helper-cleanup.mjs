import { setTimeout as delay } from "node:timers/promises";
import { InfraError, run } from "./runtime.mjs";

// Called in protected recovery after the invoking subprocess has closed.
export async function removeOwnedHelper(name, owner, { runProcess = run, pause = delay } = {}) {
  if (!/^aw-(?:helper|audit)-[a-z0-9-]{1,100}$/u.test(name) || typeof owner !== "string" || !owner.length) throw new InfraError("infra_helper_identity_invalid");
  const deadline = Date.now() + 120000;
  const command = async (args) => {
    const remaining = deadline - Date.now();
    if (remaining < 1) throw new InfraError("infra_helper_cleanup_timeout");
    const result = await runProcess("docker", args, { timeoutMs: Math.min(10000, remaining) });
    if (result.code !== 0) throw new InfraError("infra_helper_cleanup_unverified");
    return result.stdout.trim();
  };
  let absent = 0;
  while (absent < 2) {
    const listed = await command(["container", "ls", "-aq", "--filter", `name=^/${name}$`]);
    if (!listed) {
      absent += 1;
      if (absent < 2) await pause(250);
      continue;
    }
    absent = 0;
    if (!/^[a-f0-9]{12,64}$/u.test(listed)) throw new InfraError("infra_helper_cleanup_unverified");
    const actualOwner = await command(["inspect", "--format", '{{index .Config.Labels "io.auto-world.owner"}}', listed]);
    if (actualOwner !== owner) throw new InfraError("infra_helper_cleanup_unowned");
    await command(["rm", "-f", listed]);
  }
}
