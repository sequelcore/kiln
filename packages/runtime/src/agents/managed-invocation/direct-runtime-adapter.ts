import type {
  AuthorityDescriptor,
  Capability,
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentWriteEvidence,
  ProviderAdapter,
  SandboxConfig,
  ToolDefinition,
} from "@kilnai/core";
import {
  DefaultContextGovernor,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentInvocationRecord,
  extractText,
  renderProjectedContext,
  SandboxPolicy,
  textParts,
} from "@kilnai/core";
import { RuntimeSession } from "../../session/runtime-session.js";
import { RuntimeSessionOrchestrator } from "../../session/runtime-session-orchestrator.js";
import type {
  OrchestratorDeps,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
} from "../../session/runtime-session-orchestrator.types.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
} from "./index.js";
import {
  collectManagedAgentLiveWriteEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "./live-write-event-bridge.js";

export interface ManagedDirectProviderRuntimeAdapterConfig {
  readonly providerId: string;
  readonly model?: string;
  readonly provider: ProviderAdapter;
  readonly tools: readonly ToolDefinition[];
  readonly builtinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly capabilityMap?: ReadonlyMap<string, Capability>;
  readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  readonly writeAuthority?: ManagedAgentAdapterWriteAuthorityDescriptor;
  readonly maxToolRounds?: number;
}

const TIMEOUT = { type: "managed-direct-runtime-timeout" } as const;

export class ManagedDirectProviderRuntimeAdapter implements ManagedAgentRuntimeAdapter {
  readonly descriptor;
  private readonly providerId: string;
  private readonly model?: string;
  private readonly provider: ProviderAdapter;
  private readonly tools: readonly ToolDefinition[];
  private readonly builtinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  private readonly capabilityMap?: ReadonlyMap<string, Capability>;
  private readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  private readonly maxToolRounds?: number;

  constructor(config: ManagedDirectProviderRuntimeAdapterConfig) {
    this.providerId = requireText(config.providerId, "Managed direct provider id is required");
    this.model = config.model;
    this.provider = config.provider;
    this.tools = config.tools;
    this.builtinTools = config.builtinTools;
    this.capabilityMap = config.capabilityMap;
    this.toolAuthority = config.toolAuthority;
    this.maxToolRounds = config.maxToolRounds;
    const writeAuthority = config.writeAuthority !== undefined
      ? defineManagedAgentAdapterWriteAuthorityDescriptor(config.writeAuthority)
      : undefined;
    this.descriptor = defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: `adapter:${this.providerId}:direct-provider`,
      providerId: this.providerId,
      adapterKind: "direct",
      supportedProfiles: writeAuthority !== undefined
        ? ["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes", "foundation-memory-write-proposals"]
        : ["foundation-readonly-plan"],
      supportedExecutionModes: ["direct-provider"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: {
        supported: true,
        diagnosticArtifactOnTimeout: true,
      },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      ...(writeAuthority !== undefined ? { writeAuthority } : {}),
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    });
  }

  async invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord> {
    const request = input.request;
    const childSessionId = buildChildSessionId(request);
    const childTurnId = `${childSessionId}:turn:1`;
    const childSession = new RuntimeSession({
      sessionId: childSessionId,
      appName: "managed-agent",
      tenantId: request.authority.memoryScope.scope.id,
      userId: request.requestedBy,
      systemPrompt: request.input.summary,
    });
    const execution = this.runChildRuntime(input, childSession);
    const timeout = sleep(request.authority.timeoutMs).then(() => TIMEOUT);
    const raced: ManagedAgentInvocationRecord | typeof TIMEOUT = await Promise.race([execution, timeout]);

    if (raced === TIMEOUT) {
      execution.catch(() => undefined);
      const timeoutSummary = formatTimeoutSummary({
        timeoutMs: request.authority.timeoutMs,
        childSessionId,
        childTurnId,
      });
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: "timed-out",
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        diagnostics: [{
          uri: managedInvocationUri(request.invocationId, "timeout"),
          kind: "timeout",
        }],
        usage: unknownRuntimeUsage(),
        resultHandoff: {
          summary: timeoutSummary,
          resourceUris: [managedInvocationUri(request.invocationId, "timeout")],
          memoryWriteProposalUris: [],
        },
      });
    }

    return raced as ManagedAgentInvocationRecord;
  }

  private async runChildRuntime(
    input: ManagedAgentRuntimeInvocationInput,
    childSession: RuntimeSession,
  ): Promise<ManagedAgentInvocationRecord> {
    const request = input.request;
    const childSessionId = childSession.id;
    const childTurnId = `${childSessionId}:turn:1`;
    try {
      const allowedToolNames = new Set(request.authority.toolAuthority.allowedToolNames);
      const tools = this.tools.filter((tool) => allowedToolNames.has(tool.name));
      const capabilityMap = this.capabilityMap ? filterMap(this.capabilityMap, allowedToolNames) : undefined;
      const toolAuthority = this.toolAuthority ? filterMap(this.toolAuthority, allowedToolNames) : undefined;
      const builtinTools = withManagedToolSandbox(
        this.builtinTools,
        createManagedToolSandbox(request),
      );
      const deps: OrchestratorDeps = {
        provider: this.provider,
        ...(this.model ? { model: this.model } : {}),
        maxToolRounds: this.maxToolRounds,
        tools,
        builtinTools,
        ...(capabilityMap ? { capabilityMap } : {}),
      };
      const orchestrator = new RuntimeSessionOrchestrator(deps);
      const perCallConfig: PerCallToolConfig = {
        tenantId: request.authority.memoryScope.scope.id,
        toolAllowlist: allowedToolNames,
        additionalTools: tools,
        ...(capabilityMap ? { perCallCapabilities: capabilityMap } : {}),
        ...(toolAuthority ? { toolAuthority } : {}),
        ...(request.providerRoute.reasoningEffort ? { reasoningEffort: request.providerRoute.reasoningEffort as PerCallToolConfig["reasoningEffort"] } : {}),
      };
      const result = await orchestrator.processMessage(
        childSession,
        textParts(request.input.prompt ?? request.input.summary),
        buildManagedResourceContext(request.input.resourceUris),
        builtinTools,
        perCallConfig,
      );
      const summary = clipSummary(extractText(result.parts));
      const writeEvidence = collectDirectRuntimeWriteEvidence(request, result.toolExecutions ?? []);

      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: "completed",
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        usage: {
          source: "runtime",
          tokenClasses: [
            { name: "input", value: result.inputTokens },
            { name: "output", value: result.outputTokens },
            { name: "cache_read", value: result.cacheReadTokens },
            { name: "cache_write", value: result.cacheWriteTokens },
          ],
          cost: {
            currency: "unknown",
            amount: "unknown",
          },
        },
        resultHandoff: {
          summary,
          resourceUris: [
            managedInvocationUri(request.invocationId, "transcript"),
            ...writeEvidence.resultResourceUris,
          ],
          memoryWriteProposalUris: [],
        },
        ...(writeEvidence.evidence.length > 0 ? { writeEvidence: writeEvidence.evidence } : {}),
      });
    } catch (err) {
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: "failed",
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        diagnostics: [{
          uri: managedInvocationUri(request.invocationId, "failure"),
          kind: "failure",
        }],
        usage: unknownRuntimeUsage(),
        resultHandoff: {
          summary: `Direct provider managed invocation failed. ${err instanceof Error ? err.message : String(err)}`,
          resourceUris: [managedInvocationUri(request.invocationId, "failure")],
          memoryWriteProposalUris: [],
        },
      });
    }
  }

  private baseRecord(input: ManagedAgentRuntimeInvocationInput): Omit<
    ManagedAgentInvocationRecord,
    "lifecycleState" | "childSessionId" | "childTurnId" | "transcript" | "diagnostics" | "usage" | "resultHandoff" | "writeEvidence"
  > {
    const request = input.request;
    return {
      invocationId: request.invocationId,
      agentId: request.agentId,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      profile: request.profile,
      providerRoute: this.providerRoute(request.providerRoute),
      adapterKind: request.adapterKind,
      executionMode: request.executionMode,
      authority: request.authority,
      capabilitySnapshot: input.admission.capabilitySnapshot,
    };
  }

  private providerRoute(route: ManagedAgentInvocationRequest["providerRoute"]): ManagedAgentInvocationRequest["providerRoute"] {
    return {
      providerId: this.providerId,
      surface: "direct-provider",
      ...(route.model ?? this.model ? { model: route.model ?? this.model } : {}),
      ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
    };
  }
}

