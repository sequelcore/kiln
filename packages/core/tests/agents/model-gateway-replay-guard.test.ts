import { describe, expect, it } from "vitest";
import {
  abandonModelGatewayReplayClaim,
  commitModelGatewayReplayClaim,
  completeModelGatewayReplayClaim,
  createModelGatewayReplayClaim,
  settleModelGatewayReplayClaimUnknown,
  type ModelGatewayReplayFence,
} from "../../src/agents/model-gateway/index.js";

const fence = (value: string) => value as ModelGatewayReplayFence;

describe("model gateway replay claim", () => {
  it("moves claimed to committed-unknown to completed", () => {
    const claimed = createModelGatewayReplayClaim<string>(fence("f-1"));
    const committed = commitModelGatewayReplayClaim(claimed, fence("f-1"));
    expect(committed.phase).toBe("committed");
    expect(completeModelGatewayReplayClaim(committed, fence("f-1"), "safe-result"))
      .toEqual({ phase: "completed", fence: "f-1", value: "safe-result" });
  });

  it("allows only predispatch abandonment and rejects stale fences", () => {
    const claimed = createModelGatewayReplayClaim<string>(fence("f-1"));
    expect(abandonModelGatewayReplayClaim(claimed, fence("f-1"))).toBeUndefined();
    expect(() => commitModelGatewayReplayClaim(claimed, fence("stale"))).toThrow("Stale replay fence");
    const committed = commitModelGatewayReplayClaim(claimed, fence("f-1"));
    expect(() => abandonModelGatewayReplayClaim(committed, fence("f-1"))).toThrow("predispatch");
    expect(settleModelGatewayReplayClaimUnknown(committed, fence("f-1"))).toEqual({ phase: "committed-unknown", fence: "f-1" });
    expect(() => completeModelGatewayReplayClaim(settleModelGatewayReplayClaimUnknown(committed, fence("f-1")), fence("f-1"), "late"))
      .toThrow("cannot be completed");
  });
});
