import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionRouteCatalog,
  ExecutionTargetWizardProposal,
  ExecutionTargetWizardRequest,
  GuiProviderModelDiscoveryProjection,
} from "@kilnai/gateway-contracts";
import {
  executionTargetWizardDiscoveryEvidence,
  handleExecutionTargetWizard,
} from "../../src/gateway/execution-target-wizard-handler.js";

const revision = `sha256:${"c".repeat(64)}` as const;
const createdRevision = `sha256:${"d".repeat(64)}` as const;
const catalog: ExecutionRouteCatalog = { routes: [], revision };

describe("handleExecutionTargetWizard", () => {
  it("rejects an unauthenticated operator before application or catalog access", async () => {
    const runWizard = vi.fn();
    const readExecutionRouteCatalog = vi.fn(async () => catalog);

    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: false,
      frame: request(),
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard,
      readExecutionRouteCatalog,
    });

    expect(runWizard).not.toHaveBeenCalled();
    expect(readExecutionRouteCatalog).not.toHaveBeenCalled();
    expect(frames).toEqual([expect.objectContaining({
      type: "execution_target_wizard_result",
      requestId: "request-1",
      status: "rejected",
      code: "TARGET_CREATE_REJECTED",
    })]);
  });

  it("rejects malformed input without invoking the application port", async () => {
    const runWizard = vi.fn();
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: { type: "execution_target_wizard", requestId: "request-1" },
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard,
      readExecutionRouteCatalog: async () => catalog,
    });

    expect(runWizard).not.toHaveBeenCalled();
    expect(frames[0]).toMatchObject({ status: "rejected", code: "TARGET_CREATE_REJECTED" });
  });

  it.each([
    ["stale", discovery({ freshness: "stale" }), "TARGET_DISCOVERY_STALE"],
    ["ineligible", discovery({ eligible: false }), "TARGET_CREATE_REJECTED"],
    ["different identity", discovery({ providerModelId: "different-model" }), "TARGET_IDENTITY_CHANGED"],
  ])("rejects %s discovery before application", async (_case, currentDiscovery, code) => {
    const runWizard = vi.fn();
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: request(),
      discovery: currentDiscovery,
      executionRouteCatalog: catalog,
      runWizard,
      readExecutionRouteCatalog: async () => catalog,
    });

    expect(runWizard).not.toHaveBeenCalled();
    expect(frames[0]).toMatchObject({ status: "rejected", code });
  });

  it("allows an observed eligible model when availability is only diagnostic", async () => {
    const runWizard = vi.fn(async () => ({ status: "previewed" as const, proposal: proposal(), message: "Review." }));

    await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: request(),
      discovery: discovery({ health: "unhealthy" }),
      executionRouteCatalog: catalog,
      runWizard,
      readExecutionRouteCatalog: async () => catalog,
    });

    expect(runWizard).toHaveBeenCalledTimes(1);
  });

  it("assigns a bounded managed horizon when a fresh adapter observation has no explicit expiry", () => {
    const current = discovery({ omitExpiry: true, observedAt: "2098-08-13T18:00:00.000Z" });
    const entry = {
      providerId: "provider",
      providerRouteId: "provider:direct",
      providerModelId: "model",
      discoveryState: "observed" as const,
      eligibilityState: "eligible" as const,
      availabilityState: "available" as const,
      configuredState: "unconfigured" as const,
      configuredRouteRefs: [],
      reasonCodes: ["discovery-observed" as const],
    };

    const evidence = executionTargetWizardDiscoveryEvidence(current, entry);

    expect(Date.parse(evidence.expiresAt)).toBe(Date.parse("2099-08-13T00:00:00.000Z"));
  });

  it("binds adapter capability, provenance, and observation changes into discovery evidence", () => {
    const entry = {
      providerId: "provider",
      providerRouteId: "provider:direct",
      providerModelId: "model",
      discoveryState: "observed" as const,
      eligibilityState: "eligible" as const,
      availabilityState: "available" as const,
      configuredState: "unconfigured" as const,
      configuredRouteRefs: [],
      reasonCodes: ["discovery-observed" as const],
    };
    const withoutTools = executionTargetWizardDiscoveryEvidence(discovery({
      capabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
    }), entry);
    const withTools = executionTargetWizardDiscoveryEvidence(discovery({
      capabilities: { supportsFunctionTools: true, supportsRuntimeTools: true },
    }), entry);
    const differentProvenance = executionTargetWizardDiscoveryEvidence(discovery({
      capabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
      rawProvenance: "different-adapter-observation",
    }), entry);
    const laterObservation = executionTargetWizardDiscoveryEvidence(discovery({
      capabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
      observedAt: "2026-08-14T18:00:00.000Z",
    }), entry);

    expect(withoutTools.modelCapabilities).toEqual({ supportsFunctionTools: false, supportsRuntimeTools: false });
    expect(withoutTools.rawEvidence).toEqual({ rawId: "model", provenance: "fixture" });
    expect(withoutTools.evidenceRevision).not.toBe(withTools.evidenceRevision);
    expect(withoutTools.evidenceRevision).not.toBe(differentProvenance.evidenceRevision);
    expect(withoutTools.evidenceRevision).not.toBe(laterObservation.evidenceRevision);
    expect(withoutTools.materialRevision).not.toBe(withTools.materialRevision);
    expect(withoutTools.materialRevision).not.toBe(differentProvenance.materialRevision);
    expect(withoutTools.materialRevision).toBe(laterObservation.materialRevision);
  });

  it("previews a normalized proposal without reading a post-mutation catalog", async () => {
    const runWizard = vi.fn(async () => ({ status: "previewed" as const, proposal: proposal(), message: "Review before approval." }));
    const readExecutionRouteCatalog = vi.fn(async () => catalog);
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: request(),
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard,
      readExecutionRouteCatalog,
    });

    expect(runWizard).toHaveBeenCalledWith(expect.objectContaining({ action: "preview" }), expect.objectContaining({
      entry: expect.objectContaining({ providerModelId: "model" }),
      evidenceRevision: expect.stringMatching(/^sha256:/u),
    }));
    expect(readExecutionRouteCatalog).not.toHaveBeenCalled();
    expect(frames).toEqual([expect.objectContaining({
      status: "previewed",
      code: "EXECUTION_TARGET_PREVIEWED",
      proposal: proposal(),
    })]);
  });

  it("publishes refreshed catalogs only after a created result", async () => {
    const createdCatalog: ExecutionRouteCatalog = { routes: [], revision: createdRevision };
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: applyRequest(),
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard: async () => ({ status: "created", proposal: proposal("approved"), revision: createdRevision }),
      readExecutionRouteCatalog: async () => createdCatalog,
    });

    expect(frames.map((frame) => frame.type)).toEqual(["execution_target_wizard_result"]);
    expect(frames[0]).toMatchObject({
      status: "created",
      code: "EXECUTION_TARGET_CREATED",
      revision: createdRevision,
      executionRouteCatalog: createdCatalog,
    });
  });

  it("preserves a typed rejection without refreshing catalogs", async () => {
    const readExecutionRouteCatalog = vi.fn(async () => catalog);
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: applyRequest(),
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard: async () => ({
        status: "rejected",
        code: "TARGET_REVISION_CONFLICT",
        action: "refresh-and-retry",
        message: "Current evidence changed.",
      }),
      readExecutionRouteCatalog,
    });

    expect(readExecutionRouteCatalog).not.toHaveBeenCalled();
    expect(frames).toEqual([expect.objectContaining({ status: "rejected", code: "TARGET_REVISION_CONFLICT" })]);
  });

  it("reports a committed write whose catalog refresh failed without retrying the write", async () => {
    const runWizard = vi.fn(async () => ({
      status: "committed-refresh-failed" as const,
      proposal: proposal("approved"),
      revision: createdRevision,
    }));
    const readExecutionRouteCatalog = vi.fn(async () => { throw new Error("must not refresh here"); });
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: applyRequest(),
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard,
      readExecutionRouteCatalog,
    });

    expect(runWizard).toHaveBeenCalledTimes(1);
    expect(readExecutionRouteCatalog).not.toHaveBeenCalled();
    expect(frames).toEqual([expect.objectContaining({
      status: "committed-refresh-failed",
      revision: createdRevision,
      code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED",
    })]);
  });

  it("reports committed-refresh-failed when the post-commit catalog cannot be read", async () => {
    const runWizard = vi.fn(async () => ({
      status: "created" as const,
      proposal: proposal("approved"),
      revision: createdRevision,
    }));
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: applyRequest(),
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard,
      readExecutionRouteCatalog: async () => { throw new Error("catalog unavailable"); },
    });

    expect(runWizard).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([expect.objectContaining({
      status: "committed-refresh-failed",
      code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED",
      action: "refresh-catalog",
      revision: createdRevision,
    })]);
  });

  it("sanitizes unexpected application failures", async () => {
    const frames = await handleExecutionTargetWizard({
      operatorAuthorized: true,
      frame: request(),
      discovery: discovery(),
      executionRouteCatalog: catalog,
      runWizard: async () => { throw new Error("token=secret C:\\operator\\config"); },
      readExecutionRouteCatalog: async () => catalog,
    });

    expect(frames.at(-1)).toEqual(expect.objectContaining({ status: "rejected", code: "TARGET_CREATE_REJECTED" }));
    expect(JSON.stringify(frames)).not.toMatch(/secret|operator\\config/u);
  });
});

