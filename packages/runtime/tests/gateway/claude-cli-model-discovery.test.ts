import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSync, installedClaudeOnly } = vi.hoisted(() => {
  const installedClaudeOnly = (executable: string, args: readonly string[]) => {
    if (executable === "claude" && args[0] === "--version") {
      return "2.1.220 (Claude Code)\n";
    }
    throw new Error("executable unavailable");
  };
  return { execFileSync: vi.fn(installedClaudeOnly), installedClaudeOnly };
});
const supportedModels = vi.fn(async () => [{
  value: "sonnet",
  resolvedModel: "claude-sonnet-5",
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  supportsAdaptiveThinking: true,
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
  beforeEach(() => {
    execFileSync.mockImplementation(installedClaudeOnly);
  });

  it("reads the SDK control catalog without consuming the response iterator", async () => {
    const discovery = await discoverClaudeCliModelDiscovery();

    expect(query).toHaveBeenCalledWith({
      prompt: "",
      options: {
        permissionMode: "plan",
        pathToClaudeCodeExecutable: "claude",
      },
    });
    expect(execFileSync).toHaveBeenCalledWith(expect.stringMatching(/(?:^|[\\/])claude(?:\.exe)?$/u), ["--version"], {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(supportedModels).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(discovery).toMatchObject({
      models: ["sonnet", "claude-sonnet-5"],
      status: "available",
      authState: "authenticated",
      modelCapabilities: {
        sonnet: {
          deliberation: {
            provider: "claude",
            model: "sonnet",
            levels: [
              { id: "low" },
              { id: "medium" },
              { id: "high" },
              { id: "xhigh" },
              { id: "max" },
            ],
            supportsAdaptive: true,
            evidence: {
              sourceIdentity: "claude-code-model-catalog",
              sourceRevision: "2.1.220",
            },
          },
        },
        "claude-sonnet-5": {
          deliberation: {
            model: "claude-sonnet-5",
            evidence: { sourceRevision: "2.1.220" },
          },
        },
      },
    });
  });

  it("does not invent deliberation levels when Claude reports no effort support", async () => {
    supportedModels.mockResolvedValueOnce([{
      value: "haiku",
      resolvedModel: "claude-haiku-4-5",
      supportsEffort: false,
      supportsAdaptiveThinking: false,
    }]);

    const discovery = await discoverClaudeCliModelDiscovery();

    expect(discovery.modelCapabilities).toBeUndefined();
  });

  it("drops catalog effort levels that the bound Agent SDK cannot transport", async () => {
    supportedModels.mockResolvedValueOnce([{
      value: "sonnet",
      resolvedModel: "claude-sonnet-5",
      supportsEffort: true,
      supportedEffortLevels: ["low", "provider-experimental"],
      supportsAdaptiveThinking: true,
    }]);

    const discovery = await discoverClaudeCliModelDiscovery();

    expect(discovery.modelCapabilities?.["claude-sonnet-5"]?.deliberation?.levels).toEqual([{ id: "low" }]);
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

  it("skips a candidate that runs but reports no version instead of ending resolution", () => {
    execFileSync.mockImplementation((executable: string, args: readonly string[]) => {
      if (args[0] !== "--version") {
        throw new Error("unexpected invocation");
      }
      if (executable === "claude") {
        return "(Claude Code)\n";
      }
      if (executable === "claude.exe") {
        return "2.1.220 (Claude Code)\n";
      }
      throw new Error("executable unavailable");
    });

    expect(resolveClaudeCodeExecutable()).toEqual({
      path: "claude.exe",
      evidence: {
        executable: "<operator-harness>/claude.exe",
        version: "2.1.220",
      },
    });
  });

  it("fails closed when no candidate reports a version, never falling back to the SDK build", () => {
    execFileSync.mockImplementation(() => "(Claude Code)\n");

    expect(resolveClaudeCodeExecutable()).toBeUndefined();
  });

  it("prefers the operator's home install over a bare PATH lookup and keeps its path out of evidence", () => {
    const home = process.platform === "win32" ? "C:\\synthetic-home" : "/synthetic-home";
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    execFileSync.mockImplementation(() => "2.1.220 (Claude Code)\n");

    const resolution = resolveClaudeCodeExecutable();

    // Ordering: every candidate reports a version here, so the winner proves
    // the home install is probed before the bare `claude` PATH lookup.
    expect(resolution?.path).toContain("synthetic-home");
    // Privacy: the operator-absolute path must never reach durable evidence.
    expect(resolution?.evidence.executable).toMatch(/^<operator-harness>\//u);
    expect(resolution?.evidence.executable).not.toContain("synthetic-home");

    vi.unstubAllEnvs();
  });
});
