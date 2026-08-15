import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineExecutionCatalog,
  type ExecutionCatalog,
  type ModelGatewayConfig,
} from "@kilnai/core";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import {
  createModelGatewayExecutionRoutingPort,
  createModelGatewayIngress,
  type ModelGatewayExecutionCandidatePort,
} from "../../src/model-gateway/model-gateway-ingress.js";

const evidence = {
  sourceIdentity: "fixture-source",
  sourceRevision: "revision-1",
  sourceDigest: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-01-01T00:00:00.000Z",
  validUntil: "2026-12-31T00:00:00.000Z",
  confidence: "high" as const,
  authority: "configured" as const,
};
const catalog: ExecutionCatalog = defineExecutionCatalog({
  accounts: [{
    id: "account",
    providerId: "codex-oauth",
    credentialId: "credential",
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
    economics: {
      capacityIdentity: "account-capacity",
      subscriptionClass: "subscription",
      quotaClassId: "quota",
      creditPosture: "disabled",
      overagePosture: "disabled",
    },
  }],
  accountPolicies: [],
  routes: [{
    id: "route",
    label: "Fixture route",
    providerId: "codex-oauth",
    providerModelId: "gpt-test",
    dataClassification: "internal",
    dataPolicyEvidence: { providerId: "codex-oauth", providerModelId: "gpt-test", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" },
    accountSelection: { mode: "exact", accountId: "account" },
    economics: {
      adapterCapabilityId: "fixture-adapter",
      adapterCapabilityVersion: "v1",
      authBillingChannel: "oauth-subscription",
      executionMode: "responses-api",
      serviceTier: "standard",
      rateCardBasis: "configured",
      envelopeSemantics: "configured-upper-bound",
      fallbackPosture: "disabled",
      overagePosture: "disabled",
      contextClass: "standard",
      cacheClass: "provider-cache",
      priceEvidence: { kind: "subscription", rateCardId: "fixture-rate-card", rateCardRevision: "v1", evidence },
      auxiliaryCharges: [],
      executionEnvelope: { limits: [{ atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" } }] },
    },
  }],
});

function config(targetId = "route"): ModelGatewayConfig {
  return {
    port: 4801,
    replay: { ttlMs: 1_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
    surfaces: { openAIResponses: { maxBodyBytes: 1024 * 1024, maxConcurrentRequests: 1 } },
    principals: [{
      tokenEnv: "TOKEN",
      ingress: "openai-responses",
      tenantId: "tenant",
      applicationId: "app",
      callerId: "caller",
      capabilityId: "invoke",
      scopes: ["model.invoke"],
      budgetEvidenceId: "budget",
      virtualModelIds: ["model"],
    }],
    virtualModels: [{
      id: "model",
      targetId,
      capabilities: ["text"],
      affinity: { continuity: "none" },
    }],
  };
}

function authority(): SqliteManagedAccountLeaseAuthority {
  return new SqliteManagedAccountLeaseAuthority({
    path: ":memory:",
    participantKind: "model-gateway-ingress",
    recoveryDomain: `model-gateway-test-${crypto.randomUUID()}`,
    configurationRevision: "fixture",
  });
}

const env = { REPLAY_SECRET: "r".repeat(32), TOKEN: "t".repeat(32) };
const noCandidates: ModelGatewayExecutionCandidatePort = { resolve: vi.fn(async () => []) };
const noDispatcher = { resolve: vi.fn(async () => { throw new Error("No dispatcher is available in this fixture."); }) };

describe("createModelGatewayIngress", () => {
  const authorities: SqliteManagedAccountLeaseAuthority[] = [];

  afterEach(() => {
    for (const value of authorities.splice(0)) value.close();
    vi.restoreAllMocks();
  });

  it("fails closed when a virtual model references an unknown canonical target", async () => {
    const sharedAuthority = authority();
    authorities.push(sharedAuthority);
    await expect(createModelGatewayIngress({
      config: config("missing-route"),
      executionCatalog: catalog,
      executionRouting: createModelGatewayExecutionRoutingPort(catalog),
      executionCandidates: noCandidates,
      executionDispatcher: noDispatcher,
      accountCapacityAuthority: sharedAuthority,
      databasePath: ":memory:",
      env,
    })).rejects.toThrow(/unknown target/);
  });

  it("resolves the overlay through injected admission and candidate ports", async () => {
    const sharedAuthority = authority();
    authorities.push(sharedAuthority);
    const candidates: ModelGatewayExecutionCandidatePort = { resolve: vi.fn(async () => []) };
    const handle = await createModelGatewayIngress({
      config: config(),
      executionCatalog: catalog,
      executionRouting: createModelGatewayExecutionRoutingPort(catalog),
      executionCandidates: candidates,
      executionDispatcher: noDispatcher,
      accountCapacityAuthority: sharedAuthority,
      databasePath: ":memory:",
      env,
    });
    try {
      const response = await handle.openAIResponses!.resolveVirtualModel({
        principal: { tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidence: { status: "admitted", evidenceId: "budget" } },
        requestedModel: "model",
      });
      expect(response?.route).toEqual({ routeId: "route", providerId: "codex-oauth", providerModelId: "gpt-test", scope: "virtual:model" });
      const listed = await handle.openAIResponses!.invocationPorts.candidateCatalog.list({
        identity: { tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" },
        route: response!.route,
        authority: { status: "admitted", capabilityId: "invoke", scopes: ["model.invoke"] },
        budget: { status: "admitted", evidenceId: "budget" },
      });
      expect(listed.admission.routeId).toBe("route");
      expect(candidates.resolve).toHaveBeenCalledWith(expect.objectContaining({
        admission: expect.objectContaining({ routeId: "route" }),
        route: expect.objectContaining({ routeId: "route" }),
      }));
    } finally {
      handle.close();
    }
  });

  it("selects the exact route id when duplicate provider/model identities exist and denies route-id drift", async () => {
    const duplicate = defineExecutionCatalog({ ...catalog, routes: [catalog.routes[0]!, { ...catalog.routes[0]!, id: "route-other", label: "Other" }] });
    const sharedAuthority = authority();
    authorities.push(sharedAuthority);
    const candidates: ModelGatewayExecutionCandidatePort = { resolve: vi.fn(async () => []) };
    const handle = await createModelGatewayIngress({
      config: config("route-other"), executionCatalog: duplicate,
      executionRouting: createModelGatewayExecutionRoutingPort(duplicate), executionCandidates: candidates,
      executionDispatcher: noDispatcher, accountCapacityAuthority: sharedAuthority, databasePath: ":memory:", env,
    });
    try {
      const resolved = await handle.openAIResponses!.resolveVirtualModel({
        principal: { tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidence: { status: "admitted", evidenceId: "budget" } },
        requestedModel: "model",
      });
      await expect(handle.openAIResponses!.invocationPorts.candidateCatalog.list({
        identity: { tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" },
        route: resolved!.route, authority: { status: "admitted", capabilityId: "invoke", scopes: ["model.invoke"] },
        budget: { status: "admitted", evidenceId: "budget" },
      })).resolves.toMatchObject({ admission: { routeId: "route-other" } });
      await expect(handle.openAIResponses!.invocationPorts.candidateCatalog.list({
        identity: { tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "drift" },
        route: { ...resolved!.route, routeId: "route" }, authority: { status: "admitted", capabilityId: "invoke", scopes: ["model.invoke"] },
        budget: { status: "admitted", evidenceId: "budget" },
      })).rejects.toThrow(/unavailable/u);
    } finally { handle.close(); }
  });
});
