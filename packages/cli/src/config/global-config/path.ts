import { homedir } from "node:os";
import { join } from "node:path";

export function resolveGlobalConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return join(xdgConfigHome, "kiln", "config.yaml");
  }
  return join(homedir(), ".kiln", "config.yaml");
}
