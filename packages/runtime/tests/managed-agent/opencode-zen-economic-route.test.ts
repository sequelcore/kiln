import { describe, expect, it } from "vitest";
import { proveEconomicRouteLifecycle } from "./economic-route-proof-fixture.js";

describe("OpenCode Zen economic route", () => {
  it("keeps unknown balance authority explicit and reconciles metered usage only as an estimate", async () => {
    const result = await proveEconomicRouteLifecycle({
      providerId: "opencode-zen",
      routeId: "opencode-zen-metered",
      modelId: "anthropic/claude-sonnet-4-6",
      priceKind: "metered",
      quotaRequirement: "optional",
      quotaEvidence: {
        kind: "unknown",
        capacityIdentity: "opencode-zen-capacity",
        subscriptionClass: "unknown",
        reason: "remote-auto-reload-state-unobservable",
        evidence: null,
        credits: { status: "unknown", balance: null },
        spendControl: { status: "unknown", limit: null, used: null, remainingPercent: null, resetsAt: null },
        exhaustionReason: null,
      },
    });

    expect(result.settlement).toMatchObject({ kind: "estimated", evidence: { authority: "calculated-estimate" } });
    expect(result.settlement).not.toHaveProperty("charge");
    expect(result.record).toMatchObject({
      state: "released",
      commitment: { reservation: { selectedIdentity: { route: {
        providerId: "opencode-zen",
        fallbackPosture: "disabled",
        overagePosture: "disabled",
      } } } },
      settlement: { kind: "estimated" },
    });

    const lifecycleEvents = result.replayedEvents.filter((event) => event.kind === "managed_economic_lifecycle");
    expect(lifecycleEvents.map((event) => event.transition)).toEqual(["held", "dispatch-fenced", "released"]);
    for (const event of lifecycleEvents) {
      expect(event.selectedRoute).toMatchObject({
        routeId: "opencode-zen-metered",
        providerId: "opencode-zen",
        modelId: "anthropic/claude-sonnet-4-6",
      });
      expect(event.policyId).toBe("opencode-zen-policy");
      expect(event.policyRevision).toBe("revision-1");
    }
    const dispatchFenced = lifecycleEvents.find((event) => event.transition === "dispatch-fenced");
    expect(dispatchFenced?.dispatchFenceId).toBeTruthy();
    const released = lifecycleEvents.find((event) => event.transition === "released");
    expect(released?.dispatchFenceId).toBe(dispatchFenced?.dispatchFenceId);
    expect(released?.settlementKind).toBe("estimated");

    const lifecycleFrames = result.frames.filter((frame) => frame.event.kind === "managed_economic_lifecycle");
    expect(lifecycleFrames.length).toBe(lifecycleEvents.length);
    for (const frame of lifecycleFrames) {
      const serialized = JSON.stringify(frame.event.payload);
      expect(serialized).not.toContain("accountRef");
      expect(serialized).not.toContain("credentialRevision");
    }
  });
});
