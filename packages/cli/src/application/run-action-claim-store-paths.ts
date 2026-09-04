import { join } from "node:path";

export interface RunManagedDirectActionClaimStorePaths {
  readonly stateRoot: string;
  readonly modelRoundClaimsPath: string;
  readonly toolActionClaimsPath: string;
}

/** Gives each finite CLI run one workload-local action-claim authority. */
export function resolveRunManagedDirectActionClaimStorePaths(
  runtimePath: string,
  sessionId: string,
): RunManagedDirectActionClaimStorePaths {
  if (!runtimePath.trim()) throw new TypeError("Run Runtime state path is required.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(sessionId)) {
    throw new TypeError("Run session identity must be a filesystem-safe canonical identifier.");
  }
  const stateRoot = join(runtimePath, "run-sessions", sessionId);
  return {
    stateRoot,
    modelRoundClaimsPath: join(stateRoot, "managed-direct-model-round-action-claims.sqlite"),
    toolActionClaimsPath: join(stateRoot, "managed-direct-tool-action-claims.sqlite"),
  };
}
