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
  migrateConfigJson,
  defaultKilnYaml,
  KilnYamlError,
  type KilnYaml,
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
      "version: '1'\ndomain: python\nprovider: claude\n",
    );
    const result = readKilnYaml(join(tempDir, ".kiln"));
    expect(result).not.toBeNull();
    expect(result!.version).toBe("1");
    expect(result!.domain).toBe("python");
    expect(result!.provider).toBe("claude");
  });

  it("throws KilnYamlError when file is not an object", () => {
    writeFileSync(join(tempDir, ".kiln", "kiln.yaml"), "just a string");
    expect(() => readKilnYaml(join(tempDir, ".kiln"))).toThrow(KilnYamlError);
  });

  it("throws KilnYamlError on parse failure", () => {
    writeFileSync(join(tempDir, ".kiln", "kiln.yaml"), "invalid: yaml: [");
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
    const config: KilnYaml = {
      version: "1",
      domain: "react-ts",
      provider: "openai",
    };
    writeKilnYaml(tempDir, config);
    const path = join(tempDir, "kiln.yaml");
    expect(existsSync(path)).toBe(true);
    const parsed = parseYaml(readFileSync(path, "utf-8")) as KilnYaml;
    expect(parsed.version).toBe("1");
    expect(parsed.domain).toBe("react-ts");
    expect(parsed.provider).toBe("openai");
  });

  it("creates kilnDir if it does not exist", () => {
    const nested = join(tempDir, "subdir", ".kiln");
    const config: KilnYaml = { version: "1" };
    writeKilnYaml(nested, config);
    expect(existsSync(join(nested, "kiln.yaml"))).toBe(true);
  });

  it("writes nested permissions object", () => {
    const config: KilnYaml = {
      version: "1",
      permissions: { approval: "on-request", sandbox: "read-only" },
    };
    writeKilnYaml(tempDir, config);
    const parsed = parseYaml(readFileSync(join(tempDir, "kiln.yaml"), "utf-8")) as KilnYaml;
    expect(parsed.permissions?.approval).toBe("on-request");
    expect(parsed.permissions?.sandbox).toBe("read-only");
  });
});

describe("mergeKilnYaml", () => {
  it("override wins on scalar conflict", () => {
    const base: KilnYaml = { version: "1", domain: "python" };
    const override: Partial<KilnYaml> = { domain: "react-ts" };
    const result = mergeKilnYaml(base, override);
    expect(result.domain).toBe("react-ts");
  });

  it("preserves base fields not in override", () => {
    const base: KilnYaml = { version: "1", domain: "python", provider: "claude" };
    const override: Partial<KilnYaml> = { domain: "react-ts" };
    const result = mergeKilnYaml(base, override);
    expect(result.provider).toBe("claude");
  });

  it("merges mcp.servers by server name", () => {
    const base: KilnYaml = {
      version: "1",
      mcp: {
        servers: {
          kiln: { type: "stdio", command: "kiln-mcp" },
        },
      },
    };
    const override: Partial<KilnYaml> = {
      mcp: {
        servers: {
          kiln: { enabled: true },
        },
      },
    };
    const result = mergeKilnYaml(base, override);
    expect(result.mcp?.servers["kiln"]).toEqual({
      type: "stdio",
      command: "kiln-mcp",
      enabled: true,
    });
  });

  it("adds new mcp server from override", () => {
    const base: KilnYaml = {
      version: "1",
      mcp: { servers: { kiln: { type: "stdio" } } },
    };
    const override: Partial<KilnYaml> = {
      mcp: {
        servers: {
          custom: { type: "http", url: "http://localhost:3001/sse" },
        },
      },
    };
    const result = mergeKilnYaml(base, override);
    expect(result.mcp?.servers["kiln"]).toBeDefined();
    expect(result.mcp?.servers["custom"]).toBeDefined();
  });

  it("merges model task suitability by provider, model, and task", () => {
    const base: KilnYaml = {
      version: "1",
      modelTaskSuitability: [{
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        task: "frontend-design",
        level: "limited",
        reason: "Global operator preference.",
      }],
    };
    const override: Partial<KilnYaml> = {
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
      level: "capable",
      reason: "Project has a strong frontend skill profile.",
    }]);
  });

  it("merges builtin skill policy additively", () => {
    const base: KilnYaml = {
      version: "1",
      skills: {
        builtin: {
          enabled: true,
          include: ["tdd-workflow"],
          exclude: ["frontend-ux-review"],
        },
      },
    };
    const override: Partial<KilnYaml> = {
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

  it("merges work governance policy with project overrides", () => {
    const base: KilnYaml = {
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
    const override: Partial<KilnYaml> = {
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
    const base: KilnYaml = {
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
    const override: Partial<KilnYaml> = {
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
    const base: KilnYaml = {
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
    const override: Partial<KilnYaml> = {
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
    const base: KilnYaml = { version: "1", domain: "python" };
    const override: Partial<KilnYaml> = { domain: undefined };
    const result = mergeKilnYaml(base, override);
    expect(result.domain).toBe("python");
  });
});

describe("migrateConfigJson", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-yaml-migrate-"));
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false when config.json does not exist", () => {
    const result = migrateConfigJson(join(tempDir, ".kiln"));
    expect(result).toBe(false);
  });

  it("migrates config.json to kiln.yaml", () => {
    writeFileSync(
      join(tempDir, ".kiln", "config.json"),
      JSON.stringify({
        domain: "python",
        provider: "claude",
        channels: ["cli", "web"],
        teamMode: "sequential",
        requireApproval: true,
        maxDepth: 5,
        parallelWorkers: 4,
        mode: "api-key",
      }),
    );
    const result = migrateConfigJson(join(tempDir, ".kiln"));
    expect(result).toBe(true);

    const parsed = parseYaml(
      readFileSync(join(tempDir, ".kiln", "kiln.yaml"), "utf-8"),
    ) as KilnYaml;
    expect(parsed.domain).toBe("python");
    expect(parsed.provider).toBe("claude");
    expect(parsed.channels).toEqual(["cli", "web"]);
    expect(parsed.requireApproval).toBe(true);
    expect(parsed.maxDepth).toBe(5);
    expect(parsed.parallelWorkers).toBe(4);
    expect(parsed.permissions?.approval).toBe("on-request");
  });

  it("deletes config.json after migration", () => {
    writeFileSync(
      join(tempDir, ".kiln", "config.json"),
      JSON.stringify({ domain: "generic" }),
    );
    migrateConfigJson(join(tempDir, ".kiln"));
    expect(existsSync(join(tempDir, ".kiln", "config.json"))).toBe(false);
  });

  it("maps requireApproval false to never", () => {
    writeFileSync(
      join(tempDir, ".kiln", "config.json"),
      JSON.stringify({ requireApproval: false }),
    );
    migrateConfigJson(join(tempDir, ".kiln"));
    const parsed = parseYaml(
      readFileSync(join(tempDir, ".kiln", "kiln.yaml"), "utf-8"),
    ) as KilnYaml;
    expect(parsed.permissions?.approval).toBe("never");
  });
});

describe("defaultKilnYaml", () => {
  it("returns valid default with given domain", () => {
    const result = defaultKilnYaml("python");
    expect(result.version).toBe("1");
    expect(result.domain).toBe("python");
    expect(result.provider).toBe("claude");
    expect(result.mode).toBe("api-key");
    expect(result.permissions?.approval).toBe("on-request");
    expect(result.permissions?.sandbox).toBe("read-only");
  });
});