function request(): ExecutionTargetWizardRequest & { readonly type: "execution_target_wizard" } {
  return {
    type: "execution_target_wizard",
    requestId: "request-1",
    expectedRevision: revision,
    discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" },
    dataClassification: "public",
    dataPolicyConfirmed: true,
    action: "preview",
  };
}

function applyRequest(): ExecutionTargetWizardRequest & { readonly type: "execution_target_wizard" } {
  return {
    ...request(),
    action: "apply",
    proposalId: "proposal-1",
    operatorApproved: true,
  };
}

function proposal(approvalStatus: "required" | "approved" = "required"): ExecutionTargetWizardProposal {
  return {
    proposalId: "proposal-1",
    operation: "target.create",
    scope: "global",
    status: "valid",
    baseRevision: revision,
    authorityImpact: "expands-write",
    approvalRequired: true,
    approvalStatus,
    activation: "hot",
    owners: ["execution-routes"],
    reconciliationTargets: ["execution-route-catalog"],
    diagnostics: [],
    rollback: { restorable: true, summary: "Remove the created target." },
    target: {
      routeId: "provider-model",
      label: "Provider Model",
      providerId: "provider",
      providerModelId: "model",
      accountSelectionMode: "exact",
      dataClassification: "public",
      billingClass: "subscription",
      capabilityPosture: "kiln-executable",
      discoveryExpiresAt: "2099-01-01T00:00:00.000Z",
      evidenceExpiresAt: "2099-01-01T00:00:00.000Z",
    },
  };
}

