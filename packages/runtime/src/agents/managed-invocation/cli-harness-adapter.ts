import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineStructuredExecutionResult,
  STRUCTURED_EXECUTION_RESULT_JSON_SCHEMA,
} from "@kilnai/core";
import type {
  ExecutionSessionEvent,
  ManagedAgentAdapterDescriptor,
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentWriteEvidence,
  ManagedAgentProviderRoute,
  StructuredExecutionResult,
} from "@kilnai/core";
import type {
  CliSession,
  CliSessionFactory,
} from "../../execution/cli-session-contract.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
} from "./index.js";
import { RuntimeSession } from "../../session/runtime-session.js";
import type { RuntimeBuiltinToolExecutor } from "../../session/runtime-session-orchestrator.types.js";
import {
  collectManagedAgentLiveWriteDecisionEvidence,
  collectManagedAgentLiveWriteEvidence,
} from "./live-write-event-bridge.js";
import {
  buildManagedInvocationResourceContext,
  createManagedInvocationRuntimeResourceReader,
  type ManagedInvocationResourceReader,
} from "./resource-context.js";
import { appendManagedResultHandoffContract } from "./handoff-prompt.js";

export interface ManagedCliHarnessAdapterConfig {
  readonly providerId: string;
  readonly model: string;
  readonly factory: CliSessionFactory;
  readonly writeAuthority?: ManagedAgentAdapterWriteAuthorityDescriptor;
  readonly filesystemBoundary?: ManagedCliHarnessFilesystemBoundaryConfig;
  readonly resourceReader?: ManagedInvocationResourceReader;
  readonly builtinToolsProvider?: () => ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
}

export interface ManagedCliHarnessFilesystemBoundaryConfig {
  readonly enabled: boolean;
  readonly trackedPaths: readonly string[];
  readonly restoreReadOnlyViolations?: boolean;
}

interface CollectedCliHarnessEvidence {
  readonly textParts: string[];
  readonly structuredOutputs: unknown[];
  readonly fileChanges: Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[];
  readonly writeDecisions: Extract<ExecutionSessionEvent, { readonly type: "write_decision" }>[];
  readonly usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
  };
  completed?: Extract<ExecutionSessionEvent, { readonly type: "completed" }>;
  error?: Extract<ExecutionSessionEvent, { readonly type: "error" }>;
}

const TIMEOUT = Symbol("managed-cli-harness-timeout");
const CANCELLED = Symbol("managed-cli-harness-cancelled");

interface FilesystemBoundarySnapshot {
  readonly entries: readonly FilesystemBoundarySnapshotEntry[];
}

interface FilesystemBoundarySnapshotEntry {
  readonly path: string;
  readonly existed: boolean;
  readonly contents?: string;
}

export class ManagedCliHarnessAdapter implements ManagedAgentRuntimeAdapter {
  readonly descriptor: ManagedAgentAdapterDescriptor;
  private readonly providerId: string;
  private readonly model: string;
  private readonly factory: CliSessionFactory;
  private readonly filesystemBoundary?: ManagedCliHarnessFilesystemBoundaryConfig;
  private readonly resourceReader?: ManagedInvocationResourceReader;
  private readonly builtinToolsProvider?: () => ReadonlyMap<string, RuntimeBuiltinToolExecutor>;

