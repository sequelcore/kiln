import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveProviderModelEligibility,
  textParts,
  type AgentResponse,
  type Capability,
  type ProviderAdapter,
  type ProviderModelEligibilityRequirements,
} from "@kilnai/core";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import {
  defineEffectiveAuthorityAdmissionBundle,
  ManagedDirectProviderRuntimeAdapter,
  normalizeRuntimeProviderDiscoveryCatalog,
  SqliteManagedAccountLeaseAuthority,
  type EffectiveAuthorityAdmissionBundle,
  type ManagedCommittedInvocationRequest,
} from "@kilnai/runtime";
import { createOperatorProjectAgentTaskApplicationComposition } from "../../src/application/operator-project-agent-tasks.js";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../../src/config/managed-agent-provider-models.js";
import { persistAdmittedGlobalConfigFixture } from "../config/global-config-fixture.js";
import { managedAgentIntentConfig } from "../config/managed-agent-intent-config-fixture.js";
import type { ResolvedManagedTargetConfig } from "../../src/config/resolved-managed-target.js";
import type { DirectProviderCredentialBinding } from "../../src/wrapper/direct-provider-adapter-factory.js";

const trace = vi.hoisted(() => ({
  adapterCreations: 0,
  builtinReads: 0,
  providerRequests: 0,
  bindings: [] as DirectProviderCredentialBinding[],
  errors: [] as unknown[],
}));

vi.mock("../../src/config/managed-agent-direct-adapters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/managed-agent-direct-adapters.js")>();
  return {
    ...actual,
    createManagedDirectProviderAdapterFactory: vi.fn((options: {
      readonly runtimeToolActionClaims: ConstructorParameters<typeof ManagedDirectProviderRuntimeAdapter>[0]["runtimeToolActionClaims"];
      readonly runtimeModelRoundActionClaims: ConstructorParameters<typeof ManagedDirectProviderRuntimeAdapter>[0]["runtimeModelRoundActionClaims"];
      readonly readAuthorityAdmission: ConstructorParameters<typeof ManagedDirectProviderRuntimeAdapter>[0]["readAuthorityAdmission"];
    }) => async (
      _route: ResolvedManagedTargetConfig,
      credentialBinding: DirectProviderCredentialBinding | undefined,
      _abortSignal: AbortSignal | undefined,
      committedRequest: ManagedCommittedInvocationRequest,
    ) => {
      if (!credentialBinding) throw new Error("Synthetic direct child requires the committed credential binding.");
      trace.adapterCreations += 1;
      trace.bindings.push(credentialBinding);
      return new ManagedDirectProviderRuntimeAdapter({
        providerId: "codex-oauth",
        model: "gpt-5.6-codex",
        provider: syntheticProvider(),
        tools: [{ name: "read", description: "Read a bounded fixture.", inputSchema: { type: "object" }, tags: new Set(["read"]) }],
        builtinTools: new Map([["read", async () => {
          trace.builtinReads += 1;
          return "fixture read completed";
        }]]),
        capabilityMap: new Map([["read", readCapability()]]),
        toolAuthority: new Map([["read", { level: 1, allowed: true, requiresApproval: false, reason: "configured read-only profile" }]]),
        economicIdentity: committedRequest.commitment.reservation.selectedIdentity,
        executionBinding: { status: "bound", ...credentialBinding },
        runtimeToolActionClaims: options.runtimeToolActionClaims,
        runtimeModelRoundActionClaims: options.runtimeModelRoundActionClaims,
        readAuthorityAdmission: options.readAuthorityAdmission,
      });
    }),
  };
});

const OBSERVED_AT = "2026-09-08T00:00:00.000Z";

