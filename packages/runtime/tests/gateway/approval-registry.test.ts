import { describe, it, expect, vi } from "vitest";
import { ApprovalGateRegistry } from "../../src/gateway/approval-registry.js";
import type { ApprovalTarget } from "../../src/gateway/approval-registry.js";

function makeTarget(status: string): ApprovalTarget & { approveSpy: ReturnType<typeof vi.fn>; rejectSpy: ReturnType<typeof vi.fn> } {
  let currentStatus = status;
  const approveSpy = vi.fn(() => { currentStatus = "running"; });
  const rejectSpy = vi.fn(() => { currentStatus = "running"; });
  return {
    approve: approveSpy,
    reject: rejectSpy,
    status: () => currentStatus,
    approveSpy,
    rejectSpy,
  };
}

describe("ApprovalGateRegistry", () => {
  describe("register / unregister", () => {
    it("unregister removes target so approve returns error", () => {
      const registry = new ApprovalGateRegistry();
      const target = makeTarget("awaiting_approval");
      registry.register("s1", target);
      registry.unregister("s1");
      const result = registry.approve("s1");
      expect(result).toEqual({ ok: false, error: "Session not found: s1" });
      expect(target.approveSpy).not.toHaveBeenCalled();
    });
  });

  describe("approve by sessionId", () => {
    it("succeeds when target is awaiting_approval", () => {
      const registry = new ApprovalGateRegistry();
      const target = makeTarget("awaiting_approval");
      registry.register("s1", target);
      const result = registry.approve("s1");
      expect(result).toEqual({ ok: true });
      expect(target.approveSpy).toHaveBeenCalledOnce();
    });

    it("fails when target status is not awaiting_approval", () => {
      const registry = new ApprovalGateRegistry();
      const target = makeTarget("running");
      registry.register("s1", target);
      const result = registry.approve("s1");
      expect(result).toEqual({ ok: false, error: "Session s1 is not awaiting approval" });
      expect(target.approveSpy).not.toHaveBeenCalled();
    });

    it("fails when sessionId not found", () => {
      const registry = new ApprovalGateRegistry();
      const result = registry.approve("missing");
      expect(result).toEqual({ ok: false, error: "Session not found: missing" });
    });
  });

  describe("approve without sessionId", () => {
    it("finds the first target in awaiting_approval and approves it", () => {
      const registry = new ApprovalGateRegistry();
      const t1 = makeTarget("awaiting_approval");
      const t2 = makeTarget("awaiting_approval");
      registry.register("s1", t1);
      registry.register("s2", t2);
      const result = registry.approve();
      expect(result).toEqual({ ok: true });
      // exactly one of the two is approved
      const approvedCount = [t1.approveSpy.mock.calls.length, t2.approveSpy.mock.calls.length];
      expect(approvedCount.filter((n) => n === 1)).toHaveLength(1);
      expect(approvedCount.filter((n) => n === 0)).toHaveLength(1);
    });

    it("returns error when no targets are pending", () => {
      const registry = new ApprovalGateRegistry();
      const target = makeTarget("running");
      registry.register("s1", target);
      const result = registry.approve();
      expect(result).toEqual({ ok: false, error: "No approval pending" });
      expect(target.approveSpy).not.toHaveBeenCalled();
    });

    it("returns error when registry is empty", () => {
      const registry = new ApprovalGateRegistry();
      const result = registry.approve();
      expect(result).toEqual({ ok: false, error: "No approval pending" });
    });
  });

  describe("reject by sessionId", () => {
    it("calls target.reject with reason when awaiting_approval", () => {
      const registry = new ApprovalGateRegistry();
      const target = makeTarget("awaiting_approval");
      registry.register("s1", target);
      const result = registry.reject("not ready", "s1");
      expect(result).toEqual({ ok: true });
      expect(target.rejectSpy).toHaveBeenCalledWith("not ready");
    });

    it("fails when target status is not awaiting_approval", () => {
      const registry = new ApprovalGateRegistry();
      const target = makeTarget("completed");
      registry.register("s1", target);
      const result = registry.reject("reason", "s1");
      expect(result).toEqual({ ok: false, error: "Session s1 is not awaiting approval" });
      expect(target.rejectSpy).not.toHaveBeenCalled();
    });

    it("fails when sessionId not found", () => {
      const registry = new ApprovalGateRegistry();
      const result = registry.reject("reason", "missing");
      expect(result).toEqual({ ok: false, error: "Session not found: missing" });
    });
  });

  describe("reject without sessionId", () => {
    it("finds the first awaiting target and rejects with reason", () => {
      const registry = new ApprovalGateRegistry();
      const t1 = makeTarget("running");
      const t2 = makeTarget("awaiting_approval");
      registry.register("s1", t1);
      registry.register("s2", t2);
      const result = registry.reject("bad output");
      expect(result).toEqual({ ok: true });
      expect(t1.rejectSpy).not.toHaveBeenCalled();
      expect(t2.rejectSpy).toHaveBeenCalledWith("bad output");
    });

    it("returns error when no targets are pending", () => {
      const registry = new ApprovalGateRegistry();
      const result = registry.reject("reason");
      expect(result).toEqual({ ok: false, error: "No approval pending" });
    });
  });

  describe("multiple targets", () => {
    it("approve targets correct session by sessionId, not others", () => {
      const registry = new ApprovalGateRegistry();
      const t1 = makeTarget("awaiting_approval");
      const t2 = makeTarget("awaiting_approval");
      registry.register("s1", t1);
      registry.register("s2", t2);
      const result = registry.approve("s2");
      expect(result).toEqual({ ok: true });
      expect(t1.approveSpy).not.toHaveBeenCalled();
      expect(t2.approveSpy).toHaveBeenCalledOnce();
    });
  });
});
