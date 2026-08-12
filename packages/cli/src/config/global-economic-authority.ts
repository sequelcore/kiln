import { dirname, join } from "node:path";

export function resolveGlobalEconomicAuthorityDatabasePath(globalConfigPath: string): string {
  return join(dirname(globalConfigPath), "runtime", "economic-authority", "managed-account-leases.sqlite");
}
