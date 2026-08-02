import { describe, expect, it } from "vitest";
import { proveEconomicRouteLifecycle } from "./economic-route-proof-fixture.js";

describe("OpenCode Zen economic route", () => {
  it("keeps unknown balance authority explicit and reconciles metered usage only as an estimate", async () => {
    const result = await proveEconomicRouteLifecycle({
      providerId: "opencode-zen",
      routeId: "opencode-zen-metered",
      modelId: "anthropic/claude-sonnet-4-6",
      priceKind: "metered",
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

    expect(result.events).toEqual(["commitment", "dispatch-fence", "adapter-binding", "settlement"]);
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
  });
});
