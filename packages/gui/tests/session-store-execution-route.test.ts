import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../src/lib/session-store/index.js";

const route = (overrides: Record<string, unknown> = {}) => ({ routeId: "terra", label: "Terra", providerId: "codex", providerModelId: "gpt", accountOverrideIds: ["work"], accountSelection: { mode: "automatic", eligibleAccountCount: 1, allowOperatorOverride: true }, availability: "available", reasonCodes: ["configured"], repairActions: [], ...overrides });

describe("session-store execution target selection", () => {
  beforeEach(() => { localStorage.clear(); useSessionStore.setState({ outboundSend: null, executionRouteSelecting: false, executionRouteSelectionTarget: null, activeRouteId: null, activeAccountOverrideId: null, providerOperationFailure: null, executionRouteCatalog: { routes: [] }, executionTargetWizardResult: null }); });
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
    useSessionStore.getState().onExecutionRouteChanged({ type: "execution_route_changed", routeId: "terra", requestId: "stale" } as never);
    expect(useSessionStore.getState().activeRouteId).toBeNull();
  });
  it("records route failure repair context", () => {
    useSessionStore.setState({ executionRouteSelecting: true, executionRouteSelectionTarget: { routeId: "terra", requestId: "request" } });
    useSessionStore.getState().onExecutionRouteChangeFailed({ type: "execution_route_change_failed", routeId: "terra", requestId: "request", reasonCode: "missing-credentials", reason: "Authenticate", repairActions: ["authenticate-provider"] } as never);
    expect(useSessionStore.getState().providerOperationFailure?.message).toBe("Authenticate");
  });
  it("adopts the refreshed route catalog when provider authentication completes", () => {
    useSessionStore.setState({
      executionRouteCatalog: { routes: [route({ availability: "unresolved", reasonCodes: ["missing-credentials"] })] },
      providerAuthTarget: { provider: "codex-oauth", requestId: "auth-1" },
    });

    useSessionStore.getState().onProviderAuthCompleted({
      type: "provider_auth_completed",
      provider: "codex-oauth",
      requestId: "auth-1",
      executionRouteCatalog: { routes: [route()] },
    } as never);

    expect(useSessionStore.getState().executionRouteCatalog.routes[0]?.availability).toBe("available");
  });
  it("stores wizard outcomes and adopts catalogs only after creation", () => {
    useSessionStore.setState({ executionRouteCatalog: { routes: [] }, availableModels: null });
    useSessionStore.getState().onExecutionTargetWizardResult({ type: "execution_target_wizard_result", requestId: "wizard-1", status: "rejected", code: "TARGET_REVISION_CONFLICT", action: "refresh-and-retry", message: "Refresh." } as never);
    expect(useSessionStore.getState().executionTargetWizardResult?.status).toBe("rejected");
    expect(useSessionStore.getState().executionRouteCatalog.routes).toHaveLength(0);
    useSessionStore.getState().onExecutionTargetWizardResult({ type: "execution_target_wizard_result", requestId: "wizard-1", status: "created", executionRouteCatalog: { routes: [route()] }, availableModels: { observedAt: "2026-08-01T00:00:00.000Z", entries: [] } } as never);
    expect(useSessionStore.getState().executionRouteCatalog.routes[0]?.routeId).toBe("terra");
  });
});
