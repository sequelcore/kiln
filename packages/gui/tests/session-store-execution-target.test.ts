import type {
  ExecutionTargetChangeFailed,
  ExecutionTargetChanged,
  ExecutionTargetWizardResult,
  GuiProviderAuthCompleted,
} from "@kilnai/gateway-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../src/lib/session-store/index.js";
import { testModelCatalog } from "./fixtures/model-catalog.js";

const availableCatalog = () => testModelCatalog({
  targetId: "terra",
  label: "Terra",
  providerId: "codex",
  providerModelId: "gpt",
  accountOverrideIds: ["work"],
});

const unavailableCatalog = () => testModelCatalog({
  targetId: "terra",
  label: "Terra",
  providerId: "codex",
  providerModelId: "gpt",
  targetAvailability: "unavailable",
});

describe("session-store execution target selection", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      outboundSend: null,
      executionTargetSelecting: false,
      executionTargetSelectionTarget: null,
      modelCatalogRefresh: { state: "idle" },
      modelCatalogRefreshTimeoutId: null,
      activeTargetId: null,
      activeAccountOverrideId: null,
      providerOperationFailure: null,
      modelCatalog: testModelCatalog(),
      executionTargetWizardResult: null,
    });
  });

  it("reports selection failure when no gateway connection is active", () => {
    expect(useSessionStore.getState().selectExecutionTarget("terra")).toBe(false);
    expect(useSessionStore.getState().providerOperationFailure).toMatchObject({
      operation: "select-target",
      message: "Model selection requires an active gateway connection.",
    });
  });

  it("sends target intent with an optional account override", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ modelCatalog: availableCatalog() });
    expect(useSessionStore.getState().selectExecutionTarget("terra", "work")).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "execution_target", targetId: "terra", accountOverrideId: "work" }));
  });

  it("fails closed for unavailable configured targets", () => {
    useSessionStore.getState().setSender(vi.fn());
    useSessionStore.setState({ modelCatalog: unavailableCatalog() });
    expect(useSessionStore.getState().selectExecutionTarget("terra")).toBe(false);
    expect(useSessionStore.getState().providerOperationFailure?.message).toContain("unavailable");
  });

  it("ignores stale acknowledgements and records correlated failures", () => {
    useSessionStore.setState({ executionTargetSelecting: true, executionTargetSelectionTarget: { targetId: "terra", requestId: "current" } });
    const stale: ExecutionTargetChanged = { type: "execution_target_changed", targetId: "terra", requestId: "stale" };
    useSessionStore.getState().onExecutionTargetChanged(stale);
    expect(useSessionStore.getState().activeTargetId).toBeNull();

    const failure: ExecutionTargetChangeFailed = {
      type: "execution_target_change_failed",
      targetId: "terra",
      requestId: "current",
      reasonCode: "missing-credentials",
      reason: "Authenticate",
      repairActions: ["authenticate-provider"],
    };
    useSessionStore.getState().onExecutionTargetChangeFailed(failure);
    expect(useSessionStore.getState().providerOperationFailure?.message).toBe("Authenticate");
  });

  it("adopts the model catalog published after provider authentication", () => {
    useSessionStore.setState({
      modelCatalog: unavailableCatalog(),
      providerAuthTarget: { provider: "codex-oauth", requestId: "auth-1" },
    });
    const frame: GuiProviderAuthCompleted = {
      type: "provider_auth_completed",
      provider: "codex-oauth",
      requestId: "auth-1",
      modelCatalog: availableCatalog(),
      models: { "codex-oauth": ["gpt"] },
      providerDiscovery: [],
      providerModelDiscovery: providerModelDiscovery("provider-auth"),
    };
    useSessionStore.getState().onProviderAuthCompleted(frame);
    expect(useSessionStore.getState().modelCatalog.models[0]?.targets[0]?.availability).toBe("available");
  });

  it("keeps startup pending until Runtime publishes fresh discovery evidence", () => {
    useSessionStore.getState().onWelcome({ type: "welcome", modelCatalog: testModelCatalog() });
    expect(useSessionStore.getState().providerCatalogStatus).toBe("pending");
    useSessionStore.getState().onProviderCatalogState({
      type: "provider_catalog_state",
      status: "ready",
      models: { "codex-oauth": ["gpt"] },
      providerDiscovery: [],
      providerModelDiscovery: providerModelDiscovery("startup-publication"),
      modelCatalog: availableCatalog(),
    });
    expect(useSessionStore.getState()).toMatchObject({ providerCatalogStatus: "ready", providerCatalogError: null });
    expect(useSessionStore.getState().modelCatalog.models[0]?.targets[0]?.targetId).toBe("terra");
  });

  it("correlates an in-place model-catalog refresh without changing bootstrap state", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ providerCatalogStatus: "ready" });
    expect(useSessionStore.getState().refreshModelCatalog()).toBe(true);
    const request = send.mock.calls[0]?.[0] as { readonly type: string; readonly requestId: string };
    expect(request).toMatchObject({ type: "refresh_model_catalog" });

    useSessionStore.getState().onModelCatalogRefreshed({ type: "model_catalog_refreshed", requestId: "stale", modelCatalog: testModelCatalog() });
    expect(useSessionStore.getState().modelCatalogRefresh.state).toBe("refreshing");
    useSessionStore.getState().onModelCatalogRefreshed({ type: "model_catalog_refreshed", requestId: request.requestId, modelCatalog: availableCatalog() });
    expect(useSessionStore.getState()).toMatchObject({ providerCatalogStatus: "ready", modelCatalogRefresh: { state: "idle" } });
    expect(useSessionStore.getState().modelCatalog.models[0]?.targets[0]?.targetId).toBe("terra");
  });

  it("keeps a correlated refresh failure local to the refresh control", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ providerCatalogStatus: "ready" });
    useSessionStore.getState().refreshModelCatalog();
    const request = send.mock.calls[0]?.[0] as { readonly requestId: string };
    useSessionStore.getState().onModelCatalogRefreshFailed({
      type: "model_catalog_refresh_failed",
      requestId: request.requestId,
      message: "Provider discovery timed out.",
    });
    expect(useSessionStore.getState().modelCatalogRefresh).toEqual({ state: "failed", message: "Provider discovery timed out." });
  });

  it("adopts wizard catalogs only after target creation", () => {
    const rejected: ExecutionTargetWizardResult = {
      type: "execution_target_wizard_result",
      requestId: "wizard-1",
      status: "rejected",
      code: "TARGET_REVISION_CONFLICT",
      action: "refresh-and-retry",
      message: "Refresh.",
    };
    useSessionStore.getState().onExecutionTargetWizardResult(rejected);
    expect(useSessionStore.getState().modelCatalog.models).toHaveLength(0);
    useSessionStore.getState().onExecutionTargetWizardResult(createdWizardResult());
    expect(useSessionStore.getState().modelCatalog.models[0]?.targets[0]?.targetId).toBe("terra");
  });
});

