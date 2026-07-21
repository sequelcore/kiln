import { describe, expect, it, vi } from "vitest";
import {
  buildEffectivePromptManifest,
  textParts,
  type EffectivePromptManifest,
  type ProviderAdapter,
} from "@kilnai/core";
import { requestRuntimeSessionFallbackResponse } from "../../src/session/runtime-session-orchestrator-response.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

function session(): RuntimeSession {
  return new RuntimeSession({
    appName: "app",
    tenantId: "tenant",
    userId: "user",
    systemPrompt: "base",
  });
}

function provider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("done"),
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

describe("requestRuntimeSessionFallbackResponse", () => {
  it("uses the manifest as the only prompt authority", async () => {
    const adapter = provider();
    const manifest = buildEffectivePromptManifest({
      components: [{
        id: "exact",
        revision: "revision",
        scope: "static",
        content: "Exact prompt.",
        provenance: { source: "test" },
      }],
    });

    await requestRuntimeSessionFallbackResponse(adapter, manifest, session(), 100);

    expect((adapter.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].system)
      .toBe(manifest.finalPrompt);
  });

  it("rejects an invalid separate prompt before invoking the provider", async () => {
    const adapter = provider();

    await expect(requestRuntimeSessionFallbackResponse(
      adapter,
      "incorrect separate prompt" as unknown as EffectivePromptManifest,
      session(),
      100,
    )).rejects.toThrow("effective prompt manifest");
    expect(adapter.createMessage).not.toHaveBeenCalled();
  });
});
