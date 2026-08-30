import { lstatSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { PhysicalPathResolver } from "@kilnai/core/sandbox";

/**
 * Node's synchronous physical path adapter for Core sandbox validation.
 *
 * The nearest-existing-ancestor walk is intentional: a write target may not
 * exist yet, while every existing component must still be canonicalized before
 * policy containment is evaluated.
 */
export class NodePhysicalPathResolver implements PhysicalPathResolver {
  resolve(filePath: string): string | undefined {
    const target = resolve(filePath);
    let current = target;
    for (;;) {
      try {
        return resolve(realpathSync.native(current), relative(current, target));
      } catch {
        try {
          if (lstatSync(current).isSymbolicLink()) return undefined;
        } catch {
          // A missing component is expected for new write targets.
        }
        const parent = dirname(current);
        if (parent === current) return undefined;
        current = parent;
      }
    }
  }
}

/** One process-local adapter shared by every Runtime host-tool composition. */
export const nodePhysicalPathResolver: PhysicalPathResolver = new NodePhysicalPathResolver();
