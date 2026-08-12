import { describe, expect, it } from "vitest";
import type {
  ExecutionRouteCatalog,
  ExecutionRouteSelectionIntent,
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiSessionMeta,
} from "../src/index.js";
import { ExecutionRouteCatalogSchema, ExecutionRouteSelectionIntentSchema } from "../src/index.js";

const catalog: ExecutionRouteCatalog = {
  routes: [
    {
      routeId: "terra",
      label: "Terra",
      providerId: "codex-oauth",
      providerModelId: "gpt-5.6-terra",
      accountOverrideIds: ["work"],
      accountSelection: {
        mode: "automatic",
        eligibleAccountCount: 2,
        allowOperatorOverride: true,
      },
      availability: "available",
      reasonCodes: ["configured"],
      repairActions: [],
    },
    {
      routeId: "sonnet",
      label: "Sonnet",
      providerId: "anthropic",
      providerModelId: "claude-sonnet",
      accountSelection: {
        mode: "exact",
        eligibleAccountCount: 1,
        allowOperatorOverride: false,
      },
      availability: "unavailable",
      reasonCodes: ["missing-credentials", "provider-unavailable"],
      repairActions: ["authenticate-provider", "retry-route"],
    },
    {
      routeId: "local",
      label: "Local",
      providerId: "ollama",
      providerModelId: "llama",
      accountSelection: {
        mode: "exact",
        eligibleAccountCount: 1,
        allowOperatorOverride: false,
      },
      availability: "unresolved",
      reasonCodes: ["route-evidence-pending"],
      repairActions: ["refresh-route-catalog"],
    },
  ],
};

describe("execution route wire contract", () => {
  it("validates route catalogs and intents at the wire boundary", () => {
    expect(ExecutionRouteCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(ExecutionRouteSelectionIntentSchema.safeParse({ routeId: "terra", credentialId: "secret-ref" }).success).toBe(false);
    expect(ExecutionRouteCatalogSchema.safeParse({ routes: [{ ...catalog.routes[0], availability: "maybe" }] }).success).toBe(false);
  });
  it("keeps every configured route in the catalog with explicit availability diagnostics", () => {
    expect(catalog.routes).toHaveLength(3);
    expect(catalog.routes.map((route) => route.availability)).toEqual([
      "available",
      "unavailable",
      "unresolved",
    ]);
    expect(catalog.routes[1]).toMatchObject({
      routeId: "sonnet",
      reasonCodes: ["missing-credentials", "provider-unavailable"],
      repairActions: ["authenticate-provider", "retry-route"],
    });
    expect(JSON.stringify(catalog)).not.toContain("credential-material");
  });

  it("sends a route selection intent without provider/model authority", () => {
    const intent: ExecutionRouteSelectionIntent = {
      routeId: "terra",
      accountOverrideId: "work",
    };
    const frame: GuiOutboundFrame = {
      type: "execution_route",
      requestId: "request-1",
      ...intent,
    };

    expect(frame).toEqual({
      type: "execution_route",
      requestId: "request-1",
      routeId: "terra",
      accountOverrideId: "work",
    });
  });

  it("acknowledges and rejects route changes by route identity", () => {
    const changed: GuiInboundFrame = {
      type: "execution_route_changed",
      requestId: "request-1",
      routeId: "terra",
      providerId: "codex-oauth",
      providerModelId: "gpt-5.6-terra",
    };
    const failed: GuiInboundFrame = {
      type: "execution_route_change_failed",
      requestId: "request-2",
      routeId: "sonnet",
      reasonCode: "missing-credentials",
      reason: "The configured route is unavailable.",
      repairActions: ["authenticate-provider"],
    };

    expect(changed).toMatchObject({ routeId: "terra" });
    expect(failed).toMatchObject({ routeId: "sonnet", reasonCode: "missing-credentials" });
  });

  it("uses route identity for welcome, done, and session evidence while retaining derived provider/model facts", () => {
    const welcome: GuiInboundFrame = {
      type: "welcome",
      executionRouteCatalog: catalog,
    };
    const done: GuiInboundFrame = {
      type: "done",
      kilnSessionId: "session-1",
      content: "Completed.",
      inputTokens: 1,
      outputTokens: 2,
      outcome: "completed",
      routedRouteId: "terra",
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.6-terra",
    };
    const session: GuiSessionMeta = {
      kilnSessionId: "session-1",
      task: "Inspect route evidence",
      startedAt: "2026-08-11T00:00:00.000Z",
      routesUsed: ["terra"],
      lastRouteId: "terra",
      routeThreads: [{
        routeId: "terra",
        providerSessionId: "provider-session-1",
        provider: "codex-oauth",
        model: "gpt-5.6-terra",
      }],
    };

    expect(welcome.executionRouteCatalog.routes[0]?.routeId).toBe("terra");
    expect(done).toMatchObject({ routedRouteId: "terra", routedProvider: "codex-oauth" });
    expect(session).toMatchObject({ routesUsed: ["terra"], lastRouteId: "terra" });
  });
});
