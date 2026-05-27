import { describe, expect, it, vi } from "vitest";
import { RuntimeBudgetAdmissionService } from "../../src/session/runtime-budget-admission.js";

describe("RuntimeBudgetAdmissionService", () => {
  it("admits routes when budget admission is disabled", async () => {
    const service = new RuntimeBudgetAdmissionService({
      policy: { enabled: false, routeBudgets: [] },
    });

    await expect(service.admit({
      subject: "managed-orchestration",
      sessionId: "session-1",
      routeCandidates: [{ routeId: "codex-write", providerId: "codex", model: "gpt-5.5" }],
    })).resolves.toMatchObject({
      status: "admitted",
      reason: "budget-disabled",
    });
  });

  it("fails closed when enabled admission has no usage reader", async () => {
    const service = new RuntimeBudgetAdmissionService({
      policy: {
        enabled: true,
        routeBudgets: [{ providerId: "codex", dailyTokenCeiling: 100 }],
      },
    });

    await expect(service.admit({
      subject: "managed-orchestration",
      sessionId: "session-1",
      routeCandidates: [{ routeId: "codex-write", providerId: "codex", model: "gpt-5.5" }],
    })).resolves.toMatchObject({
      status: "denied",
      reason: "usage-unavailable",
      missingCapabilities: ["budget.usage.available"],
    });
  });

  it("admits when at least one candidate route is within its budget ceiling", async () => {
    const usageReader = vi.fn(async ({ providerId }: { readonly providerId: string }) => ({
      providerId,
      tokensUsed: providerId === "codex" ? 150 : 10,
      source: "test-meter",
    }));
    const service = new RuntimeBudgetAdmissionService({
      policy: {
        enabled: true,
        routeBudgets: [
          { providerId: "codex", dailyTokenCeiling: 100 },
          { providerId: "opencode", dailyTokenCeiling: 100 },
        ],
      },
      usageReader,
    });

    const decision = await service.admit({
      subject: "managed-orchestration",
      sessionId: "session-1",
      routeCandidates: [
        { routeId: "codex-write", providerId: "codex", model: "gpt-5.5" },
        { routeId: "opencode-write", providerId: "opencode", model: "minimax-m2.5-free" },
      ],
    });

    expect(decision).toMatchObject({
      status: "admitted",
      reason: "route-within-budget",
      admittedRoutes: [expect.objectContaining({ routeId: "opencode-write" })],
    });
    expect(usageReader).toHaveBeenCalledTimes(2);
  });

  it("denies when every candidate route is over budget", async () => {
    const service = new RuntimeBudgetAdmissionService({
      policy: {
        enabled: true,
        routeBudgets: [{ providerId: "codex", dailyTokenCeiling: 100 }],
      },
      usageReader: async ({ providerId }) => ({
        providerId,
        tokensUsed: 101,
        source: "test-meter",
      }),
    });

    await expect(service.admit({
      subject: "managed-orchestration",
      sessionId: "session-1",
      routeCandidates: [{ routeId: "codex-write", providerId: "codex", model: "gpt-5.5" }],
    })).resolves.toMatchObject({
      status: "denied",
      reason: "all-routes-over-budget",
      missingCapabilities: ["budget.route.within_ceiling"],
    });
  });

  it("fails closed when the usage reader throws", async () => {
    const service = new RuntimeBudgetAdmissionService({
      policy: {
        enabled: true,
        routeBudgets: [{ providerId: "codex", dailyTokenCeiling: 100 }],
      },
      usageReader: async () => {
        throw new Error("meter unavailable");
      },
    });

    await expect(service.admit({
      subject: "runtime-session-turn",
      sessionId: "session-1",
      routeCandidates: [{ providerId: "codex", model: "gpt-5.5" }],
    })).resolves.toMatchObject({
      status: "denied",
      reason: "usage-unavailable",
      missingCapabilities: ["budget.usage.available"],
    });
  });
});
