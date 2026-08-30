import { join } from "node:path";

export interface KilnHomeResolutionInput {
  readonly explicitKilnHome?: string;
  readonly xdgConfigHome?: string;
  readonly userHome?: string;
  readonly readUserHome?: () => string;
}

/**
 * Resolve a Kiln home from observed values and an optional lazy fallback.
 *
 * Host discovery belongs to Runtime. Core owns only the precedence and invokes
 * the supplied fallback reader when neither explicit nor XDG input resolves.
 */
export function resolveKilnHome(input: KilnHomeResolutionInput): string {
  const explicit = input.explicitKilnHome?.trim();
  if (explicit) return explicit;

  const xdgConfigHome = input.xdgConfigHome?.trim();
  if (xdgConfigHome) return join(xdgConfigHome, "kiln");

  const userHome = input.userHome ?? input.readUserHome?.();
  if (userHome === undefined) {
    throw new Error("Kiln home resolution requires userHome or readUserHome.");
  }
  return join(userHome, ".kiln");
}
