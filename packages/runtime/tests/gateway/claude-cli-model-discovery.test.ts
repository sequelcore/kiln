import { describe, expect, it, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn((executable: string, args: readonly string[]) => {
    if (executable === "claude" && args[0] === "--version") {
      return "2.1.220 (Claude Code)\n";
    }
    throw new Error("executable unavailable");
  }),
}));
const supportedModels = vi.fn(async () => [{
  value: "sonnet",
  resolvedModel: "claude-sonnet-5",
}]);
const close = vi.fn();
const next = vi.fn();
const query = vi.fn(() => ({ supportedModels, close, next }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync,
}));

import {
  discoverClaudeCliModelDiscovery,
  resolveClaudeCodeExecutable,
} from "../../src/gateway/gui-provider-models.js";

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
    expect(execFileSync).toHaveBeenCalledWith("claude", ["--version"], { encoding: "utf8" });
    expect(supportedModels).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(discovery).toMatchObject({
      models: ["sonnet", "claude-sonnet-5"],
      status: "available",
      authState: "authenticated",
    });
  });

  it("resolves one shared executable path with portable version evidence", () => {
    expect(resolveClaudeCodeExecutable()).toEqual({
      path: "claude",
      evidence: {
        executable: "<operator-harness>/claude",
        version: "2.1.220",
      },
    });
  });
});
