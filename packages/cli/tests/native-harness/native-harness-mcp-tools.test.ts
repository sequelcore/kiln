import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KilnConfigStatusSnapshot } from "@kilnai/gateway-contracts";
import { canonicalTurnId } from "@kilnai/core/events";
import { defineEffectiveAuthorityAdmissionBundle } from "@kilnai/runtime";
import type { AgentTaskDataPolicyProof, AgentTaskRecord, EffectiveAuthorityAdmissionBundle } from "@kilnai/runtime";
import type { AccountUsageInspectionService } from "../../src/application/account-usage-inspection.js";
import { discoverNativeHarnessProjectRoot } from "../../src/application/native-harness-project-root.js";
import {
  NativeHarnessMcpTools,
  createNativeHarnessInspectionService,
} from "../../src/native-harness/native-harness-mcp-tools.js";

const CodexMcpTools = class extends NativeHarnessMcpTools {
  constructor(options: Omit<ConstructorParameters<typeof NativeHarnessMcpTools>[0], "harness">) {
    super({ harness: "codex", ...options, requestIdentity: options.requestIdentity ?? (() => ({ callerId: "test-codex-session" })) });
  }
};

const OBSERVED_AT = "2026-07-13T18:01:00.000Z";
const TEMPORARY_CWD = join(tmpdir(), "kiln-codex-app-mcp-unrelated-cwd");

function effectiveProjection(workGovernance?: unknown): KilnConfigStatusSnapshot["effectiveConfig"] {
  return {
    schemaRevision: 1,
    health: "current",
    fields: workGovernance === undefined ? [] : [{
      identity: "/workGovernance",
      value: workGovernance,
      scope: "effective",
      source: "global",
      sourcePath: "C:\\Users\\operator\\.kiln\\config.yaml",
      defaultStatus: "explicit",
      overrideChain: [{
        scope: "global",
        sourcePath: "C:\\Users\\operator\\.kiln\\config.yaml",
        disposition: "selected",
      }],
      health: "current",
      schemaRevision: 1,
      activation: "next-turn",
      sensitivity: "public",
    }],
  };
}

function nativeHarnessDispatchFixture(overrides: {
  readonly routeId?: string;
  readonly providerId?: string;
  readonly model?: string;
} = {}) {
  const routeId = overrides.routeId ?? "route-go";
  const providerId = overrides.providerId ?? "opencode-go";
  const model = overrides.model ?? "go-test";
  return {
    kind: "native-harness" as const,
    routeId,
    routeRevision: "r1",
    providerId,
    model,
    admissionProfileId: "foundation-readonly-plan" as const,
    adapterCapabilityId: "opencode-cli",
    adapterCapabilityVersion: "v1",
    acknowledgement: {
      version: 1 as const,
      source: "managed-route-admission" as const,
      credentialMode: "credentialless" as const,
      acknowledgedAt: OBSERVED_AT,
      routeId,
      routeRevision: "r1",
      providerId,
      model,
      admissionProfileId: "foundation-readonly-plan" as const,
      adapterCapabilityId: "opencode-cli",
      adapterCapabilityVersion: "v1",
    },
  };
}

function snapshot(overrides: Partial<KilnConfigStatusSnapshot> = {}): KilnConfigStatusSnapshot {
  return {
    evidenceVersion: 4,
    generatedAt: "2026-07-13T18:00:00.000Z",
    project: {
      rootPath: "C:\\workspace\\kiln",
      projectName: "kiln",
      hasGitRoot: true,
      kilnYaml: { path: "C:\\workspace\\kiln\\.kiln\\kiln.yaml", status: "valid" },
      projectContext: { path: "C:\\workspace\\kiln\\.kiln\\project-context.md", status: "valid" },
    },
    global: { path: "C:\\Users\\operator\\.kiln\\config.yaml", status: "valid" },
    effectiveConfigStatus: "valid",
    effectiveConfig: effectiveProjection({
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map", "tests"],
    }),
    errors: [],
    projections: [],
    permissionIntegrity: [],
    mcp: { servers: [], diagnostics: [] },
    setup: {
      projectRoot: "C:\\workspace\\kiln",
      projectContext: { path: "C:\\workspace\\kiln\\.kiln\\project-context.md", status: "valid", recommendation: "none" },
      projectInstructions: [],
      workflowSnapshots: [],
      globalInstructionShims: [],
      nativeProjections: [],
      permissionIntegrity: [],
      skillDiagnostics: { state: "current", observedAt: "2026-07-01T00:00:00.000Z" },
      recommendedActions: ["none"],
    },
    harnessCapabilities: [{
      harness: "codex",
      displayName: "Codex",
      runtimeConfigInjection: "supported",
      nativeProjection: "install-state",
      nativeConfigImport: "supported",
      mcpRuntimeTools: "supported",
      hooks: "supported",
    }],
    ...overrides,
  };
}

