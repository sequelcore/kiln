import { describe, expect, it, vi } from "vitest";
import type { OperatorTurnTerminalDisposition } from "@kilnai/gateway-contracts";

vi.mock("hono/bun", () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: vi.fn(),
    websocket: {},
  }),
}));

const policy = {
  policyId: "test.runtime.turn-convergence",
  configurationHash: `sha256:${"0".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 8,
  toolCalls: 24,
  cumulativeInputTokens: 256_000,
  elapsedMs: 600_000,
  activeMs: 600_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
} as const;

const convergence = {
  policy,
  progressEvidence: [],
} as const;

const ineligibleCompletion = {
  obligations: [{
    kind: "required_producer",
    obligationId: "required-producer:formal_verify",
    canonicalToolId: "formal_verify",
    acceptedEquivalentToolIds: [],
    sourceAlias: "Dafny",
  }],
  producerEvidence: [{
    canonicalProducerId: "formal_verify",
    status: "not_run",
  }],
  eligibility: {
    status: "ineligible",
    unmet: [{
      obligationId: "required-producer:formal_verify",
      canonicalToolId: "formal_verify",
      sourceAlias: "Dafny",
      status: "not_run",
    }],
  },
} as const;

const terminalDispositions = {
  completed: {
    outcome: "completed",
    dispositionReason: "completion_eligible",
    completion: {
      obligations: [],
      producerEvidence: [],
      eligibility: { status: "eligible" },
    },
    convergence,
  },
  noProgress: {
    outcome: "paused",
    dispositionReason: "no_progress",
    convergence: {
      ...convergence,
      pause: {
        status: "pause",
        reason: "no_progress",
        metric: "consecutiveNoProgressSteps",
        observed: 3,
        limit: 3,
      },
    },
  },
  requiredProducerNotRun: {
    outcome: "paused",
    dispositionReason: "required_producer_not_run",
    completion: ineligibleCompletion,
    convergence,
  },
  cancelled: {
    outcome: "cancelled",
    dispositionReason: "operator_cancelled",
  },
} as const satisfies Record<string, OperatorTurnTerminalDisposition>;

const commonFrameFields = {
  kilnSessionId: "session-1",
  sourceMessageId: "message-1",
  content: "terminal output",
  parts: [{ type: "text", text: "terminal output" }],
  inputTokens: 12,
  outputTokens: 4,
  routedProvider: "codex-oauth",
  routedModel: "gpt-5.6-sol",
  runtimeContinuity: { strategy: "none" },
  authorityStatus: {
    effective: "audited",
    admittedAuthority: "audited",
    requestedAuthority: "auto",
    executionMode: "execute",
    completeness: "authoritative",
  },
} as const;

describe("operator terminal disposition gateway frames", () => {
  it.each([
    ["completed", terminalDispositions.completed],
    ["no-progress pause", terminalDispositions.noProgress],
    ["required producer not run", terminalDispositions.requiredProducerNotRun],
    ["operator cancellation", terminalDispositions.cancelled],
  ] as const)("preserves the exact %s disposition for GUI and TUI", async (_label, disposition) => {
    const { buildGuiDoneFramePayload } = await import("../../src/gateway/gui-gateway.js");
    const { buildTuiDoneFramePayload } = await import("../../src/gateway/tui-gateway.js");

    const expected = {
      type: "done",
      ...commonFrameFields,
      ...disposition,
    };

    expect(buildGuiDoneFramePayload({ ...commonFrameFields, ...disposition })).toEqual(expected);
    expect(buildTuiDoneFramePayload({ ...commonFrameFields, ...disposition })).toEqual(expected);
  });
});
