import { describe, expect, it } from "vitest";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";

describe("LocalModelGatewayStore", () => {
  it("retains replay completion without owning account capacity", () => {
    const store = new LocalModelGatewayStore({
      path: ":memory:",
      replaySecret: "r".repeat(32),
      replayTtlMs: 60_000,
      replayMaxEntries: 5,
    });
    const key = store.fingerprint({
      ingress: "openai-responses",
      rawBody: "{}",
      tenantId: "tenant",
      applicationId: "app",
      callerId: "caller",
      sessionId: "session",
      turnId: "turn",
      route: {
        providerId: "provider",
        providerModelId: "model",
        scope: "scope",
      },
      toolExecutionMode: "caller-owned",
    });
    const dispatch = store.claim(key);
    expect(dispatch.kind).toBe("dispatch");
    if (dispatch.kind === "dispatch") {
      store.markCommitted(dispatch.key, dispatch.fence);
      store.complete(dispatch.key, dispatch.fence, {
        responseId: "response",
        result: {
          parts: [{ type: "text", text: "ok" }],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          stopReason: "completed",
        },
      });
    }
    expect(store.claim(key)).toMatchObject({ kind: "replay-completed" });
    expect("acquire" in store).toBe(false);
    expect("read" in store).toBe(false);
    store.close();
  });
});
