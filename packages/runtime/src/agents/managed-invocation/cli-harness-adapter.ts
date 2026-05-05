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
  readonly text: string;
  readonly fileChanges: readonly Extract<CliSessionEvent, { readonly type: "file_changed" }>[];
  readonly writeDecisions: readonly Extract<CliSessionEvent, { readonly type: "write_decision" }>[];
  readonly usage: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly costUsd?: number;
  };
  readonly completed?: Extract<CliSessionEvent, { readonly type: "completed" }>;
  readonly error?: Extract<CliSessionEvent, { readonly type: "error" }>;
}

const TIMEOUT = Symbol("managed-cli-harness-timeout");

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
    const session = this.factory(system, cwd, { kilnSessionId: childSessionId });
    const runPromise = this.collectRunEvidence(session, {
      kilnSessionId: childSessionId,
      prompt,
      cwd,
      system,
    });
    const timeoutPromise = sleep(request.authority.timeoutMs).then(() => TIMEOUT);
    const raced = await Promise.race([runPromise, timeoutPromise]);

    if (typeof raced === "symbol") {
      runPromise.catch(() => undefined);
      await session.dispose();
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input, childSessionId),
        lifecycleState: "timed-out",
        diagnostics: [{
          uri: managedInvocationUri(request.invocationId, "timeout"),
          kind: "timeout",
        }],
        transcript: transcriptPointer(request.invocationId),
        usage: unknownUsageReport(),
        resultHandoff: {
          summary: "Managed CLI harness invocation timed out.",
          resourceUris: [managedInvocationUri(request.invocationId, "timeout")],
          memoryWriteProposalUris: [],
        },
      });
    }

    await session.dispose();
    const collected = raced;
    const filesystemChanges = await collectFilesystemBoundaryChanges(filesystemSnapshot);
    const readOnlyFilesystemViolation = request.authority.writeAuthority === undefined && filesystemChanges.length > 0;
    if (readOnlyFilesystemViolation && this.filesystemBoundary?.restoreReadOnlyViolations === true) {
      await restoreFilesystemBoundary(filesystemSnapshot);
    }
    const lifecycleState = collected.error || collected.completed?.isError ? "failed" : "completed";
    const summary = summarizeResult(collected);
    const writeEvidence = collectManagedAgentLiveWriteEvidence({
      request,
      fileChanges: readOnlyFilesystemViolation
        ? []
        : mergeFileChanges(collected.fileChanges, filesystemChanges),
    });
    const writeDecisionEvidence = collectManagedAgentLiveWriteDecisionEvidence({
      request,
      decisions: [
        ...collected.writeDecisions.map((decision) => ({
          source: "tool-result" as const,
          status: decision.status,
          providerRequestId: decision.providerRequestId,
          actor: decision.actor,
          reason: decision.reason,
          resourceUris: decision.resourceUris,
        })),
        ...(readOnlyFilesystemViolation
          ? [{
            source: "tool-result" as const,
            status: "denied" as const,
            providerRequestId: "filesystem-boundary-1",
            actor: "kiln-filesystem-boundary",
            reason: `Live harness modified files during read-only invocation: ${filesystemChanges.map((change) => change.path).join(", ")}`,
          }]
          : []),
      ],
    });
    const collectedWriteEvidence = [
      ...writeDecisionEvidence,
      ...writeEvidence.evidence,
    ];
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
          ...writeDecisionEvidence.flatMap((evidence) => evidence.resourceUris),
          ...writeEvidence.attemptResourceUris,
        ],
        memoryWriteProposalUris: [],
      },
      ...(collectedWriteEvidence.length > 0 ? { writeEvidence: collectedWriteEvidence } : {}),
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
  ): Promise<CollectedCliHarnessEvidence> {
    const textParts: string[] = [];
    const fileChanges: Extract<CliSessionEvent, { readonly type: "file_changed" }>[] = [];
    const writeDecisions: Extract<CliSessionEvent, { readonly type: "write_decision" }>[] = [];
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cacheReadTokens: number | undefined;
    let costUsd: number | undefined;
    let completed: Extract<CliSessionEvent, { readonly type: "completed" }> | undefined;
    let error: Extract<CliSessionEvent, { readonly type: "error" }> | undefined;

    for await (const event of session.run(options)) {
      if (event.type === "text_delta" && event.isThinking !== true) {
        textParts.push(event.content);
        continue;
      }
      if (event.type === "cost_update") {
        inputTokens = event.inputTokens ?? inputTokens;
        outputTokens = event.outputTokens ?? outputTokens;
        cacheReadTokens = event.cacheReadTokens ?? cacheReadTokens;
        costUsd = event.usd;
        continue;
      }
      if (event.type === "file_changed") {
        fileChanges.push(event);
        continue;
      }
      if (event.type === "write_decision") {
        writeDecisions.push(event);
        continue;
      }
      if (event.type === "completed") {
        completed = event;
        costUsd = event.totalUsd;
        continue;
      }
      if (event.type === "error") {
        error = event;
      }
    }

    return {
      text: textParts.join("").trim(),
      fileChanges,
      writeDecisions,
      usage: {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
      },
      ...(completed !== undefined ? { completed } : {}),
      ...(error !== undefined ? { error } : {}),
    };
  }
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

function unknownUsageReport(): ManagedAgentInvocationRecord["usage"] {
  return usageReport({});
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

function summarizeResult(collected: CollectedCliHarnessEvidence): string {
  if (collected.error) {
    return `[${collected.error.code}] ${collected.error.message}`;
  }
  return collected.text.length > 0
    ? collected.text
    : "Managed CLI harness invocation completed without text output.";
}

function managedInvocationUri(invocationId: string, resource: string): string {
  return `kiln://managed-invocations/${invocationId}/${resource}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
