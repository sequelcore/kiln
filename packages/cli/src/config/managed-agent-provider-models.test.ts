import { describe, expect, it, vi } from "vitest";
import { discoverManagedAgentProviderModels } from "./managed-agent-provider-models.js";

vi.mock("@kilnai/runtime", () => ({
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
}));

describe("discoverManagedAgentProviderModels", () => {
  it("includes direct-provider discovery for managed invocation routes", async () => {
    await expect(discoverManagedAgentProviderModels()).resolves.toEqual({
      codex: ["gpt-5.3-codex"],
      opencode: ["opencode/minimax-m2.5-free"],
      "codex-oauth": ["gpt-5.5", "codex-auto-review"],
      "opencode-go": ["qwen3.7-max"],
    });
  });
});