  constructor(config: ManagedCliHarnessAdapterConfig) {
    this.providerId = requireText(config.providerId, "Managed CLI harness provider id is required");
    this.model = requireText(config.model, "Managed CLI harness model is required");
    this.factory = config.factory;
    this.filesystemBoundary = config.filesystemBoundary;
    this.resourceReader = config.resourceReader;
    this.builtinToolsProvider = config.builtinToolsProvider;
    const writeAuthority = config.writeAuthority !== undefined
      ? defineManagedAgentAdapterWriteAuthorityDescriptor(config.writeAuthority)
      : undefined;
    this.descriptor = defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: `adapter:${this.providerId}:cli-harness`,
      providerId: this.providerId,
      adapterKind: "harness",
      supportedProfiles: writeAuthority !== undefined
        ? ["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes", "foundation-memory-write-proposals"]
        : ["foundation-readonly-plan"],
      supportedExecutionModes: ["cli-harness"],
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
        tokenClasses: ["input", "output", "cache_read"],
        semanticSourceGranularity: "unknown",
        evidenceBasis: "adapter",
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
    const childSessionId = `${request.parentSessionId}:managed:${request.invocationId}`;
    const cwd = request.authority.workingDirectory.path;
    const resourceReader = this.resolveResourceReader(request, childSessionId);
    const resourceContext = await buildManagedInvocationResourceContext({
      resourceUris: request.input.resourceUris,
      invocationId: request.invocationId,
      abortSignal: input.abortSignal,
      ...(resourceReader ? { resourceReader } : {}),
    });
    const system = withManagedInvocationResourceContext(request.input.summary, resourceContext?.content);
    const prompt = appendManagedResultHandoffContract(
      request.input.prompt ?? request.input.summary,
      request,
    );
    const filesystemSnapshot = await snapshotFilesystemBoundary(this.filesystemBoundary);
    const session = this.factory(system, cwd, {
      kilnSessionId: childSessionId,
      permissionPolicy: permissionPolicyFromAuthority(request, this.providerId),
      ...(request.input.handoff ? {
        structuredOutput: { schema: STRUCTURED_EXECUTION_RESULT_JSON_SCHEMA },
      } : {}),
    });
    const collected = createEmptyCollectedEvidence();
    const runPromise = this.collectRunEvidence(session, {
      kilnSessionId: childSessionId,
      prompt,
      cwd,
      system,
      ...(input.environment !== undefined ? { env: input.environment } : {}),
    }, collected);
    input.registerExecutionSettlement(runPromise);
    const timeoutPromise = sleep(request.authority.timeoutMs).then(() => TIMEOUT);
    const cancelPromise = abortSignalPromise(input.abortSignal).then(() => CANCELLED);
    const raced = await Promise.race([runPromise, timeoutPromise, cancelPromise]);

    if (typeof raced === "symbol" && raced === CANCELLED) {
      runPromise.catch(() => undefined);
      await session.dispose();
      const filesystemChanges = await collectFilesystemBoundaryChanges(filesystemSnapshot);
      const readOnlyFilesystemViolation = request.authority.writeAuthority === undefined && filesystemChanges.length > 0;
      if (readOnlyFilesystemViolation && this.filesystemBoundary?.restoreReadOnlyViolations === true) {
        await restoreFilesystemBoundary(filesystemSnapshot);
      }
      const writeEvidence = collectWriteEvidence({
        request,
        collected,
        filesystemChanges,
        readOnlyFilesystemViolation,
      });
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input, childSessionId),
        lifecycleState: "cancelled",
        transcript: transcriptPointer(request.invocationId),
        usage: usageReport(collected.usage),
        resultHandoff: {
          summary: "Managed CLI harness invocation cancelled.",
          resourceUris: writeEvidence.resultResourceUris,
          memoryWriteProposalUris: [],
        },
        ...(writeEvidence.evidence.length > 0 ? { writeEvidence: writeEvidence.evidence } : {}),
      });
    }

    if (typeof raced === "symbol") {
      runPromise.catch(() => undefined);
      await session.dispose();
      const filesystemChanges = await collectFilesystemBoundaryChanges(filesystemSnapshot);
      const readOnlyFilesystemViolation = request.authority.writeAuthority === undefined && filesystemChanges.length > 0;
      if (readOnlyFilesystemViolation && this.filesystemBoundary?.restoreReadOnlyViolations === true) {
        await restoreFilesystemBoundary(filesystemSnapshot);
      }
      const writeEvidence = collectWriteEvidence({
        request,
        collected,
        filesystemChanges,
        readOnlyFilesystemViolation,
      });
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input, childSessionId),
        lifecycleState: "timed_out",
        diagnostics: [{
          uri: managedInvocationUri(request.invocationId, "timeout"),
          kind: "timeout",
        }],
        transcript: transcriptPointer(request.invocationId),
        usage: usageReport(collected.usage),
        resultHandoff: {
          summary: formatTimeoutSummary({
            timeoutMs: request.authority.timeoutMs,
            childSessionId,
          }),
          resourceUris: [
            managedInvocationUri(request.invocationId, "timeout"),
            ...writeEvidence.resultResourceUris,
          ],
          memoryWriteProposalUris: [],
        },
        ...(writeEvidence.evidence.length > 0 ? { writeEvidence: writeEvidence.evidence } : {}),
      });
    }

    await session.dispose();
    const filesystemChanges = await collectFilesystemBoundaryChanges(filesystemSnapshot);
    const readOnlyFilesystemViolation = request.authority.writeAuthority === undefined && filesystemChanges.length > 0;
    if (readOnlyFilesystemViolation && this.filesystemBoundary?.restoreReadOnlyViolations === true) {
      await restoreFilesystemBoundary(filesystemSnapshot);
    }
    const writeEvidence = collectWriteEvidence({
      request,
      collected,
      filesystemChanges,
      readOnlyFilesystemViolation,
    });
    const structuredResult = request.input.handoff
      ? parseCliHarnessStructuredResult(
        collected.structuredOutputs.length === 1
          ? collected.structuredOutputs[0]
          : collected.structuredOutputs.length === 0 ? collected.textParts.join("") : undefined,
      )
      : undefined;
    const lifecycleState = resolveLifecycleState(request, collected, writeEvidence, structuredResult);
    const summary = structuredResult?.summary ?? summarizeResult(request, collected, writeEvidence);
    return defineManagedAgentInvocationRecord({
      ...this.baseRecord(input, childSessionId),
      lifecycleState,
      ...(lifecycleState === "failed"
        ? {
          diagnostics: [{
            uri: managedInvocationUri(request.invocationId, "diagnostics"),
            kind: "failure" as const,
          }],
        }
        : {}),
      transcript: transcriptPointer(request.invocationId),
      usage: usageReport(collected.usage),
      resultHandoff: {
        summary,
        resourceUris: [
          managedInvocationUri(request.invocationId, "transcript"),
          ...writeEvidence.resultResourceUris,
        ],
        memoryWriteProposalUris: [],
        ...(structuredResult ? { structuredResult } : {}),
      },
      ...(writeEvidence.evidence.length > 0 ? { writeEvidence: writeEvidence.evidence } : {}),
    });
  }

  private resolveResourceReader(
    request: ManagedAgentInvocationRequest,
    childSessionId: string,
  ): ManagedInvocationResourceReader | undefined {
    if (this.resourceReader) {
      return this.resourceReader;
    }
    if (!this.builtinToolsProvider) {
      return undefined;
    }
    return createManagedInvocationRuntimeResourceReader({
      builtinTools: this.builtinToolsProvider(),
      session: new RuntimeSession({
        sessionId: childSessionId,
        appName: "managed-agent",
        tenantId: request.authority.memoryScope.scope.id,
        userId: request.requestedBy,
        systemPrompt: request.input.summary,
      }),
    });
  }

  private baseRecord(
    input: ManagedAgentRuntimeInvocationInput,
    childSessionId: string,
  ): Omit<ManagedAgentInvocationRecord, "lifecycleState"> {
    const request = input.request;
    return {
      invocationId: request.invocationId,
      agentId: request.agentId,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      profile: request.profile,
      providerRoute: this.providerRoute(request.providerRoute),
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: request.authority,
      capabilitySnapshot: input.admission.capabilitySnapshot,
      childSessionId,
    };
  }

  private providerRoute(route: ManagedAgentProviderRoute): ManagedAgentProviderRoute {
    return {
      providerId: this.providerId,
      surface: "cli-harness",
      model: route.model ?? this.model,
      ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
    };
  }

  private async collectRunEvidence(
    session: CliSession,
    options: Parameters<CliSession["run"]>[0],
    collected: CollectedCliHarnessEvidence,
  ): Promise<CollectedCliHarnessEvidence> {
    for await (const event of session.run(options)) {
      if (event.type === "text_delta" && event.isThinking !== true) {
        collected.textParts.push(event.content);
        continue;
      }
      if (event.type === "structured_output") {
        collected.structuredOutputs.push(event.value);
        continue;
      }
      if (event.type === "cost_update") {
        collected.usage.inputTokens = event.inputTokens ?? collected.usage.inputTokens;
        collected.usage.outputTokens = event.outputTokens ?? collected.usage.outputTokens;
        collected.usage.cacheReadTokens = event.cacheReadTokens ?? collected.usage.cacheReadTokens;
        collected.usage.costUsd = event.usd;
        continue;
      }
      if (event.type === "file_changed") {
        collected.fileChanges.push(event);
        continue;
      }
      if (event.type === "write_decision") {
        collected.writeDecisions.push(event);
        continue;
      }
      if (event.type === "completed") {
        collected.completed = event;
        collected.usage.costUsd = event.totalUsd;
        continue;
      }
      if (event.type === "error") {
        collected.error = event;
      }
    }

    return collected;
  }
}

