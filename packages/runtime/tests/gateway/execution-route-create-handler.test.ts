import { describe, expect, it, vi } from "vitest";
import type { ExecutionRouteCatalog, ExecutionRouteCreationRequest, GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import { handleExecutionRouteCreate } from "../../src/gateway/execution-route-create-handler.js";

const catalog: ExecutionRouteCatalog = { routes: [], revision: `sha256:${"c".repeat(64)}` };

describe("handleExecutionRouteCreate", () => {
  it("rejects an unauthenticated operator before creation or catalog refresh", async () => {
    const create = vi.fn();
    const readExecutionRouteCatalog = vi.fn(async () => catalog);
    const frames = await handleExecutionRouteCreate({ operatorAuthorized: false, frame: request(), discovery: discovery(), executionRouteCatalog: catalog, createExecutionRoute: create, readExecutionRouteCatalog });
    expect(create).not.toHaveBeenCalled();
    expect(readExecutionRouteCatalog).not.toHaveBeenCalled();
    expect(frames).toEqual([expect.objectContaining({ type: "execution_route_create_result", requestId: "request-1", status: "rejected", code: "EXECUTION_ROUTE_CREATE_DENIED" })]);
  });

  it("rejects malformed input without invoking the creation port", async () => {
    const create = vi.fn();
    const frames = await handleExecutionRouteCreate({ operatorAuthorized: true, frame: { type: "execution_route_create", requestId: "request-1" }, discovery: discovery(), executionRouteCatalog: catalog, createExecutionRoute: create, readExecutionRouteCatalog: async () => catalog });
    expect(create).not.toHaveBeenCalled();
    expect(frames).toEqual([expect.objectContaining({ type: "execution_route_create_result", status: "rejected", code: "EXECUTION_ROUTE_CREATE_DENIED" })]);
  });

  it.each([
    ["stale", discovery({ freshness: "stale" })],
    ["ineligible", discovery({ eligible: false })],
    ["different identity", discovery({ providerModelId: "different-model" })],
  ])("rejects %s discovery without invoking the creation port", async (_case, currentDiscovery) => {
    const create = vi.fn();
    const frames = await handleExecutionRouteCreate({ operatorAuthorized: true, frame: request(), discovery: currentDiscovery, executionRouteCatalog: catalog, createExecutionRoute: create, readExecutionRouteCatalog: async () => catalog });
    expect(create).not.toHaveBeenCalled();
    expect(frames[0]).toMatchObject({ status: "rejected", code: "EXECUTION_ROUTE_CREATE_DENIED" });
  });

  it("creates once for the exact current discovery identity and returns typed catalogs plus refresh broadcast", async () => {
    const createdCatalog: ExecutionRouteCatalog = { routes: [{ routeId: "route-1", label: "Route", providerId: "provider", providerModelId: "model", accountSelection: { mode: "exact", accountId: "account" }, dataClassification: "public", dataPolicyEvidence: request().material.dataPolicyEvidence, economics: request().material.economics }] };
    const create = vi.fn(async () => ({ status: "created" as const, revision: "sha256:next" }));
    const frames = await handleExecutionRouteCreate({ operatorAuthorized: true, frame: request(), discovery: discovery(), executionRouteCatalog: catalog, createExecutionRoute: create, readExecutionRouteCatalog: async () => createdCatalog });
    expect(create).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ type: "execution_routes_refreshed", executionRouteCatalog: createdCatalog, availableModels: { entries: [expect.objectContaining({ configuredState: "configured" })] } });
    expect(frames[1]).toMatchObject({ type: "execution_route_create_result", status: "created", revision: "sha256:next", executionRouteCatalog: createdCatalog, availableModels: { entries: [expect.objectContaining({ configuredState: "configured" })] } });
  });

  it("sanitizes creation failures", async () => {
    const frames = await handleExecutionRouteCreate({ operatorAuthorized: true, frame: request(), discovery: discovery(), executionRouteCatalog: catalog, createExecutionRoute: async () => { throw new Error("token=secret C:\\operator\\config"); }, readExecutionRouteCatalog: async () => catalog });
    expect(frames.at(-1)).toEqual(expect.objectContaining({ status: "rejected", code: "EXECUTION_ROUTE_CREATE_REJECTED" }));
    expect(JSON.stringify(frames)).not.toMatch(/secret|operator\\config/u);
  });

  it("broadcasts refreshed evidence separately before a strict rejected result", async () => {
    const frames = await handleExecutionRouteCreate({ operatorAuthorized: true, frame: request(), discovery: discovery(), executionRouteCatalog: catalog, createExecutionRoute: async () => { throw new Error("conflict"); }, readExecutionRouteCatalog: async () => catalog });
    expect(frames.map((frame) => frame.type)).toEqual(["execution_routes_refreshed", "execution_route_create_result"]);
    expect(frames[1]).toEqual({ type: "execution_route_create_result", requestId: "request-1", status: "rejected", code: "EXECUTION_ROUTE_CREATE_REJECTED", message: expect.any(String) });
  });

  it("reports a committed write whose catalog refresh failed", async () => {
    const revision = `sha256:${"d".repeat(64)}`;
    const frames = await handleExecutionRouteCreate({ operatorAuthorized: true, frame: request(), discovery: discovery(), executionRouteCatalog: catalog, createExecutionRoute: async () => ({ status: "committed-refresh-failed", revision }), readExecutionRouteCatalog: async () => { throw new Error("refresh unavailable"); } });
    expect(frames).toEqual([expect.objectContaining({ status: "committed-refresh-failed", revision, code: "EXECUTION_ROUTE_COMMITTED_REFRESH_FAILED" })]);
  });
});

function request(): ExecutionRouteCreationRequest & { readonly type: "execution_route_create" } {
  const evidence = { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const };
  return { type: "execution_route_create", requestId: "request-1", expectedRevision: `sha256:${"c".repeat(64)}`, discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" }, material: { routeId: "route-1", label: "Route", accountSelection: { mode: "exact", accountId: "account" }, dataClassification: "public", dataPolicyEvidence: { providerId: "provider", providerModelId: "model", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "public", permittedClassifications: ["public"], sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, economics: { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "fixture", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription", rateCardId: "fixture", rateCardRevision: "v1", evidence }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } } };
}

function discovery(change: { readonly freshness?: "fresh" | "stale"; readonly eligible?: boolean; readonly providerModelId?: string } = {}): GuiProviderModelDiscoveryProjection {
  const providerModelId = change.providerModelId ?? "model";
  const eligible = change.eligible ?? true;
  return { catalogEvidence: { status: "complete", source: { kind: "runtime-provider-catalog", id: "fixture" }, observedAt: "2026-08-13T18:00:00.000Z", counts: { total: 1, returned: 1, omitted: 0 } }, entries: [{ normalizedModel: { family: providerModelId }, providerRoute: { providerId: "provider", providerModelId, scope: "provider:direct" }, rawEvidence: { rawId: providerModelId, provenance: "fixture" }, credentialEvidence: { state: "not-required", source: "fixture" }, entitlementEvidence: { state: "not-required", source: "fixture" }, freshness: { status: change.freshness ?? "fresh", observedAt: "2026-08-13T18:00:00.000Z" }, routeHealth: { status: "healthy" }, policyAdmission: { use: "interactive", status: eligible ? "admitted" : "denied" }, eligibility: { eligible, reasonCodes: eligible ? [] : ["policy-denied"] } }] };
}
