// ApprovalGateRegistry -- tracks approval targets by canonical approval ID.

export interface ApprovalTarget {
  readonly approve: () => void;
  readonly reject: (reason: string) => void;
  readonly status: () => string;
}

export class ApprovalGateRegistry {
  private readonly targets = new Map<string, ApprovalTarget>();

  register(approvalId: string, target: ApprovalTarget): void {
    this.targets.set(approvalId, target);
  }

  unregister(approvalId: string): void {
    this.targets.delete(approvalId);
  }

  approve(approvalId?: string): { ok: boolean; error?: string } {
    if (!approvalId || approvalId.trim() === "") {
      return { ok: false, error: "approvalId is required" };
    }

    const target = this.targets.get(approvalId);
    if (!target) return { ok: false, error: `Approval not found: ${approvalId}` };
    if (target.status() !== "awaiting_approval") {
      return { ok: false, error: `Approval ${approvalId} is not awaiting approval` };
    }
    target.approve();
    return { ok: true };
  }

  reject(reason: string, approvalId?: string): { ok: boolean; error?: string } {
    if (!approvalId || approvalId.trim() === "") {
      return { ok: false, error: "approvalId is required" };
    }

    const target = this.targets.get(approvalId);
    if (!target) return { ok: false, error: `Approval not found: ${approvalId}` };
    if (target.status() !== "awaiting_approval") {
      return { ok: false, error: `Approval ${approvalId} is not awaiting approval` };
    }
    target.reject(reason);
    return { ok: true };
  }
}