function parseCliHarnessStructuredResult(value: unknown): StructuredExecutionResult | undefined {
  const parsed = typeof value === "string"
    ? (() => {
      const trimmed = value.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
      try { return JSON.parse(trimmed) as unknown; } catch { return undefined; }
    })()
    : value;
  if (parsed === undefined) return undefined;
  try {
    return defineStructuredExecutionResult(parsed as StructuredExecutionResult);
  } catch {
    return undefined;
  }
}

function withManagedInvocationResourceContext(system: string, resourceContext: string | undefined): string {
  if (!resourceContext) {
    return system;
  }
  return [
    system,
    "",
    "## Managed Invocation Resource Context",
    resourceContext,
  ].join("\n");
}

function createEmptyCollectedEvidence(): CollectedCliHarnessEvidence {
  return {
    textParts: [],
    structuredOutputs: [],
    fileChanges: [],
    writeDecisions: [],
    usage: {},
  };
}

function collectWriteEvidence(input: {
  readonly request: ManagedAgentInvocationRequest;
  readonly collected: CollectedCliHarnessEvidence;
  readonly filesystemChanges: readonly Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[];
  readonly readOnlyFilesystemViolation: boolean;
}): {
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly resultResourceUris: readonly string[];
} {
  const writeEvidence = collectManagedAgentLiveWriteEvidence({
    request: input.request,
    fileChanges: input.readOnlyFilesystemViolation
      ? []
      : mergeFileChanges(input.collected.fileChanges, input.filesystemChanges),
  });
  const writeDecisionEvidence = collectManagedAgentLiveWriteDecisionEvidence({
    request: input.request,
    decisions: [
      ...input.collected.writeDecisions.map((decision) => ({
        source: "tool-result" as const,
        status: decision.status,
        providerRequestId: decision.providerRequestId,
        actor: decision.actor,
        reason: decision.reason,
        resourceUris: decision.resourceUris,
      })),
      ...(input.readOnlyFilesystemViolation
        ? [{
          source: "tool-result" as const,
          status: "denied" as const,
          providerRequestId: "filesystem-boundary-1",
          actor: "kiln-filesystem-boundary",
          reason: `Live harness modified files during read-only invocation: ${input.filesystemChanges.map((change) => change.path).join(", ")}`,
        }]
        : []),
    ],
  });
  const evidence = [
    ...writeDecisionEvidence,
    ...writeEvidence.evidence,
  ];

  return {
    evidence,
    resultResourceUris: [
      ...writeDecisionEvidence.flatMap((item) => item.resourceUris),
      ...writeEvidence.attemptResourceUris,
    ],
  };
}

