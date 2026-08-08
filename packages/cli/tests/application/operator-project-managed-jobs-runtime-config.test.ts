import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveProviderModelEligibility, type ProviderModelEligibilityRequirements } from "@kilnai/core";
import { normalizeRuntimeProviderDiscoveryCatalog } from "@kilnai/runtime";
import { writeGlobalConfig, type KilnGlobalConfig } from "../../src/config/global-config.js";
import { createOperatorProjectManagedJobApplicationComposition } from "../../src/application/operator-project-managed-jobs.js";
import { createNativeHarnessInspectionService } from "../../src/application/native-harness-inspection.js";
import { NativeHarnessMcpTools } from "../../src/native-harness/native-harness-mcp-tools.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../../src/config/managed-agent-provider-models.js";
import { economicConfig } from "../config/managed-economic-policy-config-fixture.js";

/**
 * Regression proof for #56 revised S1: the operator-supervised project Runtime
 * composition must derive its managed-route config
 * (`modelGateway`, `engines`, `routing`, `models`, `managedAgents`, ...) from
 * canonical global/project config with the correct authority split, not from
 * `readConfigStatusSnapshot().effectiveConfig` (a project/status projection
 * that never carries global-only Runtime route authority). Unlike
 * `operator-project-managed-jobs.test.ts`, this file does not mock `config-status.js`,
 * `global-config.js`, or `kiln-yaml.js`: it drives the real production
 * `readGlobalConfig()` + `readKilnYaml()` reads against real fixture files on
 * disk, through the real composition boundary
 * (`createOperatorProjectManagedJobApplicationComposition`) and the real MCP
 * surface (`NativeHarnessMcpTools`). A fake `effectiveConfig` mock (as the
 * existing sibling test uses) can assert whatever shape it likes, including a
 * `modelGateway` field that `KilnYaml` never actually produces -- which is
 * exactly how the original defect went uncaught.
 */
const FIXTURE_OBSERVED_AT = "2026-07-01T12:00:00.000Z";

