import { digestManagedEconomicValue } from "@kilnai/core/cost";
import type {
  BoundedWorkAccountingSnapshot,
  BoundedWorkContractRevision,
  BoundedWorkHarnessCapability,
} from "@kilnai/core/work-governance";
import type {
  ManagedInvocationBoundedWorkAdmission,
  ManagedInvocationBoundedWorkAdmissionInput,
  ManagedInvocationBoundedWorkAdmissionResult,
} from "../agents/managed-invocation/runtime-tool/types.js";
import type { SqliteBoundedWorkAuthority } from "./sqlite-bounded-work-authority.js";

/** Immutable accounting identity shared by the parent Runtime and its direct children. */
export interface RuntimeSharedExecutionBudgetScopeInput {
  readonly projectRuntimeId: string;
  readonly authority: SqliteBoundedWorkAuthority;
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly contractRevision: BoundedWorkContractRevision;
  readonly route: {
    readonly routeId: string;
    readonly harnessId: string;
  };
  readonly harnessCapability: BoundedWorkHarnessCapability;
  readonly limits: {
    readonly maximumManagedChildren: number;
    readonly maximumToolCalls: number;
  };
}

export interface RuntimeSharedExecutionBudgetSnapshot {
  readonly scopeId: string;
  readonly accountingLineageId: string;
  readonly contractRevisionDigest: string;
  readonly limits: {
    readonly maximumManagedChildren: number;
    readonly maximumToolCalls: number;
  };
  readonly accounting?: BoundedWorkAccountingSnapshot;
  readonly settlement: {
    readonly status: "not_started" | "active" | "settled" | "reconciliation_required";
  };
}

export type RuntimeSharedToolBatchAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: string; readonly message: string };

export interface RuntimeSharedExecutionBudget {
  assertBound(): void;
  managedInvocationAttribution(): { readonly goalRunId: string; readonly workItemId: string };
  reserveToolBatch(input: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly toolCallScopeId: string;
    readonly toolCallCount: number;
  }): RuntimeSharedToolBatchAdmission;
  readonly admitManagedInvocation: ManagedInvocationBoundedWorkAdmission;
  snapshot(): RuntimeSharedExecutionBudgetSnapshot;
}

/**
 * Binds one caller-authorized benchmark/workload budget to the durable bounded-work
 * authority. This is deliberately an adapter, never a second counter owner.
 */
export class RuntimeSharedExecutionBudgetScope implements RuntimeSharedExecutionBudget {
  readonly #input: RuntimeSharedExecutionBudgetScopeInput;
  readonly scopeId: string;

