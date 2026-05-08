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
});
