import { describe, expect, it } from "vitest";
import {
  resolveAdHocManagedInvocationRouteProfile,
  resolveConfiguredManagedInvocationRouteProfile,
  type ManagedInvocationRouteProfile,
  type ManagedInvocationToolRoute,
} from "../../src/agents/managed-invocation/index.js";
import { resolveRoute } from "../../src/agents/managed-invocation/runtime-tool/route-resolution.js";
import type {
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationToolInput,
} from "../../src/agents/managed-invocation/runtime-tool/types.js";

function profile(
  authorityProfileId: string,
  access: ManagedInvocationRouteProfile["access"] = "read-only",
): ManagedInvocationRouteProfile {
  return {
    authorityProfileId,
    access,
    allowedToolNames: ["read"],
    workingDirectory: { path: "C:/workspace", mode: "read-only" },
    timeoutMs: 60_000,
    credentialRoute: { mode: "credentialless" },
    memoryScope: { scope: { kind: "project", id: "fixture" }, access: "read-only" },
  };
}

function route(profiles: readonly ManagedInvocationRouteProfile[]): ManagedInvocationToolRoute {
  return {
    routeId: "target-a",
    routeSource: "explicit-managed-route",
    providerId: "provider-a",
    model: "model-a",
    capability: {
      identity: { routeId: "target-a", revision: "test-v1" },
      target: { providerId: "provider-a", modelId: "model-a" },
      adapter: { kind: "direct-provider", capabilityId: "provider-a-direct", capabilityVersion: "1" },
      authorityCeiling: "audited",
      toolNames: ["read"],
      supportsRecursion: false,
      supportsAttachments: false,
      supportsWrite: false,
      proof: { status: "configured", source: "test", provenAccess: ["read-only"] },
      capacity: { kind: "accountless" },
      settlement: { kind: "not-required" },
    },
    profiles,
  };
}

describe("managed route authority profile resolution", () => {
  it("resolves a configured agent by exact authority identity and admission", () => {
    const exact = profile("authority:exact");
    const configuredRoute = route([profile("authority:other"), exact]);

    expect(resolveConfiguredManagedInvocationRouteProfile(configuredRoute, {
      authorityProfileId: "authority:exact",
      access: "read-only",
    }, "read-only")).toBe(exact);
  });

  it("denies a configured agent when its admission does not match the request", () => {
    const configuredRoute = route([profile("authority:exact")]);

    expect(resolveConfiguredManagedInvocationRouteProfile(configuredRoute, {
      authorityProfileId: "authority:exact",
      access: "read-only",
    }, "propose")).toBeUndefined();
  });

  it("fails closed when an exact configured authority identity is duplicated", () => {
    const duplicate = profile("authority:duplicate");
    const configuredRoute = route([
      duplicate,
      { ...duplicate, access: "propose" },
    ]);

    expect(resolveConfiguredManagedInvocationRouteProfile(configuredRoute, {
      authorityProfileId: "authority:duplicate",
      access: "read-only",
    }, "read-only")).toBeUndefined();
  });

  it("allows ad-hoc admission only when the access level is unique", () => {
    const unique = profile("authority:unique");
    expect(resolveAdHocManagedInvocationRouteProfile(route([unique]), "read-only")).toBe(unique);
    expect(resolveAdHocManagedInvocationRouteProfile(
      route([unique, profile("authority:second")]),
      "read-only",
    )).toBeUndefined();
  });

  it("selects the configured agent's exact authority when admission alone is ambiguous", () => {
    const configuredRoute = route([profile("authority:first"), profile("authority:second")]);
    const agent: ManagedInvocationAgentCatalogEntry = {
      name: "scout",
      role: "Scout",
      goal: "Inspect bounded context.",
      tier: "reasoning",
      routeId: configuredRoute.routeId,
      authorityProfileId: "authority:second",
      access: "read-only",
    };
    const input = {
      access: "read-only",
      providerRoute: { providerId: "provider-a", surface: "configured" },
    } as ManagedInvocationToolInput;

    expect(resolveRoute([configuredRoute], input, agent)).toEqual({ status: "found", route: configuredRoute });
    expect(resolveRoute([configuredRoute], input)).toEqual({ status: "missing" });
  });
});
