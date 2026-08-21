import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  statusCommand as statusCommandImplementation,
  type StatusCommandOptions,
} from "../../src/commands/status.js";
import { writeKilnYaml, defaultKilnYaml } from "../../src/kiln-yaml.js";
import { resolveGlobalConfigPath, type KilnGlobalConfig } from "../../src/config/global-config.js";
import { persistGlobalConfigFixture } from "../config/global-config-fixture.js";
import { writeExecutionTargetEvidenceSnapshot } from "../../src/config/execution-target-evidence-store.js";
import { makeOperatorSurfaceGlobalConfig } from "./operator-surface-v4-fixture.js";
import { withSyntheticExecutionTargetEvidence } from "../config/execution-target-evidence-fixture.js";

function persistGlobalConfig(config: KilnGlobalConfig): void {
  const admitted = withSyntheticExecutionTargetEvidence(config);
  if (admitted.evidence) {
    writeExecutionTargetEvidenceSnapshot({
      globalConfigPath: resolveGlobalConfigPath(),
      snapshot: admitted.evidence,
    });
  }
  persistGlobalConfigFixture(admitted.config);
}
import type { KilnAppConfig } from "../../src/config.js";
import type { ProviderModelEligibilityRequirements } from "@kilnai/core/agents";

const MOCK_APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry not called in status tests");
  },
  buildSystemPrompt: () => "",
};

const emptyPluginProvider = () => ({ roots: [], diagnostics: [] });
const statusCommand = (
  appConfig: KilnAppConfig,
  projectPath?: string,
  options: StatusCommandOptions = {},
) => statusCommandImplementation(appConfig, projectPath, { ...options, pluginProvider: emptyPluginProvider });

vi.mock("../../src/config/managed-agent-provider-models.js", async () => {
  const core = await import("@kilnai/core");
  const runtime = await import("@kilnai/runtime");
  const observedAt = "2026-07-01T12:00:00.000Z";
  const requirements: ProviderModelEligibilityRequirements = {
    use: "managed-agent",
    evaluatedAt: observedAt,
    requiredStates: [
      "discovered",
      "configured",
      "authenticated",
      "capabilityCompatible",
      "policyAdmitted",
      "routeHealthy",
    ],
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    minimumStateAuthority: "harness-reported",
    requireProbe: false,
  };
  const observedModels = (providerId: string, models: readonly string[]) => {
    const catalog = runtime.normalizeRuntimeProviderDiscoveryCatalog({
      providerId,
      family: providerId === "codex" ? "codex-harness" : "opencode-harness",
      discovery: {
        models,
        status: "available",
        reason: "fixture catalog",
        authState: "authenticated",
      },
      observedAt,
      freshness: "fresh",
      harnessId: providerId,
      reportedProviderId: providerId,
    });
    return Object.fromEntries(catalog.routes.map((route) => [
      route.identity.route.providerModelId,
      {
        catalogDiagnosticEvidence: route,
        catalogDiagnosticDecision: core.deriveProviderModelEligibility(route, requirements, []),
      },
    ]));
  };
  return {
    discoverManagedAgentProviderModels: vi.fn().mockResolvedValue({
      codex: observedModels("codex", ["gpt-5.3-codex-spark", "gpt-5.4-mini"]),
      opencode: observedModels("opencode", ["opencode/minimax-m2.5-free"]),
    }),
  };
});

