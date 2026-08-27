import { describe, expect, it, vi } from "vitest";
import type {
  AgentResponse,
  CreateMessageOptions,
  ManagedAgentInvocationRequest,
  ProviderAdapter,
  ToolDefinition,
} from "@kilnai/core/agents";
import type { ActionEffectEnvelope, AuthorityDescriptor, Capability } from "@kilnai/core/engine";
import { defineManagedAgentInvocationRequest } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import {
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeInvocationLifecycleOptions,
} from "../../src/agents/managed-invocation/index.js";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";
import type {
  RuntimeModelRoundActionClaim,
  RuntimeModelRoundActionClaimPermit,
  RuntimeModelRoundActionClaimStore,
} from "../../src/execution-kernel/runtime-model-round-action-claim.js";
import { createFixtureToolActionStore } from "../session/runtime-claim-fixture.js";

const TEST_ADMISSIONS = new Map<string, EffectiveAuthorityAdmissionBundle>();

function testModelRoundStore(): RuntimeModelRoundActionClaimStore {
  const claims = new Map<string, RuntimeModelRoundActionClaim>();
  const permits = new WeakMap<object, { consumed: boolean }>();
  return {
    claim(input) {
      const state = { consumed: false };
      const permit = Object.freeze({
        claimId: input.claimId,
        permitId: `authority-admission-test:${input.claimId}`,
        consume: () => {
          if (state.consumed) throw new Error("test model-round permit already consumed");
          state.consumed = true;
        },
      }) as unknown as RuntimeModelRoundActionClaimPermit;
      if (claims.has(input.claimId)) throw new Error("test model-round claim already exists");
      claims.set(input.claimId, input);
      permits.set(permit, state);
      return permit;
    },
    settle(permit, settlement) {
      const state = permits.get(permit);
      const claim = claims.get(permit.claimId);
      if (!state?.consumed || !claim) throw new Error("test model-round permit was not consumed");
      claims.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "success"
          ? { outcome: "success" as const }
          : { outcome: "unknown" as const, unknownReason: settlement.reason }),
      });
      permits.delete(permit);
    },
  };
}

const READ_AUTHORITY: AuthorityDescriptor = {
  level: 1,
  allowed: true,
  requiresApproval: false,
  reason: "read-only child tool",
};
const WRITE_AUTHORITY: AuthorityDescriptor = {
  level: 3,
  allowed: true,
  requiresApproval: false,
  reason: "audited child write tool",
};
const READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};
const WRITE_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "compensatable",
  dataEgress: "none",
  identityUse: "authenticated",
  consequences: ["local-state"],
  idempotency: "conditionally-idempotent",
};

const READ_TOOL: ToolDefinition = {
  name: "read",
  description: "Read one governed resource.",
  inputSchema: {},
  tags: new Set(["read"]),
};
const WRITE_TOOL: ToolDefinition = {
  name: "write",
  description: "Write one governed resource.",
  inputSchema: {},
  tags: new Set(["write"]),
};

function response(text: string): AgentResponse {
  return {
    parts: textParts(text),
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    stopReason: "end_turn",
  };
}

function request(overrides: Partial<Parameters<typeof defineManagedAgentInvocationRequest>[0]> = {}): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "child-authority-1",
    agentId: "child-authority:foundation-readonly-plan",
    parentSessionId: "parent-session",
    parentTurnId: "parent-session:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "assistant",
    requestSource: "test",
    requestedAuthority: "read_only",
    providerRoute: {
      providerId: "openai",
      surface: "direct-provider",
      model: "gpt-test",
    },
    adapterKind: "direct",
    executionMode: "direct-provider",
    authority: {
      authorityProfileId: "authority:child-readonly",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "write"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: { path: "C:/repo", mode: "read-only" },
      timeoutMs: 5_000,
      credentialRoute: { mode: "credentialless" },
      memoryScope: {
        scope: { kind: "project", id: "repo" },
        access: "read-only",
      },
    },
    input: {
      summary: "Read the repository.",
      prompt: "Read the repository and summarize the result.",
    },
    ...overrides,
  });
}