function economicAdmissionBundle(): EffectiveAuthorityAdmissionBundle {
  const turnId = canonicalTurnId("economic-session", 1);
  const revision = { revisionSetId: "economic-session-revision", revisions: { routes: "test" } } as const;
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "economic-session",
    turnId,
    admittedAt: OBSERVED_AT,
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "test-skills", revision: "test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "test", subjectId: "economic-session" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "test",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      },
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

function createServer(
  status = snapshot(),
  options: Omit<Parameters<typeof createNativeHarnessInspectionService>[0], "harness"> = {},
): NativeHarnessMcpTools {
  return new CodexMcpTools({
    inspection: createNativeHarnessInspectionService({
      harness: "codex",
      readStatus: async () => status,
      readBridgeProjection: async () => "current",
      readProjectRoot: async () => ({ status: "resolved", rootPath: "C:\\workspace\\kiln" }),
      now: () => new Date(OBSERVED_AT),
      ...options,
    }),
  });
}

function agentTask(overrides: Partial<AgentTaskRecord> = {}): AgentTaskRecord {
  const state = overrides.state ?? "succeeded";
  const admissionBundle = economicAdmissionBundle();
  const dispatch = {
    kind: "economic" as const,
    economicAttemptId: "economic-attempt:test-0001",
    economicPolicyId: "economy-policy",
    economicPolicyRevision: "revision-001",
    admissionBundle,
    constraints: {},
    candidateSet: {
      economicPolicyId: "economy-policy",
      economicPolicyRevision: "revision-001",
      admissionProfileId: "foundation-readonly-plan" as const,
      constraints: {},
      candidates: [{
        routeId: "route-go",
        routeSource: "explicit-managed-route" as const,
        providerId: "opencode-go",
        surface: "direct-provider" as const,
        adapterCapabilityId: "opencode-go-direct",
        adapterCapabilityVersion: "1",
        profileAuthorityDigest: `sha256:${"9".repeat(64)}`,
      }],
      rejections: [],
    },
  };
  return {
    version: 15,
    id: "agent-task-0001",
    adoptedDecisionAt: OBSERVED_AT,
    state,
    objective: "Inspect bounded work.",
    projectId: "trusted-project",
    callerId: "trusted-codex-user",
    configuredAgentProfileId: "scout",
    admissionProfileId: "foundation-readonly-plan",
    dispatch,
    governanceSource: "kiln-governance",
    admissionId: admissionBundle.admissionId,
    admissionBundle,
    requestFingerprint: `sha256:${"a".repeat(64)}`,
    idempotencyKeyHash: `sha256:${"b".repeat(64)}`,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    lifecycle: [{ sequence: 1, state, observedAt: OBSERVED_AT }],
    ...(state === "succeeded" ? {
      result: {
        version: 1,
        jobId: "agent-task-0001",
        runtimeInvocationId: "runtime-invocation-0001",
        configuredAgentProfileId: "scout",
        admissionProfileId: "foundation-readonly-plan",
        routeId: "route-go",
        providerId: "opencode-go",
        terminalState: "completed",
        completedAt: OBSERVED_AT,
        provenance: { source: "runtime-managed-invocation", trust: "untrusted-child-output" },
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output",
            configuredModelId: "test-model",
            primaryObservedModelId: "test-model",
            observedModelIds: ["test-model"],
            harness: { id: "opencode", executable: "<operator-harness>/opencode", version: "1.0.0" },
          },
          summary: "Managed work completed.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
        dataPolicyProof: {
          version: 1,
          jobId: "agent-task-0001",
          dispatchFenceId: "fence-safe-001",
          routeId: "route-go",
          providerId: "opencode-go",
          providerModelId: "go-test",
          decision: { status: "admitted" as const, freshness: "current" as const, reason: "policy-admitted" as const },
          evidence: {
            providerId: "opencode-go",
            providerModelId: "go-test",
            sourceIdentity: "fixture",
            sourceRevision: "rev-1",
            sourceDigest: `sha256:${"a".repeat(64)}`,
            trainingPosture: "prohibited" as const,
            retentionPosture: "zero" as const,
            retentionDays: 0,
            maximumClassification: "internal" as const,
            observedAt: OBSERVED_AT,
            expiresAt: "2027-07-13T18:01:00.000Z",
          },
        },
      },
    } : {}),
    ...overrides,
    run: {
      runId: "run-0001",
      state: overrides.state ?? state,
      dispatch: overrides.dispatch ?? dispatch,
    },
  };
}

function economicAgentTask(): AgentTaskRecord {
  return agentTask({
    id: "agent-task-economic-0001",
    state: "failed",
    diagnostic: "economic_commitment_unavailable",
    lifecycle: [{
      sequence: 1,
      state: "failed",
      observedAt: OBSERVED_AT,
      diagnostic: "economic_commitment_unavailable",
    }],
  });
}

