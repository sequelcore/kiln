import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KilnConfigStatusSnapshot } from "@kilnai/gateway-contracts";
import type { ManagedJobRecord } from "@kilnai/runtime";
import { discoverNativeHarnessProjectRoot } from "../../src/application/native-harness-project-root.js";
import {
  NativeHarnessMcpTools,
  createNativeHarnessInspectionService,
} from "../../src/native-harness/native-harness-mcp-tools.js";

const CodexMcpTools = class extends NativeHarnessMcpTools {
  constructor(options: Omit<ConstructorParameters<typeof NativeHarnessMcpTools>[0], "harness">) {
    super({ harness: "codex", ...options });
  }
};

const OBSERVED_AT = "2026-07-13T18:01:00.000Z";
const TEMPORARY_CWD = join(tmpdir(), "kiln-codex-app-mcp-unrelated-cwd");

function snapshot(overrides: Partial<KilnConfigStatusSnapshot> = {}): KilnConfigStatusSnapshot {
  return {
    evidenceVersion: 2,
    generatedAt: "2026-07-13T18:00:00.000Z",
    project: {
      rootPath: "C:\\workspace\\kiln",
      projectName: "kiln",
      hasGitRoot: true,
      hasKilnYaml: true,
      kilnYaml: { path: "C:\\workspace\\kiln\\.kiln\\kiln.yaml", status: "valid" },
      projectContext: { path: "C:\\workspace\\kiln\\.kiln\\project-context.md", status: "valid" },
    },
    global: { path: "C:\\Users\\operator\\.kiln\\config.yaml", status: "valid" },
    effectiveConfigStatus: "valid",
    effectiveConfig: {
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: { maxFiles: 1, maxRisk: "low" },
        requireDelegationFor: ["architecture"],
        requiredEvidence: ["surface-map", "tests"],
      },
    },
    errors: [],
    projections: [],
    permissionIntegrity: [],
    mcp: { servers: [], diagnostics: [] },
    setup: {
      projectRoot: "C:\\workspace\\kiln",
      projectContext: { path: "C:\\workspace\\kiln\\.kiln\\project-context.md", status: "valid", recommendation: "none" },
      repoShims: [],
      globalInstructionShims: [],
      nativeProjections: [],
      permissionIntegrity: [],
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

function managedJob(overrides: Partial<ManagedJobRecord> = {}): ManagedJobRecord {
  const state = overrides.state ?? "succeeded";
  const candidateSet = {
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
  };
  return {
    version: 10,
    id: "managed-job-0001",
    adoptedDecisionAt: OBSERVED_AT,
    state,
    objective: "Inspect bounded work.",
    projectId: "trusted-project",
    callerId: "trusted-codex-user",
    configuredAgentProfileId: "scout",
    admissionProfileId: "foundation-readonly-plan",
    dispatch: {
      kind: "economic",
      economicAttemptId: "economic-attempt:test-0001",
      economicPolicyId: "economy-policy",
      economicPolicyRevision: "revision-001",
      constraints: {},
      candidateSet,
    },
    governanceSource: "kiln-governance",
    admissionId: "admission-001",
    requestFingerprint: `sha256:${"a".repeat(64)}`,
    idempotencyKeyHash: `sha256:${"b".repeat(64)}`,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    lifecycle: [{ sequence: 1, state, observedAt: OBSERVED_AT }],
    ...(state === "succeeded" ? {
      result: {
        version: 1,
        jobId: "managed-job-0001",
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
      },
    } : {}),
    ...overrides,
  };
}

function managedEconomicJob(): ManagedJobRecord {
  return managedJob({
    id: "managed-job-economic-0001",
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
  it.each(["codex", "claude", "opencode"] as const)("uses trusted %s identity in managed-job evidence", async (harness) => {
    const server = new NativeHarnessMcpTools({
      harness,
      inspection: createNativeHarnessInspectionService({ harness }),
      managedJobs: {
        accept: async () => managedJob(),
        getStatus: async () => managedJob(),
        getResult: async () => ({ jobId: "managed-job-0001", availability: "pending", lifecycleState: "running", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go" }),
        cancel: async () => managedJob(),
        getReplay: async () => ({ jobId: "managed-job-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", diagnostic: "replay_unavailable" }),
      },
    });

    await expect(server.callTool("kiln_managed_agent_status", { jobId: "managed-job-0001" })).resolves.toMatchObject({
      structuredContent: {
        evidence: {
          harness,
          adapter: "global-operator-runtime-mcp",
          callerId: `${harness}-native-harness`,
        },
      },
    });
    expect(server.listTools().map((tool) => tool.name)).toContain("kiln_managed_agent_invoke");
  });

  afterEach(() => {
    rmSync(TEMPORARY_CWD, { recursive: true, force: true });
  });
  it("discovers four inspection tools and exactly five managed-job tools", () => {
    expect(createServer().listTools().map((tool) => tool.name)).toEqual([
      "kiln_status_inspect",
      "kiln_work_governance_inspect",
      "kiln_capability_inspect",
      "kiln_account_usage_inspect",
      "kiln_managed_agent_invoke",
      "kiln_managed_agent_status",
      "kiln_managed_agent_result",
      "kiln_managed_agent_cancel",
      "kiln_managed_agent_replay",
    ]);
  });

  it("returns sanitized account usage without accepting account selection arguments", async () => {
    const inspect = vi.fn(async () => ({
      operation: "account-usage",
      accounts: [{ provider: "codex-oauth", accountId: "plus", credentialId: "opaque-id", plan: "plus", availability: "available", freshness: "fresh", source: "provider-endpoint", confidence: "authoritative", eligibleRoutes: ["codex-managed"] }],
      evidence: { authority: "global-model-gateway" },
    }));
    const server = new NativeHarnessMcpTools({ harness: "codex", accountUsage: { inspect } });
    const result = await server.callTool("kiln_account_usage_inspect", {});
    expect(result.structuredContent).toMatchObject({ accounts: [{ credentialId: "opaque-id", eligibleRoutes: ["codex-managed"] }] });
    expect(JSON.stringify(result)).not.toMatch(/token|email|path|raw/i);
    await expect(server.callTool("kiln_account_usage_inspect", { credentialId: "opaque-id" })).resolves.toMatchObject({ isError: true });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("publishes a stable invoke schema without exposing route configuration", () => {
    const server = new CodexMcpTools({});
    const tool = server.listTools().find((candidate) => candidate.name === "kiln_managed_agent_invoke");

    expect(tool?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["objective", "configuredAgentProfileId", "idempotencyKey"],
      properties: { configuredAgentProfileId: { type: "string", minLength: 1, maxLength: 200 } },
    });
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("route");
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("foundation-readonly-plan");
  });

  it("projects only trusted request identity into the canonical managed-job acceptance", async () => {
    const accepted: unknown[] = [];
    const server = new CodexMcpTools({
      inspection: createNativeHarnessInspectionService({ harness: "codex" }),
      managedJobs: {
        accept: async (input) => { accepted.push(input); return managedJob(); },
        getStatus: async () => managedJob(),
        getResult: async () => ({ jobId: "managed-job-0001", availability: "available", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", handoff: { summary: "done", resourceUris: [], memoryWriteProposalUris: [] } }),
        cancel: async () => managedJob({ state: "cancelled", diagnostic: "cancelled" }),
        getReplay: async () => ({ jobId: "managed-job-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", diagnostic: "replay_unavailable" }),
      },
      requestIdentity: () => ({ callerId: "trusted-codex-user", requestId: "trusted-request" }),
    });

    const result = await server.callTool("kiln_managed_agent_invoke", { objective: "  inspect bounded work  ", configuredAgentProfileId: "scout", idempotencyKey: "retry-1" });
    expect(accepted).toEqual([{ objective: "inspect bounded work", configuredAgentProfileId: "scout", idempotencyKey: "retry-1", callerId: "trusted-codex-user" }]);
    expect(result.structuredContent).toMatchObject({
      accepted: true,
      completionChannel: "status-result-replay",
      job: { id: "managed-job-0001", routeId: "route-go", state: "succeeded" },
      evidence: { callerId: "trusted-codex-user", requestId: "trusted-request" },
    });
    expect(JSON.stringify(result)).not.toContain("objective");
  });

  it("projects a failed V10 job without fabricating route or provider identity", async () => {
    const server = new CodexMcpTools({
      managedJobs: {
        accept: async () => managedEconomicJob(),
        getStatus: async () => managedEconomicJob(),
        getResult: async () => ({
          jobId: "managed-job-economic-0001",
          availability: "failed",
          lifecycleState: "failed",
          configuredAgentProfileId: "scout",
          admissionProfileId: "foundation-readonly-plan",
          diagnostic: "economic_commitment_unavailable",
        }),
        cancel: async () => managedEconomicJob(),
        getReplay: async () => ({
          jobId: "managed-job-economic-0001",
          availability: "unavailable",
          lifecycleState: "failed",
          configuredAgentProfileId: "scout",
          admissionProfileId: "foundation-readonly-plan",
          lifecycle: [],
          resultAvailability: "failed",
          diagnostic: "replay_unavailable",
        }),
      },
      requestIdentity: () => ({
        callerId: "trusted-codex-user",
        requestId: "trusted-request",
      }),
    });

    const result = await server.callTool("kiln_managed_agent_invoke", {
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
      diagnosticUri: "kiln://diagnostics/managed-jobs/structured-handoff-rejected",
    };
    const failed = managedJob({
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
      managedJobs: {
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
      server.callTool("kiln_managed_agent_status", { jobId: failed.id }),
      server.callTool("kiln_managed_agent_result", { jobId: failed.id }),
      server.callTool("kiln_managed_agent_replay", { jobId: failed.id }),
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
      managedJobs: {
        accept: async () => managedJob({ state: "running" }),
        getStatus: async () => managedJob({ state: "running" }),
        getResult: async () => ({ jobId: "managed-job-0001", availability: "failed", lifecycleState: "cancelled", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", diagnostic: "cancelled" }),
        cancel: async (input, jobId) => { calls.push({ operation: "cancel", input, jobId }); return managedJob({ state: "cancelled", diagnostic: "cancelled" }); },
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

    const cancelled = await server.callTool("kiln_managed_agent_cancel", { jobId: "managed-job-0001" });
    const replay = await server.callTool("kiln_managed_agent_replay", { jobId: "managed-job-0001" });

    expect(calls).toEqual([
      { operation: "cancel", input: { callerId: "trusted-codex-user" }, jobId: "managed-job-0001" },
      { operation: "replay", input: { callerId: "trusted-codex-user" }, jobId: "managed-job-0001" },
    ]);
    expect(cancelled.structuredContent).toMatchObject({ operation: "managed-agent-cancel", job: { state: "cancelled" } });
    expect(replay.structuredContent).toMatchObject({
      operation: "managed-agent-replay",
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
    await expect(server.callTool("kiln_managed_agent_cancel", { jobId: "managed-job-0001", reason: "override" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
  });

  it("rejects unknown invoke fields and malformed status or result identifiers before the application owner", async () => {
    let calls = 0;
    const server = new CodexMcpTools({ managedJobs: { accept: async () => { calls++; return managedJob(); }, getStatus: async () => { calls++; return managedJob(); }, getResult: async () => { calls++; return { jobId: "managed-job-0001", availability: "pending", lifecycleState: "running", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go" }; }, cancel: async () => { calls++; return managedJob(); }, getReplay: async () => { calls++; return { jobId: "managed-job-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", diagnostic: "replay_unavailable" }; } } });
    await expect(server.callTool("kiln_managed_agent_invoke", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key", provider: "opencode-go" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_managed_agent_invoke", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key", admissionProfileId: "foundation-readonly-plan" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_managed_agent_status", { jobId: "not valid" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    await expect(server.callTool("kiln_managed_agent_result", { jobId: "not valid" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    expect(calls).toBe(0);
  });

  it("maps application diagnostics without exposing internal error text", async () => {
    const server = new CodexMcpTools({ managedJobs: { accept: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "provider_rejected" }); }, getStatus: async () => managedJob(), getResult: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "result_corrupt" }); }, cancel: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "invocation_failed" }); }, getReplay: async () => { throw Object.assign(new Error("C:\\secrets\\provider payload"), { code: "job_persistence_corrupt" }); } } });
    const result = await server.callTool("kiln_managed_agent_invoke", { objective: "work", configuredAgentProfileId: "scout", idempotencyKey: "key" });
    expect(result).toMatchObject({ isError: true, structuredContent: { error: { code: "provider_rejected" } } });
    expect(JSON.stringify(result)).not.toContain("secrets");
  });

  it("projects an authorized bounded canonical result without accepting authority or raw-output inputs", async () => {
    const reads: unknown[] = [];
    const server = new CodexMcpTools({
      managedJobs: {
        accept: async () => managedJob(),
        getStatus: async () => managedJob(),
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
            handoff: { summary: "bounded child answer", resourceUris: ["kiln://artifacts/managed-job-0001/result"], memoryWriteProposalUris: [] },
          };
        },
        cancel: async () => managedJob({ state: "cancelled", diagnostic: "cancelled" }),
        getReplay: async () => ({ jobId: "managed-job-0001", availability: "unavailable", lifecycleState: "succeeded", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "route-go", providerId: "opencode-go", lifecycle: [], resultAvailability: "unavailable", diagnostic: "replay_unavailable" }),
      },
      requestIdentity: () => ({ callerId: "trusted-codex-user", requestId: "result-request" }),
    });
    const result = await server.callTool("kiln_managed_agent_result", { jobId: "managed-job-0001" });
    expect(reads).toEqual([{ input: { callerId: "trusted-codex-user" }, jobId: "managed-job-0001" }]);
    expect(result.structuredContent).toMatchObject({ operation: "managed-agent-result", result: { availability: "available", provenance: { trust: "untrusted-child-output" }, handoff: { summary: "bounded child answer" } } });
    await expect(server.callTool("kiln_managed_agent_result", { jobId: "managed-job-0001", transcript: "no" })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_request" } } });
    expect(JSON.stringify(result)).not.toContain("objective");
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
      policy: { defaultPosture: "orchestrate", directExecution: { maxFiles: 1, maxRisk: "low" } },
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
    const result = await createServer(snapshot({ effectiveConfig: {} })).callTool("kiln_work_governance_inspect", {});

    expect(result).toMatchObject({
      structuredContent: { operation: "work-governance", authority: "unresolved", diagnostics: [expect.objectContaining({ code: "KILN_GOVERNANCE_EVIDENCE_MALFORMED" })] },
    });
  });

  it("rejects malformed resolved governance policy instead of authorizing it", async () => {
    const malformed = snapshot({
      effectiveConfig: {
        workGovernance: {
          defaultPosture: "direct",
          directExecution: { maxFiles: 0, maxRisk: "low" },
          requireDelegationFor: ["not-a-trigger"],
          requiredEvidence: ["surface-map"],
        },
      },
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
    ["fractional direct file limit", { defaultPosture: "direct", directExecution: { maxFiles: 1.5, maxRisk: "low" }, requireDelegationFor: [], requiredEvidence: [] }],
    ["unsupported risk", { defaultPosture: "direct", directExecution: { maxFiles: 1, maxRisk: "critical" }, requireDelegationFor: [], requiredEvidence: [] }],
    ["duplicated authority trigger", { defaultPosture: "direct", directExecution: { maxFiles: 1, maxRisk: "low" }, requireDelegationFor: ["security", "security"], requiredEvidence: [] }],
    ["unsupported evidence", { defaultPosture: "direct", directExecution: { maxFiles: 1, maxRisk: "low" }, requireDelegationFor: [], requiredEvidence: ["operator-says-so"] }],
  ])("rejects %s governance evidence", async (_, workGovernance) => {
    const result = await createServer(snapshot({ effectiveConfig: { workGovernance } })).callTool("kiln_work_governance_inspect", {});

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
      ["unsupported version", snapshot({ evidenceVersion: 1 }), "KILN_EVIDENCE_VERSION_UNSUPPORTED"],
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
      projections: [{ targetId: "codex", path: "C:\\secret", kind: "native", status: "current", routeIntegrity: { routeStatus: "unknown", credentialStatus: "valid", classification: "x" } }] as KilnConfigStatusSnapshot["projections"],
      harnessCapabilities: [{ harness: "codex", displayName: "Codex", runtimeConfigInjection: "supported", nativeProjection: "install-state", nativeConfigImport: "supported", mcpRuntimeTools: 7, hooks: "supported" }] as KilnConfigStatusSnapshot["harnessCapabilities"],
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
    expect(source).not.toMatch(/child_process|spawn\(|exec\(|StdioServerTransport|createOperatorProjectManagedJobApplicationComposition/);
    expect(source).not.toMatch(/process\.cwd\(\)/);
  });

});
