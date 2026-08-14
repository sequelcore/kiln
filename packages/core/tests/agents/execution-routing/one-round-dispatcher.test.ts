import { describe, expect, it } from "vitest";
import { createExecutionAccountRef } from "../../../src/agents/execution-routing/index.js";
import {
  dispatchOneModelRound,
  type OneRoundModelDispatchInput,
  type OneRoundModelDispatcher,
} from "../../../src/agents/execution-routing/index.js";

describe("provider-neutral one-round model dispatch", () => {
  it("validates and invokes the provider boundary exactly once", async () => {
    const input: OneRoundModelDispatchInput = {
      account: createExecutionAccountRef("account-a"),
      route: { providerId: "provider", providerModelId: "model", scope: "test" },
      sessionId: "session-a",
      turn: { history: [{ role: "user", parts: [{ type: "text", text: "hello" }] }] },
    };
    let calls = 0;
    const dispatcher: OneRoundModelDispatcher = {
      dispatchOneRound: async (received) => {
        calls += 1;
        expect(received).toBe(input);
        return {
          parts: [{ type: "text", text: "world" }],
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "completed",
        };
      },
    };

    const result = await dispatchOneModelRound(dispatcher, input);

    expect(calls).toBe(1);
    expect(result.parts).toEqual([{ type: "text", text: "world" }]);
  });

  it("rejects invalid input before calling the provider boundary", async () => {
    let calls = 0;
    const dispatcher: OneRoundModelDispatcher = {
      dispatchOneRound: async () => {
        calls += 1;
        throw new Error("must not dispatch");
      },
    };

    await expect(dispatchOneModelRound(dispatcher, {
      account: createExecutionAccountRef("account-a"),
      route: { providerId: "provider", providerModelId: "model", scope: "test" },
      sessionId: "",
      turn: { history: [] },
    })).rejects.toThrow("sessionId");
    expect(calls).toBe(0);
  });
});
