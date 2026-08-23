import { vi } from "vitest";
import { type ProviderAdapter, type ToolDefinition } from "@kilnai/core/agents";
import { type ActionEffectEnvelope, type AuthorityDescriptor, type Capability, textParts, type ToolAuthorizer } from "@kilnai/core/engine";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority, parseCanonicalTurnId } from "@kilnai/core/events";
import { getBuiltinEffectEnvelope } from "@kilnai/core/tools";
import type { AuditLog } from "@kilnai/core/security";
import { RuntimeSessionOrchestrator, type PerCallToolConfig } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import type { RuntimeToolActionClaim, RuntimeToolActionClaimPermit, RuntimeToolActionClaimStore } from "../../src/execution-kernel/runtime-tool-action-claim.js";
import { runtimeModelRoundEffectIdentity, type RuntimeModelRoundActionClaim, type RuntimeModelRoundActionClaimPermit, type RuntimeModelRoundActionClaimStore } from "../../src/execution-kernel/runtime-model-round-action-claim.js";

export function fixtureAuditLog(append: AuditLog["append"]): AuditLog {
  return {
    append,
    query: () => [],
    verifyChain: () => ({ valid: true, entriesChecked: 0 }),
    count: () => 0,
  };
}

export async function waitForAssertion(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

export function makeProvider(toolCallsOnRound?: number): ProviderAdapter {
  let callCount = 0;
  return {
    name: "mock",
    createMessage: vi.fn().mockImplementation(() => {
      callCount++;
      if (toolCallsOnRound !== undefined && callCount === toolCallsOnRound) {
        return {
          parts: textParts("thinking..."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-1", name: "get_data", input: { query: "test" } }],
          stopReason: "tool_use",
        };
      }
      return {
        parts: textParts("done"),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

export function makeCommandProvider(command: string, toolName = "bash"): ProviderAdapter {
  let callCount = 0;
  return {
    name: "mock",
    createMessage: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          parts: textParts("running command..."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-cmd-1", name: toolName, input: { command } }],
          stopReason: "tool_use",
        };
      }
      return {
        parts: textParts("done"),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

export function makeToolCallProvider(
  toolCall: { readonly id: string; readonly name: string; readonly input: Record<string, unknown> },
  firstResponseText = "using tool...",
): ProviderAdapter {
  let callCount = 0;
  return {
    name: "mock",
    createMessage: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          parts: textParts(firstResponseText),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [toolCall],
          stopReason: "tool_use",
        };
      }
      return {
        parts: textParts("done"),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

export function makeSession(): RuntimeSession {
  return new RuntimeSession({ appName: "app", tenantId: "test-tenant", userId: "user-1", systemPrompt: "Be helpful." });
}

export function getReinjectedToolResultFromSecondCall(provider: ProviderAdapter): string {
  return getReinjectedToolResultFromCall(provider, 1);
}

export function getReinjectedToolResultFromCall(provider: ProviderAdapter, callIndex: number): string {
  const calls = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls;
  const targetCall = calls[callIndex]?.[0] as { messages?: Array<{ role?: string; parts?: Array<{ type?: string; content?: unknown }> }> } | undefined;
  const messages = targetCall?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const parts = msg.parts ?? [];
    const toolResult = parts.find((part) => part?.type === "tool_result");
    if (toolResult && typeof toolResult.content === "string") {
      return toolResult.content;
    }
  }
  throw new Error(`No reinjected tool_result content found in provider call ${callIndex + 1}.`);
}

export function getReinjectedToolResultPartFromSecondCall(provider: ProviderAdapter): {
  readonly content?: unknown;
  readonly contentParts?: unknown;
} {
  const calls = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls;
  const targetCall = calls[1]?.[0] as { messages?: Array<{ role?: string; parts?: Array<{ type?: string; content?: unknown; contentParts?: unknown }> }> } | undefined;
  const messages = targetCall?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const toolResult = (msg.parts ?? []).find((part) => part?.type === "tool_result");
    if (toolResult) {
      return toolResult;
    }
  }
  throw new Error("No reinjected tool_result part found in second provider call.");
}

export function getLastToolResultPartsFromCall(
  provider: ProviderAdapter,
  callIndex: number,
): Array<{ toolUseId: string; content: string }> {
  const calls = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls;
  const targetCall = calls[callIndex]?.[0] as
    | { messages?: Array<{ role?: string; parts?: Array<{ type?: string; toolUseId?: string; content?: unknown }> }> }
    | undefined;
  const messages = targetCall?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const parts = msg.parts ?? [];
    const toolResults = parts
      .filter((part): part is { type: "tool_result"; toolUseId?: string; content?: unknown } => part?.type === "tool_result")
      .map((part) => ({
        toolUseId: typeof part.toolUseId === "string" ? part.toolUseId : "",
        content: typeof part.content === "string" ? part.content : "",
      }));
    if (toolResults.length > 0) {
      return toolResults;
    }
  }
  throw new Error(`No reinjected tool_result parts found in provider call ${callIndex + 1}.`);
}

export const READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

export const MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "irreversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

export const IDEMPOTENT_MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};

export const FIXTURE_EFFECT_CEILING: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace", "machine", "network", "external-system"],
  reversibility: "irreversible",
  dataEgress: "sensitive-data",
  identityUse: "privileged",
  consequences: ["local-state", "external-state", "financial", "legal", "security"],
  idempotency: "non-idempotent",
};

export function makeCapabilityMap(overrides?: Partial<Capability>): ReadonlyMap<string, Capability> {
  const cap: Capability = {
    name: "get_data",
    description: "Gets data",
    schema: {},
    tags: [],
    effectEnvelope: READ_ONLY_EFFECT,
    ...overrides,
  };
  return new Map([["get_data", cap]]);
}

export function makeFixtureToolActionStore(): RuntimeToolActionClaimStore {
  const rows = new Map<string, RuntimeToolActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim: (claim) => {
      const permit = {
        claimId: claim.claimId,
        permitId: `fixture-permit:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("fixture permit already consumed");
          consumed.add(permit);
        },
      } as unknown as RuntimeToolActionClaimPermit;
      rows.set(claim.claimId, claim);
      return permit;
    },
    settle: (permit, settlement) => {
      const claim = rows.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("fixture permit was not consumed");
      rows.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "unknown" ? { unknownReason: settlement.reason } : { outcome: "success" }),
      });
    },
  };
}

export function makeFixtureModelRoundActionStore(): RuntimeModelRoundActionClaimStore {
  const rows = new Map<string, RuntimeModelRoundActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim: (claim) => {
      const permit = {
        claimId: claim.claimId,
        permitId: `fixture-model-round-permit:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("fixture model-round permit already consumed");
          consumed.add(permit);
        },
      } as unknown as RuntimeModelRoundActionClaimPermit;
      rows.set(claim.claimId, claim);
      return permit;
    },
    settle: (permit, settlement) => {
      const claim = rows.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("fixture model-round permit was not consumed");
      rows.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "unknown" ? { unknownReason: settlement.reason } : { outcome: "success" }),
      });
    },
  };
}

