export type DemoBackendMode = "offline" | "prototype" | "disabled";

type Environment = Readonly<Record<string, string | undefined>>;

export function resolveDemoBackendMode(environment: Environment = process.env): DemoBackendMode {
  if (environment.AUTO_WORLD_DEMO !== "1") return "disabled";
  const requested = environment.AUTO_WORLD_WEB_BACKEND;
  if (requested === undefined || requested === "" || requested === "offline") return "offline";
  if (requested === "prototype") return "prototype";
  return "disabled";
}

export function demoBackendOrigin(mode: Exclude<DemoBackendMode, "disabled">): string {
  return mode === "prototype" ? "http://127.0.0.1:3211" : "http://127.0.0.1:3210";
}

export function demoBackendLabel(mode: DemoBackendMode): string {
  return mode === "prototype" ? "Prototype local persistant" : "Démonstration locale";
}