function managedCatalogRequirements(): ProviderModelEligibilityRequirements {
  return {
    use: "managed-agent",
    evaluatedAt: FIXTURE_OBSERVED_AT,
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
}

/** Synthesizes a deterministic, network-free eligible provider/model catalog for one direct route. */
function eligibleDirectProviderCatalog(providerId: string, model: string): ManagedAgentProviderModelCatalogDiagnostics {
  const catalog = normalizeRuntimeProviderDiscoveryCatalog({
    providerId,
    family: "direct-provider",
    discovery: {
      models: [model],
      status: "available",
      reason: "fixture catalog",
      authState: "authenticated",
    },
    observedAt: FIXTURE_OBSERVED_AT,
    freshness: "fresh",
  });
  return {
    [providerId]: Object.fromEntries(catalog.routes.map((route) => [
      route.identity.route.providerModelId,
      {
        catalogDiagnosticEvidence: route,
        catalogDiagnosticDecision: deriveProviderModelEligibility(route, managedCatalogRequirements(), []),
      },
    ])),
  };
}

const ECONOMIC_WORKER_AGENT = [
  "---",
  "name: economic-worker",
  "role: Policy-bound worker",
  "goal: Prove economic policy binding reaches native-harness composition.",
  "tier: fast",
  "mode: managed-child",
  "economicPolicyId: default-economic-policy",
  "---",
  "Regression fixture agent; not used for real work.",
].join("\n");

describe("native-harness managed-route runtime config authority (#56 S1)", () => {
  const tempDirs: string[] = [];
  const isolatedEnvKeys = ["XDG_CONFIG_HOME", "HOME", "USERPROFILE"] as const;
  const originalEnv: Partial<Record<typeof isolatedEnvKeys[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of isolatedEnvKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Isolates both the global-config path (`XDG_CONFIG_HOME`, read by
   * `readGlobalConfig()`) and `os.homedir()` (`HOME`/`USERPROFILE`, read by
   * `loadAgentDefinitions()`'s global agents directory). Without the latter,
   * this test would pick up the real operator's `~/.kiln/agents` definitions
   * and become machine-dependent.
   */
  function useIsolatedGlobalConfigHome(): void {
    for (const key of isolatedEnvKeys) {
      originalEnv[key] = process.env[key];
    }
    const globalHome = mkdtempSync(join(tmpdir(), "kiln-global-config-"));
    tempDirs.push(globalHome);
    process.env.XDG_CONFIG_HOME = globalHome;
    process.env.HOME = globalHome;
    process.env.USERPROFILE = globalHome;
  }

  function createProjectRoot(kilnYamlContents: string, agents: Readonly<Record<string, string>> = {}): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "kiln-native-harness-runtime-config-"));
    tempDirs.push(projectRoot);
    mkdirSync(join(projectRoot, ".kiln"), { recursive: true });
    writeFileSync(join(projectRoot, ".kiln", "kiln.yaml"), kilnYamlContents, "utf8");
    if (Object.keys(agents).length > 0) {
      mkdirSync(join(projectRoot, ".kiln", "agents"), { recursive: true });
      for (const [fileName, contents] of Object.entries(agents)) {
        writeFileSync(join(projectRoot, ".kiln", "agents", fileName), contents, "utf8");
      }
    }
    return projectRoot;
  }

  it("constructs the real composition from canonical schema-v2 config and surfaces the admitted managed agent through the real MCP server", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(economicConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      expect(composition.configuredAgents).toMatchObject([{
        configuredAgentProfileId: "economic-worker",
        availability: "admitted",
        providerFamily: "codex-oauth",
      }]);

      const server = new NativeHarnessMcpTools({
        harness: "codex",
        managedJobs: composition.application,
        inspection: createNativeHarnessInspectionService({
          harness: "codex",
          managedAgents: composition.configuredAgents,
          readProjectRoot: async () => ({ status: "resolved", rootPath: projectRoot }),
        }),
      });
      const tools = server.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "kiln_managed_agent_invoke",
        "kiln_managed_agent_status",
        "kiln_managed_agent_result",
        "kiln_managed_agent_cancel",
        "kiln_managed_agent_replay",
      ]));
      const invokeTool = tools.find((tool) => tool.name === "kiln_managed_agent_invoke");
      expect(invokeTool).toBeDefined();
      expect((invokeTool!.inputSchema.properties as { configuredAgentProfileId: Record<string, unknown> }).configuredAgentProfileId)
        .toEqual({ type: "string", minLength: 1, maxLength: 200 });
    } finally {
      composition.close();
    }
  });

  it("keeps a globally disabled provider engine unavailable through the real composition boundary", async () => {
    useIsolatedGlobalConfigHome();
    const globalConfig: KilnGlobalConfig = {
      ...economicConfig(),
      engines: { "codex-oauth": { enabled: false } },
    };
    writeGlobalConfig(globalConfig);
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      // Same fixture as the positive test above -- the eligibility catalog would
      // admit this exact route -- except the global engine is disabled, so this
      // proves the denial and not mere eligibility-catalog absence.
      expect(composition.configuredAgents).toMatchObject([{
        configuredAgentProfileId: "economic-worker",
        availability: "unresolved",
        diagnostic: "eligibility_unresolved",
      }]);
    } finally {
      composition.close();
    }
  });

  it("does not let a project kiln.yaml override global modelGateway or engine authority", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(economicConfig());
    // `KilnYaml` has neither a `modelGateway` nor an `engines` field; this
    // simulates an operator (or a regression) hand-editing project kiln.yaml
    // with out-of-schema keys attempting to disable the provider the global
    // config allows, and to replace modelGateway with a value that would crash
    // `ConfiguredManagedAccountRuntime` if it were ever used. Both global
    // authorities must keep governing composition unchanged.
    const projectRoot = createProjectRoot([
      'version: "1"',
      "engines:",
      "  codex-oauth:",
      "    enabled: false",
      "modelGateway: not-a-gateway",
    ].join("\n"), { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      expect(composition.configuredAgents).toMatchObject([{
        configuredAgentProfileId: "economic-worker",
        availability: "admitted",
        providerFamily: "codex-oauth",
      }]);
    } finally {
      composition.close();
    }
  });

  it("stays fail-closed when a project-declared runtime-selected route has no reachable global modelGateway", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig({ version: "1" });
    const projectRoot = createProjectRoot([
      'version: "1"',
      "managedAgents:",
      "  schemaVersion: 2",
      "  routes:",
      "    - id: project-declared-route",
      "      kind: direct",
      "      provider: codex-oauth",
      "      model: gpt-5.6-terra",
      "      credentials:",
      "        mode: runtime-selected",
      "        accountPolicyId: unresolvable-policy",
    ].join("\n"));

    await expect(createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => ({}),
    })).rejects.toThrow("Managed account or economic routes require modelGateway configuration.");
  });
});
