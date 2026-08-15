import { describe, expect, it } from "vitest";
import type { RouteAdmissionDecision } from "@kilnai/core";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import { decideNativeAgentProjection } from "./native-agent-projection-decision.js";

const agent = (targetId = "codex"): KilnAgentDefinition => ({
  name: "coder", role: "Coding", goal: "Implement", tier: "coding", scope: "project",
  targetId,
});
const admitted: RouteAdmissionDecision = {
  status: "admitted",
  route: {
    identity: { routeId: "codex", revision: "v1" }, target: { providerId: "codex-oauth", modelId: "gpt-5.5" },
    adapter: { kind: "direct-provider", capabilityId: "test", capabilityVersion: "v1" }, authorityCeiling: "read_only",
    toolNames: [], supportsRecursion: false, supportsAttachments: false, supportsWrite: false,
    proof: { status: "configured", source: "test", provenProfiles: ["foundation-readonly-plan"] }, capacity: { kind: "accountless" }, settlement: { kind: "not-required" },
  }, effectiveAuthority: "read_only", allowedToolNames: [],
};

describe("decideNativeAgentProjection", () => {
  it("keeps route admission independent from Codex transport encoding", () => {
    expect(decideNativeAgentProjection({ agent: agent(), harness: "codex", admission: admitted })).toMatchObject({ kind: "project", nativeModel: "gpt-5.5" });
    expect(decideNativeAgentProjection({ agent: agent(), harness: "claude", admission: admitted })).toMatchObject({ kind: "unavailable", reason: { kind: "transport", code: "native-encoder-unavailable" } });
  });

  it("propagates canonical route rejection instead of provider denial", () => {
    const unavailable: RouteAdmissionDecision = { status: "unavailable", routeId: "claude", reasons: [{ code: "profile-unproven", profile: "foundation-readonly-plan" }] };
    expect(decideNativeAgentProjection({ agent: agent("claude"), harness: "codex", admission: unavailable })).toEqual({ kind: "unavailable", harness: "codex", admission: unavailable, reason: { kind: "route-admission", reasons: unavailable.reasons } });
  });

  it("does not project an admitted decision for a different route identity", () => {
    expect(decideNativeAgentProjection({ agent: agent("different-target"), harness: "codex", admission: admitted }))
      .toMatchObject({ kind: "unresolved", reason: { kind: "route-admission", reasons: [{ code: "proof-unknown" }] } });
  });

  it("does not project an admitted native route with runtime-selected capacity", () => {
    const runtimeSelected: RouteAdmissionDecision = {
      ...admitted,
      route: {
        ...admitted.route,
        capacity: { kind: "policy-bound", accountPolicyId: "managed-codex" },
      },
    };

    expect(decideNativeAgentProjection({ agent: agent(), harness: "codex", admission: runtimeSelected }))
      .toMatchObject({
        kind: "unavailable",
        admission: { status: "unavailable", reasons: [{ code: "capacity-policy-mismatch" }] },
        reason: { kind: "route-admission", reasons: [{ code: "capacity-policy-mismatch" }] },
      });
  });
});
