import type { ProviderAdapter, ToolCache } from "@kilnai/core/agents";
import type { ActionEffectEnvelope, Capability } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION,
  type ManagedAttendedTrustedExecutionContext,
} from "../../src/agents/managed-invocation/attended-trusted-execution.js";
import { AttendedTrustedExecutionLeaseAuthority } from "../../src/execution-kernel/attended-trusted-execution-lease-authority.js";
import type { AttendedTrustedExecutionLeaseSessionAuthority } from "../../src/execution-kernel/attended-trusted-execution-lease-session-authority.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { RuntimeSessionToolExecutor } from "../../src/session/runtime-session-orchestrator-tool-executor.js";
import {
  createFixtureClaimConfig,
  createFixtureToolPermission,
  FIXTURE_READ_ONLY_EFFECT,
} from "./runtime-claim-fixture.js";
import { fixtureAuditLog } from "./runtime-session-orchestrator-tools-test-fixture.js";

const NOW = "2026-08-24T00:30:00.000Z";
const PROJECT_RUNTIME_ID = `krp_${"1".repeat(64)}` as const;
const COMPOSITION_REVISION = `sha256:${"2".repeat(64)}` as const;

const MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["external-system"],
  reversibility: "irreversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["external-state"],
  idempotency: "non-idempotent",
};

function provider(): ProviderAdapter {
  return { name: "test" } as ProviderAdapter;
}

function session(): RuntimeSession {
  return new RuntimeSession({
    appName: "test",
    tenantId: "tenant",
    userId: "operator",
    systemPrompt: "Test system prompt.",
  });
}

async function issuedContext(input: {
  readonly admissionId: string;
  readonly allowedToolNames: readonly string[];
  readonly effectCeiling: ActionEffectEnvelope;
  readonly durationMs?: number;
}): Promise<ManagedAttendedTrustedExecutionContext> {
  const authority = new AttendedTrustedExecutionLeaseAuthority({
    binding: {
      localPrincipalId: "local-operator-session:1",
      operatorSessionId: "operator-session",
      invocationTreeId: "invocation-tree:1",
      projectRuntimeId: PROJECT_RUNTIME_ID,
      compositionRevision: COMPOSITION_REVISION,
    },
    approvalPort: { approve: () => ({ status: "approved" }) },
    now: () => NOW,
  });
  const issued = await authority.issue({
    harness: "codex",
    routeId: "runtime-fixture-route",
    profileCeiling: "trusted-full-access",
    allowedToolNames: input.allowedToolNames,
    effectCeiling: input.effectCeiling,
    policyDigest: input.admissionId as `sha256:${string}`,
    enforcementRevision: MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION,
    durationMs: input.durationMs ?? 60_000,
  });
  if (issued.status !== "issued") throw new Error(`fixture lease was not issued: ${issued.reason}`);
  return {
    authority,
    projectRuntimeId: PROJECT_RUNTIME_ID,
    compositionRevision: COMPOSITION_REVISION,
    harness: "codex",
    routeId: "runtime-fixture-route",
    policyDigest: input.admissionId as `sha256:${string}`,
    enforcementRevision: MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION,
    requestedProfile: "trusted-full-access",
  };
}

function cache(): ToolCache {
  return {
    get: vi.fn(),
    set: vi.fn(),
  } as unknown as ToolCache;
}

function capability(effectEnvelope: ActionEffectEnvelope): Capability {
  return {
    name: "read",
    description: "Read data",
    schema: {},
    tags: [],
    effectEnvelope,
    cacheTtl: 60_000,
  };
}

