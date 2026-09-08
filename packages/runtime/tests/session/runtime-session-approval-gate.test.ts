import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@kilnai/core/events";
import { RuntimeSessionApprovalGate } from "../../src/session/runtime-session-orchestrator-approvals.js";

describe("Runtime approval cancellation", () => {
  it("settles an outstanding approval once on abort and ignores a late approval", async () => {
    const events = new EventBus(100);
    const requested = vi.fn();
    const received = vi.fn();
    events.on("approval_requested", requested);
    events.on("approval_received", received);
    const gate = new RuntimeSessionApprovalGate(events);
    const abort = new AbortController();
    const pending = gate.requestApproval("session", "read a protected file", abort.signal);
    expect(requested).toHaveBeenCalledOnce();
    const event = requested.mock.calls[0]?.[0];
    expect(event.approvalId).toBe("session:approval:1");
    abort.abort();
    await expect(pending).resolves.toMatchObject({ approved: false, reason: expect.stringContaining("cancelled") });
    gate.continue(event.approvalId);
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0]?.[0]).toMatchObject({ approved: false, sessionId: "session" });
  });

  it("does not wait when cancellation preceded the approval request", async () => {
    const events = new EventBus(100);
    const received = vi.fn();
    events.on("approval_received", received);
    const abort = new AbortController();
    abort.abort();
    await expect(new RuntimeSessionApprovalGate(events).requestApproval("session", "read", abort.signal))
      .resolves.toMatchObject({ approved: false });
    expect(received).toHaveBeenCalledOnce();
  });
});
