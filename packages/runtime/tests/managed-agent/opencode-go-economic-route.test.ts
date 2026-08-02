import { describe, expect, it } from "vitest";
import { proveEconomicRouteLifecycle } from "./economic-route-proof-fixture.js";

describe("OpenCode Go economic route", () => {
  it("preserves unavailable quota as unknown while priority-only subscription dispatch settles distinctly", async () => {
    const result = await proveEconomicRouteLifecycle({
      providerId: "opencode-go",
      routeId: "opencode-go-subscription",
      modelId: "glm-test",
      priceKind: "subscription",
      quotaEvidence: {
        kind: "unknown",
        capacityIdentity: "opencode-go-capacity",
        subscriptionClass: "unknown",
        reason: "provider-quota-missing",
        evidence: null,
        exhaustionReason: null,
      },
    });

    expect(result.events).toEqual(["commitment", "dispatch-fence", "adapter-binding", "settlement"]);
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
  });
});
