import {
  discoverClaudeCliModelDiscovery,
  discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
} from "@kilnai/runtime";
import { describe, expect, it, vi } from "vitest";
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
    discoverClaudeCliModelDiscovery: vi.fn(async () => ({
      models: ["claude-sonnet-live-exact"],
      modelCapabilities: {
        "claude-sonnet-live-exact": {
          deliberation: {
            provider: "claude",
            model: "claude-sonnet-live-exact",
            levels: [{ id: "low" }, { id: "high" }],
            defaultLevel: "high",
            supportsAdaptive: true,
            evidence: {
              sourceIdentity: "claude-code-model-catalog",
              sourceRevision: "2.1.226",
              observedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        },
      },
      status: "available",
      reason: "Claude Code models discovered through the Agent SDK control plane.",
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
      modelCapabilities: {
        "opencode/minimax-m2.5-free": {
          deliberation: {
            provider: "opencode",
            model: "opencode/minimax-m2.5-free",
            levels: [{ id: "low" }, { id: "high" }],
            supportsAdaptive: false,
            evidence: {
              sourceIdentity: "opencode-cli-model-catalog",
              sourceRevision: "1.18.16:catalog-fixture",
              observedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        },
      },
      status: "available",
      reason: "OpenCode CLI models discovered through its local model API.",
      authState: "authenticated",
    })),
  };
});

describe("discoverManagedAgentProviderModels", () => {
  it("targets selected harnesses and direct providers without probing unrelated providers", async () => {
    vi.clearAllMocks();
    let directAvailability: Readonly<Record<string, boolean>> | undefined;
    vi.mocked(discoverGuiDirectProviderModelDiscovery).mockImplementationOnce(async (availability) => {
      directAvailability = availability;
      return {};
    });

    const discovered = await discoverManagedAgentProviderModels(
      new Set(["codex", "opencode-go", "codex", "unknown-provider"]),
    );

    expect(discoverClaudeCliModelDiscovery).not.toHaveBeenCalled();
    expect(discoverCodexCliModelDiscovery).toHaveBeenCalledTimes(1);
    expect(discoverOpencodeCliModelDiscovery).not.toHaveBeenCalled();
    expect(directAvailability).toEqual({
      anthropic: false,
      "codex-oauth": false,
      deepseek: false,
      lmstudio: false,
      ollama: false,
      openai: false,
      "opencode-go": true,
      "opencode-zen": false,
      openrouter: false,
    });
    expect(Object.keys(discovered)).toEqual(["codex"]);
    expect(discovered.codex).toHaveProperty("gpt-5.3-codex");
  });

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
    expect(discovered.opencode?.["opencode/minimax-m2.5-free"]?.deliberationCapabilities).toEqual({
      provider: "opencode",
      model: "opencode/minimax-m2.5-free",
      levels: [{ id: "low" }, { id: "high" }],
      supportsAdaptive: false,
      evidence: {
        sourceIdentity: "opencode-cli-model-catalog",
        sourceRevision: "1.18.16:catalog-fixture",
        observedAt: "2026-08-10T00:00:00.000Z",
      },
    });
    expect(discovered.claude?.["claude-sonnet-live-exact"]?.catalogDiagnosticDecision).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["missing-configured-evidence"]),
      route: { providerId: "claude", providerModelId: "claude-sonnet-live-exact" },
    });
    expect(discovered.claude?.["claude-sonnet-live-exact"]?.deliberationCapabilities).toEqual({
      provider: "claude",
      model: "claude-sonnet-live-exact",
      levels: [{ id: "low" }, { id: "high" }],
      defaultLevel: "high",
      supportsAdaptive: true,
      evidence: {
        sourceIdentity: "claude-code-model-catalog",
        sourceRevision: "2.1.226",
        observedAt: "2026-08-10T00:00:00.000Z",
      },
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

  it("drops discovered deliberation evidence whose model identity does not match its catalog entry", async () => {
    vi.mocked(discoverClaudeCliModelDiscovery).mockResolvedValueOnce({
      models: ["claude-sonnet-live-exact"],
      modelCapabilities: {
        "claude-sonnet-live-exact": {
          deliberation: {
            provider: "claude",
            model: "claude-opus-other-exact",
            levels: [{ id: "high" }],
            supportsAdaptive: false,
            evidence: {
              sourceIdentity: "claude-code-model-catalog",
              sourceRevision: "2.1.226",
              observedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        },
      },
      status: "available",
      reason: "Claude Code models discovered through the Agent SDK control plane.",
      authState: "authenticated",
    });

    const discovered = await discoverManagedAgentProviderModels();

    expect(discovered.claude?.["claude-sonnet-live-exact"]?.deliberationCapabilities).toBeUndefined();
  });
});
