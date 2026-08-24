import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readKilnYamlFile,
  mergeKilnYaml,
  defaultKilnYaml,
  KilnYamlError,
  type ResolvedKilnConfig,
  type KilnProjectConfig,
  type KilnYamlWebConfig,
} from "../src/kiln-yaml.js";

describe("readKilnYamlFile", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-yaml-read-"));
    configPath = join(tempDir, "config.yaml");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    expect(readKilnYamlFile(configPath)).toBeNull();
  });

  it("parses valid kiln.yaml", () => {
    writeFileSync(
      configPath,
      "version: '1'\ndomain: python\nmaxDepth: 2\n",
    );
    const result = readKilnYamlFile(configPath);
    expect(result).not.toBeNull();
    expect(result!.version).toBe("1");
    expect(result!.domain).toBe("python");
    expect(result!.maxDepth).toBe(2);
  });

  it("throws KilnYamlError when file is not an object", () => {
    writeFileSync(configPath, "just a string");
    expect(() => readKilnYamlFile(configPath)).toThrow(KilnYamlError);
  });

  it("throws KilnYamlError on parse failure", () => {
    writeFileSync(configPath, "invalid: yaml: [");
    expect(() => readKilnYamlFile(configPath)).toThrow(KilnYamlError);
  });

  it("rejects project skill visibility while native projections are user-global", () => {
    writeFileSync(
      configPath,
      "version: '1'\nskills:\n  visibility:\n    overrides:\n      planner: disabled\n",
    );
    expect(() => readKilnYamlFile(configPath)).toThrow(
      /Invalid project config at \/skills\/visibility: unknown field/u,
    );
  });

  it("rejects the global-only bounded work ceiling from project config", () => {
    writeFileSync(
      configPath,
      [
        "version: '1'",
        "workGovernance:",
        "  boundedWorkCeiling:",
        "    allowedEffects: [inspect, modify_source]",
        "    allowedRoots: [packages/cli]",
        "    deniedRoots: [packages/cli/private]",
        "    maximumLimits:",
        "      maxExecutionAttempts: 2",
        "    minimumHarnessCapability: authoritative",
      ].join("\n"),
    );

    expect(() => readKilnYamlFile(configPath)).toThrow(
      "workGovernance.boundedWorkCeiling is global-only",
    );
  });

  it("rejects agent inherit:false at the project configuration boundary", () => {
    writeFileSync(
      configPath,
      [
        "version: '1'",
        "permissions:",
        "  agentScopes:",
        "    - agent: planner",
        "      inherit: false",
      ].join("\n"),
    );

    expect(() => readKilnYamlFile(configPath)).toThrow(
      /Invalid project config at \/permissions\/agentScopes: unknown field/u,
    );
  });

  it("rejects unsupported per-gate fields", () => {
    writeFileSync(
      configPath,
      [
        "version: '1'",
        "qualityGates:",
        "  - name: test",
        "    command: bun test",
        "    coverageThreshold: 80",
      ].join("\n"),
    );

    expect(() => readKilnYamlFile(configPath)).toThrow(
      /qualityGates is global-only or is not a supported project configuration field/u,
    );
  });

  it("rejects malformed nested values with a stable field path", () => {
    writeFileSync(
      configPath,
      [
        "version: '1'",
        "permissions:",
        "  tools:",
        "    - tool: read",
        "      action: maybe",
      ].join("\n"),
    );

    expect(() => readKilnYamlFile(configPath)).toThrow(
      /Invalid project config at \/permissions\/tools: unknown field/u,
    );
  });

  it("rejects the deleted knowledge context source", () => {
    writeFileSync(
      configPath,
      "version: '1'\ncontextGovernance:\n  preferredSources: [knowledge]\n",
    );
    expect(() => readKilnYamlFile(configPath)).toThrow(
      /Invalid project config at \/contextGovernance\/preferredSources\/0/u,
    );
  });

  it("rejects whitespace-only quality-gate names at the structural boundary", () => {
    writeFileSync(
      configPath,
      [
        "version: '1'",
        "qualityGates:",
        "  - name: '   '",
        "    command: bun test",
      ].join("\n"),
    );

    expect(() => readKilnYamlFile(configPath)).toThrow(
      /qualityGates is global-only or is not a supported project configuration field/u,
    );
  });

  it("rejects unknown nested fields with the running build identity", () => {
    writeFileSync(
      configPath,
      [
        "version: '1'",
        "permissions:",
        "  sandbox: read-only",
        "  mystery: true",
      ].join("\n"),
    );

    expect(() => readKilnYamlFile(configPath)).toThrow(
      /Invalid project config at \/permissions\/mystery: unknown field\. Validated by kiln .+ at .+;/u,
    );
  });

  it.each([
    ["provider", "provider: codex-oauth"],
    ["model", "model:\n  default: gpt-5.6-sol"],
    ["provider catalog", "providers:\n  codex-oauth: {}"],
    ["target catalog", "targets:\n  sol:\n    kind: direct\n    provider: codex-oauth\n    model: gpt-5.6-sol"],
    ["managed target definitions", "managedAgents:\n  routes:\n    - id: sol\n      kind: harness\n      provider: codex\n      model: gpt-5.6-sol"],
    ["model suitability", "modelTaskSuitability: []"],
    ["deliberation policy", "deliberationPolicy:\n  default:\n    mode: adaptive\n    target: balanced"],
  ])("rejects global-only %s from project config", (_label, fieldYaml) => {
    writeFileSync(
      configPath,
      `version: '1'\n${fieldYaml}\n`,
    );

    expect(() => readKilnYamlFile(configPath)).toThrow(
      /is global-only or is not a supported project configuration field/u,
    );
  });
});

