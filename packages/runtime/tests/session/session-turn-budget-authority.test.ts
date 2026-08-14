import { describe, expect, it, vi } from "vitest";
import { RuntimeSessionTurnBudgetService } from "../../src/session/session-turn-budget-authority.js";

describe("RuntimeSessionTurnBudgetService", () => {
  it("admits strictly below the observed session token limit", async () => {
    const service = new RuntimeSessionTurnBudgetService({ tokenLimit: 100, action: "stop" }, async () => ({ observedTokens: 99, source: "test" }));
    await expect(service.admit("session-1")).resolves.toMatchObject({ status: "admitted", reason: "observed-below-limit" });
  });

  it("stops the next turn at the exact observed limit", async () => {
    const service = new RuntimeSessionTurnBudgetService({ tokenLimit: 100, action: "stop" }, async () => ({ observedTokens: 100, source: "test" }));
    await expect(service.admit("session-1")).resolves.toMatchObject({ status: "denied", reason: "observed-at-or-above-limit", action: "stop" });
  });

  it("fails closed when usage is unknown", async () => {
    const service = new RuntimeSessionTurnBudgetService({ tokenLimit: 100, action: "stop" }, async () => { throw new Error("unreadable"); });
    await expect(service.admit("session-1")).resolves.toMatchObject({ status: "denied", reason: "usage-unknown", action: "stop" });
  });

  it("reads one exact session once per admission", async () => {
    const reader = vi.fn(async (sessionId: string) => ({ observedTokens: 0, source: "test", sessionId }));
    const service = new RuntimeSessionTurnBudgetService({ tokenLimit: 100, action: "stop" }, reader);
    await service.admit("session-a");
    expect(reader).toHaveBeenCalledExactlyOnceWith("session-a");
  });
});
