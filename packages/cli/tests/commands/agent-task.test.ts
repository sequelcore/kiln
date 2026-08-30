import { describe, expect, it, vi } from "vitest";
import { agentTaskCommand } from "../../src/commands/agent-task.js";

describe("agentTaskCommand", () => {
  it("submits a bounded profile objective and waits through the typed Runtime client", async () => {
    const log = vi.fn();
    const close = vi.fn();
    const delay = vi.fn(async () => undefined);
    const client = {
      submit: vi.fn(async () => ({ id: "job-1", state: "queued" })),
      status: vi.fn()
        .mockResolvedValueOnce({ id: "job-1", state: "running" })
        .mockResolvedValueOnce({ id: "job-1", state: "succeeded" }),
      result: vi.fn(async () => ({ jobId: "job-1", availability: "available" })),
      cancel: vi.fn(),
      replay: vi.fn(),
    };

    await agentTaskCommand([
      "submit", "--profile", "reviewer", "--idempotency-key", "review-1", "--wait", "Review", "this", "boundary",
    ], { createClient: () => ({ client, close }), delay, log });

    expect(client.submit).toHaveBeenCalledWith({
      objective: "Review this boundary",
      configuredAgentProfileId: "reviewer",
      idempotencyKey: "review-1",
    });
    expect(client.status).toHaveBeenCalledTimes(2);
    expect(client.result).toHaveBeenCalledWith("job-1");
    expect(delay).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "Agent Task job-1: queued.",
      "Agent Task job-1: available.",
    ]);
  });

  it("supports durable follow-up operations and rejects routing overrides", async () => {
    const log = vi.fn();
    const close = vi.fn();
    const client = {
      submit: vi.fn(),
      status: vi.fn(async () => ({ id: "job-1", state: "running" })),
      result: vi.fn(),
      cancel: vi.fn(),
      replay: vi.fn(),
    };
    await agentTaskCommand(["status", "--json", "job-1"], {
      createClient: () => ({ client, close }), log,
    });
    expect(client.status).toHaveBeenCalledWith("job-1");
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      operation: "status",
      jobId: "job-1",
      state: "running",
    }));
    await expect(agentTaskCommand(["submit", "--profile", "reviewer", "--provider", "codex-oauth", "Review"], {
      createClient: () => ({ client, close }), log,
    })).rejects.toThrow(/routing.*Runtime-owned/i);
  });

  it("prints a useful bounded result without leaking the canonical admission bundle", async () => {
    const log = vi.fn();
    const client = {
      submit: vi.fn(),
      status: vi.fn(),
      result: vi.fn(async () => ({
        jobId: "job-1",
        availability: "available",
        lifecycleState: "succeeded",
        configuredAgentProfileId: "scout",
        admissionProfileId: "foundation-readonly-plan",
        routeId: "codex-terra",
        providerId: "codex-oauth",
        completedAt: "2026-08-30T22:52:51.284Z",
        handoff: {
          summary: "cross-account-worker-ok",
          resourceUris: ["kiln://managed-agents/invocations/child/handoff"],
          memoryWriteProposalUris: [],
        },
        admissionBundle: { secret: "must-not-be-printed" },
      })),
      cancel: vi.fn(),
      replay: vi.fn(),
    };

    await agentTaskCommand(["result", "job-1"], { createClient: () => ({ client, close: vi.fn() }), log });
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "Agent Task job-1: succeeded via codex-terra (codex-oauth).",
      "cross-account-worker-ok",
      "Resources:\n- kiln://managed-agents/invocations/child/handoff",
    ]);

    log.mockClear();
    await agentTaskCommand(["result", "--json", "job-1"], { createClient: () => ({ client, close: vi.fn() }), log });
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      operation: "result",
      jobId: "job-1",
      state: "succeeded",
      availability: "available",
      configuredAgentProfileId: "scout",
      admissionProfileId: "foundation-readonly-plan",
      routeId: "codex-terra",
      providerId: "codex-oauth",
      completedAt: "2026-08-30T22:52:51.284Z",
      summary: "cross-account-worker-ok",
      resourceUris: ["kiln://managed-agents/invocations/child/handoff"],
      memoryWriteProposalUris: [],
    }));
  });
});
