import { resolveRuntimeKilnHome } from "@kilnai/runtime/kiln-home";
import { join } from "node:path";

export function resolveGlobalConfigPath(explicitKilnHome?: string): string {
  return join(resolveKilnHomePath(explicitKilnHome), "config.yaml");
}

/** Canonical operator Kiln home shared by global and private-project state. */
export function resolveKilnHomePath(explicitKilnHome?: string): string {
  return resolveRuntimeKilnHome(explicitKilnHome);
}
