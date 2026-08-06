import { describe, expect, it } from "vitest";
import { proveEconomicRouteLifecycle } from "./economic-route-proof-fixture.js";

describe("OpenCode Go economic route", () => {
  it("preserves unavailable quota as unknown while priority-only subscription dispatch settles distinctly", async () => {
    const result = await proveEconomicRouteLifecycle({
      providerId: "opencode-go",
      routeId: "opencode-go-subscription",
      modelId: "glm-test",
      priceKind: "subscription",
      quotaRequirement: "optional",
      quotaEvidence: {
        kind: "unknown",
        capacityIdentity: "opencode-go-capacity",
        subscriptionClass: "unknown",
        reason: "provider-quota-missing",
        evidence: null,
        exhaustionReason: null,
      },
    });

    expect(result.settlement).toMatchObject({ kind: "subscription" });
    expect(result.settlement).not.toHaveProperty("charge");
    expect(result.record).toMatchObject({
      state: "released",
      commitment: { reservation: { selectedIdentity: { account: {
        quotaEvidence: { kind: "unknown", reason: "provider-quota-missing" },
        creditPosture: "disabled",
        overagePosture: "disabled",
      } } } },
      settlement: { kind: "subscription" },
    });

    const lifecycleEvents = result.replayedEvents.filter((event) => event.kind === "managed_economic_lifecycle");
    expect(lifecycleEvents.map((event) => event.transition)).toEqual(["held", "dispatch-fenced", "released"]);
    for (const event of lifecycleEvents) {
      expect(event.selectedRoute).toMatchObject({
        routeId: "opencode-go-subscription",
        providerId: "opencode-go",
        modelId: "glm-test",
      });
      expect(event.policyId).toBe("opencode-go-policy");
      expect(event.policyRevision).toBe("revision-1");
    }
    const dispatchFenced = lifecycleEvents.find((event) => event.transition === "dispatch-fenced");
    expect(dispatchFenced?.dispatchFenceId).toBeTruthy();
    const released = lifecycleEvents.find((event) => event.transition === "released");
    expect(released?.dispatchFenceId).toBe(dispatchFenced?.dispatchFenceId);
    expect(released?.settlementKind).toBe("subscription");

    const lifecycleFrames = result.frames.filter((frame) => frame.event.kind === "managed_economic_lifecycle");
    expect(lifecycleFrames.length).toBe(lifecycleEvents.length);
    for (const frame of lifecycleFrames) {
      const serialized = JSON.stringify(frame.event.payload);
      expect(serialized).not.toContain("accountRef");
      expect(serialized).not.toContain("credentialRevision");
    }
  });
});
