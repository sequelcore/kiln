import type { EventBus, ApprovalRequestedEvent, ApprovalReceivedEvent } from "@kilnai/core";

export class RuntimeSessionApprovalGate {
  private approvalOrdinal = 0;
  private readonly pendingApprovals = new Map<string, {
    sessionId: string;
    resolve: (decision: { approved: boolean; reason?: string }) => void;
    promise: Promise<{ approved: boolean; reason?: string }>;
  }>();

  constructor(private readonly eventBus?: EventBus) {}

  private nextApprovalId(sessionId: string): string {
    return `${sessionId}:approval:${++this.approvalOrdinal}`;
  }

  emitApprovalRequested(description: string, sessionId: string, approvalId: string): void {
    const event: ApprovalRequestedEvent = {
      type: "approval_requested",
      approvalId,
      taskId: "",
      description,
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
  }

  emitApprovalReceived(approved: boolean, reason: string | undefined, approvalId: string): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      pending.resolve({ approved, reason });
      this.pendingApprovals.delete(approvalId);
    }
    const event: ApprovalReceivedEvent = {
      type: "approval_received",
      approvalId,
      taskId: "",
      approved,
      reason,
      timestamp: new Date(),
      sessionId: pending?.sessionId ?? "",
    };
    this.eventBus?.emit(event);
  }

  /**
   * Records a full approval-request/approval-received lifecycle for a mutation
   * that requires confirmation but has no live approval channel to grant it
   * (no operator-configured authority source). Emits both canonical events for
   * replay/audit, then resolves immediately as denied instead of leaving a
   * pending approval nothing can ever answer.
   */
  requestImmediateDenial(
    sessionId: string,
    description: string,
    reason: string,
  ): { approved: false; reason: string } {
    const approvalId = this.nextApprovalId(sessionId);
    this.emitApprovalRequested(description, sessionId, approvalId);
    const event: ApprovalReceivedEvent = {
      type: "approval_received",
      approvalId,
      taskId: "",
      approved: false,
      reason,
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
    return { approved: false, reason };
  }

  continue(approvalId: string): void {
    this.emitApprovalReceived(true, "user approved", approvalId);
  }

  requestApproval(
    sessionId: string,
    description: string,
  ): Promise<{ approved: boolean; reason?: string }> {
    let resolveApproval!: (decision: { approved: boolean; reason?: string }) => void;
    const promise = new Promise<{ approved: boolean; reason?: string }>((resolve) => {
      resolveApproval = resolve;
    });

    const approvalId = this.nextApprovalId(sessionId);
    this.pendingApprovals.set(approvalId, {
      sessionId,
      resolve: resolveApproval,
      promise,
    });

    this.emitApprovalRequested(description, sessionId, approvalId);
    return promise;
  }
}
