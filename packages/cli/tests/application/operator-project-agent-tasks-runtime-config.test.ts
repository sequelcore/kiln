import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveProviderModelEligibility,
  type ProviderModelEligibilityRequirements,
} from "@kilnai/core/agents";
import {
  defineEffectiveAuthorityAdmissionBundle,
  normalizeRuntimeProviderDiscoveryCatalog,
  RuntimeManagedAgentInvocationService,
  type ManagedCommittedInvocationRequest,
} from "@kilnai/runtime";
import { resolveGlobalConfigPath, type KilnGlobalConfig } from "../../src/config/global-config.js";
import { writeExecutionTargetEvidenceSnapshot, type ExecutionTargetEvidenceSnapshot } from "../../src/config/execution-target-evidence-store.js";
import { withSyntheticExecutionTargetEvidence } from "../config/execution-target-evidence-fixture.js";
import { persistGlobalConfigFixture } from "../config/global-config-fixture.js";
import type { ResolvedManagedTargetConfig } from "../../src/config/resolved-managed-target.js";
import type { DirectProviderCredentialBinding } from "../../src/wrapper/direct-provider-adapter-factory.js";

function persistGlobalConfig(
  config: KilnGlobalConfig,
  mutateEvidence?: (evidence: ExecutionTargetEvidenceSnapshot) => ExecutionTargetEvidenceSnapshot,
): void {
  const admitted = withSyntheticExecutionTargetEvidence(config);
  const evidence = admitted.evidence && mutateEvidence
    ? mutateEvidence(admitted.evidence)
    : admitted.evidence;
  if (evidence) {
    const published = writeExecutionTargetEvidenceSnapshot({
      globalConfigPath: resolveGlobalConfigPath(),
      snapshot: evidence,
    });
    persistGlobalConfigFixture({
      ...admitted.config,
      targetCatalog: {
        ...admitted.config.targetCatalog!,
        evidenceRevision: published.revision,
      },
    });
    return;
  }
  persistGlobalConfigFixture(admitted.config);
}
import { createOperatorProjectAgentTaskApplicationComposition } from "../../src/application/operator-project-agent-tasks.js";
import { createNativeHarnessInspectionService } from "../../src/application/native-harness-inspection.js";
import { NativeHarnessMcpTools } from "../../src/native-harness/native-harness-mcp-tools.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../../src/config/managed-agent-provider-models.js";
import { managedAgentIntentConfig } from "../config/managed-agent-intent-config-fixture.js";

const routeCatalogTrace = vi.hoisted(() => ({
  contexts: [] as Array<{ readonly compositionMode?: "execution" | "candidate-admission"; readonly managedAccountComposition?: unknown }>,
  catalogs: [] as Array<{ readonly managedInvocation?: { readonly invocationService?: unknown } }>,
  mutateExecutionCapabilityVersion: false,
  mutateExecutionProfileAuthority: false,
  injectNativeDeliberationCapabilities: false,
  mutateExecutionDeliberationEvidence: false,
  executionRefreshCount: 0,
}));
const adapterTrace = vi.hoisted(() => ({
  createCalls: 0,
  factoryOptions: [] as Array<Record<string, unknown>>,
  requests: [] as Array<{ readonly route: unknown; readonly credentialBinding: unknown; readonly committedRequest: unknown }>,
  adapter: {
    descriptor: {
      adapterKind: "direct",
      supportedExecutionModes: ["direct-provider"],
    },
    invoke: vi.fn(),
  },
}));

vi.mock("../../src/config/managed-agent-route-catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/managed-agent-route-catalog.js")>();
  return {
    ...actual,
    createStagedManagedInvocationRouteCatalog: vi.fn(async (
      ...args: Parameters<typeof actual.createStagedManagedInvocationRouteCatalog>
    ) => {
      routeCatalogTrace.contexts.push(args[1]);
      const catalog = await actual.createStagedManagedInvocationRouteCatalog(...args);
      if (routeCatalogTrace.injectNativeDeliberationCapabilities) {
        const route = catalog.managedInvocation?.routes.find((candidate) => candidate.routeId === "native-codex-deliberation");
        if (route) {
          Object.assign(route, {
            deliberationCapabilities: {
              provider: "codex",
              model: "gpt-5.6-codex",
              levels: [{ id: "low" }, { id: "high" }],
              supportsAdaptive: false,
              evidence: {
                sourceIdentity: "fixture-native-codex-catalog",
                sourceRevision: routeCatalogTrace.mutateExecutionDeliberationEvidence && args[1].compositionMode === "execution"
                  ? "revision-2"
                  : "revision-1",
                observedAt: FIXTURE_OBSERVED_AT,
              },
            },
          });
        }
      }
      if (
        routeCatalogTrace.injectNativeDeliberationCapabilities
        || (
          args[1].compositionMode === "execution"
          && (routeCatalogTrace.mutateExecutionCapabilityVersion || routeCatalogTrace.mutateExecutionProfileAuthority)
        )
      ) {
        const tracedCatalog = {
          ...catalog,
          refreshNow: async () => {
            await catalog.refreshNow();
            routeCatalogTrace.executionRefreshCount += 1;
            if (routeCatalogTrace.injectNativeDeliberationCapabilities) {
              const nativeRoute = catalog.managedInvocation?.routes.find((candidate) => candidate.routeId === "native-codex-deliberation");
              if (nativeRoute) {
                Object.assign(nativeRoute, {
                  deliberationCapabilities: {
                    provider: "codex",
                    model: "gpt-5.6-codex",
                    levels: [{ id: "low" }, { id: "high" }],
                    supportsAdaptive: false,
                    evidence: {
                      sourceIdentity: "fixture-native-codex-catalog",
                      sourceRevision: routeCatalogTrace.mutateExecutionDeliberationEvidence && args[1].compositionMode === "execution"
                        ? "revision-2"
                        : "revision-1",
                      observedAt: FIXTURE_OBSERVED_AT,
                    },
                  },
                });
              }
            }
            const route = catalog.managedInvocation?.routes[0];
            if (routeCatalogTrace.mutateExecutionCapabilityVersion && route?.economicCapability) {
              Object.assign(route.economicCapability, {
                adapterCapabilityVersion: "execution-mismatch",
              });
            }
            if (routeCatalogTrace.mutateExecutionProfileAuthority && routeCatalogTrace.executionRefreshCount >= 3) {
              const profile = route?.profiles.find(
                (candidate) => candidate.admissionProfile === "foundation-readonly-plan",
              );
              if (profile) Object.assign(profile, { timeoutMs: profile.timeoutMs + 1 });
            }
          },
        };
        routeCatalogTrace.catalogs.push(tracedCatalog);
        return tracedCatalog;
      }
      routeCatalogTrace.catalogs.push(catalog);
      return catalog;
    }),
  };
});

