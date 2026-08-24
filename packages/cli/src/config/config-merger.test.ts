import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../kiln-yaml.js", () => ({
  readKilnYamlFile: vi.fn(),
  mergeKilnYaml: vi.fn(),
}));

vi.mock("./global-config.js", () => ({
  readGlobalConfig: vi.fn(),
  resolveGlobalConfigPath: () => "/ambient-kiln/config.yaml",
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
import { createMcpCredentialAccess, KILN_MCP_SECRET_KEY_ENV } from "./mcp-credentials.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";
import { makeOperatorSurfaceGlobalConfig } from "../../tests/commands/operator-surface-v4-fixture.js";
import { mergeKilnYaml, readKilnYamlFile } from "../kiln-yaml.js";
import { readGlobalConfig } from "./global-config.js";
import {
  deriveEffectiveKilnYaml,
  globalToKilnYaml,
  loadKilnConfig,
  loadKilnConfigWithGlobalAuthority,
  loadResolvedKilnMcpConfiguration,
} from "./config-merger.js";

const readGlobalConfigMock = readGlobalConfig as unknown as ReturnType<typeof vi.fn>;
const readKilnYamlMock = readKilnYamlFile as unknown as ReturnType<typeof vi.fn>;
const mergeKilnYamlMock = mergeKilnYaml as unknown as ReturnType<typeof vi.fn>;
const temporaryRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-config-merger-project-"));
  temporaryRoots.push(root);
  return root;
}

describe("config-merger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readGlobalConfigMock.mockReset();
    readKilnYamlMock.mockReset();
    mergeKilnYamlMock.mockReset();
  });

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("returns null when both global and project config are missing", async () => {
    readGlobalConfigMock.mockReturnValue(null);
    readKilnYamlMock.mockReturnValue(null);

    const result = await loadKilnConfig(createTempRoot());

    expect(readKilnYamlMock).toHaveBeenCalledWith(expect.stringMatching(/[\\/]config\.yaml$/u));
    expect(result).toBeNull();
  });

  it("checks MCP credentials in the established binding home", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-config-merger-binding-"));
    const bindingHome = join(root, "binding-home");
    const ambientHome = join(root, "ambient-home");
    const binding = resolveProjectStateBinding(root, { kilnHome: bindingHome });
    const globalConfig = {
      version: "4",
      mcp: {
        servers: {
          shared: {
            enabled: true,
            transport: "stdio",
            command: "fixture-mcp",
            env: { TOKEN: { fromCredential: "bound-token" } },
            admission: { state: "admitted" },
          },
        },
      },
    } as unknown as KilnGlobalConfig;
    try {
      vi.stubEnv("XDG_CONFIG_HOME", ambientHome);
      vi.stubEnv(KILN_MCP_SECRET_KEY_ENV, "binding-master-key");
      createMcpCredentialAccess(process.env, binding.kilnHome).set("bound-token", "secret-value");
      readGlobalConfigMock.mockReturnValue(globalConfig);
      readKilnYamlMock.mockReturnValue(null);

      const result = loadResolvedKilnMcpConfiguration(root, { projectStateBinding: binding, globalConfig });

      expect(result.diagnostics).toEqual([]);
      expect(result.servers.shared?.admission?.state).toBe("admitted");
      expect(result.servers.shared?.env).toEqual({ TOKEN: { fromCredential: "bound-token" } });
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads global authority from the established binding after XDG changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-config-merger-global-binding-"));
    const bindingHome = join(root, "binding-home");
    const ambientHome = join(root, "ambient-home");
    const binding = resolveProjectStateBinding(root, { kilnHome: bindingHome });
    const globalConfig = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "bound-default");
    try {
      mkdirSync(bindingHome, { recursive: true });
      writeFileSync(join(bindingHome, "config.yaml"), stringifyYaml(globalConfig), "utf-8");
      vi.stubEnv("XDG_CONFIG_HOME", ambientHome);
      readKilnYamlMock.mockReturnValue(null);

      const result = await loadKilnConfigWithGlobalAuthority(root, { projectStateBinding: binding });

      expect(result.globalConfig?.targetRouting?.defaultTargetId).toBe("bound-default");
      expect(result.kilnYaml?.model?.default).toBe("gpt-5.4-mini");
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the exact global authority alongside effective project config", async () => {
    const globalConfig = { version: "1", modelGateway: { marker: true } } as unknown as KilnGlobalConfig;
    const projectConfig = { version: "1" } as ResolvedKilnConfig;
    const merged = { version: "1", permissions: { approval: "never", sandbox: "read-only" } } as ResolvedKilnConfig;
    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(projectConfig);
    mergeKilnYamlMock.mockReturnValue(merged);

    await expect(loadKilnConfigWithGlobalAuthority(createTempRoot())).resolves.toEqual({
      kilnYaml: merged,
      globalConfig,
    });
    expect(readGlobalConfigMock).toHaveBeenCalledTimes(1);
    expect(readKilnYamlMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a project sandbox or approval policy that broadens global authority", () => {
    const globalConfig = {
      version: "4",
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

  it("rejects a project bounded work ceiling because the ceiling is global-only", () => {
    const globalConfig = {
      version: "4",
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

  it("rejects a project request above global permissions even when the ceiling is wider", () => {
    const globalConfig = {
      version: "4",
      permissions: { approval: "on-request", sandbox: "read-only" },
      permissionCeiling: { approval: "on-request", sandbox: "workspace-write" },
      workGovernance: {
        defaultPosture: "direct",
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
    } as KilnGlobalConfig;
    const projectConfig = {
      version: "1",
      permissions: { approval: "on-request", sandbox: "workspace-write" },
      workGovernance: {
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture", "security"],
        requiredEvidence: ["surface-map", "tests"],
      },
    } as unknown as ResolvedKilnConfig;
    expect(() => deriveEffectiveKilnYaml(globalConfig, projectConfig)).toThrow(
      "Project permissions.sandbox cannot broaden global.permissions.",
    );
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("checks global permissions and permissionCeiling as independent scalar bounds", () => {
    const globalConfig = {
      version: "4",
      permissions: { approval: "on-request", sandbox: "read-only" },
      permissionCeiling: { approval: "on-request", sandbox: "workspace-write" },
    } as KilnGlobalConfig;

    expect(() => deriveEffectiveKilnYaml(globalConfig, {
      version: "1",
      permissions: { sandbox: "workspace-write" },
    })).toThrow("Project permissions.sandbox cannot broaden global.permissions.");

    expect(() => deriveEffectiveKilnYaml({
      version: "4",
      permissionCeiling: { sandbox: "read-only" },
    } as KilnGlobalConfig, {
      version: "1",
      permissions: { sandbox: "workspace-write" },
    })).toThrow("Project permissions.sandbox cannot broaden global.permissionCeiling.");
  });

  it("rejects project authority-bearing dimensions with a stable path diagnostic", () => {
    const globalConfig = {
      version: "4",
      permissions: {
        approval: "on-request",
        sandbox: "read-only",
        tools: [{ tool: "bash", action: "deny" }],
      },
    } as KilnGlobalConfig;

    expect(() => deriveEffectiveKilnYaml(globalConfig, {
      version: "1",
      permissions: { tools: [{ tool: "git", action: "deny" }] },
    } as unknown as ResolvedKilnConfig)).toThrow(
      /Invalid project config at \/permissions\/tools: unknown field/u,
    );
  });

  it("admits only a project subset of global active instruction profiles", () => {
    const globalConfig = {
      version: "4",
      activeInstructionProfiles: ["sequel-engineering", "operator-communication"],
    } as KilnGlobalConfig;
    const projectConfig = {
      version: "1",
      activeInstructionProfiles: ["sequel-engineering"],
    } as ResolvedKilnConfig;
    mergeKilnYamlMock.mockReturnValue({ version: "1", activeInstructionProfiles: ["sequel-engineering"] });

    expect(deriveEffectiveKilnYaml(globalConfig, projectConfig).activeInstructionProfiles).toEqual([
      "sequel-engineering",
    ]);
    expect(mergeKilnYamlMock).toHaveBeenCalledWith(
      expect.objectContaining({ activeInstructionProfiles: ["sequel-engineering", "operator-communication"] }),
      expect.objectContaining({ activeInstructionProfiles: ["sequel-engineering"] }),
    );
  });

  it("denies project permission leaves with no global permission ceiling", () => {
    const projectConfig = {
      version: "1",
      permissions: { sandbox: "read-only" },
    } as const;
    mergeKilnYamlMock.mockImplementation((base: ResolvedKilnConfig, override: ResolvedKilnConfig) => ({
      ...base,
      ...override,
    }));

    expect(() => deriveEffectiveKilnYaml({ version: "4" } as KilnGlobalConfig, projectConfig)).toThrow(
      "Project permissions.sandbox has no global permission ceiling.",
    );
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("denies an unbounded project permission sibling in a partial global ceiling", () => {
    expect(() => deriveEffectiveKilnYaml({
      version: "4",
      permissions: { sandbox: "read-only" },
    } as KilnGlobalConfig, {
      version: "1",
      permissions: { approval: "untrusted" },
    })).toThrow("Project permissions.approval has no global permission ceiling.");
  });

  it("denies an execution limit whose matching global bound is omitted", () => {
    expect(() => deriveEffectiveKilnYaml({
      version: "4",
      workGovernance: { boundedWorkCeiling: { maximumLimits: { maxChildDepth: 2 } } },
    } as unknown as KilnGlobalConfig, {
      version: "1",
      parallelWorkers: 1,
    })).toThrow("Project parallelWorkers cannot exceed global bounded-work ceiling.");
  });

  it("rejects project web policy and domains that broaden the global ceiling", () => {
    const globalConfig = {
      version: "4",
      web: {
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      },
    } as KilnGlobalConfig;

    expect(() => deriveEffectiveKilnYaml(globalConfig, {
      version: "1",
      web: { enabled: true, netPolicy: "full" },
    })).toThrow("Project web.netPolicy cannot broaden the global network policy.");
    expect(() => deriveEffectiveKilnYaml(globalConfig, {
      version: "1",
      web: { enabled: true, netPolicy: "documentation", allowedDomains: ["other.example.com"] },
    })).toThrow("Project web.allowedDomains must be a subset of the global domain ceiling.");
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("never promotes project authority to the root when global config is absent", () => {
    const projectConfig = {
      version: "1",
      domain: "project-fact",
      communication: { responseDetail: "concise" },
      permissions: { sandbox: "danger-full-access", approval: "never" },
      workGovernance: { defaultPosture: "direct" },
    } as unknown as ResolvedKilnConfig;

    expect(deriveEffectiveKilnYaml(null, projectConfig)).toEqual({
      version: "1",
      domain: "project-fact",
      communication: { responseDetail: "concise" },
    });
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("rejects project-only MCP servers instead of granting project connection authority", () => {
    expect(() => deriveEffectiveKilnYaml(
      {
        version: "4",
        mcp: { servers: { global: { type: "stdio", command: "global" } } },
      } as unknown as KilnGlobalConfig,
      {
        version: "1",
        mcp: { servers: { projectOnly: { enabled: true } } },
      } as unknown as ResolvedKilnConfig,
    )).toThrow(/project-only MCP server.*projectOnly|MCP.*projectOnly.*global/iu);
  });

  it("rejects project MCP servers when global authority is absent", () => {
    expect(() => deriveEffectiveKilnYaml(null, {
      version: "1",
      mcp: { servers: { projectOnly: { enabled: false } } },
    })).toThrow(/project-only MCP server.*projectOnly/iu);
  });

  it("rejects project execution limits above the global bounded-work ceiling", () => {
    expect(() => deriveEffectiveKilnYaml(
      {
        version: "4",
        workGovernance: {
          boundedWorkCeiling: {
            maximumLimits: {
              maxChildDepth: 2,
              maxConcurrentManagedInvocations: 3,
            },
          },
        },
      } as unknown as KilnGlobalConfig,
      {
        version: "1",
        maxDepth: 3,
        parallelWorkers: 4,
      } as unknown as ResolvedKilnConfig,
    )).toThrow(/cannot exceed global bounded-work ceiling/iu);
  });

  it("returns global-converted-to-ResolvedKilnConfig when only global config exists", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "4",
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

    const result = await loadKilnConfig(createTempRoot());

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
      domain: "cinema",
    };
    readGlobalConfigMock.mockReturnValue(null);
    readKilnYamlMock.mockReturnValue(projectConfig);

    const result = await loadKilnConfig(createTempRoot());

    expect(result).toEqual(projectConfig);
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("merges global as base with project as override - project scalar wins", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "4",
      engines: { codex: { enabled: true, billing: "plus-quota" } },
      targetCatalog: {
        accounts: [], accountPolicies: [],
        targets: [{ id: "codex", kind: "harness", label: "Codex", providerId: "codex", providerModelId: "gpt-5.4" } as never],
      },
      targetRouting: { defaultTargetId: "codex" },
    };
    const projectConfig: ResolvedKilnConfig = {
      version: "1",
      domain: "project-domain",
    };
    const merged: ResolvedKilnConfig = {
      version: "1",
      provider: "codex",
      domain: "project-domain",
      model: { default: "gpt-5.4" },
    };

    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(projectConfig);
    mergeKilnYamlMock.mockReturnValue(merged);

    const result = await loadKilnConfig(createTempRoot());

    expect(mergeKilnYamlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "1",
        provider: "codex",
        model: { default: "gpt-5.4" },
        targetCatalog: globalConfig.targetCatalog,
        workGovernance: {
          defaultPosture: "direct",
          requireDelegationFor: [],
          requiredEvidence: [],
        },
      }),
      projectConfig,
    );
    expect(result).toEqual(merged);
  });

  it("rejects project-only MCP servers instead of treating them as additive", async () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      mcp: { servers: { globalSrv: { type: "stdio", command: "global" } } },
    };
    const projectConfig: ResolvedKilnConfig = {
      version: "1",
      mcp: { servers: { projectSrv: { enabled: false } } },
    };
    readGlobalConfigMock.mockReturnValue(globalConfig);
    readKilnYamlMock.mockReturnValue(projectConfig);

    await expect(loadKilnConfig(createTempRoot())).rejects.toThrow(
      "Project-only MCP server 'projectSrv' is not admitted by global configuration.",
    );
    expect(mergeKilnYamlMock).not.toHaveBeenCalled();
  });

  it("globalToKilnYaml() maps provider, model, permissions, mcp, hooks correctly", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "4",
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
      version: "4",
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
        defaultPosture: "direct",
        requireDelegationFor: [],
        requiredEvidence: [],
      },
    });
  });
});
