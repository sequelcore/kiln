import { describe, expect, it } from "vitest";
import {
  buildOperatorToolResultPayload,
  parseOperatorToolResultEnvelope,
  presentOperatorEventPayload,
} from "../src/index.js";

describe("operator tool result contract", () => {
  it("normalizes nested envelopes into one operator payload", () => {
    const payload = buildOperatorToolResultPayload({
      toolCallId: "call-1",
      toolName: "managed_agent.invoke",
      output: JSON.stringify({
        result: {
          output: JSON.stringify({
            output: "child completed",
            metadata: {
              invocationId: "managed-1",
              resourceLinks: [{ uri: "kiln://managed/managed-1", title: "Managed invocation" }],
            },
          }),
          isError: false,
        },
      }),
      outputSummary: "completed",
    });

    expect(payload).toEqual({
      toolCallId: "call-1",
      toolName: "managed_agent.invoke",
      output: "child completed",
      outputSummary: "completed",
      metadata: {
        invocationId: "managed-1",
        resourceLinks: [{ uri: "kiln://managed/managed-1", title: "Managed invocation" }],
      },
      resourceLinks: [{ uri: "kiln://managed/managed-1", title: "Managed invocation" }],
      status: { state: "succeeded" },
    });
  });

  it("preserves explicit runtime evidence and failure status", () => {
    const payload = buildOperatorToolResultPayload({
      toolCallId: "call-2",
      toolName: "read",
      output: JSON.stringify({ output: "permission denied", isError: false }),
      isError: true,
      metadata: { operation: "read", source: "runtime" },
      resourceLinks: [{ uri: "kiln://resource/error" }],
      toolUsage: { calls: 1 },
    });

    expect(payload).toEqual({
      toolCallId: "call-2",
      toolName: "read",
      output: "permission denied",
      outputSummary: "permission denied",
      metadata: { operation: "read", source: "runtime" },
      resourceLinks: [{ uri: "kiln://resource/error" }],
      toolUsage: { calls: 1 },
      status: { state: "failed" },
    });

    expect(presentOperatorEventPayload("tool_call_completed", payload)).toMatchObject({
      title: "Failed read",
      tone: "error",
      conversationDisposition: "exception",
    });
  });

  it("exposes the same envelope parser used by presentation", () => {
    expect(parseOperatorToolResultEnvelope(JSON.stringify({
      output: "ok",
      isError: false,
      metadata: { operation: "read" },
    }))).toEqual({
      output: "ok",
      isError: false,
      metadata: { operation: "read" },
      resourceLinks: [],
    });
  });
});
