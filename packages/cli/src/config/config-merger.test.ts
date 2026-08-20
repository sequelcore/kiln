import { describe, expect, it, vi, beforeEach } from "vitest";
import { join } from "node:path";

vi.mock("../kiln-yaml.js", () => ({
  readKilnYaml: vi.fn(),
  mergeKilnYaml: vi.fn(),
}));

vi.mock("./global-config.js", () => ({
  readGlobalConfig: vi.fn(),
  resolveGlobalDefaultProvider: (config: {
    targetRouting?: { defaultTargetId?: string };
    targetCatalog?: { targets?: readonly { id: string; providerId: string; providerModelId?: string }[] };
  }) => config.targetCatalog?.targets?.find((target) => target.id === config.targetRouting?.defaultTargetId)?.providerId,
  resolveGlobalDefaultModel: (config: {
    targetRouting?: { defaultTargetId?: string };
    targetCatalog?: { targets?: readonly { id: string; providerId: string; providerModelId?: string }[] };
  }) => config.targetCatalog?.targets?.find((target) => target.id === config.targetRouting?.defaultTargetId)?.providerModelId,
}));

import type { ResolvedKilnConfig } from "../kiln-yaml-types.js";
import type { KilnGlobalConfig } from "./global-config.js";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import { readGlobalConfig } from "./global-config.js";
import {
  deriveEffectiveKilnYaml,
  globalToKilnYaml,
  loadKilnConfig,
  loadKilnConfigWithGlobalAuthority,
} from "./config-merger.js";

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

  it("returns the exact global authority alongside effective project config", async () => {
    const globalConfig = { version: "1", modelGateway: { marker: true } } as unknown as KilnGlobalConfig;
    const projectConfig = { version: "1" } as ResolvedKilnConfig;
    const merged = { version: "1", permissions: { approval: "never", sandbox: "read-only" } } as ResolvedKilnConfig;
    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(projectConfig);
    mergeKilnYamlMock.mockReturnValue(merged);

    await expect(loadKilnConfigWithGlobalAuthority("/repo")).resolves.toEqual({
      kilnYaml: merged,
      globalConfig,
    });
    expect(readGlobalConfigMock).toHaveBeenCalledTimes(1);
    expect(readKilnYamlMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a project sandbox or approval policy that broadens global authority", () => {
    const globalConfig = {
      version: "3",
      permissions: { approval: "on-request", sandbox: "read-only" },
    } as KilnGlobalConfig;
    const projectConfig = {
      version: "1",
      permissions: { approval: "never", sandbox: "danger-full-access" },
    } as unknown as ResolvedKilnConfig;

    expect(() => deriveEffectiveKilnYaml(globalConfig, projectConfig)).toThrow(
      /project.*(?:authority|permissions).*broaden.*global/i,
    );
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("rejects project direct-execution limits that exceed the global ceiling", () => {
    const globalConfig = {
      version: "3",
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: { maxFiles: 1, maxRisk: "low" },
        requireDelegationFor: ["architecture", "security"],
        requiredEvidence: ["surface-map", "tests"],
      },
    } as KilnGlobalConfig;
    const projectConfig = {
      version: "1",
      workGovernance: {
        defaultPosture: "direct",
        directExecution: { maxFiles: 2, maxRisk: "medium" },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
    } as unknown as ResolvedKilnConfig;

    expect(() => deriveEffectiveKilnYaml(globalConfig, projectConfig)).toThrow(
      /project.*work governance.*(?:broaden|exceed).*global/i,
    );
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("rejects a project bounded work ceiling because the ceiling is global-only", () => {
    const globalConfig = {
      version: "3",
      workGovernance: {
        boundedWorkCeiling: {
          allowedEffects: ["inspect", "modify_source"],
          allowedRoots: ["packages/cli"],
          deniedRoots: ["packages/cli/private"],
          maximumLimits: {
            maxExecutionAttempts: 2,
            maxManagedInvocations: 4,
            maxConcurrentManagedInvocations: 2,
            maxChildDepth: 1,
            maxReviewRounds: 3,
            maxRemediationRounds: 2,
            maxToolCalls: 20,
            maxActiveDurationMs: 60_000,
          },
          minimumHarnessCapability: "authoritative",
        },
      },
    } as unknown as KilnGlobalConfig;
    const projectConfig = {
      version: "1",
      workGovernance: {
        boundedWorkCeiling: {
          allowedEffects: ["external_write"],
          allowedRoots: ["/"],
          deniedRoots: [],
          maximumLimits: { maxExecutionAttempts: 99 },
          minimumHarnessCapability: "advisory_only",
        },
      },
    } as unknown as ResolvedKilnConfig;

    expect(() => deriveEffectiveKilnYaml(globalConfig, projectConfig)).toThrow(
      "Project workGovernance.boundedWorkCeiling is global-only.",
    );
    expect(() => deriveEffectiveKilnYaml(null, projectConfig)).toThrow(
      "Project workGovernance.boundedWorkCeiling is global-only.",
    );
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("accepts a project request above the global default but within the explicit global ceiling", () => {
    const globalConfig = {
      version: "3",
      permissions: { approval: "on-request", sandbox: "read-only" },
      permissionCeiling: { approval: "on-request", sandbox: "workspace-write" },
      workGovernance: {
        defaultPosture: "direct",
        directExecution: { maxFiles: 3, maxRisk: "medium" },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
    } as KilnGlobalConfig;
    const projectConfig = {
      version: "1",
      permissions: { approval: "on-request", sandbox: "workspace-write" },
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: { maxFiles: 1, maxRisk: "low" },
        requireDelegationFor: ["architecture", "security"],
        requiredEvidence: ["surface-map", "tests"],
      },
    } as unknown as ResolvedKilnConfig;
    const narrowed = { ...projectConfig, version: "1" } as ResolvedKilnConfig;
    mergeKilnYamlMock.mockReturnValue(narrowed);

    expect(deriveEffectiveKilnYaml(globalConfig, projectConfig)).toBe(narrowed);
    expect(mergeKilnYamlMock).toHaveBeenCalledTimes(1);
  });

  it("returns global-converted-to-ResolvedKilnConfig when only global config exists", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "3",
      engines: { codex: { enabled: true, billing: "plus-quota" } },
      targetCatalog: {
        accounts: [], accountPolicies: [],
        targets: [{ id: "codex", kind: "harness", label: "Codex", providerId: "codex", providerModelId: "gpt-5.4" } as never],
      },
      targetRouting: { defaultTargetId: "codex" },
      permissions: { approval: "never", sandbox: "workspace-write" },
      mcp: { servers: { shared: { type: "stdio", command: "srv" } } },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
      skills: {
        builtin: {
          enabled: true,
          include: ["tdd-workflow"],
        },
        selection: {
          mode: "auto",
        },
      },
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
      modelTaskSuitability: [{
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "limited",
        reason: "Prefer a visual route when available.",
      }],
      deliberationPolicy: {
        default: {
          mode: "adaptive",
          target: "balanced",
          onUnsupported: "deny",
        },
        byTask: {
          "mechanical-edit": {
            mode: "adaptive",
            target: "latency-first",
          },
        },
      },
      communication: {
        responseDetail: "concise",
        requiredContent: ["warning", "verification"],
      },
    };
    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(null);

    const result = await loadKilnConfig("/repo");

    expect(result).toEqual({
      version: "1",
      provider: "codex",
      model: { default: "gpt-5.4" },
      targetCatalog: globalConfig.targetCatalog,
      permissions: { approval: "never", sandbox: "workspace-write" },
      mcp: { servers: { shared: { type: "stdio", command: "srv" } } },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
      skills: {
        builtin: {
          enabled: true,
          include: ["tdd-workflow"],
        },
        selection: {
          mode: "auto",
        },
      },
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
      modelTaskSuitability: [{
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "limited",
        reason: "Prefer a visual route when available.",
      }],
      deliberationPolicy: {
        default: {
          mode: "adaptive",
          target: "balanced",
          onUnsupported: "deny",
        },
        byTask: {
          "mechanical-edit": {
            mode: "adaptive",
            target: "latency-first",
          },
        },
      },
      communication: {
        responseDetail: "concise",
        requiredContent: ["warning", "verification"],
      },
    });
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("returns project config as-is when only project config exists", async () => {
    const projectConfig: ResolvedKilnConfig = {
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
      version: "3",
      engines: { codex: { enabled: true, billing: "plus-quota" } },
      targetCatalog: {
        accounts: [], accountPolicies: [],
        targets: [{ id: "codex", kind: "harness", label: "Codex", providerId: "codex", providerModelId: "gpt-5.4" } as never],
      },
      targetRouting: { defaultTargetId: "codex" },
    };
    const projectConfig: ResolvedKilnConfig = {
      version: "1",
      provider: "claude",
      domain: "project-domain",
      teamMode: "solo",
    };
    const merged: ResolvedKilnConfig = {
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
      expect.objectContaining({
        version: "1",
        provider: "codex",
        model: { default: "gpt-5.4" },
        targetCatalog: globalConfig.targetCatalog,
        workGovernance: {
          defaultPosture: "orchestrate",
          directExecution: {
            maxFiles: 1,
            maxRisk: "low",
          },
          requireDelegationFor: [
            "architecture",
            "security",
            "ui",
            "runtime",
            "provider-routing",
            "managed-agents",
            "config",
            "multi-file",
            "cross-surface",
            "long-running",
            "verification-heavy",
            "formal-proof-candidate",
          ],
          requiredEvidence: [
            "surface-map",
            "risk-hypothesis",
            "plan",
            "tests",
            "typecheck",
            "residual-risk",
          ],
        },
      }),
      projectConfig,
    );
    expect(result).toEqual(merged);
  });

  it("MCP servers are additive - global + project servers both present in result", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      mcp: { servers: { globalSrv: { type: "stdio", command: "global" } } },
    };
    const projectConfig: ResolvedKilnConfig = {
      version: "1",
      mcp: { servers: { projectSrv: { type: "stdio", command: "project" } } },
    };
    const merged: ResolvedKilnConfig = {
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
      version: "3",
      engines: { codex: { enabled: true, billing: "plus-quota" } },
      targetCatalog: {
        accounts: [], accountPolicies: [],
        targets: [{ id: "codex", kind: "harness", label: "Codex", providerId: "codex", providerModelId: "gpt-5.4" } as never],
      },
      targetRouting: { defaultTargetId: "codex" },
      permissions: { approval: "on-request", sandbox: "read-only" },
      mcp: { servers: { one: { type: "stdio", command: "one" } } },
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "echo done" }] }],
      },
      skills: {
        builtin: {
          exclude: ["frontend-ux-review"],
        },
        selection: {
          mode: "advisory",
        },
      },
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
      modelTaskSuitability: [{
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "limited",
        reason: "Prefer a visual route when available.",
      }],
    };

    expect(globalToKilnYaml(globalConfig)).toEqual({
      version: "1",
      provider: "codex",
      model: { default: "gpt-5.4" },
      targetCatalog: globalConfig.targetCatalog,
      permissions: { approval: "on-request", sandbox: "read-only" },
      mcp: { servers: { one: { type: "stdio", command: "one" } } },
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "echo done" }] }],
      },
      skills: {
        builtin: {
          exclude: ["frontend-ux-review"],
        },
        selection: {
          mode: "advisory",
        },
      },
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
      modelTaskSuitability: [{
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "limited",
        reason: "Prefer a visual route when available.",
      }],
    });
  });

  it("globalToKilnYaml() maps web provider defaults without granting network authority", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      web: {
        searchProvider: {
          type: "tavily",
          apiKeyEnv: "TAVILY_API_KEY",
        },
        searchFallbackProviders: [{
          type: "brave",
          apiKeyEnv: "BRAVE_API_KEY",
        }],
        extractProvider: {
          type: "firecrawl",
          apiKeyEnv: "FIRECRAWL_API_KEY",
        },
      },
    };

    expect(globalToKilnYaml(globalConfig).web).toEqual({
      searchProvider: {
        type: "tavily",
        apiKeyEnv: "TAVILY_API_KEY",
      },
      searchFallbackProviders: [{
        type: "brave",
        apiKeyEnv: "BRAVE_API_KEY",
      }],
      extractProvider: {
        type: "firecrawl",
        apiKeyEnv: "FIRECRAWL_API_KEY",
      },
    });
  });

  it("globalToKilnYaml() maps undefined model to undefined", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "3",
      engines: { claude: { enabled: true, billing: "subscription" } },
      targetCatalog: {
        accounts: [], accountPolicies: [],
        targets: [{ id: "claude", kind: "harness", label: "Claude", providerId: "claude", providerModelId: undefined } as never],
      },
      targetRouting: { defaultTargetId: "claude" },
    };

    expect(globalToKilnYaml(globalConfig)).toEqual({
      version: "1",
      provider: "claude",
      model: undefined,
      targetCatalog: globalConfig.targetCatalog,
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: [
          "architecture",
          "security",
          "ui",
          "runtime",
          "provider-routing",
          "managed-agents",
          "config",
          "multi-file",
          "cross-surface",
          "long-running",
          "verification-heavy",
          "formal-proof-candidate",
        ],
        requiredEvidence: [
          "surface-map",
          "risk-hypothesis",
          "plan",
          "tests",
          "typecheck",
          "residual-risk",
        ],
      },
      modelTaskSuitability: undefined,
    });
  });
});
