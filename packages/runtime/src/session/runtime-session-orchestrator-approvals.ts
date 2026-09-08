import type { EventBus, ApprovalRequestedEvent, ApprovalReceivedEvent } from "@kilnai/core";

export class RuntimeSessionApprovalGate {
  private approvalOrdinal = 0;
  private readonly pendingApprovals = new Map<string, {
    sessionId: string;
    resolve: (decision: { approved: boolean; reason?: string }) => void;
    removeAbortListener: () => void;
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
    if (!pending) return;
    this.pendingApprovals.delete(approvalId);
    pending.removeAbortListener();
    pending.resolve({ approved, reason });
    const event: ApprovalReceivedEvent = {
      type: "approval_received",
      approvalId,
      taskId: "",
      approved,
      reason,
      timestamp: new Date(),
      sessionId: pending.sessionId,
    };
    this.eventBus?.emit(event);
  }

  /**
   * Records a full approval-request/approval-received lifecycle for a mutation
   * that requires confirmation but has no live approval channel to grant it
   * or authority source. Emits both canonical events for
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
    abortSignal?: AbortSignal,
  ): Promise<{ approved: boolean; reason?: string }> {
    const cancellationReason = "Runtime turn cancelled while awaiting approval.";
    if (abortSignal?.aborted) {
      return Promise.resolve(this.requestImmediateDenial(sessionId, description, cancellationReason));
    }
    const approvalId = this.nextApprovalId(sessionId);
    return new Promise((resolve) => {
      const onAbort = (): void => this.emitApprovalReceived(false, cancellationReason, approvalId);
      this.pendingApprovals.set(approvalId, {
        sessionId,
        resolve,
        removeAbortListener: () => abortSignal?.removeEventListener("abort", onAbort),
      });
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      try {
        this.emitApprovalRequested(description, sessionId, approvalId);
      } catch {
        this.emitApprovalReceived(false, "Approval request delivery failed.", approvalId);
      }
    });
  }
}
