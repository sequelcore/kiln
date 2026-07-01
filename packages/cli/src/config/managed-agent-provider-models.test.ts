import { describe, expect, it, vi } from "vitest";
import { discoverOpencodeCliModelDiscovery } from "@kilnai/runtime";
import { discoverManagedAgentProviderModels } from "./managed-agent-provider-models.js";

vi.mock("@kilnai/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/runtime")>();
  return {
    ...actual,
    discoverCodexCliModelDiscovery: vi.fn(async () => ({
      models: ["gpt-5.3-codex"],
      status: "available",
      reason: "Codex CLI models discovered.",
      authState: "authenticated",
    })),
    discoverGuiDirectProviderModelDiscovery: vi.fn(async () => ({
      "codex-oauth": {
        models: ["gpt-5.5", "codex-auto-review"],
        status: "available",
        reason: "Codex OAuth models discovered.",
        authState: "authenticated",
      },
      "opencode-go": {
        models: ["qwen3.7-max"],
        status: "available",
        reason: "OpenCode Go models discovered.",
        authState: "authenticated",
      },
    })),
    discoverOpencodeCliModelDiscovery: vi.fn(async () => ({
      models: ["opencode/minimax-m2.5-free"],
      status: "available",
      reason: "OpenCode CLI models discovered.",
      authState: "authenticated",
    })),
  };
});

describe("discoverManagedAgentProviderModels", () => {
  it("keeps discovered managed-agent catalog models diagnostic until admitted by eligibility", async () => {
    const discovered = await discoverManagedAgentProviderModels();

    expect(discovered.codex?.["gpt-5.3-codex"]?.catalogDiagnosticDecision).toMatchObject({
      eligible: false,
      use: "managed-agent",
      reasons: expect.arrayContaining(["missing-configured-evidence"]),
      route: { providerId: "codex", providerModelId: "gpt-5.3-codex" },
    });
    expect(discovered.opencode?.["opencode/minimax-m2.5-free"]?.catalogDiagnosticDecision).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["missing-configured-evidence"]),
      route: { providerId: "opencode", providerModelId: "opencode/minimax-m2.5-free" },
    });
    expect(discovered["codex-oauth"]?.["gpt-5.5"]?.catalogDiagnosticDecision).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["missing-configured-evidence"]),
      route: { providerId: "codex-oauth", providerModelId: "gpt-5.5" },
    });
    expect(discovered["codex-oauth"]?.["codex-auto-review"]?.catalogDiagnosticDecision).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["missing-configured-evidence"]),
      route: { providerId: "codex-oauth", providerModelId: "codex-auto-review" },
    });
    expect(discovered["opencode-go"]?.["qwen3.7-max"]?.catalogDiagnosticDecision).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["missing-configured-evidence"]),
      route: { providerId: "opencode-go", providerModelId: "qwen3.7-max" },
    });
  });

  it("does not admit large OpenCode catalogs as managed-agent selectable routes", async () => {
    const models = Array.from({ length: 397 }, (_, index) => `provider/model-${index}`);
    vi.mocked(discoverOpencodeCliModelDiscovery).mockResolvedValueOnce({
      models,
      status: "available",
      reason: "OpenCode CLI models discovered.",
      authState: "authenticated",
    });

    const discovered = await discoverManagedAgentProviderModels();
    const decisions = Object.values(discovered.opencode ?? {}).map((entry) => entry.catalogDiagnosticDecision);

    expect(decisions).toHaveLength(397);
    expect(decisions).toEqual(models.map((model) => expect.objectContaining({
      eligible: false,
      route: expect.objectContaining({ providerId: "opencode", providerModelId: model }),
      reasons: expect.arrayContaining(["missing-configured-evidence"]),
    })));
  });
});
