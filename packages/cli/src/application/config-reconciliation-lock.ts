import { resolve } from "node:path";
import type { KilnConfigReconciliationTarget } from "@kilnai/gateway-contracts";
import { ConfigMutationStore } from "./config-mutation-store.js";
import { withConfigMutationLock } from "./config-mutation-lock.js";

/**
 * Serializes reconciliation for one project/target pair.
 *
 * Canonical mutations are locked by path, but one projection can be fed by
 * more than one canonical path (for example global and project intent). The
 * target lock is intentionally process-local: it coordinates concurrent
 * mutation, setup, and sync calls without becoming another durable authority.
 */
export async function withConfigReconciliationTargetLock<T>(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
  run: () => T | Promise<T>,
): Promise<T> {
  const sharedOutput = target === "native-agents" || target === "native-skills" || target === "native-permissions";
  const key = `${sharedOutput ? "global" : resolve(projectPath)}\u0000${target}`;
  const predecessor = targetTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  targetTails.set(key, current);
  await predecessor;
  try {
    const store = new ConfigMutationStore(projectPath);
    const lockPath = sharedOutput
      ? store.globalReconciliationLockPathFor(target)
      : store.reconciliationLockPathFor(target);
    return await withConfigMutationLock(lockPath, run, {
      waitMs: 30_000,
      retryMs: 25,
    });
  } finally {
    release();
    if (targetTails.get(key) === current) targetTails.delete(key);
  }
}

const targetTails = new Map<string, Promise<void>>();
