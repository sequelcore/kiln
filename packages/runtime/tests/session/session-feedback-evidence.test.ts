import { describe, expect, it } from "vitest";
import { createSessionEvent, type FeedbackEvidenceSelection } from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";
import { collectRuntimeFeedbackEvidence } from "../../src/session/session-feedback-evidence.js";

describe("runtime session feedback evidence", () => {
  it("collects selected session summary, tool failure, command output, file change, and diagnostic evidence", () => {
    const session = createSession();
    session.addUserMessage(textParts("Run the typecheck."));
    session.addAssistantMessage(textParts("I will run it."));
    session.updateSessionLedger({
      currentPhase: "responded",
      lastProvider: "codex-oauth",
      toolCallCount: 2,
      turnDepth: 1,
      lastSummary: "Typecheck failed after feedback contract changes.",
    });

    appendCanonicalTurnEvents({
      session,
      channel: "cli",
      userMessageContent: "Run the typecheck.",
      assistantMessageContent: "Typecheck failed.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: new Date("2026-05-18T10:00:00.000Z"),
      turnCompletedAt: new Date("2026-05-18T10:00:04.000Z"),
      continuity: { strategy: "continue" },
      runtimeEvents: [
        {
          type: "tool_called",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-shell-typecheck",
          toolName: "shell_command",
          toolInput: { command: "bun run --filter @kilnai/runtime typecheck" },
          timestamp: new Date("2026-05-18T10:00:01.000Z"),
        },
        {
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-shell-typecheck",
          toolName: "shell_command",
          durationMs: 3000,
          success: false,
          isError: true,
          output: "src/session/session-feedback-evidence.ts(1,1): error TS2307",
          resultSummary: "Runtime typecheck failed.",
          timestamp: new Date("2026-05-18T10:00:04.000Z"),
        },
        {
          type: "error",
          code: "runtime_typecheck_failed",
          message: "Typecheck failed while collecting feedback evidence.",
          timestamp: new Date("2026-05-18T10:00:04.000Z"),
        },
      ],
      fileChanges: [
        {
          path: "packages/runtime/src/session/session-feedback-evidence.ts",
          changeType: "created",
          linesAdded: 80,
          diffPreview: "+export function collectRuntimeFeedbackEvidence",
        },
      ],
    });
    session.appendSessionEvents([
      createSessionEvent<"agent_invocation_failed">({
        kilnSessionId: session.id,
        sequence: session.nextSessionEventSequence(),
        kind: "agent_invocation_failed",
        turnId: `${session.id}:turn:1`,
        invocationId: "managed-invocation-1",
        agentId: "reviewer",
        parentSessionId: session.id,
        errorCode: "ENGINE_FAILURE",
        errorMessage: "Managed reviewer failed.",
        retriable: true,
        managedInvocationEvidence: {
          diagnostics: [
            {
              uri: "kiln://artifacts/managed-invocation-1/diagnostics",
              kind: "failure",
            },
          ],
          resultHandoff: {
            summary: "Managed reviewer stopped before producing findings.",
            resourceUris: ["kiln://artifacts/managed-invocation-1/result"],
            memoryWriteProposalUris: [],
          },
        },
        source: { actor: "runtime", surface: "runtime", component: "managed-invocation" },
        timestamp: new Date("2026-05-18T10:00:05.000Z"),
      }),
    ]);

    const evidence = collectRuntimeFeedbackEvidence({
      session,
      selection: allEvidenceSelected(),
      gitStatus: " M packages/runtime/src/session/session-feedback-evidence.ts",
    });

    expect(evidence.map((item) => item.kind)).toEqual([
      "session-summary",
      "transcript-excerpt",
      "tool-failure",
      "command-output",
      "environment",
      "git-status",
      "file-change-summary",
      "log-excerpt",
      "diagnostic-finding",
    ]);
    expect(evidence.find((item) => item.kind === "session-summary")?.content)
      .toContain("Typecheck failed after feedback contract changes.");
    expect(evidence.find((item) => item.kind === "tool-failure")?.content)
      .toContain("Runtime typecheck failed.");
    expect(evidence.find((item) => item.kind === "command-output")?.content)
      .toContain("error TS2307");
    expect(evidence.find((item) => item.kind === "file-change-summary")?.content)
      .toContain("packages/runtime/src/session/session-feedback-evidence.ts");
    expect(evidence.find((item) => item.kind === "git-status")?.content)
      .toContain("packages/runtime/src/session/session-feedback-evidence.ts");
    expect(evidence.find((item) => item.kind === "diagnostic-finding")?.content)
      .toContain("runtime_typecheck_failed");
    expect(evidence.find((item) => item.kind === "diagnostic-finding")?.content)
      .toContain("ENGINE_FAILURE");
    expect(evidence.find((item) => item.kind === "diagnostic-finding")?.content)
      .toContain("kiln://artifacts/managed-invocation-1/diagnostics");
    expect(evidence.find((item) => item.kind === "log-excerpt")?.content)
      .toContain("Typecheck failed while collecting feedback evidence.");
  });

  it("does not extract transcript excerpts unless explicitly selected", () => {
    const session = createSession();
    session.addUserMessage(textParts("Private transcript content."));
    session.addAssistantMessage(textParts("Private assistant content."));

    const evidence = collectRuntimeFeedbackEvidence({
      session,
      selection: {
        ...allEvidenceSelected(),
        includeTranscriptExcerpts: false,
      },
    });

    expect(evidence.some((item) => item.kind === "transcript-excerpt")).toBe(false);
    expect(evidence.map((item) => item.content).join("\n")).not.toContain("Private transcript content.");
  });

  it("renders managed-agent completed and cancelled evidence into diagnostics", () => {
    const session = createSession();
    const source = { actor: "runtime" as const, surface: "runtime" as const, component: "managed-invocation" };
    session.appendSessionEvents([
      createSessionEvent<"agent_invocation_completed">({
        kilnSessionId: session.id,
        sequence: session.nextSessionEventSequence(),
        kind: "agent_invocation_completed",
        turnId: `${session.id}:turn:1`,
        invocationId: "managed-completed",
        agentId: "worker",
        parentSessionId: session.id,
        resultSummary: "Worker completed repair analysis.",
        managedInvocationEvidence: {
          transcript: {
            uri: "kiln://artifacts/managed-completed/transcript",
            redacted: true,
            truncated: false,
            persisted: true,
            retention: "session",
          },
          resultHandoff: {
            summary: "Repair analysis completed.",
            resourceUris: ["kiln://artifacts/managed-completed/result"],
            memoryWriteProposalUris: [],
          },
          writeEvidence: [
            {
              evidenceId: "write-evidence-1",
              invocationId: "managed-completed",
              kind: "write-proposal-created",
              proposalId: "proposal-1",
              summary: "Worker proposed a runtime collector patch.",
              resourceUris: ["kiln://artifacts/managed-completed/write-proposal"],
              recordedAt: "2026-05-18T10:00:00.000Z",
            },
          ],
        },
        source,
        timestamp: new Date("2026-05-18T10:00:00.000Z"),
      }),
      createSessionEvent<"agent_invocation_cancelled">({
        kilnSessionId: session.id,
        sequence: session.nextSessionEventSequence() + 1,
        kind: "agent_invocation_cancelled",
        turnId: `${session.id}:turn:1`,
        invocationId: "managed-cancelled",
        agentId: "reviewer",
        parentSessionId: session.id,
        reason: "Operator cancelled review.",
        cancelledBy: "operator",
        source,
        timestamp: new Date("2026-05-18T10:01:00.000Z"),
      }),
    ]);

    const diagnostics = collectRuntimeFeedbackEvidence({
      session,
      selection: {
        ...allEvidenceSelected(),
        includeSessionSummary: false,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: false,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
      },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.kind).toBe("diagnostic-finding");
    expect(diagnostics[0]?.content).toContain("kiln://artifacts/managed-completed/transcript");
    expect(diagnostics[0]?.content).toContain("Repair analysis completed.");
    expect(diagnostics[0]?.content).toContain("Worker proposed a runtime collector patch.");
    expect(diagnostics[0]?.content).toContain("Operator cancelled review.");
  });
});

function createSession(): RuntimeSession {
  return new RuntimeSession({
    appName: "kiln",
    tenantId: "local",
    userId: "ricardo",
    systemPrompt: "Test session.",
    sessionId: "session-feedback-runtime",
  });
}

function textParts(text: string): readonly [{ readonly type: "text"; readonly text: string }] {
  return [{ type: "text", text }];
}

function allEvidenceSelected(): FeedbackEvidenceSelection {
  return {
    includeSessionSummary: true,
    includeTranscriptExcerpts: true,
    includeToolFailures: true,
    includeCommandOutput: true,
    includeEnvironment: true,
    includeGitStatus: true,
    includeLogs: true,
    includeFileChangeSummary: true,
    includeDiagnosticFindings: true,
  };
}
