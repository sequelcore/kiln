import { describe, expect, it } from "vitest";
import {
  abandonModelGatewayReplayClaim,
  claimModelGatewayReplayAction,
  completeModelGatewayReplayClaim,
  createModelGatewayReplayClaim,
  persistModelGatewayReplayAdmission,
  settleModelGatewayReplayClaimUnknown,
  type ModelGatewayReplayFence,
} from "../../src/model-gateway/replay-claim.js";

const fence = (value: string) => value as ModelGatewayReplayFence;

describe("model gateway replay claim", () => {
  it("moves claimed to committed-unknown to completed", () => {
    const claimed = createModelGatewayReplayClaim<string>(fence("f-1"), "attempt-1");
    const admitted = persistModelGatewayReplayAdmission(claimed, fence("f-1"), "sha256:admission" as `sha256:${string}`);
    const committed = claimModelGatewayReplayAction(admitted, fence("f-1"), { admissionId: "sha256:admission", effectIdentity: "model-round:test" });
    expect(committed.phase).toBe("committed");
    expect(completeModelGatewayReplayClaim(committed, fence("f-1"), "safe-result"))
      .toMatchObject({ phase: "completed", fence: "f-1", attemptId: "attempt-1", admissionId: "sha256:admission", effectIdentity: "model-round:test", value: "safe-result" });
  });

  it("allows only predispatch abandonment and rejects stale fences", () => {
    const claimed = createModelGatewayReplayClaim<string>(fence("f-1"), "attempt-1");
    expect(abandonModelGatewayReplayClaim(claimed, fence("f-1"))).toBeUndefined();
    expect(() => persistModelGatewayReplayAdmission(claimed, fence("stale"), "sha256:admission" as `sha256:${string}`)).toThrow("Stale replay fence");
    const admitted = persistModelGatewayReplayAdmission(claimed, fence("f-1"), "sha256:admission" as `sha256:${string}`);
    const committed = claimModelGatewayReplayAction(admitted, fence("f-1"), { admissionId: "sha256:admission", effectIdentity: "model-round:test" });
    expect(() => abandonModelGatewayReplayClaim(committed, fence("f-1"))).toThrow("predispatch");
    expect(settleModelGatewayReplayClaimUnknown(committed, fence("f-1"))).toMatchObject({ phase: "committed-unknown", fence: "f-1", attemptId: "attempt-1", admissionId: "sha256:admission", effectIdentity: "model-round:test" });
    expect(() => completeModelGatewayReplayClaim(settleModelGatewayReplayClaimUnknown(committed, fence("f-1")), fence("f-1"), "late"))
      .toThrow("cannot be completed");
  });
});
