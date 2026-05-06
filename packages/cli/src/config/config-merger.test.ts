import { describe, expect, it, vi, beforeEach } from "vitest";
import { join } from "node:path";

vi.mock("../kiln-yaml.js", () => ({
  readKilnYaml: vi.fn(),
  mergeKilnYaml: vi.fn(),
}));

vi.mock("./global-config.js", () => ({
  readGlobalConfig: vi.fn(),
  resolveGlobalDefaultProvider: (config: {
    routing?: { defaultWorker?: string };
    engines?: Record<string, { enabled?: boolean }>;
  }) => config.routing?.defaultWorker ?? Object.entries(config.engines ?? {}).find(([, engine]) => engine.enabled)?.[0],
  resolveGlobalDefaultModel: (config: {
    routing?: { defaultWorker?: string };
    engines?: Record<string, { enabled?: boolean }>;
    models?: Record<string, string | undefined>;
  }) => {
    const provider = config.routing?.defaultWorker
      ?? Object.entries(config.engines ?? {}).find(([, engine]) => engine.enabled)?.[0];
    return (provider ? config.models?.[provider] : undefined) ?? config.models?.default;
  },
}));

import type { KilnYaml } from "../kiln-yaml-types.js";
import type { KilnGlobalConfig } from "./global-config.js";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import { readGlobalConfig } from "./global-config.js";
import { globalToKilnYaml, loadKilnConfig } from "./config-merger.js";

const readGlobalConfigMock = readGlobalConfig as unknown as ReturnType<typeof vi.fn>;
const readKilnYamlMock = readKilnYaml as unknown as ReturnType<typeof vi.fn>;
const mergeKilnYamlMock = mergeKilnYaml as unknown as ReturnType<typeof vi.fn>;

describe("config-merger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readGlobalConfigMock.mockReset();
    readKilnYamlMock.mockReset();
    mergeKilnYamlMock.mockReset();
  });

  it("returns null when both global and project config are missing", async () => {
    readGlobalConfigMock.mockReturnValue(null);
    readKilnYamlMock.mockReturnValue(null);

    const result = await loadKilnConfig("/repo");

    expect(readKilnYamlMock).toHaveBeenCalledWith(join("/repo", ".kiln"));
    expect(result).toBeNull();
  });

  it("returns global-converted-to-KilnYaml when only global config exists", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "2",
      engines: { codex: { enabled: true, billing: "plus-quota" } },
      routing: { defaultWorker: "codex", budgetAware: false },
      models: { codex: "gpt-5.4" },
      permissions: { approval: "never", sandbox: "workspace-write" },
      mcp: { servers: { shared: { type: "stdio", command: "srv" } } },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
    };
    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(null);

    const result = await loadKilnConfig("/repo");

    expect(result).toEqual({
      version: "1",
      provider: "codex",
      model: { default: "gpt-5.4" },
      permissions: { approval: "never", sandbox: "workspace-write" },
      mcp: { servers: { shared: { type: "stdio", command: "srv" } } },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
    });
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("returns project config as-is when only project config exists", async () => {
    const projectConfig: KilnYaml = {
      version: "1",
      provider: "claude",
      domain: "cinema",
      model: { default: "sonnet" },
    };
    readGlobalConfigMock.mockReturnValue(null);
    readKilnYamlMock.mockReturnValue(projectConfig);

    const result = await loadKilnConfig("/repo");

    expect(result).toBe(projectConfig);
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("merges global as base with project as override - project scalar wins", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "2",
      engines: { codex: { enabled: true, billing: "plus-quota" } },
      routing: { defaultWorker: "codex", budgetAware: false },
      models: { codex: "gpt-5.4" },
    };
    const projectConfig: KilnYaml = {
      version: "1",
      provider: "claude",
      domain: "project-domain",
      teamMode: "solo",
    };
    const merged: KilnYaml = {
      version: "1",
      provider: "claude",
      domain: "project-domain",
      teamMode: "solo",
      model: { default: "gpt-5.4" },
    };

    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(projectConfig);
    mergeKilnYamlMock.mockReturnValue(merged);

    const result = await loadKilnConfig("/repo");

    expect(mergeKilnYamlMock).toHaveBeenCalledWith(
      {
        version: "1",
        provider: "codex",
        model: { default: "gpt-5.4" },
        permissions: undefined,
        mcp: undefined,
        hooks: undefined,
      },
      projectConfig,
    );
    expect(result).toEqual(merged);
  });

  it("MCP servers are additive - global + project servers both present in result", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "2",
      mcp: { servers: { globalSrv: { type: "stdio", command: "global" } } },
    };
    const projectConfig: KilnYaml = {
      version: "1",
      mcp: { servers: { projectSrv: { type: "stdio", command: "project" } } },
    };
    const merged: KilnYaml = {
      version: "1",
      mcp: {
        servers: {
          globalSrv: { type: "stdio", command: "global" },
          projectSrv: { type: "stdio", command: "project" },
        },
      },
    };

    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(projectConfig);
    mergeKilnYamlMock.mockReturnValue(merged);

    const result = await loadKilnConfig("/repo");

    expect(mergeKilnYamlMock).toHaveBeenCalledTimes(1);
    expect(result?.mcp?.servers.globalSrv).toEqual({ type: "stdio", command: "global" });
    expect(result?.mcp?.servers.projectSrv).toEqual({ type: "stdio", command: "project" });
  });

  it("globalToKilnYaml() maps provider, model, permissions, mcp, hooks correctly", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "2",
      engines: { codex: { enabled: true, billing: "plus-quota" } },
      routing: { defaultWorker: "codex", budgetAware: false },
      models: { default: "claude-opus-4-7", codex: "gpt-5.4" },
      permissions: { approval: "on-request", sandbox: "read-only" },
      mcp: { servers: { one: { type: "stdio", command: "one" } } },
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "echo done" }] }],
      },
    };

    expect(globalToKilnYaml(globalConfig)).toEqual({
      version: "1",
      provider: "codex",
      model: { default: "gpt-5.4" },
      permissions: { approval: "on-request", sandbox: "read-only" },
      mcp: { servers: { one: { type: "stdio", command: "one" } } },
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "echo done" }] }],
      },
    });
  });

  it("globalToKilnYaml() maps undefined model to undefined", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "2",
      engines: { claude: { enabled: true, billing: "subscription" } },
      routing: { defaultWorker: "claude", budgetAware: false },
    };

    expect(globalToKilnYaml(globalConfig)).toEqual({
      version: "1",
      provider: "claude",
      model: undefined,
      permissions: undefined,
      mcp: undefined,
      hooks: undefined,
    });
  });
});
