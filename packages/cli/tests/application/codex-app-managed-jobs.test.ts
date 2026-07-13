import { describe, expect, it } from "vitest";
import {
  createCodexAppManagedJobApplicationService,
  summarizeCodexAppManagedProfiles,
} from "../../src/application/codex-app-managed-jobs.js";

describe("Codex App managed-job production composition", () => {
  it("projects zero, one, and multiple canonical eligible routes without exposing route internals", () => {
    const route = (id: string) => ({
      routeId: id,
      providerId: "opencode-go",
      profiles: { "foundation-readonly-plan": {} },
    });

    expect(summarizeCodexAppManagedProfiles(undefined)).toMatchObject([{
      id: "foundation-readonly-plan",
      availability: "unavailable",
      providerId: "opencode-go",
      diagnostic: "profile_unavailable",
    }]);
    expect(summarizeCodexAppManagedProfiles({ routes: [route("only")] } as never)).toMatchObject([{
      id: "foundation-readonly-plan",
      availability: "admitted",
      providerId: "opencode-go",
    }]);
    expect(summarizeCodexAppManagedProfiles({ routes: [route("first"), route("second")] } as never)).toMatchObject([{
      id: "foundation-readonly-plan",
      availability: "unavailable",
      providerId: "opencode-go",
      diagnostic: "route_unavailable",
    }]);
    expect(summarizeCodexAppManagedProfiles({
      routes: [],
      unavailableRoutes: [{ providerId: "opencode-go", profiles: ["foundation-readonly-plan"] }],
    } as never)).toMatchObject([{
      id: "foundation-readonly-plan",
      availability: "unresolved",
      providerId: "opencode-go",
      diagnostic: "eligibility_unresolved",
    }]);
  });

  it("uses the real application owner and fails a missing configured profile before provider execution", async () => {
    const service = await createCodexAppManagedJobApplicationService({ discoverProviderModels: async () => ({}) });
    await expect(service.submit({
      objective: "Bounded production composition proof.",
      agentProfileId: "foundation-readonly-plan",
      callerId: "codex-app",
      idempotencyKey: "production-composition-proof",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    await expect(service.status("unknown-managed-job-0001")).rejects.toMatchObject({ code: "unknown_job" });
  });
});