vi.mock("../../src/config/managed-agent-direct-adapters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/managed-agent-direct-adapters.js")>();
  return {
    ...actual,
    createManagedDirectProviderAdapterFactory: vi.fn((options: Record<string, unknown>) => {
      adapterTrace.factoryOptions.push(options);
      return async (
        route: ResolvedManagedTargetConfig,
        credentialBinding: DirectProviderCredentialBinding | undefined,
        _abortSignal: AbortSignal | undefined,
        committedRequest: ManagedCommittedInvocationRequest,
      ) => {
        adapterTrace.createCalls += 1;
        adapterTrace.requests.push({ route, credentialBinding, committedRequest });
        return adapterTrace.adapter as never;
      };
    }),
  };
});

/**
 * Regression proof for #56 revised S1: the operator-supervised project Runtime
 * composition must derive its managed-target config
 * (`targetCatalog`, `authorityProfiles`, `engines`, `managedAgents`, ...) from
 * canonical global/project config with the correct authority split, not from
 * `readConfigStatusSnapshot().effectiveConfig` (a project/status projection
 * that never carries global-only Runtime route authority). Unlike
 * `operator-project-agent-tasks.test.ts`, this file does not mock `config-status.js`,
 * `global-config.js`, or `kiln-yaml.js`: it drives the real production
 * `readGlobalConfig()` + `readKilnYaml()` reads against real fixture files on
 * disk, through the real composition boundary
 * (`createOperatorProjectAgentTaskApplicationComposition`) and the real MCP
 * surface (`NativeHarnessMcpTools`). A fake `effectiveConfig` mock (as the
 * existing sibling test uses) can assert whatever shape it likes, including
 * global target authority that `ResolvedKilnConfig` never actually produces --
 * which is exactly how the original defect went uncaught.
 */
const FIXTURE_OBSERVED_AT = "2026-07-01T12:00:00.000Z";

function taskAuthorityAdmission() {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "agent-task-runtime-config-session",
    turnId: "agent-task-runtime-config-session:turn:1",
    admittedAt: FIXTURE_OBSERVED_AT,
    configuration: {
      sessionRevision: { revisionSetId: "agent-task-runtime-config", revisions: { test: "session" } },
      turnRevision: { revisionSetId: "agent-task-runtime-config", revisions: { test: "turn" } },
    },
    session: {
      skillCatalog: { catalogId: "agent-task-runtime-config", revision: "test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "Synthetic operator task test admission." },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "Synthetic operator task test admission.",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "workspace_write",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{
          toolName: "kiln_agent_task_submit",
          authority: { level: 3, allowed: true, requiresApproval: false, reason: "Synthetic task test admission." },
          effectEnvelope: {
            operation: "mutate",
            boundaries: ["workspace", "network", "external-system"],
            reversibility: "irreversible",
            dataEgress: "sensitive-data",
            identityUse: "privileged",
            consequences: ["local-state", "external-state", "financial", "security"],
            idempotency: "non-idempotent",
          },
        }],
        deniedToolNames: [],
      },
      effectCeiling: {
        operation: "mutate",
        boundaries: ["workspace", "network", "external-system"],
        reversibility: "irreversible",
        dataEgress: "sensitive-data",
        identityUse: "privileged",
        consequences: ["local-state", "external-state", "financial", "security"],
        idempotency: "non-idempotent",
      },
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

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
        provenProfiles: ["foundation-readonly-plan"],
      },
    ])),
  };
}