describe("statusCommand", () => {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let tempDir: string;
  let tempConfigHome: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-status-"));
    tempConfigHome = mkdtempSync(join(tmpdir(), "kiln-status-config-"));
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(tempConfigHome, { recursive: true, force: true });
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    consoleSpy.mockRestore();
  });

  it("prints error when not initialized", async () => {
    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Not initialized");
    expect(output).toContain("kiln init");
  });

  it("prints domain when initialized", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, defaultKilnYaml("python"));

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("python");
  });

  it("shows all config values", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, {
      version: "1",
      domain: "react-typescript",
      channels: ["cli", "web"],
      teamMode: "sequential",
      requireApproval: false,
      maxDepth: 5,
      parallelWorkers: 4,
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("react-typescript");
    expect(output).toContain("false");
    expect(output).toContain("5");
    expect(output).toContain("4");
  });

  it("shows memory file count", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(join(kilnDir, "memory"), { recursive: true });
    writeKilnYaml(kilnDir, { ...defaultKilnYaml("python") });
    writeFileSync(join(kilnDir, "memory", "chunk1.jsonl"), "{}");
    writeFileSync(join(kilnDir, "memory", "chunk2.jsonl"), "{}");

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Memory files:     2");
  });

  it("shows managed-agent route health", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, defaultKilnYaml("python"));
    const harnessBase = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "operator-default");
    const directTarget = harnessBase.targetCatalog!.targets[0]!;
    if (directTarget.kind !== "direct") throw new Error("fixture direct target is required");
    const { accountSelection: _accountSelection, economics: _economics, ...physicalTarget } = directTarget;
    persistGlobalConfig({
      ...harnessBase,
      targetCatalog: {
        ...harnessBase.targetCatalog!,
        targets: [directTarget, {
          ...physicalTarget,
          id: "codex-readonly",
          kind: "harness",
          providerId: "codex",
          providerModelId: "gpt-5.3-codex-spark",
        }],
      },
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Managed execution targets:");
    expect(output).toContain("codex-readonly");
    expect(output).toContain("harness/codex gpt-5.3-codex-spark");
    expect(output).toContain("admission-ready");
    expect(output).toContain("provider consumption is not bounded by Kiln's managed economic ceiling");
  });

  // H1/H2 closure (issue #34): `kiln status` composes routes purely to
  // display them. A direct route with no covering economic policy must
  // degrade to "admission-unavailable" with the named reason - never throw,
  // and never perform credential or MCP work to get there.
  it("shows a policy-uncovered direct route as unavailable without throwing or resolving credentials", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, defaultKilnYaml("python"));
    const uncovered = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "operator-default");
    const coveredTarget = uncovered.targetCatalog!.targets[0]!;
    if (coveredTarget.kind !== "direct") throw new Error("fixture direct target is required");
    persistGlobalConfig({
      ...uncovered,
      targetCatalog: {
        ...uncovered.targetCatalog!,
        targets: [coveredTarget, { ...coveredTarget, id: "openai-uncovered", label: "Uncovered" }],
      },
    });

    await expect(statusCommand(MOCK_APP_CONFIG, tempDir)).resolves.toBeUndefined();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Managed execution targets:");
    expect(output).toMatch(/openai-uncovered:.*admission-unavailable/);
  });

  it("shows configured engine route health", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, { ...defaultKilnYaml("python") });
    persistGlobalConfig({
      ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-test", "codex-direct"),
      engines: {
        codex: { enabled: true, billing: "plus-quota" },
        opencode: { enabled: true, billing: "free" },
      },
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir, {
      engineRegistry: {
        probeAll: () => [
          { engineId: "codex", enabled: true, available: false, reason: "not found" },
          { engineId: "opencode", enabled: true, available: true },
        ],
      },
    });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Engine routes:");
    expect(output).toContain("codex");
    expect(output).toContain("unavailable - not found");
    expect(output).toContain("opencode");
    expect(output).toContain("Resolved worker: opencode");
    expect(output).toContain("Managed execution targets:");
    expect(output).toContain("codex-direct");
  });

  it("shows web configuration diagnostics", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    const previousFirecrawlKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "fc-test";
    writeKilnYaml(kilnDir, {
      ...defaultKilnYaml("python"),
      web: {
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
        searchProvider: {
          type: "searxng",
          url: "https://searx.example.com",
        },
        searchFallbackProviders: [{
          type: "http",
          url: "https://fallback.example.com/search",
        }],
        extractProvider: {
          type: "firecrawl",
          apiKeyEnv: "FIRECRAWL_API_KEY",
        },
      },
    });

    try {
      await statusCommand(MOCK_APP_CONFIG, tempDir);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Web access:");
      expect(output).toContain("Enabled: true");
      expect(output).toContain("Network policy: documentation");
      expect(output).toContain("Allowed domains: docs.example.com");
      expect(output).toContain("Search provider: searxng");
      expect(output).toContain("Search fallbacks: http");
      expect(output).toContain("Extract provider: firecrawl");
    } finally {
      if (previousFirecrawlKey === undefined) {
        delete process.env.FIRECRAWL_API_KEY;
      } else {
        process.env.FIRECRAWL_API_KEY = previousFirecrawlKey;
      }
    }
  });

  it("shows global web provider defaults with project web authority", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    const previousTavilyKey = process.env.TAVILY_API_KEY;
    const previousFirecrawlKey = process.env.FIRECRAWL_API_KEY;
    process.env.TAVILY_API_KEY = "tv-test";
    process.env.FIRECRAWL_API_KEY = "fc-test";
    persistGlobalConfig({
      version: "4",
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
    });
    writeKilnYaml(kilnDir, {
      ...defaultKilnYaml("python"),
      web: {
        enabled: true,
        netPolicy: "documentation",
        allowedDomains: ["docs.example.com"],
      },
    });

    try {
      await statusCommand(MOCK_APP_CONFIG, tempDir);

      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("Search provider: tavily (global)");
      expect(output).toContain("Extract provider: firecrawl (global)");
      expect(output).toContain("Network policy: documentation");
    } finally {
      if (previousTavilyKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = previousTavilyKey;
      }
      if (previousFirecrawlKey === undefined) {
        delete process.env.FIRECRAWL_API_KEY;
      } else {
        process.env.FIRECRAWL_API_KEY = previousFirecrawlKey;
      }
    }
  });

  it("shows skill catalog health from canonical Kiln status evidence", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    writeKilnYaml(kilnDir, { ...defaultKilnYaml("python") });
    writeSkill(join(kilnDir, "skills"), "project-ui", "Project UI workflow.");

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Skill catalog:");
    expect(output).toContain("Selection mode: advisory");
    expect(output).toContain("Inventory:");
    expect(output).toContain("Duplicates:");
    expect(output).toContain("Collisions:");
    expect(output).toContain("codex:");
    expect(output).toContain("description bytes, budget=unknown");
    expect(output).toContain("issue: skill=");
    expect(output).toContain("path=");
    expect(output).toContain("more skill issues omitted");
    expect(output).toContain("sync-native-projections");
  });

  it("shows missing web provider env diagnostics", async () => {
    const kilnDir = join(tempDir, ".kiln");
    mkdirSync(kilnDir, { recursive: true });
    delete process.env.KILN_TEST_MISSING_WEB_KEY;
    writeKilnYaml(kilnDir, {
      ...defaultKilnYaml("python"),
      web: {
        enabled: true,
        netPolicy: "documentation",
        searchProvider: {
          type: "tavily",
          apiKeyEnv: "KILN_TEST_MISSING_WEB_KEY",
        },
      },
    });

    await statusCommand(MOCK_APP_CONFIG, tempDir);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Search provider: tavily (missing)");
    expect(output).toContain("Issues: web.search_provider_env_missing:KILN_TEST_MISSING_WEB_KEY");
  });
});

function writeSkill(root: string, name: string, description: string): void {
  const skillDir = join(root, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    "Skill body.",
    "",
  ].join("\n"), "utf-8");
}