  constructor(input: RuntimeSharedExecutionBudgetScopeInput) {
    assertPositive(input.limits.maximumManagedChildren, "maximumManagedChildren");
    assertPositive(input.limits.maximumToolCalls, "maximumToolCalls");
    if (input.contractRevision.accountingLineageId !== input.goalRunId) {
      throw new TypeError("Shared execution budget lineage must equal its goal run id.");
    }
    if (!input.contractRevision.contract.scope.allowedWorkItemIds.includes(input.workItemId)) {
      throw new TypeError("Shared execution budget work item is not bound to its contract.");
    }
    const limits = input.contractRevision.contract.limits;
    if (
      limits.maxManagedInvocations !== input.limits.maximumManagedChildren
      || limits.maxConcurrentManagedInvocations !== input.limits.maximumManagedChildren
      || limits.maxChildDepth !== 1
      || limits.maxToolCalls !== input.limits.maximumToolCalls
    ) {
      throw new TypeError("Shared execution budget limits must exactly match its bounded-work contract.");
    }
    this.#input = Object.freeze({
      ...input,
      route: Object.freeze({ ...input.route }),
      limits: Object.freeze({ ...input.limits }),
    });
    this.scopeId = digestManagedEconomicValue({
      kind: "runtime-shared-execution-budget/v1",
      projectRuntimeId: input.projectRuntimeId,
      goalRunId: input.goalRunId,
      workItemId: input.workItemId,
      contractRevisionDigest: input.contractRevision.revisionDigest,
      route: input.route,
      limits: input.limits,
    });
  }

  reserveToolBatch(input: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly toolCallScopeId: string;
    readonly toolCallCount: number;
  }): RuntimeSharedToolBatchAdmission {
    assertPositive(input.toolCallCount, "toolCallCount");
    const admission = this.#input.authority.reserve({
      ...this.#identity(`tool-batch:${input.sessionId}:${input.turnId}:${input.toolCallScopeId}`),
      observedMetrics: ["tool_calls"],
      reservation: { kind: "tool_call", amount: input.toolCallCount },
    });
    if (admission.decision.kind !== "admitted") return denied(admission.decision);
    let receipt = admission.reservation!;
    if (receipt.state === "settled") return { admitted: true };
    try {
      receipt = this.#input.authority.markDispatched({
        reservationId: receipt.reservationId,
        expectedReservationRevision: receipt.revision,
        dispatchId: `logical-tool-batch:${input.sessionId}:${input.turnId}:${input.toolCallScopeId}`,
      });
      this.#input.authority.settleTerminal({
        reservationId: receipt.reservationId,
        expectedReservationRevision: receipt.revision,
        terminalOutcome: "completed",
        terminalEvidenceDigest: digestManagedEconomicValue({
          kind: "logical-tool-batch-admitted/v1",
          scopeId: this.scopeId,
          sessionId: input.sessionId,
          turnId: input.turnId,
          toolCallScopeId: input.toolCallScopeId,
          toolCallCount: input.toolCallCount,
        }),
      });
      return { admitted: true };
    } catch (error) {
      try {
        this.#input.authority.settleUnknown({
          reservationId: receipt.reservationId,
          expectedReservationRevision: receipt.revision,
          reason: `Logical tool-batch settlement requires reconciliation: ${errorMessage(error)}`,
        });
      } catch {
        // The authority retains the dispatched reservation if its state cannot be advanced.
      }
      throw error;
    }
  }

  readonly admitManagedInvocation: ManagedInvocationBoundedWorkAdmission = (
    input: ManagedInvocationBoundedWorkAdmissionInput,
  ): ManagedInvocationBoundedWorkAdmissionResult => {
    if (
      input.goalRunId !== this.#input.goalRunId
      || input.workItemId !== this.#input.workItemId
      || input.childDepth !== 1
    ) {
      return {
        admitted: false,
        code: "shared_execution_budget_scope_mismatch",
        message: "Managed invocation attribution does not match the shared execution budget scope.",
      };
    }
    const admission = this.#input.authority.reserve({
      ...this.#identity(`managed:${input.invocationId}`),
      observedMetrics: ["tool_calls"],
      route: { routeId: input.routeId, harnessId: input.harnessId },
      reservation: { kind: "managed_invocation", amount: 1, childDepth: input.childDepth },
    });
    if (admission.decision.kind !== "admitted") return denied(admission.decision);
    let receipt = admission.reservation!;
    return {
      admitted: true,
      workspaceAuthority: {
        allowedPaths: input.routeWriteAllowedPaths,
        deniedPaths: input.routeWriteDeniedPaths,
      },
      lifecycle: {
        markDispatched: (dispatchId) => {
          receipt = this.#input.authority.markDispatched({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
            dispatchId,
          });
        },
        releaseBeforeDispatch: () => {
          receipt = this.#input.authority.releaseBeforeDispatch({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
          });
        },
        settleTerminal: (outcome, evidenceDigest) => {
          receipt = this.#input.authority.settleTerminal({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
            terminalOutcome: outcome,
            terminalEvidenceDigest: evidenceDigest,
          });
        },
        settleUnknown: (reason) => {
          receipt = this.#input.authority.settleUnknown({
            reservationId: receipt.reservationId,
            expectedReservationRevision: receipt.revision,
            reason,
          });
        },
      },
    };
  };

  assertBound(): void {
    // A concrete immutable scope is bound at construction.
  }

  managedInvocationAttribution(): { readonly goalRunId: string; readonly workItemId: string } {
    return { goalRunId: this.#input.goalRunId, workItemId: this.#input.workItemId };
  }

  snapshot(): RuntimeSharedExecutionBudgetSnapshot {
    const accounting = this.#input.authority.inspect({
      projectRuntimeId: this.#input.projectRuntimeId,
      accountingLineageId: this.#input.goalRunId,
    });
    const reservations = this.#input.authority.inspectReservations({
      projectRuntimeId: this.#input.projectRuntimeId,
      accountingLineageId: this.#input.goalRunId,
    });
    const settlement = reservations.length === 0
      ? "not_started" as const
      : reservations.some((reservation) => reservation.state === "reconciliation_required")
        ? "reconciliation_required" as const
        : reservations.some((reservation) => reservation.state === "reserved" || reservation.state === "dispatched")
          ? "active" as const
          : "settled" as const;
    return {
      scopeId: this.scopeId,
      accountingLineageId: this.#input.goalRunId,
      contractRevisionDigest: this.#input.contractRevision.revisionDigest,
      limits: { ...this.#input.limits },
      ...(accounting ? { accounting } : {}),
      settlement: { status: settlement },
    };
  }

  #identity(idempotencyKey: string) {
    return {
      projectRuntimeId: this.#input.projectRuntimeId,
      goalRunId: this.#input.goalRunId,
      workItemId: this.#input.workItemId,
      contractRevision: this.#input.contractRevision,
      idempotencyKey,
      route: this.#input.route,
      harnessCapability: this.#input.harnessCapability,
    };
  }
}

