import { describe, expect, it, vi } from "vitest";

const { execSync } = vi.hoisted(() => ({
  execSync: vi.fn((command: string) => {
    if (command === '"claude" --version') {
      return Buffer.from("");
    }
    throw new Error("executable unavailable");
  }),
}));
const supportedModels = vi.fn(async () => [{ value: "claude-live-exact" }]);
const close = vi.fn();
const next = vi.fn();
const query = vi.fn(() => ({ supportedModels, close, next }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execSync,
}));

import { discoverClaudeCliModelDiscovery } from "../../src/gateway/gui-provider-models.js";

describe("discoverClaudeCliModelDiscovery", () => {
  it("reads the SDK control catalog without consuming the response iterator", async () => {
    const discovery = await discoverClaudeCliModelDiscovery();

    expect(query).toHaveBeenCalledWith({
      prompt: "",
      options: {
        permissionMode: "plan",
        pathToClaudeCodeExecutable: "claude",
      },
    });
    expect(execSync).toHaveBeenCalledWith('"claude" --version', { stdio: "ignore" });
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
