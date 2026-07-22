import { describe, expect, it, vi } from "vitest";

const supportedModels = vi.fn(async () => [{ value: "claude-live-exact" }]);
const close = vi.fn();
const next = vi.fn();
const query = vi.fn(() => ({ supportedModels, close, next }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query }));

import { discoverClaudeCliModelDiscovery } from "../../src/gateway/gui-provider-models.js";

describe("discoverClaudeCliModelDiscovery", () => {
  it("reads the SDK control catalog without consuming the response iterator", async () => {
    const discovery = await discoverClaudeCliModelDiscovery();

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ prompt: "" }));
    expect(supportedModels).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(discovery).toMatchObject({
      models: ["claude-live-exact"],
      status: "available",
      authState: "authenticated",
    });
  });
});