export function createRuntimeSharedExecutionBudgetScope(
  input: RuntimeSharedExecutionBudgetScopeInput,
): RuntimeSharedExecutionBudgetScope {
  return new RuntimeSharedExecutionBudgetScope(input);
}

/**
 * Stable dependency injected before the canonical operator adoption event is
 * persisted. It cannot silently become an unbounded execution path.
 */
export class RuntimeSharedExecutionBudgetScopeReference implements RuntimeSharedExecutionBudget {
  #scope: RuntimeSharedExecutionBudgetScope | undefined;

  bind(scope: RuntimeSharedExecutionBudgetScope): void {
    if (this.#scope !== undefined) {
      throw new Error("Shared execution budget scope is already bound.");
    }
    this.#scope = scope;
  }

  assertBound(): void {
    if (!this.#scope) throw new Error("Shared execution budget scope is not bound by a persisted operator adoption.");
  }

  managedInvocationAttribution(): { readonly goalRunId: string; readonly workItemId: string } {
    this.assertBound();
    return this.#scope!.managedInvocationAttribution();
  }

  reserveToolBatch(input: Parameters<RuntimeSharedExecutionBudget["reserveToolBatch"]>[0]): RuntimeSharedToolBatchAdmission {
    if (!this.#scope) {
      return {
        admitted: false,
        code: "shared_execution_budget_unbound",
        message: "Shared execution budget scope is not bound by a persisted operator adoption.",
      };
    }
    return this.#scope.reserveToolBatch(input);
  }

  readonly admitManagedInvocation: ManagedInvocationBoundedWorkAdmission = (input) => {
    if (!this.#scope) {
      return {
        admitted: false,
        code: "shared_execution_budget_unbound",
        message: "Shared execution budget scope is not bound by a persisted operator adoption.",
      };
    }
    return this.#scope.admitManagedInvocation(input);
  };

  snapshot(): RuntimeSharedExecutionBudgetSnapshot {
    this.assertBound();
    return this.#scope!.snapshot();
  }
}

export function createRuntimeSharedExecutionBudgetScopeReference(): RuntimeSharedExecutionBudgetScopeReference {
  return new RuntimeSharedExecutionBudgetScopeReference();
}

function denied(decision: Exclude<ReturnType<SqliteBoundedWorkAuthority["reserve"]>["decision"], { readonly kind: "admitted" }>): RuntimeSharedToolBatchAdmission & ManagedInvocationBoundedWorkAdmissionResult {
  switch (decision.kind) {
    case "pause_budget_exhausted":
    case "stop_budget_exhausted":
      return { admitted: false, code: decision.kind, message: `Shared execution budget exhausted: ${decision.exhaustedLimits.join(", ")}.` };
    case "pause_capability_unavailable":
      return { admitted: false, code: decision.kind, message: `Shared execution budget cannot measure: ${decision.unavailableMetrics.join(", ")}.` };
    case "pause_scope_revision_required":
      return { admitted: false, code: decision.kind, message: "Shared execution budget scope requires revision." };
  }
}

function assertPositive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive safe integer.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
