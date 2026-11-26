type Environment = Readonly<Record<string, string | undefined>>;

export function privateCatalogEnabled(environment: Environment = process.env): boolean {
  return environment.NODE_ENV === "production" && environment.AUTOFIND_PRIVATE_CATALOG === "1";
}
