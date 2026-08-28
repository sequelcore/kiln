import { describe, expect, it } from "vitest";
import {
  copyTuiTerminalDisposition,
  parseTuiDoneFrame,
} from "../src/ws-client.js";

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

const doneFields = {
  type: "done",
  kilnSessionId: "session-1",
  sourceMessageId: "message-1",
  content: "terminal output",
  inputTokens: 12,
  outputTokens: 4,
} as const;

describe("TUI terminal disposition wire contract", () => {
  it("accepts completion and preserves the shared disposition", () => {
    const frame = parseTuiDoneFrame({
      ...doneFields,
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion: {
        obligations: [],
        producerEvidence: [],
        eligibility: { status: "eligible" },
      },
      convergence,
    });

    expect(frame).not.toBeNull();
    expect(frame && copyTuiTerminalDisposition(frame)).toEqual({
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion: {
        obligations: [],
        producerEvidence: [],
        eligibility: { status: "eligible" },
      },
      convergence,
    });
  });

  it("accepts a no-progress pause with its correlated pause evidence", () => {
    const frame = parseTuiDoneFrame({
      ...doneFields,
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
    });

    expect(frame).not.toBeNull();
    expect(copyTuiTerminalDisposition(frame!)).toEqual({
      outcome: "paused",
      dispositionReason: "no_progress",
      convergence: expect.objectContaining({
        pause: expect.objectContaining({
          reason: "no_progress",
          observed: 3,
        }),
        progressEvidence: [{
          kind: "no_progress",
          reason: "repeated_result",
          strategyFingerprint: "strategy:catalog-search",
          supportingToolCallIds: ["tool-1", "tool-2"],
        }],
      }),
    });
  });

  it("accepts a required producer not-run pause and retains unmet evidence", () => {
    const completion = {
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
    const frame = parseTuiDoneFrame({
      ...doneFields,
      outcome: "paused",
      dispositionReason: "required_producer_not_run",
      completion,
      convergence,
    });

    expect(frame).not.toBeNull();
    expect(copyTuiTerminalDisposition(frame!)).toEqual({
      outcome: "paused",
      dispositionReason: "required_producer_not_run",
      completion,
      convergence,
    });
  });

  it("accepts cancellation as a terminal disposition without inventing evidence", () => {
    const frame = parseTuiDoneFrame({
      ...doneFields,
      outcome: "cancelled",
      dispositionReason: "operator_cancelled",
    });

    expect(frame).not.toBeNull();
    expect(copyTuiTerminalDisposition(frame!)).toEqual({
      outcome: "cancelled",
      dispositionReason: "operator_cancelled",
    });
  });

  it("rejects an outcome/reason mismatch before the session queue sees it", () => {
    const frame = parseTuiDoneFrame({
      ...doneFields,
      outcome: "completed",
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
    });

    expect(frame).toBeNull();
  });

  it("survives evidence-bearing fields without reducing them to outcome text", () => {
    const evidence = {
      obligations: [{
        kind: "required_producer",
        obligationId: "required-producer:static_analyze",
        canonicalToolId: "static_analyze",
        acceptedEquivalentToolIds: [],
        sourceAlias: "Oxlint",
      }],
      producerEvidence: [{
        canonicalProducerId: "static_analyze",
        status: "accepted",
        evidenceReferences: [{
          toolCallScopeId: "scope-oxlint",
          toolCallId: "tool-oxlint",
        }],
      }],
      eligibility: { status: "eligible" },
    } as const;
    const frame = parseTuiDoneFrame({
      ...doneFields,
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion: evidence,
      convergence: {
        ...convergence,
        progressEvidence: [{
          kind: "progress",
          reason: "new_material_result",
          evidenceFingerprint: "oxlint-report:fingerprint",
          supportingToolCallIds: ["tool-oxlint"],
        }],
      },
    });

    expect(frame).not.toBeNull();
    expect(frame && "completion" in frame ? frame.completion : undefined).toEqual(evidence);
    expect(frame && "convergence" in frame ? frame.convergence.progressEvidence : undefined).toEqual([{
      kind: "progress",
      reason: "new_material_result",
      evidenceFingerprint: "oxlint-report:fingerprint",
      supportingToolCallIds: ["tool-oxlint"],
    }]);
  });
});
