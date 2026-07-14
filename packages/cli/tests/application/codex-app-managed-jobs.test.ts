import { describe, expect, it } from "vitest";
import {
  createCodexAppManagedJobApplicationService,
  summarizeCodexAppManagedAgents,
} from "../../src/application/codex-app-managed-jobs.js";

describe("Codex App managed-job production composition", () => {
  it("projects configured agents through their explicit route hints without exposing route internals", () => {
    const route = (id: string) => ({
      routeId: id,
      providerId: "opencode-go",
      profiles: { "foundation-readonly-plan": {} },
    });
    const agents = [
      { name: "scout", displayName: "Scout", role: "Read-only scout", routeId: "scout-route" },
      { name: "researcher", role: "Researcher", routeId: "researcher-route" },
    ];

    expect(summarizeCodexAppManagedAgents(agents, undefined)).toMatchObject([{
      configuredAgentProfileId: "scout",
      availability: "unavailable",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "route_unavailable",
    }, {
      configuredAgentProfileId: "researcher",
      availability: "unavailable",
    }]);
    expect(summarizeCodexAppManagedAgents(agents, { routes: [route("scout-route"), route("researcher-route")] } as never)).toMatchObject([{
      configuredAgentProfileId: "scout",
      availability: "admitted",
      providerFamily: "opencode-go",
      admissionProfileId: "foundation-readonly-plan",
    }, {
      configuredAgentProfileId: "researcher",
      availability: "admitted",
    }]);
    expect(summarizeCodexAppManagedAgents(agents, {
      routes: [],
      unavailableRoutes: [{ routeId: "scout-route", providerId: "opencode-go", profiles: ["foundation-readonly-plan"] }],
    } as never)[0]).toMatchObject({
      configuredAgentProfileId: "scout",
      availability: "unresolved",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "eligibility_unresolved",
    });
  });

  it("uses the real application owner and fails a missing configured profile before provider execution", async () => {
    const service = await createCodexAppManagedJobApplicationService({ discoverProviderModels: async () => ({}) });
    await expect(service.submit({
      objective: "Bounded production composition proof.",
      configuredAgentProfileId: "missing-agent",
      callerId: "codex-app",
      idempotencyKey: "production-composition-proof",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    await expect(service.getStatus({ project: { id: "trusted-project" }, callerId: "codex-app" }, "unknown-managed-job-0001")).rejects.toMatchObject({ code: "unknown_job" });
  });
});
