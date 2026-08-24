import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the operator Kiln home for Core-owned stores when the CLI seam is
 * not available (for example, a standalone Core adapter). Production CLI and
 * Runtime composition should always supply `explicitKilnHome`.
 */
export function resolveCoreKilnHome(explicitKilnHome?: string): string {
  const explicit = explicitKilnHome?.trim();
  if (explicit) return explicit;
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) return join(xdgConfigHome, "kiln");
  return join(homedir(), ".kiln");
}