function eligibleHarnessProviderCatalog(providerId: "codex", model: string): ManagedAgentProviderModelCatalogDiagnostics {
  const catalog = normalizeRuntimeProviderDiscoveryCatalog({
    providerId,
    family: "codex-harness",
    harnessId: "codex",
    reportedProviderId: "codex",
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
        provenProfiles: ["foundation-readonly-plan"],
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
  "authorityProfileId: readonly-plan",
  "---",
  "Regression fixture agent; not used for real work.",
].join("\n");

const OPENCODE_WRITE_WORKER_AGENT = [
  "---",
  "name: opencode-write-worker",
  "role: Approved write worker",
  "goal: Apply only operator-approved workspace changes.",
  "tier: fast",
  "mode: managed-child",
  "authorityProfileId: approved-write",
  "---",
  "Regression fixture agent; not used for real work.",
].join("\n");

const NATIVE_CODEX_DELIBERATION_AGENT = [
  "---",
  "name: native-codex-deliberation-worker",
  "role: Native deliberation worker",
  "goal: Execute only with the discovered deliberation level.",
  "tier: reasoning",
  "mode: managed-child",
  "targetId: native-codex-deliberation",
  "authorityProfileId: readonly-plan",
  "---",
  "Regression fixture agent; not used for real work.",
].join("\n");

function nativeCodexDeliberationConfig(): KilnGlobalConfig {
  return {
    version: "4",
    workGovernance: {
      defaultPosture: "direct",
      requireDelegationFor: ["managed-agents"],
      requiredEvidence: [],
    },
    targetCatalog: {
      evidenceRevision: `sha256:${"a".repeat(64)}`,
      accounts: [],
      accountPolicies: [],
      targets: [{
        id: "native-codex-deliberation",
        kind: "harness",
        label: "Native Codex Deliberation",
        providerId: "codex",
        providerModelId: "gpt-5.6-codex",
        dataClassification: "internal",
      }],
    },
    authorityProfiles: [{
      id: "readonly-plan",
      admissionProfile: "foundation-readonly-plan",
      workingDirectory: "project",
      tools: { allowed: ["read"], network: false, writes: false },
      memory: { access: "read-only" },
    }],
    managedAgents: {
      enabled: true,
      defaultAuthorityProfileId: "readonly-plan",
    },
    deliberationPolicy: {
      byRoute: [{
        provider: "codex",
        model: "gpt-5.6-codex",
        mode: "fixed",
        preferredLevel: "high",
        onUnsupported: "deny",
      }],
    },
  };
}

function accountBoundEconomicConfig(): KilnGlobalConfig {
  const configured = managedAgentIntentConfig();
  // These durable Agent Task fixtures exercise dispatch/replay, not an
  // interactive approval surface. Keep their paid posture explicitly bounded
  // so the ask-before-spend producer path remains covered by Runtime-tool
  // tests without silently auto-approving a spend here.
  return {
    ...configured,
    managedAgents: {
      ...configured.managedAgents!,
      intents: configured.managedAgents!.intents!.map((intent) => ({
        ...intent,
        paidUsage: {
          kind: "cap" as const,
          amount: {
            atoms: "1000000000",
            scale: 6,
            unit: "input-token",
            scheme: { kind: "currency" as const, currency: "USD" },
          },
        },
      })),
    },
  };
}

/** An alternate direct route used to prove route identity is carried by the execution catalog. */
function openCodeGoEconomicConfig(): KilnGlobalConfig {
  const configured = accountBoundEconomicConfig();
  return {
    ...configured,
    managedAgents: {
      ...configured.managedAgents!,
      intents: configured.managedAgents!.intents!.map((intent) => ({
        ...intent,
        target: { mode: "explicit" as const, targetId: "opencode-go-direct" },
        model: { mode: "explicit" as const, modelId: "kimi-k2.6" },
      })),
    },
    targetCatalog: {
      ...configured.targetCatalog!,
      accounts: configured.targetCatalog!.accounts.map((account) => ({
        ...account,
        id: "opencode-go-account",
        providerId: "opencode-go",
        credentialId: "opencode-go-credential",
      })),
      accountPolicies: configured.targetCatalog!.accountPolicies.map((policy) => ({
        ...policy,
        id: "opencode-go-policy",
        accountIds: ["opencode-go-account"],
      })),
      targets: configured.targetCatalog!.targets.map((target) => {
        if (target.kind !== "direct") throw new Error("expected a direct execution target");
        return {
          ...target,
          id: "opencode-go-direct",
          providerId: "opencode-go",
          providerModelId: "kimi-k2.6",
          accountSelection: { mode: "automatic" as const, accountPolicyId: "opencode-go-policy" },
          economics: target.economics,
        };
      }),
    },
    targetRouting: { defaultTargetId: "opencode-go-direct" },
  };
}

function openCodeGoWriteEconomicConfig(): KilnGlobalConfig {
  const configured = openCodeGoEconomicConfig();
  return {
    ...configured,
    authorityProfiles: configured.authorityProfiles?.map((profile) => ({
      ...profile,
      id: "approved-write",
      admissionProfile: "foundation-apply-approved-writes" as const,
      tools: {
        allowed: ["read", "grep", "glob", "write", "edit", "apply-patch"],
        network: false,
        writes: true,
      },
      memory: { access: "write-proposals" as const },
      writeAuthority: {
        workspace: { mode: "apply-approved" as const, allowedPaths: ["."] },
        approval: { mode: "required-before-apply" as const },
      },
    })),
    managedAgents: {
      ...configured.managedAgents!,
      defaultAuthorityProfileId: "approved-write",
      intents: configured.managedAgents!.intents!.map((intent) => ({
        ...intent,
        id: "opencode-write-worker",
        authorityProfileId: "approved-write",
      })),
    },
  };
}

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
    routeCatalogTrace.contexts.length = 0;
    routeCatalogTrace.catalogs.length = 0;
    routeCatalogTrace.mutateExecutionCapabilityVersion = false;
    routeCatalogTrace.mutateExecutionProfileAuthority = false;
    routeCatalogTrace.injectNativeDeliberationCapabilities = false;
    routeCatalogTrace.mutateExecutionDeliberationEvidence = false;
    routeCatalogTrace.executionRefreshCount = 0;
    adapterTrace.createCalls = 0;
    adapterTrace.factoryOptions.length = 0;
    adapterTrace.requests.length = 0;
    adapterTrace.adapter.invoke.mockClear();
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
    const authRoot = join(globalHome, ".kiln", "auth");
    mkdirSync(join(authRoot, "codex-oauth"), { recursive: true });
    const tokenHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const tokenClaims = Buffer.from(JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
    })).toString("base64url");
    writeFileSync(join(authRoot, "codex-oauth", "codex-credential.json"), JSON.stringify({
      access_token: `${tokenHeader}.${tokenClaims}.`,
      refresh_token: "fixture-refresh-token",
      expires_at: "2099-01-01T00:00:00.000Z",
      client_id: "fixture-client",
    }), "utf8");
    mkdirSync(join(authRoot, "provider-usage"), { recursive: true });
    writeFileSync(join(authRoot, "provider-usage", "codex-oauth.json"), JSON.stringify([{
      provider: "codex-oauth",
      credentialId: "codex-credential",
      availability: "available",
      observedAt: "2026-08-01T00:00:00.000Z",
      validUntil: "2099-01-01T00:00:00.000Z",
      source: "provider-endpoint",
      confidence: "authoritative",
      exhaustionReason: null,
    }]), "utf8");
    mkdirSync(join(authRoot, "opencode-api"), { recursive: true });
    writeFileSync(join(authRoot, "opencode-api", "opencode-go-credential.json"), JSON.stringify({
      id: "opencode-go-credential",
      label: "opencode-go-credential",
      providerId: "opencode-api",
      source: "manual",
      priority: 0,
      tier: "go",
      auth: {
        api_key: "fixture-opencode-key",
        tier: "go",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }), "utf8");
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

  it("constructs the real composition from canonical V3 config and surfaces the admitted managed agent through the real MCP server", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig(managedAgentIntentConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      const economicWorker = composition.configuredAgents.find((agent) => agent.configuredAgentProfileId === "economic-worker");
      expect(economicWorker).toBeDefined();
      expect(economicWorker).toMatchObject({
        configuredAgentProfileId: "economic-worker",
        availability: "admitted",
        providerFamily: "codex-oauth",
      });

      const server = new NativeHarnessMcpTools({
        harness: "codex",
        requestIdentity: () => ({ callerId: "test-codex-runtime-session" }),
        agentTasks: composition.application,
        inspection: createNativeHarnessInspectionService({
          harness: "codex",
          managedAgents: composition.configuredAgents,
          readProjectRoot: async () => ({ status: "resolved", rootPath: projectRoot }),
        }),
      });
      const tools = server.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "kiln_agent_task_submit",
        "kiln_agent_task_status",
        "kiln_agent_task_result",
        "kiln_agent_task_cancel",
        "kiln_agent_task_replay",
      ]));
      const submitTool = tools.find((tool) => tool.name === "kiln_agent_task_submit");
      expect(submitTool).toBeDefined();
      expect((submitTool!.inputSchema.properties as { configuredAgentProfileId: Record<string, unknown> }).configuredAgentProfileId)
        .toEqual({ type: "string", minLength: 1, maxLength: 200 });
    } finally {
      await composition.close();
    }
  });

  it("persists exact native deliberation evidence through status and replay", async () => {
    useIsolatedGlobalConfigHome();
    routeCatalogTrace.injectNativeDeliberationCapabilities = true;
    persistGlobalConfig(nativeCodexDeliberationConfig(), (evidence) => ({
      ...evidence,
      targets: evidence.targets.map((target) => ({
        ...target,
        dataPolicyEvidence: {
          ...target.dataPolicyEvidence,
          sourceIdentity: "fixture-privacy-policy",
          sourceRevision: "rev-2026-08",
          sourceDigest: `sha256:${"b".repeat(64)}`,
          observedAt: "2026-08-01T00:00:00.000Z",
          expiresAt: "2027-08-31T00:00:00.000Z",
        },
      })),
    }));
    const projectRoot = createProjectRoot('version: "1"\n', {
      "native-codex-deliberation-worker.md": NATIVE_CODEX_DELIBERATION_AGENT,
    });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({ status: "started" } as never);
    const join = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "join").mockResolvedValue({
      status: "completed",
      record: { invocationId: "agent-task-native-policy", lifecycleState: "completed", resultHandoff: {
        provenance: { delivery: "native-structured-output", configuredModelId: "gpt-5.6-codex", primaryObservedModelId: "gpt-5.6-codex", observedModelIds: ["gpt-5.6-codex"] },
        summary: "Synthetic native policy proof completed.", resourceUris: [], memoryWriteProposalUris: [],
      } },
    } as never);
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleHarnessProviderCatalog("codex", "gpt-5.6-codex"),
    });
    try {
      expect(composition.configuredAgents.find((agent) => agent.configuredAgentProfileId === "native-codex-deliberation-worker")).toMatchObject({
        configuredAgentProfileId: "native-codex-deliberation-worker",
        availability: "admitted",
      });
      const accepted = await composition.application.accept({
        objective: "Persist admitted native deliberation.",
        configuredAgentProfileId: "native-codex-deliberation-worker",
        callerId: "codex-native-harness",
        idempotencyKey: "native-deliberation-persistence",
      });
      const expected = {
        status: "exact",
        selectedLevel: "high",
        source: "route",
        capabilityEvidence: {
          sourceIdentity: "fixture-native-codex-catalog",
          sourceRevision: "revision-1",
          observedAt: FIXTURE_OBSERVED_AT,
        },
      };
      expect(accepted.dispatch).toMatchObject({
        kind: "native-harness",
        deliberationResolution: expected,
        acknowledgement: { deliberationResolution: expected },
      });
      await expect(composition.application.getStatus({ callerId: "codex-native-harness" }, accepted.id))
        .resolves.toMatchObject({ dispatch: { deliberationResolution: expected } });
      await expect(composition.application.getReplay({ callerId: "codex-native-harness" }, accepted.id))
        .resolves.toMatchObject({ dispatch: { deliberationResolution: expected } });
      await composition.close();
      const status = await composition.application.getStatus({ callerId: "codex-native-harness" }, accepted.id);
      const result = await composition.application.getResult({ callerId: "codex-native-harness" }, accepted.id);
      const replay = await composition.application.getReplay({ callerId: "codex-native-harness" }, accepted.id);
      const proof = {
        version: 1, jobId: accepted.id, dispatchFenceId: expect.stringMatching(/^native-harness-dispatch:/u),
        routeId: "native-codex-deliberation", providerId: "codex", providerModelId: "gpt-5.6-codex",
        decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
        evidence: expect.objectContaining({ sourceIdentity: "fixture-privacy-policy", sourceRevision: "rev-2026-08", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-31T00:00:00.000Z", trainingPosture: "prohibited", retentionPosture: "zero", retentionDays: 0, maximumClassification: "internal" }),
      };
      expect(status).toMatchObject({ state: "succeeded", result: { dataPolicyProof: proof } });
      expect(result).toMatchObject({ availability: "available", dataPolicyProof: proof });
      expect(replay).toMatchObject({ lifecycleState: "succeeded", dataPolicyProof: proof });
      expect(replay.dataPolicyProof).toEqual(result.dataPolicyProof);
      expect(JSON.stringify([status.result?.dataPolicyProof, result.dataPolicyProof, replay.dataPolicyProof])).not.toMatch(/secret|rawPolicy|content|workingDirectory/iu);
    } finally {
      await composition.close();
      start.mockRestore();
      join.mockRestore();
    }
  });

  it("fails closed before adapter creation when native deliberation evidence drifts", async () => {
    useIsolatedGlobalConfigHome();
    routeCatalogTrace.injectNativeDeliberationCapabilities = true;
    routeCatalogTrace.mutateExecutionDeliberationEvidence = true;
    persistGlobalConfig(nativeCodexDeliberationConfig());
    const projectRoot = createProjectRoot('version: "1"\n', {
      "native-codex-deliberation-worker.md": NATIVE_CODEX_DELIBERATION_AGENT,
    });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({ status: "started" } as never);
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleHarnessProviderCatalog("codex", "gpt-5.6-codex"),
    });
    try {
      const accepted = await composition.application.accept({
        objective: "Reject changed native deliberation evidence.",
        configuredAgentProfileId: "native-codex-deliberation-worker",
        callerId: "codex-native-harness",
        idempotencyKey: "native-deliberation-drift",
      });
      await composition.close();
      await expect(composition.application.getStatus({ callerId: "codex-native-harness" }, accepted.id))
        .resolves.toMatchObject({ state: "failed", diagnostic: "invocation_failed" });
      expect(start).not.toHaveBeenCalled();
    } finally {
      await composition.close();
      start.mockRestore();
    }
  });

  it("rebuilds an execution composition after the economic dispatch fence", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig(accountBoundEconomicConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockImplementation(async (
      _request,
      _adapter,
      _capabilitySnapshot,
      _lifecycleOptions,
    ) => {
      return { status: "started" } as never;
    });
    const join = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "join").mockResolvedValue({
      status: "completed",
      record: {
        invocationId: "agent-task-runtime",
        lifecycleState: "completed",
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output",
            configuredModelId: "gpt-5.6-codex",
            primaryObservedModelId: "gpt-5.6-codex",
            observedModelIds: ["gpt-5.6-codex"],
          },
          summary: "Synthetic managed execution completed.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
      },
    } as never);

    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      expect(routeCatalogTrace.contexts[0]).toMatchObject({ compositionMode: "candidate-admission" });
      expect(routeCatalogTrace.catalogs[0]?.managedInvocation?.invocationService).toBeUndefined();

      const result = await composition.application.accept({
        objective: "Prove post-fence managed execution.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "post-fence-managed-execution",
      });

      expect(result.state).toBe("queued");
      await composition.close();
      const debugStatus = await composition.application.getStatus({ callerId: "codex-app" }, result.id);
      expect(debugStatus).toMatchObject({ state: "succeeded" });
      expect(adapterTrace.createCalls).toBe(1);
      expect(start).toHaveBeenCalledOnce();
      expect(join).toHaveBeenCalledWith(`agent-task:${result.id}`);
      expect(start.mock.calls[0]?.[1]).toBe(adapterTrace.adapter);
      const executionIndex = routeCatalogTrace.contexts.findIndex((context) => context.compositionMode === "execution");
      expect(executionIndex).toBeGreaterThan(0);
      expect(routeCatalogTrace.contexts[executionIndex]).toMatchObject({
        compositionMode: "execution",
        managedAccountComposition: expect.any(Object),
      });
      expect(routeCatalogTrace.catalogs[executionIndex]?.managedInvocation?.invocationService).toBeDefined();
    } finally {
      await composition.close();
      start.mockRestore();
      join.mockRestore();
    }
  });

  it("admits, commits, dispatches, and replays the exact credentialless opencode-go direct route", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig(openCodeGoEconomicConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({ status: "started" } as never);
    const join = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "join").mockResolvedValue({
      status: "completed",
      record: {
        invocationId: "agent-task-opencode-go",
        lifecycleState: "completed",
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output",
            configuredModelId: "kimi-k2.6",
            primaryObservedModelId: "kimi-k2.6",
            observedModelIds: ["kimi-k2.6"],
          },
          summary: "Synthetic OpenCode Go managed execution completed.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
      },
    } as never);
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("opencode-go", "kimi-k2.6"),
    });
    try {
      // Candidate admission must not construct an adapter or touch a credential binding.
      expect(adapterTrace.createCalls).toBe(0);
      expect(adapterTrace.requests).toEqual([]);

      const accepted = await composition.application.accept({
        objective: "Prove deterministic OpenCode Go managed dispatch.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "opencode-go-managed-regression",
      });
      expect(accepted).toMatchObject({
        state: "queued",
        dispatch: { kind: "economic", candidateSet: { candidates: [{ routeId: "opencode-go-direct", providerId: "opencode-go", model: "kimi-k2.6" }] } },
      });

      await composition.close();
      const status = await composition.application.getStatus({ callerId: "codex-app" }, accepted.id);
      const result = await composition.application.getResult({ callerId: "codex-app" }, accepted.id);
      const replay = await composition.application.getReplay({ callerId: "codex-app" }, accepted.id);
      expect(status).toMatchObject({
        state: "succeeded",
        result: { runtimeInvocationId: "agent-task-opencode-go", routeId: "opencode-go-direct", providerId: "opencode-go" },
      });
      expect(result).toMatchObject({
        availability: "available",
        routeId: "opencode-go-direct",
        providerId: "opencode-go",
        handoff: { summary: "Synthetic OpenCode Go managed execution completed." },
      });
      expect(replay).toMatchObject({
        lifecycleState: "succeeded",
        routeId: "opencode-go-direct",
        providerId: "opencode-go",
        resultAvailability: "available",
        dispatch: { kind: "economic" },
      });
      expect(adapterTrace.createCalls).toBe(1);
      expect(adapterTrace.requests).toMatchObject([{
        route: { id: "opencode-go-direct" },
        credentialBinding: {
          routeId: "opencode-go-direct",
          accountId: "opencode-go-account",
          credentialId: "opencode-go-credential",
          credentialRevision: expect.any(String),
        },
        committedRequest: { commitment: { reservation: { selectedIdentity: { route: { routeId: "opencode-go-direct", providerId: "opencode-go", modelId: "kimi-k2.6" } } } } },
      }]);
      expect(start).toHaveBeenCalledWith(expect.objectContaining({
        invocationId: `agent-task:${accepted.id}`,
        providerRoute: { providerId: "opencode-go", surface: "direct-provider", model: "kimi-k2.6" },
      }), adapterTrace.adapter, expect.anything(), expect.anything());
      expect(join).toHaveBeenCalledWith(`agent-task:${accepted.id}`);
      const projections = JSON.stringify([status, result, replay]);
      expect(projections).not.toContain("credential");
      expect(projections).not.toMatch(/accountRef|credentialRevision|api[_-]?key/iu);
    } finally {
      await composition.close();
      start.mockRestore();
      join.mockRestore();
    }
  });

  it("holds an opencode-go direct write until one exact trusted approval is consumed", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig(openCodeGoWriteEconomicConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "opencode-write-worker.md": OPENCODE_WRITE_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({ status: "started" } as never);
    const join = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "join").mockImplementation(async (invocationId) => ({
      status: "completed",
      record: {
        invocationId,
        lifecycleState: "completed",
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output",
            configuredModelId: "kimi-k2.6",
            primaryObservedModelId: "kimi-k2.6",
            observedModelIds: ["kimi-k2.6"],
          },
          summary: "Synthetic approved OpenCode Go write completed.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
        writeEvidence: [{
          evidenceId: "opencode-write-completed",
          invocationId,
          kind: "write-attempt-completed",
          summary: "Approved workspace write completed.",
          resourceUris: ["kiln://managed-agents/write-evidence/opencode-write-completed"],
          recordedAt: "2026-07-01T12:00:00.000Z",
        }],
      },
    } as never));
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("opencode-go", "kimi-k2.6"),
    });
    try {
      const accepted = await composition.application.accept({
        objective: "Apply the one approved fixture write.",
        configuredAgentProfileId: "opencode-write-worker",
        callerId: "codex-app",
        idempotencyKey: "opencode-go-approved-write",
      });
      expect(accepted).toMatchObject({
        state: "awaiting_approval",
        admissionProfileId: "foundation-apply-approved-writes",
        dispatch: { kind: "economic", candidateSet: { candidates: [{ routeId: "opencode-go-direct" }] } },
      });
      expect(adapterTrace.createCalls).toBe(0);
      expect(start).not.toHaveBeenCalled();
      await expect(composition.application.getResult({ callerId: "codex-app" }, accepted.id)).resolves.toMatchObject({
        availability: "pending",
        lifecycleState: "awaiting_approval",
      });

      const approved = await composition.application.approveWrite(accepted.id, "2099-08-09T20:05:00.000Z");
      expect(approved).toMatchObject({ state: "queued", writeApproval: { state: "issued", approverId: "operator" } });
      await composition.close();
      const status = await composition.application.getStatus({ callerId: "codex-app" }, accepted.id);
      const result = await composition.application.getResult({ callerId: "codex-app" }, accepted.id);
      const replay = await composition.application.getReplay({ callerId: "codex-app" }, accepted.id);
      expect(status).toMatchObject({ state: "succeeded", writeApproval: { state: "consumed", consumedBy: `agent-task:${accepted.id}` } });
      expect(result).toMatchObject({
        availability: "available",
        writeApproval: { state: "consumed" },
        writeEvidence: [{ kind: "write-attempt-completed", resourceUris: ["kiln://managed-agents/write-evidence/opencode-write-completed"] }],
      });
      expect(replay).toMatchObject({
        lifecycleState: "succeeded",
        writeApproval: { state: "consumed" },
        writeEvidence: [{ kind: "write-attempt-completed" }],
      });
      expect(adapterTrace.createCalls).toBe(1);
      expect(start).toHaveBeenCalledWith(expect.objectContaining({
        invocationId: `agent-task:${accepted.id}`,
        profile: "foundation-apply-approved-writes",
        requestedAuthority: "destructive",
        authorityApproval: { approved: true },
        providerRoute: { providerId: "opencode-go", surface: "direct-provider", model: "kimi-k2.6" },
        authority: expect.objectContaining({
          toolAuthority: expect.objectContaining({ writeAllowed: true, networkAllowed: false }),
          writeAuthority: expect.objectContaining({ approval: expect.objectContaining({ mode: "required-before-apply" }) }),
        }),
      }), adapterTrace.adapter, expect.anything(), expect.objectContaining({
        consumedWriteApproval: expect.objectContaining({
          approvalId: expect.any(String),
          consumerId: `agent-task:${accepted.id}`,
          consumedAt: expect.any(String),
        }),
      }));
      expect(join).toHaveBeenCalledOnce();
      await expect(composition.application.approveWrite(accepted.id, "2099-08-09T20:05:00.000Z")).rejects.toMatchObject({
        code: "invalid_transition",
      });
      const projections = JSON.stringify([status, result, replay]);
      expect(projections).not.toMatch(/accountRef|credentialRevision|api[_-]?key|authorization|C:\\/iu);
    } finally {
      await composition.close();
      start.mockRestore();
      join.mockRestore();
    }
  });

  it("keeps an economic lifecycle timeout post-claim pending for canonical settlement", async () => {
    useIsolatedGlobalConfigHome();
    const config = openCodeGoEconomicConfig();
    const authorityProfile = config.authorityProfiles?.[0];
    if (!authorityProfile) throw new Error("Expected one managed authority profile fixture.");
    persistGlobalConfig({
      ...config,
      authorityProfiles: [{ ...authorityProfile, timeoutMs: 150 }],
    });
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({ status: "started" } as never);
    const join = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "join").mockImplementation(async (invocationId) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        status: "completed",
        record: {
          invocationId,
          lifecycleState: "timed_out",
          diagnostics: [{
            kind: "timeout",
            uri: `kiln://managed-agents/invocations/${encodeURIComponent(invocationId)}/resources/timeout`,
          }],
          resultHandoff: {
            provenance: { delivery: "runtime-generated", configuredModelId: "kimi-k2.6" },
            summary: "Managed economic lifecycle timed out.",
            resourceUris: [],
            memoryWriteProposalUris: [],
          },
        },
      } as never;
    });
    const invocationStatus = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "status").mockReturnValue({
      progressEvents: [{
        eventId: "provider-transport-1",
        kind: "provider_transport",
        recordedAt: "2026-08-10T00:00:00.000Z",
        summary: "Provider transport response headers.",
        metadata: { eventType: "response_headers", phase: "headers", status: 200 },
      }],
    } as never);
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("opencode-go", "kimi-k2.6"),
    });
    try {
      const accepted = await composition.application.accept({
        objective: "Classify one bounded provider timeout.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "opencode-go-economic-timeout",
      });
      await composition.close();
      await expect(composition.application.getStatus({ callerId: "codex-app" }, accepted.id)).resolves.toMatchObject({
        state: "running",
        dispatch: {
          dispatchFenceId: expect.any(String),
          actionClaim: expect.any(Object),
        },
      });
      expect(adapterTrace.factoryOptions).not.toHaveLength(0);
      expect(adapterTrace.factoryOptions.every((factoryOptions) => {
        const store = factoryOptions.runtimeToolActionClaims as { claim?: unknown; settle?: unknown } | undefined;
        return typeof store?.claim === "function" && typeof store.settle === "function";
      })).toBe(true);
      await expect(composition.application.getResult({ callerId: "codex-app" }, accepted.id)).resolves.toMatchObject({
        availability: "pending",
        lifecycleState: "running",
        diagnostic: "result_pending",
      });
    } finally {
      await composition.close();
      start.mockRestore();
      join.mockRestore();
      invocationStatus.mockRestore();
    }
  });

  it("fails closed before Runtime start when post-fence adapter capability changes", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig(accountBoundEconomicConfig());
    routeCatalogTrace.mutateExecutionCapabilityVersion = true;
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({
      status: "started",
    } as never);
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      const result = await composition.application.accept({
        objective: "Reject a changed post-fence capability.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "post-fence-capability-mismatch",
      });
      expect(result.state).toBe("queued");
      await composition.close();
      await expect(composition.application.getStatus({ callerId: "codex-app" }, result.id)).resolves.toMatchObject({ state: "failed", diagnostic: "invocation_failed" });
      expect(start).not.toHaveBeenCalled();
      expect(adapterTrace.adapter.invoke).not.toHaveBeenCalled();
    } finally {
      await composition.close();
      start.mockRestore();
    }
  });

  it("denies native-route policy before adapter creation or Runtime start", async () => {
    useIsolatedGlobalConfigHome();
    routeCatalogTrace.injectNativeDeliberationCapabilities = true;
    const config = nativeCodexDeliberationConfig();
    persistGlobalConfig(config, (evidence) => ({
      ...evidence,
      targets: evidence.targets.map((target) => ({
        ...target,
        dataPolicyEvidence: {
          ...target.dataPolicyEvidence,
          expiresAt: "2026-08-14T00:00:00.000Z",
        },
      })),
    }));
    const projectRoot = createProjectRoot('version: "1"\n', { "native-codex-deliberation-worker.md": NATIVE_CODEX_DELIBERATION_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({ status: "started" } as never);
    const adapterCreationsBeforeDispatch = adapterTrace.createCalls;
    try {
      await expect(createOperatorProjectAgentTaskApplicationComposition({
        projectPath: projectRoot,
        authorityAdmission: taskAuthorityAdmission(),
        discoverProviderModels: async () => eligibleHarnessProviderCatalog("codex", "gpt-5.6-codex"),
      })).rejects.toThrow("data-policy evidence is stale");
      expect(adapterTrace.createCalls).toBe(adapterCreationsBeforeDispatch);
      expect(start).not.toHaveBeenCalled();
      expect(adapterTrace.adapter.invoke).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
    }
  });

  it("keeps a post-claim execution-authority mismatch pending without starting Runtime", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig(accountBoundEconomicConfig());
    routeCatalogTrace.mutateExecutionProfileAuthority = true;
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({
      status: "started",
    } as never);
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      const result = await composition.application.accept({
        objective: "Reject changed execution authority with a stable adapter identity.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "post-fence-profile-authority-mismatch",
      });
      expect(result.state).toBe("queued");
      await composition.close();
      await expect(composition.application.getStatus({ callerId: "codex-app" }, result.id)).resolves.toMatchObject({
        state: "running",
        dispatch: {
          dispatchFenceId: expect.any(String),
          actionClaim: expect.any(Object),
        },
      });
      await expect(composition.application.getResult({ callerId: "codex-app" }, result.id)).resolves.toMatchObject({
        availability: "pending",
        lifecycleState: "running",
        diagnostic: "result_pending",
      });
      expect(start).not.toHaveBeenCalled();
      expect(adapterTrace.adapter.invoke).not.toHaveBeenCalled();
    } finally {
      await composition.close();
      start.mockRestore();
    }
  });

  it("keeps a globally disabled provider engine unavailable through the real composition boundary", async () => {
    useIsolatedGlobalConfigHome();
    const globalConfig: KilnGlobalConfig = {
      ...managedAgentIntentConfig(),
      engines: { "codex-oauth": { enabled: false } },
    };
    persistGlobalConfig(globalConfig);
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      // Same fixture as the positive test above -- the eligibility catalog would
      // admit this exact route -- except the global engine is disabled, so this
      // proves the denial and not mere eligibility-catalog absence.
      const economicWorker = composition.configuredAgents.find((agent) => agent.configuredAgentProfileId === "economic-worker");
      expect(economicWorker).toBeDefined();
      expect(economicWorker).toMatchObject({
        configuredAgentProfileId: "economic-worker",
        availability: "unresolved",
        diagnostic: "eligibility_unresolved",
      });
    } finally {
      await composition.close();
    }
  });

  it("rejects project kiln.yaml attempts to declare global target or engine authority", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig(managedAgentIntentConfig());
    // Project config is a strict restriction surface. Global engine and target
    // declarations are rejected at the project boundary instead of ignored.
    const projectRoot = createProjectRoot([
      'version: "1"',
      "engines:",
      "  codex-oauth:",
      "    enabled: false",
      "targetCatalog: not-a-catalog",
    ].join("\n"), { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    await expect(createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    })).rejects.toThrow(/engines is global-only/u);
  });

  it("rejects a project-declared managed target instead of treating it as global authority", async () => {
    useIsolatedGlobalConfigHome();
    persistGlobalConfig({ version: "4" });
    const projectRoot = createProjectRoot([
      'version: "1"',
      "managedAgents:",
      "  enabled: true",
    ].join("\n"));

    await expect(createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      authorityAdmission: taskAuthorityAdmission(),
      discoverProviderModels: async () => ({}),
    })).rejects.toThrow(/managedAgents is global-only/u);
  });
});
