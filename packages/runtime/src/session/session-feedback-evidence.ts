import type {
  CanonicalSessionEvent,
  FeedbackEvidenceItemInput,
  FeedbackEvidenceSelection,
} from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";

export interface RuntimeFeedbackEvidenceCollectorInput {
  readonly session: RuntimeSession;
  readonly selection: FeedbackEvidenceSelection;
  readonly gitStatus?: string;
  readonly maxTranscriptMessages?: number;
  readonly maxContentLength?: number;
}

const DEFAULT_MAX_TRANSCRIPT_MESSAGES = 6;
const DEFAULT_MAX_CONTENT_LENGTH = 4_000;

export function collectRuntimeFeedbackEvidence(
  input: RuntimeFeedbackEvidenceCollectorInput,
): readonly FeedbackEvidenceItemInput[] {
  const maxContentLength = input.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  const evidence: FeedbackEvidenceItemInput[] = [];

  if (input.selection.includeSessionSummary) {
    evidence.push({
      kind: "session-summary",
      title: "Runtime session summary",
      content: truncateContent(renderSessionSummary(input.session), maxContentLength),
    });
  }

  if (input.selection.includeTranscriptExcerpts) {
    const transcript = renderTranscriptExcerpt(input.session, input.maxTranscriptMessages ?? DEFAULT_MAX_TRANSCRIPT_MESSAGES);
    if (transcript) {
      evidence.push({
        kind: "transcript-excerpt",
        title: "Recent transcript excerpt",
        content: truncateContent(transcript, maxContentLength),
      });
    }
  }

  if (input.selection.includeToolFailures) {
    const toolFailures = renderToolFailures(input.session.sessionEvents);
    if (toolFailures) {
      evidence.push({
        kind: "tool-failure",
        title: "Runtime tool failures",
        content: truncateContent(toolFailures, maxContentLength),
      });
    }
  }

  if (input.selection.includeCommandOutput) {
    const commandOutput = renderCommandOutput(input.session.sessionEvents);
    if (commandOutput) {
      evidence.push({
        kind: "command-output",
        title: "Runtime command output",
        content: truncateContent(commandOutput, maxContentLength),
      });
    }
  }

  if (input.selection.includeEnvironment) {
    evidence.push({
      kind: "environment",
      title: "Runtime session environment",
      content: truncateContent(renderRuntimeEnvironment(input.session), maxContentLength),
    });
  }

  if (input.selection.includeGitStatus && input.gitStatus?.trim()) {
    evidence.push({
      kind: "git-status",
      title: "Runtime git status",
      content: truncateContent(input.gitStatus.trim(), maxContentLength),
    });
  }

  if (input.selection.includeFileChangeSummary) {
    const fileChanges = renderFileChanges(input.session.sessionEvents);
    if (fileChanges) {
      evidence.push({
        kind: "file-change-summary",
        title: "Runtime file changes",
        content: truncateContent(fileChanges, maxContentLength),
      });
    }
  }

  if (input.selection.includeLogs) {
    const logs = renderLogExcerpts(input.session.sessionEvents);
    if (logs) {
      evidence.push({
        kind: "log-excerpt",
        title: "Runtime log excerpts",
        content: truncateContent(logs, maxContentLength),
      });
    }
  }

  if (input.selection.includeDiagnosticFindings) {
    const diagnostics = renderDiagnostics(input.session.sessionEvents);
    if (diagnostics) {
      evidence.push({
        kind: "diagnostic-finding",
        title: "Runtime diagnostic findings",
        content: truncateContent(diagnostics, maxContentLength),
      });
    }
  }

  return evidence;
}

function renderSessionSummary(session: RuntimeSession): string {
  const ledger = session.sessionLedger;
  return [
    `Session: ${session.id}`,
    `App: ${session.appName}`,
    `Tenant: ${session.tenantId}`,
    `Mode: ${session.sessionMode}`,
    `Current phase: ${ledger.currentPhase}`,
    `Turn depth: ${ledger.turnDepth ?? session.userTurnCount}`,
    `Message count: ${session.messageCount}`,
    `Tool calls: ${ledger.toolCallCount ?? 0}`,
    ...(ledger.lastProvider ? [`Last provider: ${ledger.lastProvider}`] : []),
    ...(ledger.lastSummary ? [`Last summary: ${ledger.lastSummary}`] : []),
    ...(ledger.lastError ? [`Last error: ${ledger.lastError}`] : []),
  ].join("\n");
}