describe("mergeKilnYaml", () => {
  it("preserves an explicit project narrowing of active instruction profiles", () => {
    const result = mergeKilnYaml(
      { version: "1", activeInstructionProfiles: ["sequel-engineering", "operator-communication"] },
      { version: "1", activeInstructionProfiles: ["sequel-engineering"] },
    );

    expect(result.activeInstructionProfiles).toEqual(["sequel-engineering"]);
  });

  it("inherits global instruction profiles when the project omits them", () => {
    const result = mergeKilnYaml(
      { version: "1", activeInstructionProfiles: ["sequel-engineering", "operator-communication"] },
      { version: "1" },
    );

    expect(result.activeInstructionProfiles).toEqual(["sequel-engineering", "operator-communication"]);
  });

  it("preserves omitted global permission dimensions in a partial project overlay", () => {
    const result = mergeKilnYaml(
      {
        version: "1",
        permissions: {
          approval: "on-request",
          sandbox: "read-only",
          tools: [{ tool: "bash", action: "deny" }],
          commands: [{ pattern: "rm *", action: "deny" }],
        },
      } as ResolvedKilnConfig,
      {
        version: "1",
        permissions: { approval: "untrusted", sandbox: "read-only" },
      },
    );

    expect(result.permissions).toEqual({
      approval: "untrusted",
      sandbox: "read-only",
      tools: [{ tool: "bash", action: "deny" }],
      commands: [{ pattern: "rm *", action: "deny" }],
    });
  });

  it("preserves global external catalog authority when project skills override other fields", () => {
    const externalCatalog = {
      version: 1 as const,
      harnesses: { codex: { expectedFingerprint: `sha256:${"a".repeat(64)}`, keepImplicit: [] } },
    };
    const result = mergeKilnYaml(
      { version: "1", skills: { externalCatalog, visibility: { default: "explicit-only" } } } as ResolvedKilnConfig,
      { version: "1", skills: { selection: { mode: "auto" } } },
    );
    expect(result.skills).toMatchObject({ externalCatalog, selection: { mode: "auto" }, visibility: { default: "explicit-only" } });
  });
  it("override wins on scalar conflict", () => {
    const base: ResolvedKilnConfig = { version: "1", domain: "python" };
    const override: KilnProjectConfig = { version: "1", domain: "react-ts" };
    const result = mergeKilnYaml(base, override);
    expect(result.domain).toBe("react-ts");
  });

  it("preserves base fields not in override", () => {
    const base: ResolvedKilnConfig = { version: "1", domain: "python", provider: "claude" };
    const override: KilnProjectConfig = { version: "1", domain: "react-ts" };
    const result = mergeKilnYaml(base, override);
    expect(result.provider).toBe("claude");
  });

  it("merges mcp.servers by server name", () => {
    const base = {
      version: "1",
      mcp: {
        servers: {
          kiln: { transport: "stdio", command: "kiln-mcp" },
        },
      },
    } as unknown as ResolvedKilnConfig;
    const override: KilnProjectConfig = {
      version: "1",
      mcp: {
        servers: {
          kiln: { enabled: false },
        },
      },
    };
    const result = mergeKilnYaml(base, override);
    expect(result.mcp?.servers["kiln"]).toEqual({
      transport: "stdio",
      command: "kiln-mcp",
      enabled: false,
    });
  });

  it("rejects a project-only mcp server from override", () => {
    const base = {
      version: "1",
      mcp: { servers: { kiln: { transport: "stdio", command: "kiln-mcp" } } },
    } as unknown as ResolvedKilnConfig;
    const override: KilnProjectConfig = {
      version: "1",
      mcp: {
        servers: {
          custom: { enabled: false },
        },
      },
    };
    expect(() => mergeKilnYaml(base, override)).toThrow(
      "Project-only MCP server 'custom' is not admitted by global configuration.",
    );
  });

  it("rejects a project MCP catalog limit without a matching global bound", () => {
    expect(() => mergeKilnYaml(
      {
        version: "1",
        mcp: { servers: { kiln: { transport: "stdio", command: "kiln-mcp" } } },
      } as unknown as ResolvedKilnConfig,
      {
        version: "1",
        mcp: { servers: { kiln: { maxCapabilities: 10 } } },
      },
    )).toThrow("Project MCP maxCapabilities for 'kiln' has no global catalog limit.");
  });

  it("does not let project config replace global model suitability", () => {
    const base: ResolvedKilnConfig = {
      version: "1",
      modelTaskSuitability: [{
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "limited",
        reason: "Global operator preference.",
      }],
    };
    const override: KilnProjectConfig = {
      version: "1",
      // Spread so an object literal assigned to `KilnProjectConfig` can still carry a
      // field the project schema no longer declares, simulating untyped YAML input that
      // slips a global-only key past the schema — production must still ignore it.
      ...{
        modelTaskSuitability: [{
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          task: "frontend-design",
          level: "capable" as const,
          reason: "Project has a strong frontend skill profile.",
        }],
      },
    };

    const result = mergeKilnYaml(base, override);

    expect(result.modelTaskSuitability).toEqual([{
      provider: "codex-oauth",
      model: "gpt-5.4-mini",
      task: "frontend-design",
      level: "limited",
      reason: "Global operator preference.",
    }]);
  });

  it("narrows builtin skill inclusion while accumulating project exclusions", () => {
    const base: ResolvedKilnConfig = {
      version: "1",
      skills: {
        builtin: {
          enabled: true,
          include: ["tdd-workflow", "code-review-findings"],
          exclude: ["frontend-ux-review"],
        },
      },
    };
    const override: KilnProjectConfig = {
      version: "1",
      skills: {
        builtin: {
          include: ["code-review-findings"],
          exclude: ["benchmark-readiness-review"],
        },
      },
    };

    const result = mergeKilnYaml(base, override);

    expect(result.skills).toEqual({
      builtin: {
        enabled: true,
        include: ["code-review-findings"],
        exclude: ["frontend-ux-review", "benchmark-readiness-review"],
      },
    });
  });

  it("retains global skill visibility when project config changes selection", () => {
    const result = mergeKilnYaml(
      {
        version: "1",
        skills: {
          selection: { mode: "advisory" },
          visibility: {
            default: "implicit",
            overrides: { planner: "explicit-only", release: "disabled" },
          },
        },
      } as ResolvedKilnConfig,
      {
        version: "1",
        skills: {
          selection: { mode: "auto" },
        },
      },
    );

    expect(result.skills).toEqual({
      selection: { mode: "auto" },
      visibility: {
        default: "implicit",
        overrides: { planner: "explicit-only", release: "disabled" },
      },
    });
  });

  it("merges work governance policy with project overrides", () => {
    const base: ResolvedKilnConfig = {
      version: "1",
      workGovernance: {
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
    };
    const override: KilnProjectConfig = {
      version: "1",
      workGovernance: {
        requireDelegationFor: ["ui"],
        requiredEvidence: ["browser-qa"],
      },
    };

    const result = mergeKilnYaml(base, override);

    expect(result.workGovernance).toEqual({
      defaultPosture: "orchestrate",
      requireDelegationFor: ["architecture", "ui"],
      requiredEvidence: ["surface-map", "browser-qa"],
    });
  });

  it("does not promote project quality gates during global/project composition", () => {
    const gates = [{ name: "test", command: "bun test", required: true }] as const;
    const override = {
      version: "1",
      ...({ qualityGates: gates } as Record<string, unknown>),
    } as KilnProjectConfig;
    const result = mergeKilnYaml(
      { version: "1", permissions: { approval: "on-request", sandbox: "read-only" } },
      override,
    );

    expect((result as unknown as Record<string, unknown>).qualityGates).toBeUndefined();
  });

  it("preserves the complete global bounded work ceiling during project composition", () => {
    const boundedWorkCeiling = {
      allowedEffects: ["inspect", "modify_source"] as const,
      allowedRoots: ["packages/cli"] as const,
      deniedRoots: ["packages/cli/private"] as const,
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
      minimumHarnessCapability: "authoritative" as const,
    };
    const result = mergeKilnYaml(
      {
        version: "1",
        workGovernance: { boundedWorkCeiling },
      },
      {
        version: "1",
        workGovernance: {
          defaultPosture: "orchestrate",
        },
      },
    );

    expect(result.workGovernance?.boundedWorkCeiling).toEqual(boundedWorkCeiling);
  });

  it("rejects a project bounded work ceiling instead of widening the global policy", () => {
    expect(() => mergeKilnYaml(
      {
        version: "1",
        workGovernance: {
          boundedWorkCeiling: {
            allowedRoots: ["packages/cli"],
            maximumLimits: { maxExecutionAttempts: 2 },
            minimumHarnessCapability: "authoritative",
          },
        },
      },
      {
        version: "1",
        workGovernance: {
          boundedWorkCeiling: {
            allowedRoots: ["/"],
            maximumLimits: { maxExecutionAttempts: 99 },
            minimumHarnessCapability: "advisory_only",
          },
        },
      },
    )).toThrow("Project workGovernance.boundedWorkCeiling is global-only.");
  });

  it("inherits global web providers while project web policy grants authority", () => {
    const base = {
      version: "1",
      web: {
        searchProvider: {
          type: "tavily",
          apiKeyEnv: "TAVILY_API_KEY",
        },
        extractProvider: {
          type: "firecrawl",
          apiKeyEnv: "FIRECRAWL_API_KEY",
        },
      },
    } as unknown as ResolvedKilnConfig;
    const override: KilnProjectConfig = {
      version: "1",
      web: {
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      },
    };

    const result = mergeKilnYaml(base, override);

    expect(result.web).toEqual({
      enabled: true,
      netPolicy: "documentation",
      allowedDomains: ["docs.example.com"],
      searchProvider: {
        type: "tavily",
        apiKeyEnv: "TAVILY_API_KEY",
      },
      extractProvider: {
        type: "firecrawl",
        apiKeyEnv: "FIRECRAWL_API_KEY",
      },
    });
  });

  it("keeps inherited web providers global-owned", () => {
    const base = {
      version: "1",
      web: {
        searchProvider: {
          type: "tavily",
          apiKeyEnv: "TAVILY_API_KEY",
        },
        extractProvider: {
          type: "firecrawl",
          apiKeyEnv: "FIRECRAWL_API_KEY",
        },
      },
    } as unknown as ResolvedKilnConfig;
    const override: KilnProjectConfig = {
      version: "1",
      web: {
        enabled: true,
        netPolicy: "documentation",
      },
    };

    const result = mergeKilnYaml(base, override);

    expect((result.web as unknown as KilnYamlWebConfig | undefined)?.searchProvider).toEqual({
      type: "tavily",
      apiKeyEnv: "TAVILY_API_KEY",
    });
    expect((result.web as unknown as KilnYamlWebConfig | undefined)?.extractProvider).toEqual({
      type: "firecrawl",
      apiKeyEnv: "FIRECRAWL_API_KEY",
    });
  });

  it("ignores undefined override values", () => {
    const base: ResolvedKilnConfig = { version: "1", domain: "python" };
    const override: KilnProjectConfig = { version: "1", domain: undefined };
    const result = mergeKilnYaml(base, override);
    expect(result.domain).toBe("python");
  });
});

describe("defaultKilnYaml", () => {
  it("returns valid default with given domain", () => {
    const result = defaultKilnYaml("python");
    expect(result.version).toBe("1");
    expect(result.domain).toBe("python");
    expect(result).not.toHaveProperty("provider");
    expect(result).not.toHaveProperty("model");
    expect(result).not.toHaveProperty("mode");
    expect(result.permissions?.approval).toBe("on-request");
    expect(result.permissions?.sandbox).toBe("read-only");
  });
});
