import { describe, expect, it } from "vitest";
import type { OperatorCockpitEconomicAttemptProjection } from "@kilnai/gateway-contracts";
import { formatManagedEconomicAttemptLines } from "../../src/commands/managed-agent.js";

describe("managed-agent CLI economic cockpit", () => {
  it("renders the secret-free Runtime-owned explanation fields", () => {
    const attempts: readonly OperatorCockpitEconomicAttemptProjection[] = [{
      jobId: "managed-economic-job:cli-fixture",
      economicAttemptId: "economic-attempt:cli-fixture:1",
      instanceId: "local-cli",
      sessionId: "session-cli",
      policyId: "managed-agent-intent:reviewer",
      policyRevision: "revision-1",
      policyDigest: "sha256:fixture",
      transition: "released",
      selectedRoute: {
        routeId: "codex-review",
        providerId: "codex-oauth",
        modelId: "gpt-test",
        adapterCapabilityId: "codex-adapter",
        adapterCapabilityVersion: "1",
      },
      selectedTarget: {
        targetId: "codex-review",
        providerId: "codex-oauth",
        modelId: "gpt-test",
        reason: "only-admitted-target",
      },
      billingClass: "metered",
      providerAllowance: { status: "available", evidenceFreshness: "fresh" },
      workLimitProgress: { dimension: "turns", consumed: 2, limit: 4, status: "within-limit" },
      reservedAmount: { atoms: "25", scale: 2, unit: "request", scheme: { kind: "currency", currency: "USD" } },
      settledAmount: { atoms: "12", scale: 2, unit: "request", scheme: { kind: "currency", currency: "USD" } },
      perChildConsumption: [{ childId: "child-cli", comparability: "comparable" }],
      evidenceFreshness: "fresh",
      terminalCause: "completed",
      eventCount: 2,
      latestEventId: "economic:event:2",
    }];

    expect(formatManagedEconomicAttemptLines(attempts)).toEqual([
      "Economic attempts:",
      expect.stringContaining("target:codex-review(only-admitted-target)"),
    ]);
    const line = formatManagedEconomicAttemptLines(attempts)[1]!;
    expect(line).toContain("billing:metered");
    expect(line).toContain("allowance:available/fresh");
    expect(line).toContain("work:turns=2/4");
    expect(line).toContain("reserved:25e-2 request USD");
    expect(line).toContain("settled:12e-2 request USD");
    expect(line).toContain("children:child-cli[none]");
    expect(line).toContain("evidence:fresh");
    expect(line).toContain("terminal:completed");
  });
});