function bundle(overrides: Partial<Parameters<typeof defineEffectiveAuthorityAdmissionBundle>[0]> = {}): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "parent-session",
    turnId: "parent-session:turn:1",
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "session-revision", revisions: { routes: "r1", skills: "s1" } },
      turnRevision: { revisionSetId: "turn-revision", revisions: { routes: "r1", skills: "s1" } },
    },
    session: {
      skillCatalog: { catalogId: "operator-skills", revision: "s1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "audited", reason: "parent turn ceiling" },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "parent turn admission",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{ toolName: "managed_agent.invoke", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT }],
        deniedToolNames: [],
      },
      effectCeiling: WRITE_EFFECT,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: "openai:foundation-readonly-plan",
          providerId: "openai",
          providerModelId: "gpt-test",
          accountSelection: { kind: "operator-override", accountPolicyId: "policy-1", accountId: "authority-test-account" },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId: "openai:foundation-readonly-plan",
          accountId: "authority-test-account",
          credentialId: "authority-test-credential",
          credentialRevision: "authority-test-credential-revision",
        },
      },
    },
    ...overrides,
  });
}

function snapshotInput(childRequest: ManagedAgentInvocationRequest) {
  return {
    capturedAt: "2026-08-22T18:00:00.000Z",
    routeId: `${childRequest.providerRoute.providerId}:${childRequest.profile}`,
    routeSource: "explicit-managed-route" as const,
  };
}

function lifecycle(authorityAdmission: EffectiveAuthorityAdmissionBundle): ManagedAgentRuntimeInvocationLifecycleOptions {
  TEST_ADMISSIONS.set(authorityAdmission.admissionId, authorityAdmission);
  return { childAuthorityAdmission: { bundle: authorityAdmission } };
}

function adapter(provider: ProviderAdapter, childRequest: ManagedAgentInvocationRequest) {
  const capabilityMap = new Map<string, Capability>([
    ["read", { name: "read", description: "read", schema: {}, tags: [], effectEnvelope: READ_EFFECT }],
    ["write", { name: "write", description: "write", schema: {}, tags: [], effectEnvelope: WRITE_EFFECT }],
  ]);
  return new ManagedDirectProviderRuntimeAdapter({
    providerId: childRequest.providerRoute.providerId,
    model: childRequest.providerRoute.model,
    provider,
    tools: [READ_TOOL, WRITE_TOOL],
    builtinTools: new Map([[
      "read",
      async () => ({ success: true, resultSummary: "read" }),
    ]]),
    capabilityMap,
    toolAuthority: new Map([
      ["read", READ_AUTHORITY],
      ["write", WRITE_AUTHORITY],
    ]),
    runtimeModelRoundActionClaims: testModelRoundStore(),
    runtimeToolActionClaims: createFixtureToolActionStore(),
    readAuthorityAdmission: async ({ admissionId }) => TEST_ADMISSIONS.get(admissionId),
  });
}

