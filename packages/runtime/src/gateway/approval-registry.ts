// ApprovalGateRegistry -- tracks approval targets (orchestrators) by session ID

export interface ApprovalTarget {
  readonly approve: () => void;
  readonly reject: (reason: string) => void;
  readonly status: () => string;
}

export class ApprovalGateRegistry {
  private readonly targets = new Map<string, ApprovalTarget>();

  register(sessionId: string, target: ApprovalTarget): void {
    this.targets.set(sessionId, target);
  }

  unregister(sessionId: string): void {
    this.targets.delete(sessionId);
  }

  approve(sessionId?: string): { ok: boolean; error?: string } {
    if (!sessionId || sessionId.trim() === "") {
      return { ok: false, error: "sessionId is required" };
    }

    const target = this.targets.get(sessionId);
    if (!target) return { ok: false, error: `Session not found: ${sessionId}` };
    if (target.status() !== "awaiting_approval") {
      return { ok: false, error: `Session ${sessionId} is not awaiting approval` };
    }
    target.approve();
    return { ok: true };
  }

  reject(reason: string, sessionId?: string): { ok: boolean; error?: string } {
    if (!sessionId || sessionId.trim() === "") {
      return { ok: false, error: "sessionId is required" };
    }

    const target = this.targets.get(sessionId);
    if (!target) return { ok: false, error: `Session not found: ${sessionId}` };
    if (target.status() !== "awaiting_approval") {
      return { ok: false, error: `Session ${sessionId} is not awaiting approval` };
    }
    target.reject(reason);
    return { ok: true };
  }
}