describe("NativeHarnessMcpTools", () => {
  it.each(["codex", "claude", "opencode"] as const)("uses trusted %s identity in agent-task evidence", async (harness) => {
    const server = new NativeHarnessMcpTools({
      harness,
      inspection: createNativeHarnessInspectionService({ harness }),
      requestIdentity: () => ({ callerId: `test-${harness}-session` }),
      agentTasks: {
        accept: async () => agentTask(),
        getStatus: async () => agentTask(),
        getResult: async () => ({ jobId: "agent-task-0001", availability: "pending", lifecycleState: "running", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go" }),
        cancel: async () => agentTask(),
        getReplay: async () => ({ jobId: "agent-task-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", dispatch: nativeHarnessDispatchFixture(), diagnostic: "replay_unavailable" }),
      },
    });

    await expect(server.callTool("kiln_agent_task_status", { jobId: "agent-task-0001" })).resolves.toMatchObject({
      structuredContent: {
        evidence: {
          harness,
          adapter: "global-operator-runtime-mcp",
          callerId: `test-${harness}-session`,
        },
      },
    });
    expect(server.listTools().map((tool) => tool.name)).toContain("kiln_agent_task_submit");
  });

  it("fails closed when the trusted AgentTask caller identity cannot be resolved", async () => {
    const getStatus = vi.fn(async () => agentTask());
    const server = new CodexMcpTools({
      agentTasks: {
        accept: async () => agentTask(),
        getStatus,
        getResult: async () => ({ jobId: "agent-task-0001", availability: "pending", lifecycleState: "running", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan" }),
        cancel: async () => agentTask(),
        getReplay: async () => ({ jobId: "agent-task-0001", availability: "unavailable", lifecycleState: "running", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", lifecycle: [], resultAvailability: "unavailable", dispatch: nativeHarnessDispatchFixture() }),
      },
      requestIdentity: () => { throw new Error("identity unavailable"); },
    });

    await expect(server.callTool("kiln_agent_task_status", { jobId: "agent-task-0001" })).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_AGENT_TASK_IDENTITY_UNAVAILABLE" } },
    });
    expect(getStatus).not.toHaveBeenCalled();
  });

  afterEach(() => {
    rmSync(TEMPORARY_CWD, { recursive: true, force: true });
  });
  it("discovers inspection, settings, and agent-task tools", () => {
    expect(createServer().listTools().map((tool) => tool.name)).toEqual([
      "kiln_status_inspect",
      "kiln_work_governance_inspect",
      "kiln_capability_inspect",
      "kiln_account_usage_inspect",
      "kiln_settings_read",
      "kiln_settings_propose",
      "kiln_settings_apply",
      "kiln_agent_task_submit",
      "kiln_agent_task_status",
      "kiln_agent_task_result",
      "kiln_agent_task_cancel",
      "kiln_agent_task_replay",
    ]);
  });

  it.each(["codex", "claude", "opencode"] as const)("forwards one typed settings operation unchanged for %s", async (harness) => {
    const request = {
      operation: "setting.set" as const,
      scope: "project" as const,
      key: "domain",
      expectedRevision: "absent" as const,
      value: "backend",
    };
    const propose = vi.fn(() => ({ proposalId: "cfg_settings" }) as never);
    const apply = vi.fn(async () => ({ outcome: "committed" }) as never);
    const server = new NativeHarnessMcpTools({
      harness,
      requestIdentity: () => ({ callerId: `test-${harness}-settings` }),
      settings: { read: async () => ({ entries: [] }) as never, propose, apply },
    });

    await expect(server.callTool("kiln_settings_propose", request)).resolves.toMatchObject({
      structuredContent: {
        operation: "settings-propose",
        result: { proposalId: "cfg_settings" },
        evidence: { harness, callerId: `test-${harness}-settings` },
      },
    });
    expect(propose).toHaveBeenCalledWith(request);

    await expect(server.callTool("kiln_settings_apply", { proposalId: "cfg_settings" })).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_SETTINGS_APPROVAL_REQUIRED" } },
    });
    expect(apply).not.toHaveBeenCalled();

    await server.callTool("kiln_settings_apply", { proposalId: "cfg_settings", approvalId: "approval-1" });
    expect(apply).toHaveBeenCalledWith({ proposalId: "cfg_settings", approvalId: "approval-1" }, "model");
  });

  it("returns sanitized account usage without accepting account selection arguments", async () => {
    const inspect = vi.fn<AccountUsageInspectionService["inspect"]>(async () => ({
      operation: "account-usage",
      accounts: [{ provider: "codex-oauth", accountId: "plus", credentialId: "opaque-id", plan: "plus", availability: "available", freshness: "fresh", evidenceState: "fresh", source: "provider-endpoint", confidence: "authoritative", operatorAction: "none", eligibleTargets: ["codex-managed"] }],
      evidence: { authority: "global-execution-catalog", observedAt: OBSERVED_AT },
    }));
    const server = new NativeHarnessMcpTools({ harness: "codex", accountUsage: { inspect } });
    const result = await server.callTool("kiln_account_usage_inspect", {});
    expect(result.structuredContent).toMatchObject({ accounts: [{ credentialId: "opaque-id", eligibleTargets: ["codex-managed"] }] });
    expect(JSON.stringify(result)).not.toMatch(/token|email|path|raw/i);
    await expect(server.callTool("kiln_account_usage_inspect", { credentialId: "opaque-id" })).resolves.toMatchObject({ isError: true });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("publishes a stable invoke schema without exposing route configuration", () => {
    const server = new CodexMcpTools({});
    const tool = server.listTools().find((candidate) => candidate.name === "kiln_agent_task_submit");

    expect(tool?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["objective", "configuredAgentProfileId", "idempotencyKey"],
      properties: {
        configuredAgentProfileId: { type: "string", minLength: 1, maxLength: 200 },
        capability: {
          properties: {
            capabilityId: { const: "vision.analyze" },
            contract: { const: "vision.analyze/v1" },
          },
        },
      },
    });
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("route");
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("foundation-readonly-plan");
  });

  it("projects only trusted request identity into the canonical agent-task acceptance", async () => {
    const accepted: unknown[] = [];
    const server = new CodexMcpTools({
      inspection: createNativeHarnessInspectionService({ harness: "codex" }),
      agentTasks: {
        accept: async (input) => { accepted.push(input); return agentTask(); },
        getStatus: async () => agentTask(),
        getResult: async () => ({ jobId: "agent-task-0001", availability: "available", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", handoff: { provenance: { delivery: "native-structured-output", configuredModelId: "go-test", primaryObservedModelId: "go-test", observedModelIds: ["go-test"], harness: { id: "opencode", executable: "<operator-harness>/opencode", version: "1.0.0" } }, summary: "done", resourceUris: [], memoryWriteProposalUris: [] } }),
        cancel: async () => agentTask({ state: "cancelled", diagnostic: "cancelled" }),
        getReplay: async () => ({ jobId: "agent-task-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", dispatch: nativeHarnessDispatchFixture(), diagnostic: "replay_unavailable" }),
      },
      requestIdentity: () => ({ callerId: "trusted-codex-user", requestId: "trusted-request" }),
    });

    const result = await server.callTool("kiln_agent_task_submit", {
      objective: "  inspect bounded work  ",
      configuredAgentProfileId: "scout",
      idempotencyKey: "retry-1",
      capability: {
        capabilityId: "vision.analyze",
        contract: "vision.analyze/v1",
        input: {
          resourceUris: ["kiln://project/artifacts/image-1"],
          instruction: "Summarize the visible evidence.",
        },
      },
    });
    expect(accepted).toEqual([{
      objective: "inspect bounded work",
      configuredAgentProfileId: "scout",
      idempotencyKey: "retry-1",
      capability: {
        capabilityId: "vision.analyze",
        contract: "vision.analyze/v1",
        input: {
          resourceUris: ["kiln://project/artifacts/image-1"],
          instruction: "Summarize the visible evidence.",
        },
      },
      callerId: "trusted-codex-user",
    }]);
    expect(result.structuredContent).toMatchObject({
      accepted: true,
      completionChannel: "status-result-replay",
      job: { id: "agent-task-0001", routeId: "route-go", state: "succeeded" },
      evidence: { callerId: "trusted-codex-user", requestId: "trusted-request" },
    });
    expect(JSON.stringify(result)).not.toContain("objective");
  });

  it("projects a failed V10 job without fabricating route or provider identity", async () => {
    const server = new CodexMcpTools({
      agentTasks: {
        accept: async () => economicAgentTask(),
        getStatus: async () => economicAgentTask(),
        getResult: async () => ({
          jobId: "agent-task-economic-0001",
          availability: "failed",
          lifecycleState: "failed",
          configuredAgentProfileId: "scout",
          admissionProfileId: "foundation-readonly-plan",
          diagnostic: "economic_commitment_unavailable",
        }),
        cancel: async () => economicAgentTask(),
        getReplay: async () => ({
          jobId: "agent-task-economic-0001",
          availability: "unavailable",
          lifecycleState: "failed",
          configuredAgentProfileId: "scout",
          admissionProfileId: "foundation-readonly-plan",
          lifecycle: [],
           resultAvailability: "failed",
           dispatch: nativeHarnessDispatchFixture(),
          diagnostic: "replay_unavailable",
        }),
      },
      requestIdentity: () => ({
        callerId: "trusted-codex-user",
        requestId: "trusted-request",
      }),
    });

    const result = await server.callTool("kiln_agent_task_submit", {
      objective: "Inspect bounded work.",
      configuredAgentProfileId: "scout",
      idempotencyKey: "retry-economic",
    });

    expect(result.structuredContent).toMatchObject({
      job: {
        dispatch: {
          kind: "economic",
          economicPolicyId: "economy-policy",
          economicPolicyRevision: "revision-001",
          constraints: {},
        },
        diagnostic: {
          code: "economic_commitment_unavailable",
          operatorAction: "Wait until the configured economic commitment authority is available.",
        },
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("routeId");
    expect(JSON.stringify(result.structuredContent)).not.toContain("providerId");
  });

  it("projects the same sanitized terminal failure evidence through status, result, and replay", async () => {
    const failureEvidence = {
      version: 1 as const,
      classification: "structured_handoff_rejected" as const,
      diagnosticUri: "kiln://diagnostics/agent-tasks/structured-handoff-rejected",
    };
    const failed = agentTask({
      state: "failed",
      diagnostic: "invocation_failed",
      failureEvidence,
      lifecycle: [{
        sequence: 1,
        state: "failed",
        observedAt: OBSERVED_AT,
        diagnostic: "invocation_failed",
        failureEvidence,
      }],
    });
    const server = new CodexMcpTools({
      agentTasks: {
        accept: async () => failed,
        getStatus: async () => failed,
        getResult: async () => ({
          jobId: failed.id,
          availability: "failed",
          lifecycleState: "failed",
          configuredAgentProfileId: failed.configuredAgentProfileId,
          admissionProfileId: failed.admissionProfileId,
          diagnostic: "invocation_failed",
          failureEvidence,
        }),
        cancel: async () => failed,
        getReplay: async () => ({
          jobId: failed.id,
          availability: "available",
          lifecycleState: "failed",
          configuredAgentProfileId: failed.configuredAgentProfileId,
          admissionProfileId: failed.admissionProfileId,
          lifecycle: failed.lifecycle,
          resultAvailability: "failed",
          dispatch: {
            kind: "native-harness",
            routeId: "route-claude",
            routeRevision: "revision-001",
            providerId: "claude",
            model: "claude-concrete-model",
            admissionProfileId: "foundation-readonly-plan",
            adapterCapabilityId: "claude-cli",
            adapterCapabilityVersion: "1",
            acknowledgement: {
              version: 1,
              source: "managed-route-admission",
              credentialMode: "credentialless",
              acknowledgedAt: OBSERVED_AT,
              routeId: "route-claude",
              routeRevision: "revision-001",
              providerId: "claude",
              model: "claude-concrete-model",
              admissionProfileId: "foundation-readonly-plan",
              adapterCapabilityId: "claude-cli",
              adapterCapabilityVersion: "1",
            },
          },
          diagnostic: "invocation_failed",
          failureEvidence,
        }),
      },
    });

    const [status, result, replay] = await Promise.all([
      server.callTool("kiln_agent_task_status", { jobId: failed.id }),
      server.callTool("kiln_agent_task_result", { jobId: failed.id }),
      server.callTool("kiln_agent_task_replay", { jobId: failed.id }),
    ]);
    const projected = [
      (status.structuredContent as { job: { failureEvidence?: unknown } }).job.failureEvidence,
      (result.structuredContent as { result: { failureEvidence?: unknown } }).result.failureEvidence,
      (replay.structuredContent as { replay: { failureEvidence?: unknown } }).replay.failureEvidence,
    ];
    expect(projected).toEqual([failureEvidence, failureEvidence, failureEvidence]);
    expect(JSON.stringify([status, result, replay])).not.toMatch(/raw provider payload|secret-token|C:\\operator/i);
  });

  it("projects trusted cancellation and canonical lifecycle replay without accepting caller authority or prose", async () => {
    const calls: unknown[] = [];
    const server = new CodexMcpTools({
      agentTasks: {
        accept: async () => agentTask({ state: "running" }),
        getStatus: async () => agentTask({ state: "running" }),
        getResult: async () => ({ jobId: "agent-task-0001", availability: "failed", lifecycleState: "cancelled", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", diagnostic: "cancelled" }),
        cancel: async (input, jobId) => { calls.push({ operation: "cancel", input, jobId }); return agentTask({ state: "cancelled", diagnostic: "cancelled" }); },
        getReplay: async (input, jobId) => {
          calls.push({ operation: "replay", input, jobId });
          return {
            jobId,
            availability: "available",
            lifecycleState: "cancelled",
            configuredAgentProfileId: "scout",
            admissionProfileId: "foundation-readonly-plan",
            routeId: "route-go",
            providerId: "opencode-go",
            lifecycle: [
              { sequence: 1, state: "queued", observedAt: OBSERVED_AT },
              { sequence: 2, state: "running", observedAt: OBSERVED_AT },
              { sequence: 3, state: "cancelled", observedAt: OBSERVED_AT, diagnostic: "cancelled" },
            ],
            resultAvailability: "failed",
            dispatch: {
              kind: "economic",
              economic: {
                availability: "available",
                snapshot: {
                  evidenceVersion: 1,
                  status: "dispatch-fenced",
                  policyId: "economy-policy",
                  policyRevision: "revision-001",
                  policyDigest: `sha256:${"a".repeat(64)}`,
                  commitmentId: "commitment-safe-001",
                  reservationId: "reservation-safe-001",
                  dispatchFenceId: "fence-safe-001",
                  selectedRoute: { routeId: "route-go", providerId: "opencode-go", modelId: "go-test", adapterCapabilityId: "opencode-direct", adapterCapabilityVersion: "1" },
                  selectedAccount: { kind: "account-bound", capacityIdentity: "pool-safe", creditPosture: "committed", overagePosture: "disabled" },
                  settlementKind: "charged",
                  settlementAuthority: "configured",
                },
              },
            },
          };
        },
      },
      requestIdentity: () => ({ callerId: "trusted-codex-user", requestId: "lifecycle-request" }),
    });

    const cancelled = await server.callTool("kiln_agent_task_cancel", { jobId: "agent-task-0001" });
    const replay = await server.callTool("kiln_agent_task_replay", { jobId: "agent-task-0001" });

    expect(calls).toEqual([
      { operation: "cancel", input: { callerId: "trusted-codex-user" }, jobId: "agent-task-0001" },
      { operation: "replay", input: { callerId: "trusted-codex-user" }, jobId: "agent-task-0001" },
    ]);
    expect(cancelled.structuredContent).toMatchObject({ operation: "agent-task-cancel", job: { state: "cancelled" } });
    expect(replay.structuredContent).toMatchObject({
      operation: "agent-task-replay",
      replay: {
        availability: "available",
        lifecycle: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }],
        dispatch: {
          kind: "economic",
          economic: {
            availability: "available",
            snapshot: {
              evidenceVersion: 1,
              status: "dispatch-fenced",
              policyDigest: `sha256:${"a".repeat(64)}`,
              commitmentId: "commitment-safe-001",
              reservationId: "reservation-safe-001",
              dispatchFenceId: "fence-safe-001",
              selectedRoute: { routeId: "route-go", adapterCapabilityId: "opencode-direct" },
              settlementKind: "charged",
              settlementAuthority: "configured",
            },
          },
        },
      },
    });
    expect(JSON.stringify(replay)).not.toMatch(/objective|prompt|transcript|provider payload|credential|accountRef|amount/iu);
    await expect(server.callTool("kiln_agent_task_cancel", { jobId: "agent-task-0001", reason: "override" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
  });

  it("rejects unknown invoke fields and malformed status or result identifiers before the application owner", async () => {
    let calls = 0;
    const server = new CodexMcpTools({ agentTasks: { accept: async () => { calls++; return agentTask(); }, getStatus: async () => { calls++; return agentTask(); }, getResult: async () => { calls++; return { jobId: "agent-task-0001", availability: "pending", lifecycleState: "running", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go" }; }, cancel: async () => { calls++; return agentTask(); }, getReplay: async () => { calls++; return { jobId: "agent-task-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", dispatch: nativeHarnessDispatchFixture(), diagnostic: "replay_unavailable" }; } } });
    await expect(server.callTool("kiln_agent_task_submit", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key", provider: "opencode-go" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_agent_task_submit", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key", admissionProfileId: "foundation-readonly-plan" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_agent_task_status", { jobId: "not valid" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_agent_task_result", { jobId: "not valid" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    expect(calls).toBe(0);
  });

  it("maps application diagnostics without exposing internal error text", async () => {
    const server = new CodexMcpTools({ agentTasks: { accept: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "provider_rejected" }); }, getStatus: async () => agentTask(), getResult: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "result_corrupt" }); }, cancel: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "invocation_failed" }); }, getReplay: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "job_persistence_corrupt" }); } } });
    const result = await server.callTool("kiln_agent_task_submit", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key" });
    expect(result).toMatchObject({ isError: true, structuredContent: { error: { code: "provider_rejected" } } });
    expect(JSON.stringify(result)).not.toContain("secrets");
  });

  it("projects an authorized bounded canonical result without accepting authority or raw-output inputs", async () => {
    const reads: unknown[] = [];
    const server = new CodexMcpTools({
      agentTasks: {
        accept: async () => agentTask(),
        getStatus: async () => agentTask(),
        getResult: async (input, jobId) => {
          reads.push({ input, jobId });
          return {
            jobId,
            availability: "available",
            lifecycleState: "succeeded",
            configuredAgentProfileId: "scout",
            admissionProfileId: "foundation-readonly-plan",
            routeId: "route-go",
            providerId: "opencode-go",
            completedAt: OBSERVED_AT,
            provenance: { source: "runtime-managed-invocation", trust: "untrusted-child-output" },
            handoff: { provenance: { delivery: "native-structured-output", configuredModelId: "go-test", primaryObservedModelId: "go-test", observedModelIds: ["go-test"], harness: { id: "opencode", executable: "<operator-harness>/opencode", version: "1.0.0" } }, summary: "bounded child answer", resourceUris: ["kiln://artifacts/agent-task-0001/result"], memoryWriteProposalUris: [] },
            dataPolicyProof: {
              version: 1, jobId, dispatchFenceId: "fence-safe-001", routeId: "route-go", providerId: "opencode-go", providerModelId: "go-test",
              decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
              evidence: { providerId: "opencode-go", providerModelId: "go-test", sourceIdentity: "fixture", sourceRevision: "rev-1", sourceDigest: `sha256:${"a".repeat(64)}`, trainingPosture: "prohibited", retentionPosture: "zero", retentionDays: 0, maximumClassification: "internal", observedAt: OBSERVED_AT, expiresAt: "2027-07-13T18:01:00.000Z" },
            },
          };
        },
        cancel: async () => agentTask({ state: "cancelled", diagnostic: "cancelled" }),
        getReplay: async () => ({ jobId: "agent-task-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", dispatch: nativeHarnessDispatchFixture(), diagnostic: "replay_unavailable" }),
      },
      requestIdentity: () => ({ callerId: "trusted-codex-user", requestId: "result-request" }),
    });
    const result = await server.callTool("kiln_agent_task_result", { jobId: "agent-task-0001" });
    expect(reads).toEqual([{ input: { callerId: "trusted-codex-user" }, jobId: "agent-task-0001" }]);
    expect(result.structuredContent).toMatchObject({ operation: "agent-task-result", result: { availability: "available", provenance: { trust: "untrusted-child-output" }, handoff: { summary: "bounded child answer" }, dataPolicyProof: { routeId: "route-go", decision: { status: "admitted" } } } });
    await expect(server.callTool("kiln_agent_task_result", { jobId: "agent-task-0001", transcript: "no" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    expect(JSON.stringify(result)).not.toContain("objective");
  });

  it("projects the exact sanitized data-policy proof through status, result, and replay", async () => {
    const proof: AgentTaskDataPolicyProof = {
      version: 1 as const, jobId: "agent-task-0001", dispatchFenceId: "fence-safe-001", routeId: "route-go", providerId: "opencode-go", providerModelId: "go-test",
      decision: { status: "admitted" as const, freshness: "current" as const, reason: "policy-admitted" as const },
      evidence: { providerId: "opencode-go", providerModelId: "go-test", sourceIdentity: "fixture", sourceRevision: "rev-1", sourceDigest: `sha256:${"a".repeat(64)}`, trainingPosture: "prohibited" as const, retentionPosture: "zero" as const, retentionDays: 0, maximumClassification: "internal" as const, observedAt: OBSERVED_AT, expiresAt: "2027-07-13T18:01:00.000Z" },
    };
    const server = new CodexMcpTools({ agentTasks: {
      accept: async () => agentTask(),
      getStatus: async () => agentTask({ result: { routeId: "route-go", providerId: "opencode-go", dataPolicyProof: proof } } as never),
      getResult: async () => ({ jobId: "agent-task-0001", availability: "available", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", dataPolicyProof: proof }),
      cancel: async () => agentTask(),
       getReplay: async () => ({ jobId: "agent-task-0001", availability: "available", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "available" as const, dispatch: nativeHarnessDispatchFixture(), dataPolicyProof: proof }),
    } });
    for (const name of ["kiln_agent_task_status", "kiln_agent_task_result", "kiln_agent_task_replay"] as const) {
      const response = await server.callTool(name, { jobId: "agent-task-0001" });
      expect(JSON.stringify(response.structuredContent)).toContain('"dataPolicyProof"');
      expect(JSON.stringify(response.structuredContent)).toContain('"routeId":"route-go"');
      expect(JSON.stringify(response.structuredContent)).not.toContain("objective");
    }
  });

  it("returns curated canonical status with Codex App evidence and no config paths", async () => {
    const result = await createServer().callTool("kiln_status_inspect", {});

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      operation: "status",
      evidence: {
        harness: { kind: "native-harness", harness: "codex", channel: "control-plane" },
        authoritySource: "kiln-config-status",
        directProviderAuthority: "kiln-runtime",
        nativeHarnessPermissionAuthority: "native-harness-only",
        observedAt: "2026-07-13T18:00:00.000Z",
      },
      status: { projectName: "kiln", effectiveConfigStatus: "valid" },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("C:\\Users");
    expect(result.content[0]?.text).toBe(JSON.stringify(result.structuredContent));
  });

  it("returns the resolved governance policy without invoking work-item tools", async () => {
    const result = await createServer().callTool("kiln_work_governance_inspect", {});

    expect(result.structuredContent).toMatchObject({
      operation: "work-governance",
      policy: { defaultPosture: "orchestrate" },
    });
  });

  it("reports capability availability from the canonical capability projection", async () => {
    const result = await createServer().callTool("kiln_capability_inspect", {});

    expect(result.structuredContent).toMatchObject({
      operation: "capability",
      capability: { availability: "available", capabilitySource: "kiln-harness-integration-capabilities" },
    });
  });

  it("projects only safe configured-agent admission summaries through capability inspection", async () => {
    const result = await createServer(snapshot(), {
      managedAgents: [{
        configuredAgentProfileId: "scout",
        availability: "unavailable",
        providerFamily: "opencode-go",
        admissionProfileId: "foundation-readonly-plan",
        diagnostic: "route_unavailable",
        operatorAction: "Restore the configured route hint for this agent.",
      }],
    }).callTool("kiln_capability_inspect", {});

    expect(result.structuredContent).toMatchObject({
      capability: {
        managedAgents: [{
          configuredAgentProfileId: "scout",
          availability: "unavailable",
          providerFamily: "opencode-go",
          admissionProfileId: "foundation-readonly-plan",
          diagnostic: "route_unavailable",
        }],
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("model");
  });

  it("fails closed when a managed-agent summary contains noncanonical metadata", async () => {
    const result = await createServer(snapshot(), {
      managedAgents: [{
        configuredAgentProfileId: "scout",
        availability: "unresolved",
        providerFamily: "opencode-go",
        admissionProfileId: "foundation-readonly-plan",
        diagnostic: "eligibility_unresolved",
      }, {
        configuredAgentProfileId: "poisoned-agent",
        availability: "admitted",
        providerFamily: "C:\\secret-model",
        admissionProfileId: "foundation-readonly-plan",
      } as never],
    }).callTool("kiln_capability_inspect", {});
    expect(result.structuredContent).toMatchObject({
      capability: { managedAgents: [{ configuredAgentProfileId: "scout", availability: "unresolved" }] },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("poisoned-agent");
    expect(JSON.stringify(result.structuredContent)).not.toContain("secret-model");
  });

  it("fails closed for malformed input, unsupported operations, and mutation attempts", async () => {
    await expect(createServer().callTool("kiln_status_inspect", { extra: true })).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_TOOL_INVALID_REQUEST" } },
    });
    await expect(createServer().callTool("unknown", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_TOOL_UNSUPPORTED" } },
    });
    await expect(createServer().callTool("managed_agent.invoke", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_TOOL_READ_ONLY" } },
    });
  });

  it("returns the live stale-projection condition as a degraded, actionable status snapshot", async () => {
    const stale = await createServer(snapshot({ projections: [{ targetId: "codex-global-instructions", path: "secret-path", kind: "global-instruction-shim", status: "stale" }] })).callTool("kiln_status_inspect", {});

    expect(stale).toMatchObject({
      structuredContent: {
        operation: "status",
        status: { completeness: "degraded" },
        diagnostics: [expect.objectContaining({ code: "KILN_PROJECTION_STALE", targetId: "codex-global-instructions" })],
      },
    });
    expect(JSON.stringify(stale)).not.toContain("secret-path");
  });

  it("refuses governance authority while returning a typed diagnostic envelope", async () => {
    const result = await createServer(snapshot({ effectiveConfig: effectiveProjection() })).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { operation: "work-governance", authority: "unresolved", diagnostics: [expect.objectContaining({ code: "KILN_GOVERNANCE_EVIDENCE_MALFORMED" })] },
    });
  });

  it("rejects malformed resolved governance policy instead of authorizing it", async () => {
    const malformed = snapshot({
      effectiveConfig: effectiveProjection({
          defaultPosture: "direct",
          requireDelegationFor: ["not-a-trigger"],
          requiredEvidence: ["surface-map"],
      }),
    });

    const result = await createServer(malformed).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "work-governance",
        authority: "unresolved",
        diagnostics: [expect.objectContaining({ code: "KILN_GOVERNANCE_EVIDENCE_MALFORMED" })],
      },
    });
    expect(JSON.stringify(result)).not.toContain("not-a-trigger");
  });

  it.each([
    ["missing required discriminants", { defaultPosture: "direct" }],
    ["unknown authority field", { defaultPosture: "direct", directExecution: { maxFiles: 1 }, requireDelegationFor: [], requiredEvidence: [] }],
    ["duplicated authority trigger", { defaultPosture: "direct", requireDelegationFor: ["security", "security"], requiredEvidence: [] }],
    ["unsupported evidence", { defaultPosture: "direct", requireDelegationFor: [], requiredEvidence: ["operator-says-so"] }],
  ])("rejects %s governance evidence", async (_, workGovernance) => {
    const result = await createServer(snapshot({ effectiveConfig: effectiveProjection(workGovernance) })).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { authority: "unresolved", diagnostics: [expect.objectContaining({ code: "KILN_GOVERNANCE_EVIDENCE_MALFORMED" })] },
    });
  });

  it("returns observed capabilities while classifying bridge and projection evidence as unresolved", async () => {
    const inspection = createNativeHarnessInspectionService({
      harness: "codex",
      readStatus: async () => snapshot({ projections: [{ targetId: "codex-config", path: "ignored", kind: "native", status: "drifted" }] }),
      readBridgeProjection: async () => "invalid",
      readProjectRoot: async () => ({ status: "resolved", rootPath: "C:\\workspace\\kiln" }),
      now: () => new Date(OBSERVED_AT),
    });
    const result = await new CodexMcpTools({ inspection }).callTool("kiln_capability_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "capability",
        capability: { availability: "unresolved" },
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "KILN_BRIDGE_PROJECTION_UNRESOLVED" })]),
      },
    });
  });

  it("keeps independently observed Codex capability available when an unrelated projection is stale", async () => {
    const result = await createServer(snapshot({
      projections: [{ targetId: "claude-global-instructions", path: "ignored", kind: "global-instruction-shim", status: "stale" }],
    })).callTool("kiln_capability_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "capability",
        capability: { availability: "available", bridgeProjection: "current" },
        diagnostics: [expect.objectContaining({ code: "KILN_PROJECTION_STALE", targetId: "claude-global-instructions" })],
      },
    });
  });

  it("returns a typed unresolved capability envelope when the bridge read fails", async () => {
    const result = await createServer(snapshot(), {
      readBridgeProjection: async () => {
        throw new Error("C:\\secrets\\config.toml token=super-secret");
      },
    }).callTool("kiln_capability_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        operation: "capability",
        capability: { availability: "unresolved" },
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "KILN_BRIDGE_READ_FAILED" })]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("C:\\secrets");
  });

  it("fails closed for malformed canonical evidence and never reflects secrets", async () => {
    const result = await createServer(snapshot({ errors: ["token=super-secret"] })).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { operation: "status", status: { completeness: "degraded" }, diagnostics: [expect.objectContaining({ code: "KILN_STATUS_EVIDENCE_INCOMPLETE" })] },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("reports a missing inspection owner through a stable unresolved envelope", async () => {
    const server = new CodexMcpTools({ inspection: createNativeHarnessInspectionService({
      harness: "codex",
      readStatus: null,
      readBridgeProjection: async () => "current",
      readProjectRoot: async () => ({ status: "resolved", rootPath: "C:\\workspace\\kiln" }),
      now: () => new Date(OBSERVED_AT),
    }) });

    await expect(server.callTool("kiln_status_inspect", {})).resolves.toMatchObject({
      structuredContent: {
        operation: "status",
        status: { completeness: "unresolved" },
        diagnostics: [expect.objectContaining({ code: "KILN_RUNTIME_OWNER_MISSING" })],
      },
    });
  });

  it.each([
    ["missing", "KILN_PROJECT_ROOT_UNRESOLVED"],
    ["ambiguous", "KILN_PROJECT_ROOT_AMBIGUOUS"],
  ] as const)("keeps %s project discovery unavailable without reading the caller CWD", async (status, code) => {
    const readStatus = async () => snapshot();
    const result = await createServer(snapshot(), {
      readStatus,
      readProjectRoot: async () => ({ status }),
    }).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code })] },
    });
  });

  it("contains project-discovery initialization failures in a stable unresolved envelope", async () => {
    const result = await createServer(snapshot(), {
      readProjectRoot: async () => { throw new Error("C:\\private\\project identity"); },
    }).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_INTERNAL_ADAPTER_FAILURE" })] },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("validates evidence versions and observation freshness before projecting authority", async () => {
    const cases: readonly [string, KilnConfigStatusSnapshot, string][] = [
      ["missing version", snapshot({ evidenceVersion: undefined }), "KILN_EVIDENCE_MALFORMED"],
      ["missing observation", snapshot({ generatedAt: undefined } as unknown as Partial<KilnConfigStatusSnapshot>), "KILN_EVIDENCE_MALFORMED"],
      [
        "unsupported version",
        snapshot({ evidenceVersion: 1 as KilnConfigStatusSnapshot["evidenceVersion"] }),
        "KILN_EVIDENCE_VERSION_UNSUPPORTED",
      ],
      ["future observation", snapshot({ generatedAt: "2026-07-13T18:03:00.000Z" }), "KILN_EVIDENCE_FUTURE"],
      ["stale observation", snapshot({ generatedAt: "2026-07-13T17:50:00.000Z" }), "KILN_EVIDENCE_STALE"],
      ["invalid observation", snapshot({ generatedAt: "not-a-timestamp" }), "KILN_EVIDENCE_MALFORMED"],
    ];

    for (const [, status, code] of cases) {
      const governance = await createServer(status).callTool("kiln_work_governance_inspect", {});
      expect(governance).toMatchObject({
        structuredContent: { authority: "unresolved", diagnostics: [expect.objectContaining({ code })] },
      });
    }
  });

  it("returns a configuration-read diagnostic when the canonical owner throws", async () => {
    const result = await createServer(snapshot(), {
      readStatus: async () => { throw new Error("C:\\private\\config.yaml token=super-secret"); },
    }).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_CONFIGURATION_READ_FAILED" })] },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("C:\\private");
  });

  it("does not let stale projection evidence grant or revoke independently valid governance authority", async () => {
    const result = await createServer(snapshot({
      projections: [{ targetId: "codex-global-instructions", path: "ignored", kind: "global-instruction-shim", status: "stale" }],
    })).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: {
        authority: "authoritative",
        diagnostics: [expect.objectContaining({ code: "KILN_PROJECTION_STALE" })],
      },
    });
  });

  it("rejects malformed status, projection, route, and capability evidence without leaking it", async () => {
    const malformed = snapshot({
      projections: [{ targetId: "codex", path: "C:\\secret", kind: "native", status: "current", routeIntegrity: { catalogStatus: { status: "invalid" }, explicitProbeStatus: "invalid", credentialSource: "unknown", bareProofSupported: false, routeStatus: "unknown", credentialStatus: "valid", classification: "x" } }],
      harnessCapabilities: [{ harness: "codex", displayName: "Codex", runtimeConfigInjection: "supported", nativeProjection: "install-state", nativeConfigImport: "supported", mcpRuntimeTools: "invalid", hooks: "supported" }],
    });

    const result = await createServer(malformed).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_EVIDENCE_MALFORMED" })] },
    });
    expect(JSON.stringify(result)).not.toContain("C:\\secret");
  });

  it.each([
    ["route classification", snapshot({ projections: [{ targetId: "codex", path: "C:\\secret", kind: "native", status: "current", routeIntegrity: { catalogStatus: { status: "available" }, explicitProbeStatus: "succeeded", credentialSource: "none", bareProofSupported: true, routeStatus: "matches-canonical", credentialStatus: "valid", classification: "token=super-secret" } }] })],
    ["capability status", snapshot({ harnessCapabilities: [{ ...snapshot().harnessCapabilities[0]!, mcpRuntimeTools: "token=super-secret" }] })],
  ])("rejects poisoned %s evidence before it reaches a tool response", async (_, status) => {
    const result = await createServer(status).callTool("kiln_status_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { status: { completeness: "unresolved" }, diagnostics: [expect.objectContaining({ code: "KILN_EVIDENCE_MALFORMED" })] },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("discovers this checkout from the adapter module, independent of repository or unrelated process CWD", () => {
    const repositoryRoot = discoverNativeHarnessProjectRoot();
    mkdirSync(TEMPORARY_CWD, { recursive: true });
    const originalCwd = process.cwd();
    try {
      process.chdir(TEMPORARY_CWD);
      expect(discoverNativeHarnessProjectRoot()).toEqual(repositoryRoot);
    } finally {
      process.chdir(originalCwd);
    }
    expect(repositoryRoot).toMatchObject({ status: "resolved" });
  });

  it("is transport-neutral and uses no CLI subprocess or local composition route", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "native-harness", "native-harness-mcp-tools.ts"), "utf8");
    expect(source).not.toMatch(/child_process|spawn\(|exec\(|StdioServerTransport|createOperatorProjectAgentTaskApplicationComposition/);
    expect(source).not.toMatch(/process\.cwd\(\)/);
  });

});