export function fixtureAuthorityForTool(
  toolName: string,
  config: PerCallToolConfig | undefined,
  authorizer: ToolAuthorizer | undefined,
  declaredEffect: ActionEffectEnvelope,
): AuthorityDescriptor {
  const configured = config?.toolAuthority?.get(toolName);
  if (configured && typeof configured === "object"
    && Number.isInteger(configured.level) && configured.level >= 0 && configured.level <= 4
    && typeof configured.allowed === "boolean" && typeof configured.requiresApproval === "boolean"
    && typeof configured.reason === "string") {
    return configured;
  }
  if (authorizer && toolName.startsWith("mcp:")) {
    return authorizer.authorize(toolName, declaredEffect);
  }
  if (authorizer) {
    return authorizer.authorize(toolName, declaredEffect);
  }
  if (toolName.startsWith("mcp:")) {
    return { level: 4, allowed: false, requiresApproval: true, reason: "Unregistered external tool requires approval" };
  }
  return { level: 2, allowed: true, requiresApproval: false, reason: "Fixture bundle admission" };
}

export function fixtureDeclaredEffect(toolName: string, capability: Capability | undefined): ActionEffectEnvelope {
  const effect = capability?.effectEnvelope ?? getBuiltinEffectEnvelope(toolName);
  if (!effect
    || effect.reversibility === "unknown"
    || effect.dataEgress === "unknown"
    || effect.identityUse === "unknown"
    || effect.idempotency === "unknown"
    || effect.consequences.includes("unknown")) {
    return FIXTURE_EFFECT_CEILING;
  }
  return effect;
}

