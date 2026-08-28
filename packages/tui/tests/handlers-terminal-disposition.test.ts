import { describe, expect, it, vi } from "vitest";
import type { OperatorTurnTerminalDisposition } from "@kilnai/gateway-contracts";

vi.mock("@opentui/core", () => ({
  BoxRenderable: class { add = vi.fn(); },
  TextRenderable: class {
    content = "";
    destroy = vi.fn();
    constructor(_: unknown, props?: { content?: string }) {
      this.content = props?.content ?? "";
    }
  },
  MarkdownRenderable: class {},
  t: (strings: TemplateStringsArray, ...values: readonly unknown[]) =>
    strings.reduce((text, chunk, index) => `${text}${chunk}${String(values[index] ?? "")}`, ""),
  fg: () => (text: string) => text,
}));

import { handleCompleted, type HandlerContext } from "../src/handlers.js";
import { createReactiveState } from "../src/state.js";
import type { KilnTheme } from "../src/theme.js";

const convergence = {
  policy: {
    policyId: "test.tui.turn-convergence",
    configurationHash: `sha256:${"0".repeat(64)}`,
    providerRequests: 10,
    toolRounds: 8,
    toolCalls: 24,
    cumulativeInputTokens: 256_000,
    elapsedMs: 600_000,
    activeMs: 600_000,
    recoveryAttempts: 3,
    consecutiveNoProgressSteps: 3,
  },
  progressEvidence: [],
} as const;

const noProgress = {
  outcome: "paused",
  dispositionReason: "no_progress",
  convergence: {
    ...convergence,
    progressEvidence: [{
      kind: "no_progress",
      reason: "repeated_result",
      strategyFingerprint: "strategy:catalog-search",
      supportingToolCallIds: ["tool-1", "tool-2"],
    }],
    pause: {
      status: "pause",
      reason: "no_progress",
      metric: "consecutiveNoProgressSteps",
      observed: 3,
      limit: 3,
    },
  },
} as const satisfies OperatorTurnTerminalDisposition;

function requiredProducerCompletion(status: "not_run" | "unavailable") {
  return {
    obligations: [{
      kind: "required_producer",
      obligationId: "required-producer:formal_verify",
      canonicalToolId: "formal_verify",
      acceptedEquivalentToolIds: [],
      sourceAlias: "Dafny",
    }],
    producerEvidence: [{
      canonicalProducerId: "formal_verify",
      status,
    }],
    eligibility: {
      status: "ineligible",
      unmet: [{
        obligationId: "required-producer:formal_verify",
        canonicalToolId: "formal_verify",
        sourceAlias: "Dafny",
        status,
      }],
    },
  } as const;
}

function requiredProducerDisposition(
  status: "not_run" | "unavailable",
): OperatorTurnTerminalDisposition {
  return status === "not_run"
    ? {
        outcome: "paused",
        dispositionReason: "required_producer_not_run",
        completion: requiredProducerCompletion(status),
        convergence,
      }
    : {
        outcome: "failed",
        dispositionReason: "required_producer_unavailable",
        completion: requiredProducerCompletion(status),
        convergence,
      };
}

function createContext() {
  const state = createReactiveState();
  state.status = "running";
  state.respondingProvider = "codex-oauth";
  state.respondingModel = "gpt-5.6-sol";
  const ui = { commandBarStatus: { content: "" } };
  const theme = {
    info: "info",
    accent: "accent",
    success: "success",
    warning: "warning",
    error: "error",
  } as KilnTheme;
  return {
    ctx: {
      state,
      ui,
      theme: () => theme,
    } as unknown as HandlerContext,
    ui,
  };
}

function settle(ctx: HandlerContext, disposition: OperatorTurnTerminalDisposition) {
  handleCompleted(
    ctx,
    1.25,
    disposition,
    11,
    5,
    undefined,
    "codex-oauth",
    { interval: null },
    { node: null },
    vi.fn(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
  );
}

describe("TUI terminal disposition rendering", () => {
  it("keeps eligible completion on the normal idle path", () => {
    const { ctx, ui } = createContext();
    settle(ctx, {
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion: {
        obligations: [],
        producerEvidence: [],
        eligibility: { status: "eligible" },
      },
      convergence,
    });

    expect(ctx.state.status).toBe("idle");
    expect(ctx.state.currentActivity).toEqual({ phase: "" });
    expect(ui.commandBarStatus.content).toBe("");
    expect(ctx.state.cost).toBe(1.25);
    expect(ctx.state.inputTokens).toBe(11);
    expect(ctx.state.outputTokens).toBe(5);
  });

  it("projects no-progress metric and limit from the canonical presentation", () => {
    const { ctx, ui } = createContext();
    settle(ctx, noProgress);

    expect(ctx.state.status).toBe("idle");
    expect(ctx.state.currentActivity.phase).toBe("responding");
    expect(ctx.state.currentActivity.details).toContain("Turn paused");
    expect(ctx.state.currentActivity.details).toContain("No progress detected (no_progress)");
    expect(ctx.state.currentActivity.details).toContain("Convergence metric: consecutiveNoProgressSteps");
    expect(ctx.state.currentActivity.details).toContain("Convergence observed: 3");
    expect(ctx.state.currentActivity.details).toContain("Convergence limit: 3");
    expect(ui.commandBarStatus.content).toBe(ctx.state.currentActivity.details);
  });

  it.each([
    ["not_run", "paused", "Required producer was not run"],
    ["unavailable", "failed", "Required producer unavailable"],
  ] as const)("projects required producer %s without relabeling it", (producerStatus, expectedOutcome, expectedTitle) => {
    const { ctx, ui } = createContext();
    const disposition = requiredProducerDisposition(producerStatus);
    settle(ctx, disposition);

    expect(ctx.state.status).toBe(expectedOutcome === "failed" ? "error" : "idle");
    expect(ctx.state.currentActivity.details).toContain(`Turn ${expectedOutcome}`);
    expect(ctx.state.currentActivity.details).toContain(expectedTitle);
    expect(ctx.state.currentActivity.details).toContain("formal_verify: ");
    expect(ui.commandBarStatus.content).toBe(ctx.state.currentActivity.details);
  });

  it("projects runtime failure as the canonical error disposition", () => {
    const { ctx, ui } = createContext();
    settle(ctx, { outcome: "failed", dispositionReason: "runtime_failure" });

    expect(ctx.state.status).toBe("error");
    expect(ctx.state.currentActivity.details).toContain("Runtime failure (runtime_failure)");
    expect(ui.commandBarStatus.content).toContain("Runtime failure");
  });

  it("projects cancellation without fabricating completion evidence", () => {
    const { ctx, ui } = createContext();
    settle(ctx, { outcome: "cancelled", dispositionReason: "operator_cancelled" });

    expect(ctx.state.status).toBe("idle");
    expect(ctx.state.currentActivity.details).toContain("Cancelled by operator (operator_cancelled)");
    expect(ctx.state.currentActivity.details).not.toContain("Completion eligibility");
    expect(ui.commandBarStatus.content).toContain("Turn cancelled");
  });
});