function buildManagedResourceContext(resourceUris: readonly string[] | undefined) {
  if (!resourceUris || resourceUris.length === 0) {
    return undefined;
  }
  const projected = new DefaultContextGovernor<undefined, "artifact", "balanced">().project({
    artifacts: [{
      kind: "artifact",
      source: "managed-invocation:resource-uris",
      required: true,
      score: 1,
      content: `Admitted resources:\n${resourceUris.join("\n")}`,
    }],
  });
  const audit = projected.auditTrail?.[projected.auditTrail.length - 1];
  return {
    content: renderProjectedContext(projected),
    ...(audit ? { audit } : {}),
  };
}

function filterMap<T>(source: ReadonlyMap<string, T>, allowedNames: ReadonlySet<string>): ReadonlyMap<string, T> {
  const filtered = new Map<string, T>();
  for (const [name, value] of source) {
    if (allowedNames.has(name)) {
      filtered.set(name, value);
    }
  }
  return filtered;
}

function withManagedToolSandbox(
  source: ReadonlyMap<string, RuntimeBuiltinToolExecutor>,
  sandbox: unknown,
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> {
  const wrapped = new Map<string, RuntimeBuiltinToolExecutor>();
  for (const [name, executor] of source) {
    wrapped.set(name, async (input, context) =>
      executor(input, withSandboxContext(context, sandbox)));
  }
  return wrapped;
}

function withSandboxContext(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  sandbox: unknown,
): RuntimeBuiltinToolExecutionContext | undefined {
  if (!context) {
    return undefined;
  }
  return {
    ...context,
    sandbox,
  };
}

function createManagedToolSandbox(request: ManagedAgentInvocationRequest): {
  readonly cwd: string;
  readonly policy: SandboxPolicy;
} {
  const workingDirectory = request.authority.workingDirectory.path;
  const config: SandboxConfig = {
    fsPolicy: request.authority.toolAuthority.writeAllowed === true
      && request.authority.workingDirectory.mode !== "read-only"
      ? "read-write"
      : "read-only",
    netPolicy: request.authority.toolAuthority.networkAllowed === true ? "full" : "none",
    allowedPaths: resolveAllowedPaths(request),
    deniedPaths: request.authority.writeAuthority?.scope.workspace.deniedPaths ?? [],
    allowedDomains: request.authority.toolAuthority.networkAllowed === true ? ["*"] : [],
  };
  return {
    cwd: workingDirectory,
    policy: new SandboxPolicy({
      config,
      projectPath: workingDirectory,
    }),
  };
}

function resolveAllowedPaths(request: ManagedAgentInvocationRequest): readonly string[] {
  const workspaceScope = request.authority.writeAuthority?.scope.workspace;
  if (workspaceScope && workspaceScope.allowedPaths.length > 0) {
    return workspaceScope.allowedPaths;
  }
  return [request.authority.workingDirectory.path];
}

function buildChildSessionId(request: ManagedAgentInvocationRequest): string {
  return `${request.parentSessionId}:managed:${request.invocationId}`;
}

function collectDirectRuntimeWriteEvidence(
  request: ManagedAgentInvocationRequest,
  toolExecutions: readonly ToolExecutionSummary[],
): {
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly resultResourceUris: readonly string[];
} {
  const fileChanges = toolExecutions.flatMap((execution) =>
    (execution.fileChanges ?? []).map((change) => ({
      source: "tool-result" as const,
      path: change.path,
      changeType: change.changeType,
      ...(change.linesAdded !== undefined ? { linesAdded: change.linesAdded } : {}),
      ...(change.linesRemoved !== undefined ? { linesRemoved: change.linesRemoved } : {}),
      ...(change.diffPreview !== undefined ? { diffPreview: change.diffPreview } : {}),
      ...(change.diffTruncated !== undefined ? { diffTruncated: change.diffTruncated } : {}),
    }))
  );
  if (fileChanges.length === 0) {
    return {
      evidence: [],
      resultResourceUris: [],
    };
  }

  const collected = collectManagedAgentLiveWriteEvidence({
    request,
    fileChanges: normalizeManagedAgentLiveWriteChanges(fileChanges),
  });
  return {
    evidence: collected.evidence,
    resultResourceUris: collected.attemptResourceUris,
  };
}

function managedInvocationUri(invocationId: string, kind: string): string {
  return `kiln://managed-invocations/${invocationId}/${kind}`;
}

function transcriptPointer(invocationId: string) {
  return {
    uri: managedInvocationUri(invocationId, "transcript"),
    redacted: "unknown" as const,
    truncated: false,
    persisted: true,
    retention: "session" as const,
  };
}

function unknownRuntimeUsage() {
  return {
    source: "runtime" as const,
    tokenClasses: [
      { name: "input", value: "unknown" as const },
      { name: "output", value: "unknown" as const },
      { name: "cache_read", value: "unknown" as const },
      { name: "cache_write", value: "unknown" as const },
    ],
    cost: {
      currency: "unknown" as const,
      amount: "unknown" as const,
    },
  };
}

function clipSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return "Direct provider managed invocation completed.";
  }
  return trimmed.length > 2000 ? `${trimmed.slice(0, 1997)}...` : trimmed;
}

function formatTimeoutSummary(input: {
  readonly timeoutMs: number;
  readonly childSessionId: string;
  readonly childTurnId: string;
}): string {
  return [
    `Direct provider managed invocation timed out after ${input.timeoutMs}ms.`,
    `Child session: ${input.childSessionId}.`,
    `Child turn: ${input.childTurnId}.`,
    "The parent invocation returned at the timeout boundary; partial child trace is unavailable from the direct provider adapter.",
  ].join(" ");
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(timeoutMs, 0)));
}

function requireText(value: string | undefined, message: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}
