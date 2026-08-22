import { describe, expect, it } from "vitest";
import { projectDirectExecutionCatalog, validateGlobalConfig } from "../../src/config/global-config.js";
import { deriveManagedAgentEconomicPolicies } from "../../src/config/managed-agent-intent.js";
import { executionTargetEvidenceRevision } from "../../src/config/execution-target-evidence-store.js";
import {
  managedAgentExecutionCatalog,
  managedAgentIntentConfig,
  managedAgentTargetEvidence,
} from "./managed-agent-intent-config-fixture.js";

describe("bounded managed-agent intent", () => {
  it("accepts purpose, authority, target/model selection, work limits, and paid posture", () => {
    expect(() => validateGlobalConfig(managedAgentIntentConfig())).not.toThrow();
  });

  it("rejects the replaced operator-authored economic policy shape", () => {
    const invalid = structuredClone(managedAgentIntentConfig()) as Record<string, any>;
    invalid.managedAgents.economicPolicies = [];
    expect(() => validateGlobalConfig(invalid as never)).toThrow(/Unknown managedAgents field: economicPolicies/);
  });

  it("rejects a monetary cap without an enforceable comparable scheme", () => {
    const invalid = structuredClone(managedAgentIntentConfig()) as Record<string, any>;
    invalid.managedAgents.intents[0].paidUsage = {
      kind: "cap",
      amount: { atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" } },
    };
    expect(() => validateGlobalConfig(invalid as never)).toThrow(/scheme.kind must be currency or credit/);
  });

  it("derives policy identity, candidates, and comparable reservation from target evidence", () => {
    const config = managedAgentIntentConfig();
    const evidence = managedAgentTargetEvidence();
    const revision = executionTargetEvidenceRevision(evidence);
    const executionCatalog = projectDirectExecutionCatalog(
      { ...config, targetCatalog: { ...config.targetCatalog!, evidenceRevision: revision } },
      evidence,
      revision,
    );
    const [policy] = deriveManagedAgentEconomicPolicies({
      managedAgents: config.managedAgents,
      executionCatalog,
      targetEvidenceRevision: revision,
    });
    expect(policy).toMatchObject({
      id: "managed-agent-intent:economic-worker",
      intentId: "economic-worker",
      noRouteAction: "deny",
      evidenceRequirements: { quota: "optional", price: "required" },
    });
    expect(policy?.candidates).toHaveLength(1);
    expect(policy?.candidates[0]?.targetId).toBe("codex-standard");
    expect(policy?.candidates[0]?.worstCaseReservation.kind).toBe("exact");
  });

  it("fails closed when an explicit spend cap cannot be compared", () => {
    const config = structuredClone(managedAgentIntentConfig()) as any;
    config.managedAgents.intents[0].paidUsage = {
      kind: "cap",
      amount: {
        atoms: "25",
        scale: 0,
        unit: "request",
        scheme: { kind: "currency", currency: "USD" },
      },
    };
    const executionCatalog = structuredClone(managedAgentExecutionCatalog()) as any;
    executionCatalog.routes[0].economics.priceEvidence = {
      ...executionCatalog.routes[0].economics.priceEvidence,
      kind: "unknown",
      reason: "fixture has no comparable price evidence",
    };
    const [policy] = deriveManagedAgentEconomicPolicies({
      managedAgents: config.managedAgents,
      executionCatalog,
      targetEvidenceRevision: config.targetCatalog?.evidenceRevision,
    });
    expect(policy?.candidates).toHaveLength(0);
    expect(policy?.unavailableReason).toMatch(/cannot enforce.*monetary cap|cap cannot be enforced/);
  });

  it("fails closed when the selected account policy permits credit or overage", () => {
    const config = managedAgentIntentConfig();
    const executionCatalog = structuredClone(managedAgentExecutionCatalog()) as any;
    executionCatalog.accounts[0].economics = {
      ...executionCatalog.accounts[0].economics,
      creditPosture: "committed",
    };
    const [policy] = deriveManagedAgentEconomicPolicies({
      managedAgents: config.managedAgents,
      executionCatalog,
      targetEvidenceRevision: config.targetCatalog?.evidenceRevision,
    });
    expect(policy?.candidates).toHaveLength(0);
    expect(policy?.unavailableReason).toMatch(/account and economic evidence/);
  });

  it("keeps the fixture's runtime catalog projection free of operator policy material", () => {
    const catalog = managedAgentExecutionCatalog();
    expect(catalog.routes[0]?.economics.priceEvidence.kind).toBe("metered");
    expect(JSON.stringify(managedAgentIntentConfig())).not.toContain("comparisonDomains");
  });
});