function readCapability(): Capability {
  return {
    name: "read",
    description: "Read a bounded fixture.",
    schema: { type: "object" },
    tags: ["read"],
    effectEnvelope: {
      operation: "observe",
      boundaries: ["workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    },
  };
}

function syntheticProvider(): ProviderAdapter {
  let round = 0;
  const response = (text: string, toolCalls: AgentResponse["toolCalls"]): AgentResponse => ({
    parts: textParts(text),
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
  });
  return {
    name: "codex-oauth",
    createMessage: async () => {
      trace.providerRequests += 1;
      return round++ === 0
        ? response("Read the admitted fixture.", [{ id: "fixture-read", name: "read", input: { path: "README.md" } }])
        : response("Synthetic child completed after its admitted read.", []);
    },
    streamMessage: async function* () {},
  };
}

function managedDiscovery(): ManagedAgentProviderModelCatalogDiagnostics {
  const requirements: ProviderModelEligibilityRequirements = {
    use: "managed-agent",
    evaluatedAt: OBSERVED_AT,
    requiredStates: ["discovered", "configured", "authenticated", "capabilityCompatible", "policyAdmitted", "routeHealthy"],
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    minimumStateAuthority: "harness-reported",
    requireProbe: false,
  };
  const catalog = normalizeRuntimeProviderDiscoveryCatalog({
    providerId: "codex-oauth",
    family: "direct-provider",
    discovery: { models: ["gpt-5.6-codex"], status: "available", reason: "narrow synthetic discovery grant", authState: "authenticated" },
    observedAt: OBSERVED_AT,
    freshness: "fresh",
  });
  return {
    "codex-oauth": Object.fromEntries(catalog.routes.map((route) => [route.identity.route.providerModelId, {
      catalogDiagnosticEvidence: route,
      catalogDiagnosticDecision: deriveProviderModelEligibility(route, requirements, []),
      provenAccess: ["read-only"],
    }])),
  };
}

function parentAdmission(): EffectiveAuthorityAdmissionBundle {
  const sessionId = "synthetic-parent-session";
  const turnId = canonicalTurnId(sessionId, 1);
  const adoption = createOperatorAdoptionDecisionAuthority({
    ownerSessionId: sessionId,
    operatorTurnId: turnId,
    actorId: "operator:synthetic-workflow",
  });
  const read = readCapability();
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId,
    turnId,
    admittedAt: OBSERVED_AT,
    configuration: {
      sessionRevision: { revisionSetId: "synthetic-managed-child", revisions: { fixture: "session" } },
      turnRevision: { revisionSetId: "synthetic-managed-child", revisions: { fixture: "turn" } },
    },
    session: {
      skillCatalog: { catalogId: "synthetic-managed-child", revision: "fixture", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "Synthetic enclosing Runtime admission." },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "Synthetic enclosing Runtime admission.",
        completeness: "authoritative",
        toolCount: 2,
        deniedToolCount: 0,
        sandboxProjection: "workspace_write",
      },
      capabilityParticipation: { status: "not-requested" },
      workGovernance: { status: "required", kind: "work-item", subjectId: adoption.decisionId, authorityRevision: adoption.decisionId },
      operatorAdoption: { status: "admitted", decision: adoption },
      tools: {
        allowedToolPermissions: [
          { toolName: "kiln_agent_task_submit", authority: { level: 3, allowed: true, requiresApproval: false, reason: "Submit admitted managed work." }, effectEnvelope: { operation: "mutate", boundaries: ["workspace"], reversibility: "compensatable", dataEgress: "none", identityUse: "none", consequences: ["local-state"], idempotency: "conditionally-idempotent" } },
          { toolName: "read", authority: { level: 1, allowed: true, requiresApproval: false, reason: "Child read is explicitly admitted." }, effectEnvelope: read.effectEnvelope! },
        ],
        deniedToolNames: [],
      },
      effectCeiling: { operation: "mutate", boundaries: ["workspace"], reversibility: "compensatable", dataEgress: "none", identityUse: "none", consequences: ["local-state"], idempotency: "conditionally-idempotent" },
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

describe("configured managed-child workflow", () => {
  const tempDirs: string[] = [];
  const envKeys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME"] as const;
  const previousEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
    trace.adapterCreations = 0;
    trace.builtinReads = 0;
    trace.providerRequests = 0;
    trace.bindings.length = 0;
    trace.errors.length = 0;
  });

  it("denies absent discovery and runs one configured direct child through its admitted builtin before releasing the commitment", async () => {
    for (const key of envKeys) previousEnv[key] = process.env[key];
    const home = mkdtempSync(join(tmpdir(), "kiln-managed-child-home-"));
    const project = mkdtempSync(join(tmpdir(), "kiln-managed-child-project-"));
    tempDirs.push(home, project);
    delete process.env.XDG_CONFIG_HOME;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    mkdirSync(join(project, ".git"), { recursive: true });
    const binding = resolveProjectStateBinding(project);
    mkdirSync(binding.projectStateRoot, { recursive: true });
    writeFileSync(binding.configPath, 'version: "1"\n', "utf8");
    bootstrapProjectAdoption(binding);
    mkdirSync(binding.agentsPath, { recursive: true });
    writeFileSync(join(binding.agentsPath, "economic-worker.md"), [
      "---",
      "name: economic-worker",
      "role: Synthetic configured worker",
      "goal: Read only the bounded fixture.",
      "tier: fast",
      "mode: managed-child",
      "targetId: codex-standard",
      "authorityProfileId: readonly-plan",
      "---",
      "Use the configured route.",
    ].join("\n"), "utf8");
    mkdirSync(join(home, ".kiln", "auth", "codex-oauth"), { recursive: true });
    const jwtHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const jwtClaims = Buffer.from(JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" },
    })).toString("base64url");
    writeFileSync(join(home, ".kiln", "auth", "codex-oauth", "codex-credential.json"), JSON.stringify({
      access_token: `${jwtHeader}.${jwtClaims}.`,
      refresh_token: "synthetic-refresh-token",
      expires_at: "2099-01-01T00:00:00.000Z",
      client_id: "synthetic-client",
    }), "utf8");
    mkdirSync(join(home, ".kiln", "auth", "provider-usage"), { recursive: true });
    writeFileSync(join(home, ".kiln", "auth", "provider-usage", "codex-oauth.json"), JSON.stringify([{
      provider: "codex-oauth",
      credentialId: "codex-credential",
      availability: "available",
      observedAt: "2026-08-01T00:00:00.000Z",
      validUntil: "2099-01-01T00:00:00.000Z",
      source: "provider-endpoint",
      confidence: "authoritative",
      exhaustionReason: null,
    }]), "utf8");
    const config = managedAgentIntentConfig();
    persistAdmittedGlobalConfigFixture({
      ...config,
      managedAgents: {
        ...config.managedAgents!,
        intents: config.managedAgents!.intents!.map((intent) => ({ ...intent, paidUsage: { kind: "cap", amount: { atoms: "1000000000", scale: 6, unit: "input-token", scheme: { kind: "currency", currency: "USD" } } } })),
      },
    });

    const denied = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: project,
      projectStateBinding: binding,
      authorityAdmission: parentAdmission(),
      onDispatchError: (error) => trace.errors.push(error),
      discoverProviderModels: async () => ({}),
    });
    try {
      expect(denied.configuredAgents).toEqual(expect.arrayContaining([
        expect.objectContaining({ configuredAgentProfileId: "economic-worker", availability: "unavailable" }),
      ]));
      expect(trace.adapterCreations).toBe(0);
    } finally {
      await denied.close();
    }

    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: project,
      projectStateBinding: binding,
      authorityAdmission: parentAdmission(),
      onDispatchError: (error) => trace.errors.push(error),
      onRefreshError: (error) => { throw error; },
      discoverProviderModels: async () => managedDiscovery(),
    });
    try {
      const accepted = await composition.application.accept({
        objective: "Read the bounded fixture through the configured child.",
        configuredAgentProfileId: "economic-worker",
        callerId: "synthetic-parent",
        idempotencyKey: "configured-managed-child-workflow",
      });
      await composition.close();
      const status = await composition.application.getStatus({ callerId: "synthetic-parent" }, accepted.id);
      const replay = await composition.application.getReplay({ callerId: "synthetic-parent" }, accepted.id);
      expect(status, JSON.stringify({ errors: trace.errors }, null, 2)).toMatchObject({ state: "succeeded", result: { routeId: "codex-standard", providerId: "codex-oauth" } });
      expect(replay).toMatchObject({ lifecycleState: "succeeded", dispatch: { kind: "economic" } });
      expect(trace.adapterCreations).toBe(1);
      expect(trace.bindings).toHaveLength(1);
      expect(trace.builtinReads).toBe(1);
      expect(trace.providerRequests).toBe(2);
      if (accepted.dispatch.kind !== "economic") throw new Error("Expected the configured economic managed-child dispatch.");
      const authority = new SqliteManagedAccountLeaseAuthority({ path: join(binding.runtimePath, "managed-account-leases.sqlite") });
      try {
        expect(authority.createAgentTaskReplayInspectionPort().inspect({
          jobId: accepted.id,
          economicAttemptId: accepted.dispatch.economicAttemptId,
        })).toMatchObject({ status: "released" });
      } finally {
        authority.close();
      }
    } finally {
      await composition.close();
    }
  });
});