function transcriptPointer(invocationId: string): ManagedAgentInvocationRecord["transcript"] {
  return {
    uri: managedInvocationUri(invocationId, "transcript"),
    redacted: "unknown",
    truncated: false,
    persisted: true,
    retention: "session",
  };
}

function usageReport(usage: CollectedCliHarnessEvidence["usage"]): ManagedAgentInvocationRecord["usage"] {
  return {
    source: "adapter",
    tokenClasses: [
      { name: "input", value: usage.inputTokens ?? "unknown" },
      { name: "output", value: usage.outputTokens ?? "unknown" },
      { name: "cache_read", value: usage.cacheReadTokens ?? "unknown" },
    ],
    cost: {
      currency: usage.costUsd !== undefined ? "USD" : "unknown",
      amount: usage.costUsd ?? "unknown",
    },
  };
}

async function snapshotFilesystemBoundary(
  config: ManagedCliHarnessFilesystemBoundaryConfig | undefined,
): Promise<FilesystemBoundarySnapshot | undefined> {
  if (config?.enabled !== true) return undefined;

  const entries = await Promise.all(config.trackedPaths.map(async (path) => {
    try {
      return {
        path,
        existed: true,
        contents: await readFile(path, "utf8"),
      } satisfies FilesystemBoundarySnapshotEntry;
    } catch {
      return {
        path,
        existed: false,
      } satisfies FilesystemBoundarySnapshotEntry;
    }
  }));

  return { entries };
}

