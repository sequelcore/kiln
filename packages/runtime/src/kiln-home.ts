import { resolveCoreKilnHome } from "@kilnai/core";
import { join } from "node:path";

/**
 * Explicit operator Kiln-home seam for Runtime-owned persistence.
 *
 * CLI composition supplies this value from its canonical resolver. The
 * environment fallback keeps direct Runtime embeddings deterministic without
 * importing CLI (and therefore without creating a package dependency cycle).
 * Tests and other callers that own an exact directory should pass `rootDir`
 * directly to the relevant Runtime owner.
 */
export interface RuntimeKilnHomeOptions {
  readonly kilnHome?: string;
}

export function resolveRuntimeKilnHome(explicitKilnHome?: string): string {
  return resolveCoreKilnHome(explicitKilnHome);
}

export function resolveRuntimeStoreRoot(input: {
  readonly kilnHome?: string;
  readonly rootDir?: string;
}, segment: string): string {
  const explicitRoot = input.rootDir?.trim();
  return explicitRoot || join(resolveRuntimeKilnHome(input.kilnHome), segment);
}