function providerModelDiscovery(id: string) {
  return {
    catalogEvidence: {
      status: "complete" as const,
      source: { kind: "test", id },
      observedAt: "2026-08-25T00:00:01.000Z",
      counts: { total: 0, returned: 0, omitted: 0 },
    },
    entries: [],
  };
}

function createdWizardResult(): ExecutionTargetWizardResult {
  return {
    type: "execution_target_wizard_result",
    requestId: "wizard-1",
    status: "created",
    code: "EXECUTION_TARGET_CREATED",
    action: "none",
    message: "Created.",
    revision: `sha256:${"a".repeat(64)}`,
    proposal: {
      proposalId: "proposal-1",
      operation: "target.create",
      scope: "global",
      status: "valid",
      baseRevision: `sha256:${"b".repeat(64)}`,
      authorityImpact: "none",
      approvalRequired: true,
      approvalStatus: "approved",
      activation: "next-session",
      owners: ["runtime"],
      reconciliationTargets: ["model-catalog"],
      diagnostics: [],
      rollback: { restorable: true, summary: "Restore prior target catalog." },
      target: {
        targetId: "terra",
        label: "Terra",
        providerId: "codex",
        providerModelId: "gpt",
        accountPolicyId: "default",
        eligibleAccountCount: 1,
        dataClassification: "internal",
        billingClass: "subscription",
        capabilityPosture: "kiln-executable",
        discoveryExpiresAt: "2026-08-02T00:00:00.000Z",
        evidenceExpiresAt: "2026-08-02T00:00:00.000Z",
      },
    },
    modelCatalog: availableCatalog(),
  };
}
