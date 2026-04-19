import type { EventBus, ApprovalRequestedEvent, ApprovalReceivedEvent } from "@kilnai/core";

export class ModeBApprovalGate {
  private readonly pendingApprovals = new Map<string, {
    resolve: (decision: { approved: boolean; reason?: string }) => void;
    promise: Promise<{ approved: boolean; reason?: string }>;
  }>();

  constructor(private readonly eventBus?: EventBus) {}

  emitApprovalRequested(description: string, sessionId: string): void {
    const event: ApprovalRequestedEvent = {
      type: "approval_requested",
      taskId: "",
      description,
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
  }

  emitApprovalReceived(approved: boolean, reason?: string, sessionId?: string): void {
    if (sessionId) {
      const pending = this.pendingApprovals.get(sessionId);
      if (pending) {
        pending.resolve({ approved, reason });
        this.pendingApprovals.delete(sessionId);
      }
    }
    const event: ApprovalReceivedEvent = {
      type: "approval_received",
      taskId: "",
      approved,
      reason,
      timestamp: new Date(),
      sessionId: sessionId ?? "",
    };
    this.eventBus?.emit(event);
  }

  continue(sessionId: string): void {
    this.emitApprovalReceived(true, "user approved", sessionId);
  }

  requestApproval(
    sessionId: string,
    description: string,
  ): Promise<{ approved: boolean; reason?: string }> {
    const existing = this.pendingApprovals.get(sessionId);
    if (existing) {
      return existing.promise;
    }

    let resolveApproval!: (decision: { approved: boolean; reason?: string }) => void;
    const promise = new Promise<{ approved: boolean; reason?: string }>((resolve) => {
      resolveApproval = resolve;
    });

    this.pendingApprovals.set(sessionId, {
      resolve: resolveApproval,
      promise,
    });

    this.emitApprovalRequested(description, sessionId);
    return promise;
  }
}
