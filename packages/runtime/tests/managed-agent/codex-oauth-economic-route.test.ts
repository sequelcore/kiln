import { describe, expect, it } from "vitest";
import { proveEconomicRouteLifecycle } from "./economic-route-proof-fixture.js";

describe("Codex OAuth economic route", () => {
  it("commits known quota, fences before adapter binding, and reconciles an exact local estimate", async () => {
    const result = await proveEconomicRouteLifecycle({
      providerId: "codex-oauth",
      routeId: "codex-token-route",
      modelId: "gpt-5.6-codex",
      priceKind: "metered",
      quotaEvidence: {
        kind: "known",
        capacityIdentity: "codex-oauth-capacity",
        subscriptionClass: "metered",
        quotaClassId: "codex-oauth-quota",
        buckets: [{
          bucketId: "primary",
          dimension: "percent",
          remaining: { atoms: "625", scale: 1, unit: "percent", scheme: { kind: "unit" } },
          windowDurationMinutes: 300,
          resetsAt: "2026-08-02T17:00:00.000Z",
        }],
        exhaustionReason: null,
        evidence: {
          sourceIdentity: "codex-oauth-provider-usage",
          sourceRevision: "revision-1",
          sourceDigest: `sha256:${"a".repeat(64)}`,
          observedAt: "2026-08-02T11:59:00.000Z",
          validUntil: "2026-08-02T12:05:00.000Z",
          confidence: "high",
          authority: "provider-reported",
        },
      },
    });

    expect(result.events).toEqual(["commitment", "dispatch-fence", "adapter-binding", "settlement"]);
    expect(result.settlement).toMatchObject({ kind: "estimated", evidence: { authority: "calculated-estimate" } });
    expect(result.record).toMatchObject({
      state: "released",
      decisionEvidence: { decision: { kind: "selected", selected: { identity: { route: { providerId: "codex-oauth" } } } } },
      settlement: { kind: "estimated" },
    });
  });
});