describe("managed child authority admission", () => {
  it("projects direct-provider child effects from the committed bundle and preserves the full bundle on the record", async () => {
    const childRequest = request({
      authority: {
        ...request().authority,
        toolAuthority: {
          ...request().authority.toolAuthority,
          allowedToolNames: ["read"],
        },
      },
    });
    const provider = {
      name: "openai",
      createMessage: vi.fn(async (input: CreateMessageOptions) => {
        expect(input.tools?.map((tool) => tool.name)).toEqual(["read"]);
        return response("read complete");
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    } satisfies ProviderAdapter;
    const committed = bundle({
      turn: {
        ...bundle().turn,
        effectCeiling: READ_EFFECT,
        tools: {
          allowedToolPermissions: [{ toolName: "read", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT }],
          deniedToolNames: [],
        },
      },
    });
    const result = await new RuntimeManagedAgentInvocationService().invoke(
      childRequest,
      adapter(provider, childRequest),
      snapshotInput(childRequest),
      lifecycle(committed),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected a completed child invocation.");
    expect((result.record as ManagedAgentInvocationRecordWithAdmission).authorityAdmission).toEqual(committed);
    const [{ appendManagedInvocationTerminalSessionEvent }, { RuntimeSession }] = await Promise.all([
      import("../../src/agents/managed-invocation/session-events.js"),
      import("../../src/session/runtime-session.js"),
    ]);
    const parentSession = new RuntimeSession({
      appName: "test",
      tenantId: "tenant",
      userId: "parent",
      systemPrompt: "",
      sessionId: childRequest.parentSessionId,
    });
    const terminalEvents = appendManagedInvocationTerminalSessionEvent({
      session: parentSession,
      request: childRequest,
      record: result.record,
    });
    const terminalEvent = terminalEvents.find((event) => event.kind === "agent_invocation_completed");
    expect((terminalEvent as { managedInvocationEvidence?: { authorityAdmission?: EffectiveAuthorityAdmissionBundle } } | undefined)
      ?.managedInvocationEvidence?.authorityAdmission).toEqual(committed);
    expect(provider.createMessage).toHaveBeenCalledOnce();
  });

  it("rejects a child whose requested authority exceeds the parent bundle before provider dispatch", async () => {
    const childRequest = request({
      invocationId: "child-authority-write-1",
      agentId: "child-authority:foundation-propose-writes",
      profile: "foundation-propose-writes",
      requestedAuthority: "destructive",
      authorityApproval: { approved: true },
      authority: {
        ...request().authority,
        permissionProfile: "propose-writes",
        toolAuthority: { allowedToolNames: ["write"], writeAllowed: true, networkAllowed: false },
        workingDirectory: { path: "C:/repo", mode: "workspace-write" },
      },
    });
    const provider = {
      name: "openai",
      createMessage: vi.fn(async () => response("must not execute")),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    } satisfies ProviderAdapter;
    const childAdapter = adapter(provider, childRequest);

    await expect(new RuntimeManagedAgentInvocationService().invoke(
      childRequest,
      childAdapter,
      snapshotInput(childRequest),
      lifecycle(bundle()),
    )).rejects.toThrow(/parent.*authority|attenuat|admission/iu);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("fails a child whose tool effect exceeds the parent effect ceiling before provider dispatch", async () => {
    const childRequest = request({ invocationId: "child-authority-effect-1" });
    const provider = {
      name: "openai",
      createMessage: vi.fn(async () => response("must not execute")),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    } satisfies ProviderAdapter;

    const result = await new RuntimeManagedAgentInvocationService().invoke(
      childRequest,
      adapter(provider, childRequest),
      snapshotInput(childRequest),
      lifecycle(bundle({
        turn: {
          ...bundle().turn,
          effectCeiling: READ_EFFECT,
        },
      })),
    );
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected a terminal child result.");
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff?.summary).toMatch(/effect.*ceiling|exceeds/iu);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("rejects a mutable or identity-mismatched bundle before provider dispatch", async () => {
    const childRequest = request({ invocationId: "child-authority-invalid-1" });
    const provider = {
      name: "openai",
      createMessage: vi.fn(async () => response("must not execute")),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    } satisfies ProviderAdapter;
    const childAdapter = adapter(provider, childRequest);
    const valid = bundle();
    const mutable = { ...valid, turn: { ...valid.turn, tools: { ...valid.turn.tools, deniedToolNames: [...valid.turn.tools.deniedToolNames] } } } as EffectiveAuthorityAdmissionBundle;

    await expect(new RuntimeManagedAgentInvocationService().invoke(
      childRequest,
      childAdapter,
      snapshotInput(childRequest),
      lifecycle(mutable),
    )).rejects.toThrow(/immutable|bundle|digest/iu);
    await expect(new RuntimeManagedAgentInvocationService().invoke(
      childRequest,
      childAdapter,
      snapshotInput(childRequest),
      lifecycle(bundle({ sessionId: "other-session" })),
    )).rejects.toThrow(/session|parent|bundle/iu);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });
});

type ManagedAgentInvocationRecordWithAdmission = {
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
};
