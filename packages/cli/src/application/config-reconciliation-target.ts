import type { KilnConfigReconciliationTarget } from "@kilnai/gateway-contracts";
import { captureCanonicalReconciliationGeneration } from "./config-reconciliation-generation.js";
import { withConfigReconciliationTargetLock } from "./config-reconciliation-lock.js";

export type ConfigReconciliationTargetResult<T> =
  | { readonly status: "completed"; readonly generation: string; readonly value: T }
  | { readonly status: "superseded"; readonly generation: string };

/** One generation-fenced transaction shared by mutation, setup, and sync. */
export function runConfigReconciliationTarget<T>(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
  run: () => T | Promise<T>,
): Promise<ConfigReconciliationTargetResult<T>> {
  return withConfigReconciliationTargetLock(projectPath, target, async () => {
    const admittedGeneration = captureCanonicalReconciliationGeneration(projectPath, target);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = captureCanonicalReconciliationGeneration(projectPath, target);
      const value = await run();
      if (captureCanonicalReconciliationGeneration(projectPath, target) === generation) {
        return generation === admittedGeneration
          ? { status: "completed", generation, value }
          : { status: "superseded", generation: admittedGeneration };
      }
    }
    throw new Error(`${target} canonical generation did not stabilize during reconciliation.`);
  });
}
