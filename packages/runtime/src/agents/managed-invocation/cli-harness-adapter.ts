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
} from "@kilnai/core";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentWriteEvidence,
  ManagedAgentProviderRoute,
} from "@kilnai/core";
import type {
  CliSession,
  CliSessionEvent,
  CliSessionFactory,
} from "../../execution/cli-session-contract.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
} from "./index.js";
import {
  collectManagedAgentLiveWriteDecisionEvidence,
  collectManagedAgentLiveWriteEvidence,
} from "./live-write-event-bridge.js";

export interface ManagedCliHarnessAdapterConfig {
  readonly providerId: string;
  readonly model: string;
  readonly factory: CliSessionFactory;
  readonly writeAuthority?: ManagedAgentAdapterWriteAuthorityDescriptor;
  readonly filesystemBoundary?: ManagedCliHarnessFilesystemBoundaryConfig;
}

export interface ManagedCliHarnessFilesystemBoundaryConfig {
  readonly enabled: boolean;
  readonly trackedPaths: readonly string[];
  readonly restoreReadOnlyViolations?: boolean;
}

interface CollectedCliHarnessEvidence {
  readonly textParts: string[];
  readonly fileChanges: Extract<CliSessionEvent, { readonly type: "file_changed" }>[];
  readonly writeDecisions: Extract<CliSessionEvent, { readonly type: "write_decision" }>[];
  readonly usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
  };
  completed?: Extract<CliSessionEvent, { readonly type: "completed" }>;
  error?: Extract<CliSessionEvent, { readonly type: "error" }>;
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

  constructor(config: ManagedCliHarnessAdapterConfig) {
    this.providerId = requireText(config.providerId, "Managed CLI harness provider id is required");
    this.model = requireText(config.model, "Managed CLI harness model is required");
    this.factory = config.factory;
    this.filesystemBoundary = config.filesystemBoundary;
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
    const system = request.input.summary;
    const prompt = request.input.prompt ?? request.input.summary;
    const filesystemSnapshot = await snapshotFilesystemBoundary(this.filesystemBoundary);
    const session = this.factory(system, cwd, {
      kilnSessionId: childSessionId,
      permissionPolicy: permissionPolicyFromAuthority(request),
    });
    const collected = createEmptyCollectedEvidence();
    const runPromise = this.collectRunEvidence(session, {
      kilnSessionId: childSessionId,
      prompt,
      cwd,
      system,
      ...(input.environment !== undefined ? { env: input.environment } : {}),
    }, collected);
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
          summary: "Managed CLI harness invocation timed out.",
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
    const lifecycleState = resolveLifecycleState(collected, writeEvidence);
    const summary = summarizeResult(collected, writeEvidence);
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
      },
      ...(writeEvidence.evidence.length > 0 ? { writeEvidence: writeEvidence.evidence } : {}),
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

function createEmptyCollectedEvidence(): CollectedCliHarnessEvidence {
  return {
    textParts: [],
    fileChanges: [],
    writeDecisions: [],
    usage: {},
  };
}

function collectWriteEvidence(input: {
  readonly request: ManagedAgentInvocationRequest;
  readonly collected: CollectedCliHarnessEvidence;
  readonly filesystemChanges: readonly Extract<CliSessionEvent, { readonly type: "file_changed" }>[];
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
      { name: "input_tokens", value: usage.inputTokens ?? "unknown" },
      { name: "output_tokens", value: usage.outputTokens ?? "unknown" },
      { name: "cache_read_tokens", value: usage.cacheReadTokens ?? "unknown" },
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
): Promise<Extract<CliSessionEvent, { readonly type: "file_changed" }>[]> {
  if (snapshot === undefined) return [];

  const changes: Extract<CliSessionEvent, { readonly type: "file_changed" }>[] = [];
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
  emittedChanges: readonly Extract<CliSessionEvent, { readonly type: "file_changed" }>[],
  filesystemChanges: readonly Extract<CliSessionEvent, { readonly type: "file_changed" }>[],
): Extract<CliSessionEvent, { readonly type: "file_changed" }>[] {
  const merged = new Map<string, Extract<CliSessionEvent, { readonly type: "file_changed" }>>();
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
  collected: CollectedCliHarnessEvidence,
  writeEvidence: ReturnType<typeof collectWriteEvidence>,
): ManagedAgentInvocationRecord["lifecycleState"] {
  if (collected.error !== undefined) {
    return isCancellationError(collected.error) ? "cancelled" : "failed";
  }
  if (collected.completed?.isError) {
    return "failed";
  }
  if (!hasSubstantiveResultHandoff(collected, writeEvidence)) {
    return "failed";
  }
  return "completed";
}

function isCancellationError(error: Extract<CliSessionEvent, { readonly type: "error" }>): boolean {
  const normalized = `${error.code} ${error.message}`.toLowerCase();
  return normalized.includes("cancel") || normalized.includes("abort");
}

function summarizeResult(
  collected: CollectedCliHarnessEvidence,
  writeEvidence: ReturnType<typeof collectWriteEvidence>,
): string {
  if (collected.error) {
    return `[${collected.error.code}] ${collected.error.message}`;
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
): boolean {
  return collected.textParts.join("").trim().length > 0
    || writeEvidence.evidence.length > 0;
}

function managedInvocationUri(invocationId: string, resource: string): string {
  return `kiln://managed-invocations/${invocationId}/${resource}`;
}

function permissionPolicyFromAuthority(
  request: ManagedAgentInvocationRequest,
): NonNullable<Parameters<CliSessionFactory>[2]>["permissionPolicy"] {
  return {
    approval: "on-request",
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
