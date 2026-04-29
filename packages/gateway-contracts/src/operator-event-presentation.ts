import type { OperatorSessionEvent, OperatorSessionEventKind } from "./frames.js";

export type OperatorEventTone = "info" | "running" | "success" | "warning" | "error";

export interface OperatorEventDetailItem {
  readonly label: string;
  readonly value: string;
}

export interface OperatorEventPresentation {
  readonly title: string;
  readonly summary?: string;
  readonly tone: OperatorEventTone;
  readonly details: readonly OperatorEventDetailItem[];
  readonly compactText?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatOperatorEventValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length > 0 ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null || value === undefined) return null;
  return "Structured value";
}

function formatUsd(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function labelFromKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function addItem(items: OperatorEventDetailItem[], label: string, value: unknown): void {
  const formatted = formatOperatorEventValue(value);
  if (formatted) {
    items.push({ label, value: formatted });
  }
}

function addPrimitiveItems(
  items: OperatorEventDetailItem[],
  record: Record<string, unknown> | null,
  limit: number,
  excludedKeys: readonly string[] = [],
): void {
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (items.length >= limit) return;
    if (excludedKeys.includes(key)) continue;
    addItem(items, labelFromKey(key), value);
  }
}

function eventPayloadText(payload: Record<string, unknown>): string | null {
  return readString(payload.content)
    ?? readString(payload.outputSummary)
    ?? readString(payload.output)
    ?? readString(payload.result)
    ?? readString(payload.details)
    ?? readString(payload.delta)
    ?? readString(payload.toolName);
}

function providerIdentity(payload: Record<string, unknown>): { provider: string | null; model: string | null } {
  const provider = asRecord(payload.provider);
  return {
    provider: readString(provider?.provider) ?? readString(payload.routedProvider),
    model: readString(provider?.model) ?? readString(payload.routedModel),
  };
}

function providerRoutedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const provider = providerIdentity(payload);
  const summary = [provider.provider, provider.model].filter((value): value is string => Boolean(value)).join(" · ")
    || readString(payload.reason)
    || "Provider selected";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Why", payload.reason);
  return {
    title: "Provider routed",
    summary,
    compactText: summary,
    tone: "info",
    details,
  };
}

function toolStartedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const toolName = readString(payload.toolName) ?? "tool";
  const input = asRecord(payload.input) ?? payload;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Tool", toolName);
  addItem(details, "Tool call ID", payload.toolCallId);
  addPrimitiveItems(details, input, 7, ["toolName", "toolCallId", "input"]);
  return {
    title: `Tool started: ${toolName}`,
    summary: "Execution in progress",
    compactText: toolName,
    tone: "running",
    details,
  };
}

function toolCompletedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const toolName = readString(payload.toolName) ?? "tool";
  const status = asRecord(payload.status);
  const statusValue = readString(status?.state) ?? readString(payload.status);
  const result = eventPayloadText(payload);
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Tool", toolName);
  addItem(details, "Tool call ID", payload.toolCallId);
  addItem(details, "Status", statusValue);
  addItem(details, "Result", result);
  addPrimitiveItems(details, asRecord(payload.input), 8, ["toolName", "toolCallId", "input", "status", "result"]);
  return {
    title: `Tool completed: ${toolName}`,
    summary: result ?? undefined,
    compactText: result ?? toolName,
    tone: statusValue === "succeeded" || statusValue === "success" ? "success" : "error",
    details,
  };
}

function fileChangedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const change = asRecord(payload.change) ?? payload;
  const path = readString(change.path);
  const changeType = readString(change.changeType);
  const summary = [changeType, path].filter((value): value is string => Boolean(value)).join(": ") || "File changed";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Path", path);
  addItem(details, "Change", changeType);
  addItem(details, "Lines added", readNumber(change.linesAdded));
  addItem(details, "Lines removed", readNumber(change.linesRemoved));
  return {
    title: "File changed",
    summary,
    compactText: summary,
    tone: "info",
    details,
  };
}

function costUpdatedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const provider = providerIdentity(payload);
  const usage = asRecord(payload.usage);
  const cost = asRecord(payload.cost);
  const deltaUsd = readNumber(cost?.deltaUsd) ?? 0;
  const inputTokens = readNumber(usage?.inputTokens) ?? 0;
  const outputTokens = readNumber(usage?.outputTokens) ?? 0;
  const summary = `${formatUsd(deltaUsd) ?? "$0.0000"} · ${inputTokens}↑ ${outputTokens}↓`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Cost", formatUsd(deltaUsd));
  addItem(details, "Input tokens", inputTokens);
  addItem(details, "Output tokens", outputTokens);
  return {
    title: "Cost updated",
    summary,
    compactText: summary,
    tone: "info",
    details,
  };
}

function approvalRequestedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const summary = readString(payload.action) ?? readString(payload.justification) ?? "Approval required";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Action", payload.action);
  addItem(details, "Why", payload.justification);
  addItem(details, "Approval ID", payload.approvalId);
  return {
    title: "Approval requested",
    summary,
    compactText: summary,
    tone: "warning",
    details,
  };
}

function approvalResolvedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const resolution = asRecord(payload.resolution) ?? payload;
  const decision = readString(resolution.decision) ?? "resolved";
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Approval ID", payload.approvalId ?? resolution.approvalId);
  addItem(details, "Decision", decision);
  addItem(details, "Reason", resolution.reason);
  addItem(details, "Resolved by", resolution.resolvedBy);
  return {
    title: "Approval resolved",
    summary: decision,
    compactText: decision,
    tone: decision === "approved" ? "success" : "error",
    details,
  };
}

function invocationLabel(payload: Record<string, unknown>): string {
  return readString(payload.agentName) ?? readString(payload.agentType) ?? readString(payload.agentId) ?? "agent";
}

function agentPresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const label = invocationLabel(payload);
  const durationMs = readNumber(payload.durationMs);
  const titles: Record<string, string> = {
    agent_invocation_requested: "Agent invocation requested",
    agent_invocation_started: "Agent invocation started",
    agent_invocation_completed: "Agent invocation completed",
    agent_invocation_failed: "Agent invocation failed",
    agent_invocation_cancelled: "Agent invocation cancelled",
  };
  const summary = readString(payload.resultSummary)
    ?? readString(payload.errorMessage)
    ?? readString(payload.errorCode)
    ?? readString(payload.reason)
    ?? readString(payload.cancelledBy)
    ?? (durationMs !== null ? `${label} · ${durationMs}ms` : label);
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Agent", label);
  addItem(details, "Invocation ID", payload.invocationId);
  addItem(details, "Requested by", payload.requestedBy);
  addItem(details, "Source", payload.requestSource ?? payload.source);
  addItem(details, "Attempt", readNumber(payload.attempt));
  addItem(details, "Duration", durationMs !== null ? `${durationMs} ms` : null);
  addItem(details, "Result", payload.resultSummary ?? payload.result);
  addItem(details, "Error", payload.errorMessage ?? payload.errorCode);
  addItem(details, "Reason", payload.reason);
  addPrimitiveItems(
    details,
    payload,
    8,
    ["agentName", "agentType", "agentId", "invocationId", "requestedBy", "requestSource", "source", "attempt", "durationMs", "resultSummary", "result", "errorMessage", "errorCode", "reason", "cancelledBy"],
  );
  return {
    title: titles[kind] ?? "Agent invocation",
    summary,
    compactText: summary,
    tone: kind === "agent_invocation_started"
      ? "running"
      : kind === "agent_invocation_failed"
        ? "error"
        : kind === "agent_invocation_cancelled"
          ? "warning"
          : kind === "agent_invocation_completed"
            ? "success"
            : "info",
    details,
  };
}

function continuityPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const runtimeContinuity = asRecord(payload.runtimeContinuity);
  const decision = readString(payload.decision) ?? readString(runtimeContinuity?.strategy);
  const reason = readString(payload.reason) ?? readString(runtimeContinuity?.selectionReason);
  const summary = `${decision ?? "Continuity decided"}${reason ? ` · ${reason}` : ""}`;
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Decision", decision);
  addItem(details, "Reason", reason);
  addItem(details, "Strategy", runtimeContinuity?.strategy);
  addItem(details, "Selection", runtimeContinuity?.selectionReason);
  addItem(details, "Feedback", runtimeContinuity?.feedbackLabel);
  addItem(details, "Provider", payload.provider);
  return {
    title: "Continuity decided",
    summary,
    compactText: summary,
    tone: "info",
    details,
  };
}

function turnCompletedPresentation(payload: Record<string, unknown>): OperatorEventPresentation {
  const runtimeContinuity = asRecord(payload.runtimeContinuity);
  const authorityStatus = asRecord(payload.authorityStatus);
  const provider = providerIdentity(payload);
  const routeSummary = [provider.provider, provider.model].filter((value): value is string => Boolean(value)).join(" · ");
  const summary = readString(payload.outcome) ?? (routeSummary || undefined);
  const details: OperatorEventDetailItem[] = [];
  addItem(details, "Provider", provider.provider);
  addItem(details, "Model", provider.model);
  addItem(details, "Outcome", payload.outcome);
  addItem(details, "Continuity", runtimeContinuity?.strategy);
  addItem(details, "Why", runtimeContinuity?.selectionReason);
  addItem(details, "Authority", authorityStatus?.effective);
  addItem(details, "Input tokens", readNumber(payload.inputTokens));
  addItem(details, "Output tokens", readNumber(payload.outputTokens));
  return {
    title: "Turn completed",
    summary,
    compactText: summary,
    tone: "success",
    details,
  };
}

function genericPresentation(kind: OperatorSessionEventKind, payload: Record<string, unknown>): OperatorEventPresentation {
  const details: OperatorEventDetailItem[] = [];
  addPrimitiveItems(details, payload, 6);
  const title = labelFromKey(kind);
  return {
    title,
    summary: eventPayloadText(payload) ?? undefined,
    compactText: eventPayloadText(payload) ?? title,
    tone: kind === "error_recorded" ? "error" : "info",
    details,
  };
}

export function presentOperatorEventPayload(
  kind: OperatorSessionEventKind,
  payload: Record<string, unknown>,
): OperatorEventPresentation {
  switch (kind) {
    case "provider_routed":
      return providerRoutedPresentation(payload);
    case "tool_call_started":
      return toolStartedPresentation(payload);
    case "tool_call_completed":
      return toolCompletedPresentation(payload);
    case "file_changed":
      return fileChangedPresentation(payload);
    case "cost_updated":
      return costUpdatedPresentation(payload);
    case "approval_requested":
      return approvalRequestedPresentation(payload);
    case "approval_resolved":
      return approvalResolvedPresentation(payload);
    case "agent_invocation_requested":
    case "agent_invocation_started":
    case "agent_invocation_completed":
    case "agent_invocation_failed":
    case "agent_invocation_cancelled":
      return agentPresentation(kind, payload);
    case "continuity_decided":
      return continuityPresentation(payload);
    case "turn_completed":
      return turnCompletedPresentation(payload);
    default:
      return genericPresentation(kind, payload);
  }
}

export function presentOperatorSessionEvent(
  event: Pick<OperatorSessionEvent, "kind" | "payload">,
): OperatorEventPresentation {
  return presentOperatorEventPayload(event.kind, event.payload);
}
