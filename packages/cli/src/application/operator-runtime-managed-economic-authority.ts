import {
  OPERATOR_RUNTIME_APPLICATION_PATH,
  type ManagedEconomicCommitmentAcquireInput,
  type ManagedEconomicCommitmentAcquireResult,
  type ManagedEconomicDispatchAuthorityPort,
} from "@kilnai/runtime";
import {
  OperatorRuntimeApplicationResponseSchema,
  type OperatorRuntimeApplicationRequest,
} from "@kilnai/gateway-contracts";
import type { ManagedEconomicSettlement } from "@kilnai/core";
import type { OperatorRuntimeClientSession } from "./operator-runtime-client-session.js";

export function createOperatorRuntimeManagedEconomicAuthority(
  session: OperatorRuntimeClientSession,
): ManagedEconomicDispatchAuthorityPort {
  const execute = async (request: OperatorRuntimeApplicationRequest): Promise<unknown> => {
    const response = await session.request(OPERATOR_RUNTIME_APPLICATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error("Operator runtime managed economic authority is unavailable.");
    const parsed = OperatorRuntimeApplicationResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Operator runtime managed economic authority returned an invalid response.");
    }
    if (parsed.data.status === "error") throw new Error(parsed.data.error.message);
    return parsed.data.result;
  };

  return {
    acquire: async (input: ManagedEconomicCommitmentAcquireInput): Promise<ManagedEconomicCommitmentAcquireResult> =>
      await execute({
        schemaVersion: 1,
        operation: "managed-economic.acquire",
        input: {
          ...input,
          snapshot: { ...input.snapshot },
          expectation: { ...input.expectation },
          routeCapacity: input.routeCapacity.map((capacity) => ({ ...capacity })),
        },
      }) as ManagedEconomicCommitmentAcquireResult,
    releasePreFence: async (jobId, economicAttemptId) => {
      await execute({ schemaVersion: 1, operation: "managed-economic.release-pre-fence", jobId, economicAttemptId });
    },
    fenceDispatch: async (jobId, economicAttemptId, dispatchFenceId, actionClaim) => {
      await execute({ schemaVersion: 1, operation: "managed-economic.fence-dispatch", jobId, economicAttemptId, dispatchFenceId, actionClaim } as unknown as OperatorRuntimeApplicationRequest);
    },
    readDispatch: async (jobId, economicAttemptId, dispatchFenceId, actionClaim) => {
      return await execute({
        schemaVersion: 1,
        operation: "managed-economic.read-dispatch",
        jobId,
        economicAttemptId,
        dispatchFenceId,
        actionClaim,
      } as unknown as OperatorRuntimeApplicationRequest) as Awaited<ReturnType<ManagedEconomicDispatchAuthorityPort["readDispatch"]>>;
    },
    settleExecution: async (jobId, economicAttemptId, dispatchFenceId, settlement: ManagedEconomicSettlement) => {
      await execute({
        schemaVersion: 1,
        operation: "managed-economic.settle-execution",
        jobId,
        economicAttemptId,
        dispatchFenceId,
        settlement,
      });
    },
    recordExecutionSettlementPending: async (jobId, economicAttemptId, dispatchFenceId, reason) => {
      await execute({
        schemaVersion: 1,
        operation: "managed-economic.record-settlement-pending",
        jobId,
        economicAttemptId,
        dispatchFenceId,
        reason,
      });
    },
  };
}