export function fixtureToolActionConfig(
  orchestrator: RuntimeSessionOrchestrator,
  session: RuntimeSession,
  config: PerCallToolConfig | undefined,
): PerCallToolConfig {
  if (config?.runtimeToolActionClaims && config.runtimeModelRoundDispatch) return config;
  const hasMalformedAuthority = config?.toolAuthority && [...config.toolAuthority.values()].some((value) =>
    typeof value !== "object"
    || !Number.isInteger(value.level) || value.level < 1 || value.level > 4
    || typeof value.allowed !== "boolean"
    || typeof value.requiresApproval !== "boolean"
    || typeof value.reason !== "string"
    || (!value.allowed && !value.requiresApproval));
  const deps = (orchestrator as unknown as { readonly deps: {
    readonly provider: ProviderAdapter;
    readonly model?: string;
    readonly tools?: readonly ToolDefinition[];
    readonly materializableTools?: ReadonlyMap<string, ToolDefinition>;
    readonly capabilityMap?: ReadonlyMap<string, Capability>;
    readonly builtinTools?: ReadonlyMap<string, unknown>;
    readonly toolAuthorizer?: ToolAuthorizer;
  } }).deps;
  // These legacy fixtures construct an orchestrator without a configured
  // model. The admitted bundle still needs a concrete route, so pin the
  // synthetic model identity before the production routing check runs.
  if (!deps.model) {
    (deps as { model?: string }).model = "unknown";
  }
  const capabilities = new Map<string, Capability>([
    ...(deps.capabilityMap ?? new Map()),
    ...(config?.perCallCapabilities ?? new Map()),
  ]);
  const names = new Set<string>([
    ...(config?.toolAllowlist ?? []),
    ...(config?.toolAllowlist ? [] : (deps.tools ?? []).map((tool) => tool.name)),
    ...(config?.toolAllowlist ? [] : [...(deps.materializableTools?.keys() ?? [])]),
    ...(config?.toolAllowlist ? [] : [...(deps.builtinTools?.keys() ?? [])]),
    ...capabilities.keys(),
    ...(config?.additionalTools ?? []).map((tool) => tool.name),
  ]);
  const projectedToolPermissions = [...names].sort().map((toolName) => {
    const effectEnvelope = fixtureDeclaredEffect(toolName, capabilities.get(toolName));
    return {
      toolName,
      authority: fixtureAuthorityForTool(toolName, config, deps.toolAuthorizer, effectEnvelope),
      effectEnvelope,
    };
  });
  const allowedToolPermissions = projectedToolPermissions.filter(({ authority }) =>
    authority.allowed || authority.requiresApproval);
  const deniedToolNames = projectedToolPermissions
    .filter(({ authority }) => !authority.allowed && !authority.requiresApproval)
    .map(({ toolName }) => toolName);
  const defaultTurnId = canonicalTurnId(session.id, Math.max(session.userTurnCount + 1, 1));
  const configuredAdmissionTurnOrdinal = config?.authorityAdmission?.turnId
    ? parseCanonicalTurnId(config.authorityAdmission.turnId, session.id)
    : undefined;
  const configuredTurnOrdinal = config?.turnCorrelationId
    ? parseCanonicalTurnId(config.turnCorrelationId, session.id)
    : undefined;
  const turnId = configuredAdmissionTurnOrdinal === undefined
    ? (configuredTurnOrdinal === undefined ? defaultTurnId : canonicalTurnId(session.id, configuredTurnOrdinal))
    : canonicalTurnId(session.id, configuredAdmissionTurnOrdinal);
  const configuredOperatorTurnId = config?.authorityAdmission?.turn.operatorAdoption.status === "admitted"
    ? config.authorityAdmission.turn.operatorAdoption.decision.operatorTurnId
    : turnId;
  const revision = { revisionSetId: "runtime-tool-test-fixture", revisions: { fixture: "runtime-tool-test-fixture" } } as const;
  const bundle = defineEffectiveAuthorityAdmissionBundle({
    sessionId: session.id,
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "runtime-tool-test-fixture", revision: "1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "Runtime tool fixture admission", subjectId: session.id },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "destructive",
        admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection",
        reason: "Runtime tool fixture admission",
        completeness: "authoritative",
        toolCount: allowedToolPermissions.length,
        deniedToolCount: deniedToolNames.length,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({
          ownerSessionId: session.id,
          operatorTurnId: configuredOperatorTurnId === turnId ? configuredOperatorTurnId : turnId,
          actorId: "runtime-tool-test-fixture",
        }),
      },
      tools: { allowedToolPermissions, deniedToolNames },
      effectCeiling: FIXTURE_EFFECT_CEILING,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: {
          routeId: "runtime-tool-test-route",
          providerId: deps.provider.name,
          providerModelId: deps.model ?? "unknown",
          accountSelection: { mode: "exact", accountId: "runtime-tool-test-account", source: "route" },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: {
          status: "bound",
          routeId: "runtime-tool-test-route",
          accountId: "runtime-tool-test-account",
          credentialId: "runtime-tool-test-credential",
          credentialRevision: "sha256:runtime-tool-test-credential-revision",
        },
      },
    },
  });
  const store = makeFixtureToolActionStore();
  const modelRoundStore = makeFixtureModelRoundActionStore();
  const modelRoundIntentFingerprint = runtimeModelRoundEffectIdentity({
    fixture: "runtime-tool-test",
    sessionId: session.id,
    turnId,
  });
  return {
    ...config,
    ...(hasMalformedAuthority ? {} : { authorityAdmission: bundle }),
    turnCorrelationId: turnId,
    runtimeModelRoundDispatch: {
      admission: bundle,
      intentFingerprint: modelRoundIntentFingerprint,
      attemptId: `fixture-model-round-attempt:${session.id}:${turnId}`,
      routeId: "runtime-tool-test-route",
      accountId: "runtime-tool-test-account",
      credentialRevision: "sha256:runtime-tool-test-credential-revision",
      readAdmission: async () => bundle,
      store: modelRoundStore,
      state: { claimed: false },
    },
    ...(hasMalformedAuthority ? {} : {
      runtimeToolActionClaims: {
        admission: bundle,
        attemptId: `fixture-attempt:${session.id}:${turnId}`,
        adapterIdentity: "runtime-test-fixture",
        readAdmission: async () => bundle,
        store,
        state: { claimed: false },
      },
    }),
  };
}

const canonicalProcessMessage = RuntimeSessionOrchestrator.prototype.processMessage;
RuntimeSessionOrchestrator.prototype.processMessage = function fixtureProcessMessage(
  session: RuntimeSession,
  userParts: Parameters<RuntimeSessionOrchestrator["processMessage"]>[1],
  governedContext?: Parameters<RuntimeSessionOrchestrator["processMessage"]>[2],
  callBuiltinTools?: Parameters<RuntimeSessionOrchestrator["processMessage"]>[3],
  perCallConfig?: PerCallToolConfig,
): ReturnType<RuntimeSessionOrchestrator["processMessage"]> {
  return canonicalProcessMessage.call(
    this,
    session,
    userParts,
    governedContext,
    callBuiltinTools,
    fixtureToolActionConfig(this, session, perCallConfig),
  );
};
