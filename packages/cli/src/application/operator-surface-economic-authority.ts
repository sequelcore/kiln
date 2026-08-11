import type { OperatorRuntimeSurface } from "@kilnai/gateway-contracts";
import type { ManagedEconomicDispatchAuthorityPort } from "@kilnai/runtime";
import pkg from "../../package.json" with { type: "json" };
import { createGlobalOperatorRuntimeLifecycle } from "./operator-runtime-lifecycle.js";
import { createOperatorRuntimeClientSession } from "./operator-runtime-client-session.js";
import { createOperatorRuntimeManagedEconomicAuthority } from "./operator-runtime-managed-economic-authority.js";

export interface OperatorSurfaceEconomicAuthority {
  readonly authority: ManagedEconomicDispatchAuthorityPort;
  close(): void;
}

/** Connects one CLI-owned operator surface to the machine-global economic owner. */
export function createOperatorSurfaceEconomicAuthority(
  surface: OperatorRuntimeSurface,
  projectPath: string,
): OperatorSurfaceEconomicAuthority {
  let session: ReturnType<typeof createOperatorRuntimeClientSession> | undefined;
  let authority: ManagedEconomicDispatchAuthorityPort | undefined;
  const resolveAuthority = (): ManagedEconomicDispatchAuthorityPort => {
    if (authority) return authority;
    const lifecycle = createGlobalOperatorRuntimeLifecycle({
      version: pkg.version,
      execPath: process.execPath,
      entrypoint: process.argv[1] ?? "",
    });
    session = createOperatorRuntimeClientSession({
      principal: { kind: "operator-surface", surface },
      supervisor: lifecycle.supervisor,
      readBridgeCredentials: lifecycle.readBridgeCredentials,
      processContext: { cwd: () => projectPath },
    });
    authority = createOperatorRuntimeManagedEconomicAuthority(session);
    return authority;
  };
  return {
    authority: {
      acquire: (input) => resolveAuthority().acquire(input),
      releasePreFence: (jobId, economicAttemptId) =>
        resolveAuthority().releasePreFence(jobId, economicAttemptId),
      fenceDispatch: (jobId, economicAttemptId, dispatchFenceId) =>
        resolveAuthority().fenceDispatch(jobId, economicAttemptId, dispatchFenceId),
      settleExecution: (jobId, economicAttemptId, dispatchFenceId, settlement) =>
        resolveAuthority().settleExecution(jobId, economicAttemptId, dispatchFenceId, settlement),
      recordExecutionSettlementPending: (jobId, economicAttemptId, dispatchFenceId, reason) =>
        resolveAuthority().recordExecutionSettlementPending(jobId, economicAttemptId, dispatchFenceId, reason),
    },
    close: () => session?.close(),
  };
}