async function collectFilesystemBoundaryChanges(
  snapshot: FilesystemBoundarySnapshot | undefined,
): Promise<Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[]> {
  if (snapshot === undefined) return [];

  const changes: Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[] = [];
  for (const entry of snapshot.entries) {
    let currentContents: string | undefined;
    let exists = true;
    try {
      currentContents = await readFile(entry.path, "utf8");
    } catch {
      exists = false;
    }

    if (!entry.existed && exists) {
      changes.push({
        type: "file_changed",
        path: entry.path,
        changeType: "created",
        linesAdded: countLines(currentContents ?? ""),
        linesRemoved: 0,
        diffTruncated: true,
      });
      continue;
    }
    if (entry.existed && !exists) {
      changes.push({
        type: "file_changed",
        path: entry.path,
        changeType: "deleted",
        linesAdded: 0,
        linesRemoved: countLines(entry.contents ?? ""),
        diffTruncated: true,
      });
      continue;
    }
    if (entry.existed && exists && currentContents !== entry.contents) {
      changes.push({
        type: "file_changed",
        path: entry.path,
        changeType: "modified",
        linesAdded: countLines(currentContents ?? ""),
        linesRemoved: countLines(entry.contents ?? ""),
        diffTruncated: true,
      });
    }
  }

  return changes;
}

async function restoreFilesystemBoundary(snapshot: FilesystemBoundarySnapshot | undefined): Promise<void> {
  if (snapshot === undefined) return;

  for (const entry of snapshot.entries) {
    if (!entry.existed) {
      await rm(entry.path, { force: true });
      continue;
    }
    await mkdir(dirname(entry.path), { recursive: true });
    await writeFile(entry.path, entry.contents ?? "", "utf8");
  }
}

function mergeFileChanges(
  emittedChanges: readonly Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[],
  filesystemChanges: readonly Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[],
): Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>[] {
  const merged = new Map<string, Extract<ExecutionSessionEvent, { readonly type: "file_changed" }>>();
  for (const change of emittedChanges) {
    merged.set(change.path, change);
  }
  for (const change of filesystemChanges) {
    if (!merged.has(change.path)) {
      merged.set(change.path, change);
    }
  }
  return [...merged.values()];
}

function countLines(contents: string): number {
  if (contents.length === 0) return 0;
  return contents.split(/\r\n|\r|\n/).length;
}

