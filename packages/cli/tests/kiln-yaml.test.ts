import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import {
  readKilnYaml,
  writeKilnYaml,
  mergeKilnYaml,
  defaultKilnYaml,
  KilnYamlError,
  type ResolvedKilnConfig,
} from "../src/kiln-yaml.js";

describe("readKilnYaml", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-yaml-read-"));
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    expect(readKilnYaml(join(tempDir, ".kiln"))).toBeNull();
  });

  it("parses valid kiln.yaml", () => {
    writeFileSync(
      join(tempDir, ".kiln", "kiln.yaml"),
      "version: '1'\ndomain: python\nmaxDepth: 2\n",
    );
    const result = readKilnYaml(join(tempDir, ".kiln"));
    expect(result).not.toBeNull();
    expect(result!.version).toBe("1");
    expect(result!.domain).toBe("python");
    expect(result!.maxDepth).toBe(2);
  });

  it("throws KilnYamlError when file is not an object", () => {
    writeFileSync(join(tempDir, ".kiln", "kiln.yaml"), "just a string");
    expect(() => readKilnYaml(join(tempDir, ".kiln"))).toThrow(KilnYamlError);
  });

  it("throws KilnYamlError on parse failure", () => {
    writeFileSync(join(tempDir, ".kiln", "kiln.yaml"), "invalid: yaml: [");
    expect(() => readKilnYaml(join(tempDir, ".kiln"))).toThrow(KilnYamlError);
  });

  it("rejects project skill visibility while native projections are user-global", () => {
    writeFileSync(
      join(tempDir, ".kiln", "kiln.yaml"),
      "version: '1'\nskills:\n  visibility:\n    overrides:\n      planner: disabled\n",
    );
    expect(() => readKilnYaml(join(tempDir, ".kiln"))).toThrow(
      "skills.visibility is global-only because native skill targets are user-global",
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
      join(tempDir, ".kiln", "kiln.yaml"),
      `version: '2'\n${fieldYaml}\n`,
    );

    expect(() => readKilnYaml(join(tempDir, ".kiln"))).toThrow(KilnYamlError);
  });
});

describe("writeKilnYaml", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-yaml-write-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes valid YAML file", () => {
    const config: ResolvedKilnConfig = {
      version: "1",
      domain: "react-ts",
      provider: "openai",
    };
    writeKilnYaml(tempDir, config);
    const path = join(tempDir, "kiln.yaml");
    expect(existsSync(path)).toBe(true);
    const parsed = parseYaml(readFileSync(path, "utf-8")) as ResolvedKilnConfig;
    expect(parsed.version).toBe("1");
    expect(parsed.domain).toBe("react-ts");
    expect(parsed.provider).toBe("openai");
  });

  it("creates kilnDir if it does not exist", () => {
    const nested = join(tempDir, "subdir", ".kiln");
    const config: ResolvedKilnConfig = { version: "1" };
    writeKilnYaml(nested, config);
    expect(existsSync(join(nested, "kiln.yaml"))).toBe(true);
  });

  it("writes nested permissions object", () => {
    const config: ResolvedKilnConfig = {
      version: "1",
      permissions: { approval: "on-request", sandbox: "read-only" },
    };
    writeKilnYaml(tempDir, config);
    const parsed = parseYaml(readFileSync(join(tempDir, "kiln.yaml"), "utf-8")) as ResolvedKilnConfig;
    expect(parsed.permissions?.approval).toBe("on-request");
    expect(parsed.permissions?.sandbox).toBe("read-only");
  });
});