function renderTranscriptExcerpt(session: RuntimeSession, maxMessages: number): string | null {
  const messages = session.conversationHistory.slice(-maxMessages);
  if (messages.length === 0) {
    return null;
  }

  return messages
    .map((message, index) => {
      const text = extractText(message.parts).trim();
      return `${index + 1}. ${message.role}: ${text || "[non-text content]"}`;
    })
    .join("\n");
}

function renderToolFailures(events: readonly CanonicalSessionEvent[]): string | null {
  const failures = events
    .filter((event): event is Extract<CanonicalSessionEvent, { readonly kind: "tool_call_completed" }> =>
      event.kind === "tool_call_completed" && event.status.state === "failed"
    )
    .map((event) => {
      const status = event.status.state === "failed" ? event.status : undefined;
      return [
        `Tool: ${event.toolName}`,
        `Tool call: ${event.toolCallId}`,
        ...(status?.errorCode ? [`Error code: ${status.errorCode}`] : []),
        ...(status?.errorMessage ? [`Error message: ${status.errorMessage}`] : []),
        ...(event.outputSummary ? [`Summary: ${event.outputSummary}`] : []),
      ].join("\n");
    });

  return failures.length > 0 ? failures.join("\n\n") : null;
}

function renderCommandOutput(events: readonly CanonicalSessionEvent[]): string | null {
  const outputs = events
    .filter((event): event is Extract<CanonicalSessionEvent, { readonly kind: "tool_call_completed" }> =>
      event.kind === "tool_call_completed" && Boolean(event.output || event.outputSummary)
    )
    .map((event) => [
      `Tool: ${event.toolName}`,
      `Tool call: ${event.toolCallId}`,
      `Status: ${event.status.state}`,
      ...(event.outputSummary ? [`Summary: ${event.outputSummary}`] : []),
      ...(event.output ? ["Output:", event.output] : []),
    ].join("\n"));

  return outputs.length > 0 ? outputs.join("\n\n") : null;
}

function renderRuntimeEnvironment(session: RuntimeSession): string {
  return [
    `Session: ${session.id}`,
    `App: ${session.appName}`,
    `Tenant: ${session.tenantId}`,
    `User: ${session.userId}`,
    `Created at: ${session.createdAt.toISOString()}`,
    `Last activity at: ${session.lastActivityAt.toISOString()}`,
    `Session events: ${session.sessionEvents.length}`,
  ].join("\n");
}

function renderFileChanges(events: readonly CanonicalSessionEvent[]): string | null {
  const fileChanges = events
    .filter((event): event is Extract<CanonicalSessionEvent, { readonly kind: "file_changed" }> =>
      event.kind === "file_changed"
    )
    .map((event) => [
      `Path: ${event.change.path}`,
      `Change: ${event.change.changeType}`,
      ...(event.change.linesAdded !== undefined ? [`Lines added: ${event.change.linesAdded}`] : []),
      ...(event.change.linesRemoved !== undefined ? [`Lines removed: ${event.change.linesRemoved}`] : []),
      ...(event.change.diffPreview ? ["Diff preview:", event.change.diffPreview] : []),
      ...(event.change.diffTruncated ? ["Diff truncated: true"] : []),
    ].join("\n"));

  return fileChanges.length > 0 ? fileChanges.join("\n\n") : null;
}