function discovery(change: {
  readonly freshness?: "fresh" | "stale";
  readonly eligible?: boolean;
  readonly providerModelId?: string;
  readonly health?: "healthy" | "unhealthy";
  readonly omitExpiry?: boolean;
  readonly observedAt?: string;
  readonly capabilities?: {
    readonly supportsFunctionTools?: boolean;
    readonly supportsRuntimeTools?: boolean;
  };
  readonly rawProvenance?: string;
} = {}): GuiProviderModelDiscoveryProjection {
  const providerModelId = change.providerModelId ?? "model";
  const eligible = change.eligible ?? true;
  const observedAt = change.observedAt ?? "2026-08-13T18:00:00.000Z";
  return {
    catalogEvidence: {
      status: "complete",
      source: { kind: "runtime-provider-catalog", id: "fixture" },
      observedAt,
      counts: { total: 1, returned: 1, omitted: 0 },
    },
    entries: [{
      normalizedModel: { family: providerModelId },
      providerRoute: { providerId: "provider", providerModelId, scope: "provider:direct" },
      rawEvidence: { rawId: providerModelId, provenance: change.rawProvenance ?? "fixture" },
      credentialEvidence: { state: "not-required", source: "fixture" },
      entitlementEvidence: { state: "not-required", source: "fixture" },
      freshness: {
        status: change.freshness ?? "fresh",
        observedAt,
        ...(change.omitExpiry ? {} : { expiresAt: "2099-01-01T00:00:00.000Z" }),
      },
      routeHealth: { status: change.health ?? "healthy" },
      policyAdmission: { use: "interactive", status: eligible ? "admitted" : "denied" },
      eligibility: { eligible, reasonCodes: eligible ? [] : ["policy-denied"] },
      ...(change.capabilities ? { modelCapabilities: change.capabilities } : {}),
    }],
  };
}
