import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExecutionRouteCatalogEntry,
  ExecutionRouteChangeFailed,
  ExecutionRouteChanged,
  ExecutionTargetWizardResult,
  GuiProviderAuthCompleted,
} from "@kilnai/gateway-contracts";
import { useSessionStore } from "../src/lib/session-store/index.js";

type AutomaticRoute = Extract<ExecutionRouteCatalogEntry, { accountSelection: { mode: "automatic" } }>;

const route = (overrides: Partial<Pick<AutomaticRoute, "availability" | "reasonCodes" | "repairActions">> = {}): AutomaticRoute => ({
  routeId: "terra",
  label: "Terra",
  providerId: "codex",
  providerModelId: "gpt",
  accountOverrideIds: ["work"],
  accountSelection: { mode: "automatic", eligibleAccountCount: 1, allowOperatorOverride: true },
  availability: "available",
  reasonCodes: ["configured"],
  repairActions: [],
  ...overrides,
});

describe("session-store execution target selection", () => {
  beforeEach(() => { localStorage.clear(); useSessionStore.setState({ outboundSend: null, executionRouteSelecting: false, executionRouteSelectionTarget: null, activeRouteId: null, activeAccountOverrideId: null, providerOperationFailure: null, executionRouteCatalog: { routes: [] }, executionTargetWizardResult: null }); });
  it("reports selection failure when no gateway connection is active", () => {
    expect(useSessionStore.getState().selectExecutionRoute("terra")).toBe(false);
    expect(useSessionStore.getState().providerOperationFailure).toMatchObject({
      operation: "select-route",
      message: "Execution target selection requires an active gateway connection.",
    });
  });
  it("sends an admitted route with an exact account override", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ executionRouteCatalog: { routes: [route()] } });
    expect(useSessionStore.getState().selectExecutionRoute("terra", "work")).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "execution_route", routeId: "terra", accountOverrideId: "work" }));
  });
  it("fails closed for unavailable configured routes", () => {
    useSessionStore.getState().setSender(vi.fn());
    useSessionStore.setState({ executionRouteCatalog: { routes: [route({ availability: "unresolved", repairActions: ["refresh-route-catalog"] })] } });
    expect(useSessionStore.getState().selectExecutionRoute("terra")).toBe(false);
    expect(useSessionStore.getState().providerOperationFailure?.message).toMatch(/unresolved/);
  });
  it("ignores a stale route acknowledgement", () => {
    useSessionStore.setState({ executionRouteSelecting: true, executionRouteSelectionTarget: { routeId: "terra", requestId: "current" } });
    const frame: ExecutionRouteChanged = { type: "execution_route_changed", routeId: "terra", requestId: "stale" };
    useSessionStore.getState().onExecutionRouteChanged(frame);
    expect(useSessionStore.getState().activeRouteId).toBeNull();
  });
  it("records route failure repair context", () => {
    useSessionStore.setState({ executionRouteSelecting: true, executionRouteSelectionTarget: { routeId: "terra", requestId: "request" } });
    const frame: ExecutionRouteChangeFailed = {
      type: "execution_route_change_failed",
      routeId: "terra",
      requestId: "request",
      reasonCode: "missing-credentials",
      reason: "Authenticate",
      repairActions: ["authenticate-provider"],
    };
    useSessionStore.getState().onExecutionRouteChangeFailed(frame);
    expect(useSessionStore.getState().providerOperationFailure?.message).toBe("Authenticate");
  });
  it("adopts the refreshed route catalog when provider authentication completes", () => {
    useSessionStore.setState({
      executionRouteCatalog: { routes: [route({ availability: "unresolved", reasonCodes: ["missing-credentials"] })] },
      providerAuthTarget: { provider: "codex-oauth", requestId: "auth-1" },
    });

    const frame: GuiProviderAuthCompleted = {
      type: "provider_auth_completed",
      provider: "codex-oauth",
      requestId: "auth-1",
      executionRouteCatalog: { routes: [route()] },
      models: { "codex-oauth": ["gpt"] },
      providerDiscovery: [],
      providerModelDiscovery: {
        catalogEvidence: {
          status: "complete",
          source: { kind: "test", id: "session-store-execution-route" },
          observedAt: "2026-08-01T00:00:00.000Z",
          counts: { total: 0, returned: 0, omitted: 0 },
        },
        entries: [],
      },
      availableModels: { observedAt: "2026-08-01T00:00:00.000Z", entries: [] },
    };
    useSessionStore.getState().onProviderAuthCompleted(frame);

    expect(useSessionStore.getState().executionRouteCatalog.routes[0]?.availability).toBe("available");
  });
  it("stores wizard outcomes and adopts catalogs only after creation", () => {
    useSessionStore.setState({ executionRouteCatalog: { routes: [] }, availableModels: null });
    const rejected: ExecutionTargetWizardResult = {
      type: "execution_target_wizard_result",
      requestId: "wizard-1",
      status: "rejected",
      code: "TARGET_REVISION_CONFLICT",
      action: "refresh-and-retry",
      message: "Refresh.",
    };
    useSessionStore.getState().onExecutionTargetWizardResult(rejected);
    expect(useSessionStore.getState().executionTargetWizardResult?.status).toBe("rejected");
    expect(useSessionStore.getState().executionRouteCatalog.routes).toHaveLength(0);
    const created: ExecutionTargetWizardResult = {
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
        reconciliationTargets: ["execution-route-catalog"],
        diagnostics: [],
        rollback: { restorable: true, summary: "Restore prior route catalog." },
        target: {
          routeId: "terra",
          label: "Terra",
          providerId: "codex",
          providerModelId: "gpt",
          accountSelectionMode: "automatic",
          dataClassification: "internal",
          billingClass: "subscription",
          capabilityPosture: "kiln-executable",
          discoveryExpiresAt: "2026-08-02T00:00:00.000Z",
          evidenceExpiresAt: "2026-08-02T00:00:00.000Z",
        },
      },
      executionRouteCatalog: { routes: [route()] },
      availableModels: { observedAt: "2026-08-01T00:00:00.000Z", entries: [] },
    };
    useSessionStore.getState().onExecutionTargetWizardResult(created);
    expect(useSessionStore.getState().executionRouteCatalog.routes[0]?.routeId).toBe("terra");
  });
});
