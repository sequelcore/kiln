import { resolveCoreKilnHome } from "@kilnai/core";
import { join } from "node:path";

export function resolveGlobalConfigPath(): string {
  return join(resolveKilnHomePath(), "config.yaml");
}

/** Canonical operator Kiln home shared by global and private-project state. */
export function resolveKilnHomePath(): string {
  return resolveCoreKilnHome();
}
