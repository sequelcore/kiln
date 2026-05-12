import { describe, expect, it } from "vitest";
import { textParts } from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";

describe("runtime work item session events", () => {
  it("projects work item tool metadata into canonical session events", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Plan the work"));

    const timestamp = new Date("2026-05-08T12:00:00.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Plan the work",
      assistantMessageContent: "Work item tracked.",
      queued: false,
      turnStartedAt: timestamp,
      turnCompletedAt: timestamp,
      continuity: { strategy: "new-session" },
      runtimeEvents: [
        {
          type: "tool_called",
          sessionId: session.id,
          timestamp,
          toolName: "work_item.update",
          toolInput: {
            summary: "Validate managed agent work evidence",
          },
        },
        {
          type: "tool_result",
          sessionId: session.id,
          timestamp,
          toolName: "work_item.update",
          durationMs: 12,
          success: true,
          output: "{}",
          metadata: {
            kind: "work_item",
            toolName: "work_item.update",
            operation: "update",
            id: "work-1",
            status: "pending",
            item: {
              id: "work-1",
              summary: "Validate managed agent work evidence",
              status: "pending",
              workflowProfile: "managed-agent-change",
              triggers: ["managed-agents"],
              expectedEvidence: ["managed-agent-review", "typecheck"],
              providedEvidence: ["managed-agent-review"],
              verificationGates: ["bun run typecheck"],
              dependencies: [],
              createdAt: "2026-05-08T12:00:00.000Z",
              updatedAt: "2026-05-08T12:00:00.000Z",
              sequence: 1,
            },
            sequence: 1,
          },
        },
      ],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "work_item_updated",
        operation: "update",
        toolCallId: expect.stringContaining(":tool:1"),
        workItem: expect.objectContaining({
          id: "work-1",
          summary: "Validate managed agent work evidence",
          workflowProfile: "managed-agent-change",
        }),
      }),
    ]));
  });

  it("projects work item execution attempt metadata into canonical session events", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Execute the next work item"));

    const timestamp = new Date("2026-05-12T20:00:00.000Z");
    const workItem = {
      id: "work-1",
      summary: "Verify goal execution.",
      status: "in_progress",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      providedEvidence: [],
      verificationGates: ["bun test"],
      dependencies: [],
      executionAttempts: [{
        id: "goal-1:work-1:attempt:1",
        workItemId: "work-1",
        goalRunId: "goal-1",
        status: "started",
        executionMode: "direct",
        startedAt: "2026-05-12T20:00:00.000Z",
              providedEvidence: [],
              missingEvidence: [],
              skippedVerificationGates: [],
              verificationGateResults: [],
              missingResidualRisk: false,
            }],
      createdAt: "2026-05-12T20:00:00.000Z",
      updatedAt: "2026-05-12T20:00:00.000Z",
      sequence: 2,
    };
    const finishedWorkItem = {
      ...workItem,
      status: "completed",
      providedEvidence: ["tests"],
      executionAttempts: [{
        ...workItem.executionAttempts[0]!,
        status: "completed",
        completedAt: "2026-05-12T20:01:00.000Z",
        providedEvidence: ["tests"],
        verificationGateResults: [
          { gate: "bun test", status: "passed" },
          { gate: "bun run typecheck", status: "failed" },
        ],
      }],
      updatedAt: "2026-05-12T20:01:00.000Z",
      sequence: 3,
    };

    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Execute the next work item",
      assistantMessageContent: "Work item executed.",
      queued: false,
      turnStartedAt: timestamp,
      turnCompletedAt: timestamp,
      continuity: { strategy: "new-session" },
      runtimeEvents: [
        {
          type: "tool_called",
          sessionId: session.id,
          timestamp,
          toolName: "work_item.execution.start",
          toolInput: { id: "work-1" },
        },
        {
          type: "tool_result",
          sessionId: session.id,
          timestamp,
          toolName: "work_item.execution.start",
          durationMs: 8,
          success: true,
          output: "{}",
          metadata: {
            kind: "work_item",
            operation: "execution_started",
            item: workItem,
            attempt: workItem.executionAttempts[0],
          },
        },
        {
          type: "tool_called",
          sessionId: session.id,
          timestamp,
          toolName: "work_item.execution.finish",
          toolInput: { id: "work-1" },
        },
        {
          type: "tool_result",
          sessionId: session.id,
          timestamp,
          toolName: "work_item.execution.finish",
          durationMs: 9,
          success: true,
          output: "{}",
          metadata: {
            kind: "work_item",
            operation: "execution_finished",
            item: finishedWorkItem,
            attempt: finishedWorkItem.executionAttempts[0],
            missingEvidence: [],
            missingGoalEvidence: ["typecheck"],
            missingVerificationGates: ["adversarial managed-agent review"],
            failedVerificationGates: ["bun run typecheck"],
            missingResidualRisk: false,
          },
        },
      ],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "work_item_execution_started",
        workItem: expect.objectContaining({ id: "work-1" }),
        attempt: expect.objectContaining({
          id: "goal-1:work-1:attempt:1",
          status: "started",
        }),
      }),
      expect.objectContaining({
        kind: "work_item_execution_finished",
        workItem: expect.objectContaining({
          id: "work-1",
          status: "completed",
        }),
        attempt: expect.objectContaining({
          id: "goal-1:work-1:attempt:1",
          status: "completed",
        }),
        missingEvidence: [],
        missingGoalEvidence: ["typecheck"],
        missingVerificationGates: ["adversarial managed-agent review"],
        failedVerificationGates: ["bun run typecheck"],
        missingResidualRisk: false,
      }),
    ]));
  });
});
