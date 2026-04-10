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
    it("requires sessionId", () => {
      const registry = new ApprovalGateRegistry();
      const result = registry.approve();
      expect(result).toEqual({ ok: false, error: "sessionId is required" });
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
    it("requires sessionId", () => {
      const registry = new ApprovalGateRegistry();
      const result = registry.reject("reason");
      expect(result).toEqual({ ok: false, error: "sessionId is required" });
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