describe("mergeKilnYaml", () => {
  it("preserves global external catalog authority when project skills override other fields", () => {
    const externalCatalog = {
      version: 1 as const,
      harnesses: { codex: { expectedFingerprint: `sha256:${"a".repeat(64)}`, keepImplicit: [] } },
    };
    const result = mergeKilnYaml(
      { version: "1", skills: { externalCatalog, visibility: { default: "explicit-only" } } },
      { version: "1", skills: { selection: { mode: "auto" } } },
    );
    expect(result.skills).toMatchObject({ externalCatalog, selection: { mode: "auto" }, visibility: { default: "explicit-only" } });
  });
  it("override wins on scalar conflict", () => {
    const base: ResolvedKilnConfig = { version: "1", domain: "python" };
    const override: Partial<ResolvedKilnConfig> = { domain: "react-ts" };
    const result = mergeKilnYaml(base, override);
    expect(result.domain).toBe("react-ts");
  });

  it("preserves base fields not in override", () => {
    const base: ResolvedKilnConfig = { version: "1", domain: "python", provider: "claude" };
    const override: Partial<ResolvedKilnConfig> = { domain: "react-ts" };
    const result = mergeKilnYaml(base, override);
    expect(result.provider).toBe("claude");
  });

  it("merges mcp.servers by server name", () => {
    const base: ResolvedKilnConfig = {
      version: "1",
      mcp: {
        servers: {
          kiln: { transport: "stdio", command: "kiln-mcp" },
        },
      },
    };
    const override: Partial<ResolvedKilnConfig> = {
      mcp: {
        servers: {
          kiln: { enabled: true },
        },
      },
    };
    const result = mergeKilnYaml(base, override);
    expect(result.mcp?.servers["kiln"]).toEqual({
      transport: "stdio",
      command: "kiln-mcp",
      enabled: true,
    });
  });

  it("adds new mcp server from override", () => {
    const base: ResolvedKilnConfig = {
      version: "1",
      mcp: { servers: { kiln: { transport: "stdio", command: "kiln-mcp" } } },
    };
    const override: Partial<ResolvedKilnConfig> = {
      mcp: {
        servers: {
          custom: { transport: "streamable-http", url: "http://localhost:3001/mcp" },
        },
      },
    };
    const result = mergeKilnYaml(base, override);
    expect(result.mcp?.servers["kiln"]).toBeDefined();
    expect(result.mcp?.servers["custom"]).toBeDefined();
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
    const override: Partial<ResolvedKilnConfig> = {
      modelTaskSuitability: [{
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "capable",
        reason: "Project has a strong frontend skill profile.",
      }],
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

  it("merges builtin skill policy additively", () => {
    const base: ResolvedKilnConfig = {
      version: "1",
      skills: {
        builtin: {
          enabled: true,
          include: ["tdd-workflow"],
          exclude: ["frontend-ux-review"],
        },
      },
    };
    const override: Partial<ResolvedKilnConfig> = {
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
        include: ["tdd-workflow", "code-review-findings"],
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
      },
      {
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
        directExecution: {
          maxFiles: 1,
          maxRisk: "low",
        },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map"],
      },
    };
    const override: Partial<ResolvedKilnConfig> = {
      workGovernance: {
        directExecution: {
          maxFiles: 2,
        },
        requireDelegationFor: ["ui"],
        requiredEvidence: ["browser-qa"],
      },
    };

    const result = mergeKilnYaml(base, override);

    expect(result.workGovernance).toEqual({
      defaultPosture: "orchestrate",
      directExecution: {
        maxFiles: 2,
        maxRisk: "low",
      },
      requireDelegationFor: ["architecture", "ui"],
      requiredEvidence: ["surface-map", "browser-qa"],
    });
  });

  it("inherits global web providers while project web policy grants authority", () => {
    const base: ResolvedKilnConfig = {
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
    };
    const override: Partial<ResolvedKilnConfig> = {
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

  it("lets project web config explicitly disable inherited providers", () => {
    const base: ResolvedKilnConfig = {
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
    };
    const override: Partial<ResolvedKilnConfig> = {
      web: {
        enabled: true,
        netPolicy: "documentation",
        searchProvider: { type: "none" },
        extractProvider: { type: "none" },
      },
    };

    const result = mergeKilnYaml(base, override);

    expect(result.web?.searchProvider).toEqual({ type: "none" });
    expect(result.web?.extractProvider).toEqual({ type: "none" });
  });

  it("ignores undefined override values", () => {
    const base: ResolvedKilnConfig = { version: "1", domain: "python" };
    const override: Partial<ResolvedKilnConfig> = { domain: undefined };
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