function renderDiagnostics(events: readonly CanonicalSessionEvent[]): string | null {
  const errors = events
    .filter((event): event is Extract<CanonicalSessionEvent, { readonly kind: "error_recorded" }> =>
      event.kind === "error_recorded"
    )
    .map((event) => [
      `Error code: ${event.errorCode}`,
      `Message: ${event.message}`,
      `Retriable: ${event.retriable ? "yes" : "no"}`,
      ...(event.details ? ["Details:", JSON.stringify(event.details, null, 2)] : []),
    ].join("\n"));

  const managedInvocations = events
    .filter((event): event is Extract<CanonicalSessionEvent, {
      readonly kind: "agent_invocation_completed" | "agent_invocation_failed" | "agent_invocation_cancelled";
    }> =>
      event.kind === "agent_invocation_completed"
      || event.kind === "agent_invocation_failed"
      || event.kind === "agent_invocation_cancelled"
    )
    .flatMap((event) => renderManagedInvocationDiagnostics(event));

  const diagnostics = [...errors, ...managedInvocations];
  return diagnostics.length > 0 ? diagnostics.join("\n\n") : null;
}

function renderLogExcerpts(events: readonly CanonicalSessionEvent[]): string | null {
  const logs = events.flatMap((event) => {
    if (event.kind === "error_recorded") {
      return [[
        `Event: ${event.kind}`,
        `Error code: ${event.errorCode}`,
        `Message: ${event.message}`,
      ].join("\n")];
    }
    if (event.kind === "tool_call_completed" && event.status.state === "failed") {
      return [[
        `Event: ${event.kind}`,
        `Tool: ${event.toolName}`,
        ...(event.outputSummary ? [`Summary: ${event.outputSummary}`] : []),
        ...(event.output ? ["Output:", event.output] : []),
      ].join("\n")];
    }
    if (event.kind === "agent_invocation_failed" || event.kind === "agent_invocation_cancelled") {
      return [[
        `Event: ${event.kind}`,
        `Invocation: ${event.invocationId}`,
        ...(event.kind === "agent_invocation_failed" ? [`Error: ${event.errorMessage}`] : []),
        ...(event.kind === "agent_invocation_cancelled" && event.reason ? [`Reason: ${event.reason}`] : []),
      ].join("\n")];
    }
    return [];
  });

  return logs.length > 0 ? logs.join("\n\n") : null;
}

function renderManagedInvocationDiagnostics(
  event: Extract<CanonicalSessionEvent, {
    readonly kind: "agent_invocation_completed" | "agent_invocation_failed" | "agent_invocation_cancelled";
  }>,
): readonly string[] {
  const evidence = event.managedInvocationEvidence;
  const base = [
    `Managed invocation: ${event.invocationId}`,
    `Agent: ${event.agentId}`,
    `Status: ${event.kind.replace("agent_invocation_", "")}`,
    ...(event.kind === "agent_invocation_failed" ? [`Error code: ${event.errorCode ?? "unknown"}`, `Error message: ${event.errorMessage}`] : []),
    ...(event.kind === "agent_invocation_cancelled" && event.reason ? [`Reason: ${event.reason}`] : []),
    ...(event.kind === "agent_invocation_completed" && event.resultSummary ? [`Result summary: ${event.resultSummary}`] : []),
  ];

  const evidenceLines = [
    ...(evidence?.childSessionId ? [`Child session: ${evidence.childSessionId}`] : []),
    ...(evidence?.childTurnId ? [`Child turn: ${evidence.childTurnId}`] : []),
    ...(evidence?.transcript ? [`Transcript: ${evidence.transcript.uri}`] : []),
    ...(evidence?.diagnostics?.map((diagnostic) => `Diagnostic ${diagnostic.kind}: ${diagnostic.uri}`) ?? []),
    ...(evidence?.resultHandoff ? [
      `Result handoff: ${evidence.resultHandoff.summary}`,
      ...evidence.resultHandoff.resourceUris.map((uri) => `Result resource: ${uri}`),
      ...evidence.resultHandoff.memoryWriteProposalUris.map((uri) => `Memory write proposal: ${uri}`),
    ] : []),
    ...(evidence?.writeEvidence?.map((writeEvidence) => `Write evidence ${writeEvidence.kind}: ${writeEvidence.summary}`) ?? []),
  ];

  return [...base, ...evidenceLines].length > base.length
    || event.kind === "agent_invocation_failed"
    || event.kind === "agent_invocation_cancelled"
    ? [[...base, ...evidenceLines].join("\n")]
    : [];
}

function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, Math.max(0, maxLength - 24))}\n[truncated for feedback]`;
}
