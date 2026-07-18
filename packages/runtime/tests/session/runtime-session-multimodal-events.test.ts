import { describe, expect, it } from "vitest";
import { textParts } from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";

describe("runtime multimodal session events", () => {
  it("projects multimodal route evidence into canonical operator events", () => {
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
    });
    session.addUserMessage(textParts("Describe this image"));

    const timestamp = new Date("2026-05-13T12:00:00.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Describe this image",
      assistantMessageContent: "The image shows a form.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: timestamp,
      turnCompletedAt: timestamp,
      continuity: { strategy: "new-session" },
      runtimeEvents: [{
        type: "multimodal_routed",
        sessionId: session.id,
        timestamp,
        provider: "openai",
        model: "gpt-4o",
        strategy: "native",
        reasonCode: "native_supported",
        reason: "The active provider/model can accept the required modality.",
        requestedCapability: "vision",
        requiredModalities: ["text", "image"],
        artifactUris: ["kiln://runtime/session-artifact/0"],
        diagnostics: [],
      }],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "multimodal_routed",
        provider: {
          provider: "openai",
          model: "gpt-4o",
          canonicalModel: undefined,
          billingMode: undefined,
        },
        strategy: "native",
        reasonCode: "native_supported",
        requestedCapability: "vision",
        requiredModalities: ["text", "image"],
        artifactUris: ["kiln://runtime/session-artifact/0"],
      }),
    ]));
  });
});
