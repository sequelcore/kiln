import { describe, expect, it, vi } from "vitest";
import { createManagedAgentRouteAdmissionResolver } from "../../src/config/managed-agent-route-admission.js";

const capability = {
  identity: { routeId: "route-alpha", revision: "v1" },
  target: { providerId: "codex", modelId: "gpt-5.3-codex-spark" },
  adapter: { kind: "cli-harness" as const, capabilityId: "adapter-alpha", capabilityVersion: "v1" },
  authorityCeiling: "read_only" as const,
  toolNames: ["read"], supportsRecursion: false, supportsAttachments: false, supportsWrite: false,
  proof: { status: "configured" as const, source: "test", provenProfiles: ["foundation-readonly-plan" as const] },
  capacity: { kind: "accountless" as const }, settlement: { kind: "not-required" as const },
};

const agent = {
  name: "planner", role: "planner", goal: "plan", targetId: "route-alpha",
  authorityProfileId: "cross-repository-research-readonly",
  tools: ["read"],
} as const;

const authorityProfiles = [{
  id: "cross-repository-research-readonly",
  admissionProfile: "foundation-readonly-plan",
}] as const;

describe("managed agent route admission", () => {
  it("projects from canonical candidate-admission routes without execution composition", async () => {
    const createRegistry = vi.fn(() => ({ registry: {} as never }));
    const discoverProviderModels = vi.fn(async () => ({}));
    const resolveRoutes = vi.fn(async (_config, context) => {
      expect(context).toMatchObject({ cwd: "/repo", surface: "operator", includeUnavailableRoutes: true, compositionMode: "candidate-admission" });
      expect(context).not.toHaveProperty("managedAccountComposition");
      expect(context).not.toHaveProperty("directAdapterFactory");
      return { managedInvocation: { routes: [{ routeId: "route-alpha", providerId: "codex", model: "gpt-5.3-codex-spark", capability }] } };
    });

    const resolver = await createManagedAgentRouteAdmissionResolver("/repo", {
      loadConfig: async () => ({ authorityProfiles }) as never,
      createRegistry,
      discoverProviderModels,
      resolveRoutes: resolveRoutes as never,
    });

    expect(resolver.resolve(agent as never)).toMatchObject({ status: "admitted", route: { identity: { routeId: "route-alpha" } } });
    expect(createRegistry).toHaveBeenCalledTimes(1);
    expect(discoverProviderModels).toHaveBeenCalledTimes(1);
  });

  it("returns unresolved for an absent canonical route and unavailable for an unhealthy route", async () => {
    const create = (resolution: unknown) => createManagedAgentRouteAdmissionResolver("/repo", {
      loadConfig: async () => ({ authorityProfiles }) as never,
      createRegistry: () => ({ registry: {} as never }),
      discoverProviderModels: async () => ({}),
      resolveRoutes: async () => resolution as never,
    });
    expect((await create({ managedInvocation: { routes: [] } })).resolve(agent as never)).toMatchObject({ status: "unresolved" });
    expect((await create({ managedInvocation: { routes: [], unavailableRoutes: [{ routeId: "route-alpha", providerId: "codex", model: "gpt-5.3-codex-spark" }] } })).resolve(agent as never)).toMatchObject({ status: "unavailable" });
  });

  it("requires an explicit canonical target and rejects duplicate target observations", async () => {
    const create = (routes: readonly unknown[]) => createManagedAgentRouteAdmissionResolver("/repo", {
      loadConfig: async () => ({ authorityProfiles }) as never,
      createRegistry: () => ({ registry: {} as never }),
      discoverProviderModels: async () => ({}),
      resolveRoutes: async () => ({ managedInvocation: { routes } }) as never,
    });
    const withoutTargetId = { ...agent, targetId: undefined };
    const canonicalRoute = { routeId: "route-alpha", providerId: "codex", model: "gpt-5.3-codex-spark", capability };
    expect((await create([canonicalRoute])).resolve(withoutTargetId as never)).toBeUndefined();
    expect((await create([canonicalRoute, canonicalRoute])).resolve(agent as never)).toMatchObject({ status: "unresolved" });
    expect((await create([canonicalRoute, { ...canonicalRoute, routeId: "route-beta" }])).resolve(agent as never)).toMatchObject({ status: "admitted", route: { identity: { routeId: "route-alpha" } } });
  });

  it("admits a policy-bound route and defers capacity selection to runtime", async () => {
    const resolver = await createManagedAgentRouteAdmissionResolver("/repo", {
      loadConfig: async () => ({ authorityProfiles }) as never,
      createRegistry: () => ({ registry: {} as never }),
      discoverProviderModels: async () => ({}),
      resolveRoutes: async () => ({
        managedInvocation: {
          routes: [{
            routeId: "route-alpha",
            providerId: "codex",
            model: "gpt-5.3-codex-spark",
            capability: { ...capability, capacity: { kind: "policy-bound", accountPolicyId: "managed-codex" } },
          }],
        },
      }) as never,
    });

    expect(resolver.resolve(agent as never)).toMatchObject({
      status: "admitted",
      route: {
        identity: { routeId: "route-alpha" },
        capacity: { kind: "policy-bound", accountPolicyId: "managed-codex" },
      },
    });
  });

  it("fails closed when the agent references an unknown authority profile id", async () => {
    const resolver = await createManagedAgentRouteAdmissionResolver("/repo", {
      loadConfig: async () => ({ authorityProfiles }) as never,
      createRegistry: () => ({ registry: {} as never }),
      discoverProviderModels: async () => ({}),
      resolveRoutes: async () => ({
        managedInvocation: {
          routes: [{ routeId: "route-alpha", providerId: "codex", model: "gpt-5.3-codex-spark", capability }],
        },
      }) as never,
    });

    expect(resolver.resolve({ ...agent, authorityProfileId: "missing-profile" } as never)).toMatchObject({
      status: "unresolved",
      routeId: "route-alpha",
    });
  });
});