function resolveLifecycleState(
  request: ManagedAgentInvocationRequest,
  collected: CollectedCliHarnessEvidence,
  writeEvidence: ReturnType<typeof collectWriteEvidence>,
  structuredResult: StructuredExecutionResult | undefined,
): ManagedAgentInvocationRecord["lifecycleState"] {
  if (collected.error !== undefined) {
    return isCancellationError(collected.error) ? "cancelled" : "failed";
  }
  if (collected.completed && collected.completed.outcome !== "completed") {
    return "failed";
  }
  if (requiresApprovedWorkspaceWriteEvidence(request) && !hasCompletedWorkspaceWriteEvidence(writeEvidence)) {
    return "failed";
  }
  if (!hasSubstantiveResultHandoff(collected, writeEvidence, structuredResult)) {
    return "failed";
  }
  return "completed";
}

function isCancellationError(error: Extract<ExecutionSessionEvent, { readonly type: "error" }>): boolean {
  const normalized = `${error.code} ${error.message}`.toLowerCase();
  return normalized.includes("cancel") || normalized.includes("abort");
}

function summarizeResult(
  request: ManagedAgentInvocationRequest,
  collected: CollectedCliHarnessEvidence,
  writeEvidence: ReturnType<typeof collectWriteEvidence>,
): string {
  if (collected.error) {
    return `[${collected.error.code}] ${collected.error.message}`;
  }
  if (requiresApprovedWorkspaceWriteEvidence(request) && !hasCompletedWorkspaceWriteEvidence(writeEvidence)) {
    return "Managed CLI harness invocation failed: apply-approved workspace write authority completed without write-attempt evidence.";
  }
  const text = collected.textParts.join("").trim();
  return text.length > 0
    ? text
    : writeEvidence.evidence.length > 0
      ? "Managed CLI harness invocation completed with write evidence and no text output."
      : "Managed CLI harness invocation failed: the child process completed without a result handoff.";
}

function hasSubstantiveResultHandoff(
  collected: CollectedCliHarnessEvidence,
  writeEvidence: ReturnType<typeof collectWriteEvidence>,
  structuredResult: StructuredExecutionResult | undefined,
): boolean {
  return structuredResult !== undefined
    || collected.textParts.join("").trim().length > 0
    || writeEvidence.evidence.length > 0;
}

function requiresApprovedWorkspaceWriteEvidence(request: ManagedAgentInvocationRequest): boolean {
  return request.authority.writeAuthority?.scope.workspace.mode === "apply-approved"
    && request.authority.toolAuthority.writeAllowed === true
    && request.authority.workingDirectory.mode === "workspace-write";
}

function hasCompletedWorkspaceWriteEvidence(writeEvidence: ReturnType<typeof collectWriteEvidence>): boolean {
  return writeEvidence.evidence.some((evidence) => evidence.kind === "write-attempt-completed");
}

function formatTimeoutSummary(input: {
  readonly timeoutMs: number;
  readonly childSessionId: string;
}): string {
  return [
    `Managed CLI harness invocation timed out after ${input.timeoutMs}ms.`,
    `Child session: ${input.childSessionId}.`,
    "No completed child handoff was produced before timeout.",
    "Inspect the transcript and timeout diagnostic resources for replayable route, authority, context, and terminal-state evidence.",
  ].join(" ");
}

function managedInvocationUri(invocationId: string, resource: string): string {
  return `kiln://managed-invocations/${invocationId}/${resource}`;
}

function permissionPolicyFromAuthority(
  request: ManagedAgentInvocationRequest,
  providerId: string,
): NonNullable<Parameters<CliSessionFactory>[2]>["permissionPolicy"] {
  return {
    // Claude Code plan mode is its native read-only capability.  Do not lend
    // the child the interactive/default authority of its parent surface.
    approval: providerId === "claude" && request.authority.writeAuthority === undefined
      ? "untrusted"
      : "on-request",
    sandbox: request.authority.toolAuthority.writeAllowed === true
      && request.authority.workingDirectory.mode === "workspace-write"
      ? "workspace-write"
      : "read-only",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortSignalPromise(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