describe("RuntimeSessionToolExecutor attended trusted execution gate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes a matching tool/effect and forwards both process-local contexts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const currentSession = session();
    const currentProvider = provider();
    const config = createFixtureClaimConfig({
      session: currentSession,
      provider: currentProvider,
      toolPermissions: [createFixtureToolPermission("read", FIXTURE_READ_ONLY_EFFECT)],
    });
    const attendedTrustedExecution = await issuedContext({
      admissionId: config.authorityAdmission!.admissionId,
      allowedToolNames: ["read"],
      effectCeiling: FIXTURE_READ_ONLY_EFFECT,
    });
    const attendedTrustedExecutionSessionAuthority = {} as AttendedTrustedExecutionLeaseSessionAuthority;
    const tool = vi.fn(async (_input: Record<string, unknown>, context) => {
      expect(context?.attendedTrustedExecution).toBe(attendedTrustedExecution);
      expect(context?.attendedTrustedExecutionSessionAuthority).toBe(attendedTrustedExecutionSessionAuthority);
      return "read-result";
    });
    const executor = new RuntimeSessionToolExecutor(
      { provider: currentProvider, builtinTools: new Map([["read", tool]]) },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
    );

    const result = await executor.executeToolCalls(
      currentSession,
      [{ id: "read-1", name: "read", input: {} }],
      `${config.turnCorrelationId}:response:1`,
      {
        ...config,
        attendedTrustedExecution,
        attendedTrustedExecutionSessionAuthority,
      },
    );

    expect(tool).toHaveBeenCalledOnce();
    expect(result.toolExecutions[0]).toMatchObject({ success: true, output: "read-result" });
  });

  it.each([
    {
      name: "tool mismatch",
      toolEffect: FIXTURE_READ_ONLY_EFFECT,
      leaseEffect: FIXTURE_READ_ONLY_EFFECT,
      leaseTools: ["other"],
      reason: "tool-not-approved",
    },
    {
      name: "effect mismatch",
      toolEffect: MUTATION_EFFECT,
      leaseEffect: FIXTURE_READ_ONLY_EFFECT,
      leaseTools: ["read"],
      reason: "effect-ceiling-exceeded",
    },
  ])("denies before invocation or cache lookup on $name", async ({ toolEffect, leaseEffect, leaseTools, reason }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const currentSession = session();
    const currentProvider = provider();
    const config = createFixtureClaimConfig({
      session: currentSession,
      provider: currentProvider,
      includeToolClaims: true,
      toolPermissions: [createFixtureToolPermission("read", toolEffect)],
    });
    const attendedTrustedExecution = await issuedContext({
      admissionId: config.authorityAdmission!.admissionId,
      allowedToolNames: leaseTools,
      effectCeiling: leaseEffect,
    });
    const tool = vi.fn(async () => "must-not-run");
    const toolCache = cache();
    const auditEntries: unknown[] = [];
    const executor = new RuntimeSessionToolExecutor(
      {
        provider: currentProvider,
        builtinTools: new Map([["read", tool]]),
        capabilityMap: new Map([["read", capability(toolEffect)]]),
        toolCache,
        auditLog: fixtureAuditLog((entry) => {
          const stored = { ...entry, id: "audit-1" };
          auditEntries.push(stored);
          return stored;
        }),
      },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
    );

    const result = await executor.executeToolCalls(
      currentSession,
      [{ id: "read-1", name: "read", input: {} }],
      `${config.turnCorrelationId}:response:1`,
      { ...config, attendedTrustedExecution },
    );

    expect(tool).not.toHaveBeenCalled();
    expect(toolCache.get).not.toHaveBeenCalled();
    expect(result.toolExecutions[0]).toMatchObject({
      success: false,
      authority: { allowed: false, reason: `Attended trusted execution denied: ${reason}` },
    });
    expect(result.resultParts[0]?.content).toContain("Authorization denied");
    expect(auditEntries).toEqual([
      expect.objectContaining({ action: "tool_execution", outcome: "error", resource: "read" }),
    ]);
  });

  it("denies an expired context before invocation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const currentSession = session();
    const currentProvider = provider();
    const config = createFixtureClaimConfig({
      session: currentSession,
      provider: currentProvider,
      toolPermissions: [createFixtureToolPermission("read", FIXTURE_READ_ONLY_EFFECT)],
    });
    const attendedTrustedExecution = await issuedContext({
      admissionId: config.authorityAdmission!.admissionId,
      allowedToolNames: ["read"],
      effectCeiling: FIXTURE_READ_ONLY_EFFECT,
      durationMs: 1_000,
    });
    vi.setSystemTime(new Date(Date.parse(NOW) + 1_000));
    const tool = vi.fn(async () => "must-not-run");
    const executor = new RuntimeSessionToolExecutor(
      { provider: currentProvider, builtinTools: new Map([["read", tool]]) },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
    );

    const result = await executor.executeToolCalls(
      currentSession,
      [{ id: "read-1", name: "read", input: {} }],
      `${config.turnCorrelationId}:response:1`,
      { ...config, attendedTrustedExecution },
    );

    expect(tool).not.toHaveBeenCalled();
    expect(result.resultParts[0]?.content).toContain("expired");
  });

  it("rechecks after async admission readback and denies before a consequential claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const currentSession = session();
    const currentProvider = provider();
    const config = createFixtureClaimConfig({
      session: currentSession,
      provider: currentProvider,
      includeToolClaims: true,
      toolPermissions: [createFixtureToolPermission("read", MUTATION_EFFECT)],
    });
    const attendedTrustedExecution = await issuedContext({
      admissionId: config.authorityAdmission!.admissionId,
      allowedToolNames: ["read"],
      effectCeiling: MUTATION_EFFECT,
    });
    const claims = config.runtimeToolActionClaims!;
    const readAdmission = vi.fn(async (input: Parameters<typeof claims.readAdmission>[0]) => {
      attendedTrustedExecution.authority.closeSession();
      return await claims.readAdmission(input);
    });
    const tool = vi.fn(async () => "must-not-run");
    const executor = new RuntimeSessionToolExecutor(
      { provider: currentProvider, builtinTools: new Map([["read", tool]]) },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
    );

    const result = await executor.executeToolCalls(
      currentSession,
      [{ id: "read-toctou", name: "read", input: {} }],
      `${config.turnCorrelationId}:response:1`,
      {
        ...config,
        attendedTrustedExecution,
        runtimeToolActionClaims: { ...claims, readAdmission },
      },
    );

    expect(readAdmission).toHaveBeenCalledOnce();
    expect(tool).not.toHaveBeenCalled();
    expect(claims.state).toMatchObject({ claimed: false });
    expect(result.toolExecutions[0]).toMatchObject({ success: false });
    expect(result.resultParts[0]?.content).toContain("session-closed");
  });

  it("preserves execution when no attended context is supplied", async () => {
    const currentSession = session();
    const currentProvider = provider();
    const config = createFixtureClaimConfig({
      session: currentSession,
      provider: currentProvider,
      toolPermissions: [createFixtureToolPermission("read", FIXTURE_READ_ONLY_EFFECT)],
    });
    const tool = vi.fn(async () => "read-result");
    const executor = new RuntimeSessionToolExecutor(
      { provider: currentProvider, builtinTools: new Map([["read", tool]]) },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
    );

    const result = await executor.executeToolCalls(
      currentSession,
      [{ id: "read-1", name: "read", input: {} }],
      `${config.turnCorrelationId}:response:1`,
      config,
    );

    expect(tool).toHaveBeenCalledOnce();
    expect(result.toolExecutions[0]).toMatchObject({ success: true, output: "read-result" });
  });
});
