import type { GuiBrowserSessionCapture, GuiBrowserSessionState, GuiInboundFrame, GuiInteractiveUseSnapshot } from "@kilnai/gateway-contracts";

const BROWSER_STREAM_UNAVAILABLE_REASON = "No live browser stream transport is configured.";

export interface InteractiveUseToolResultFrameInput {
  readonly kilnSessionId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly timestamp: string;
  readonly status: GuiInteractiveUseSnapshot["status"];
  readonly metadata?: Record<string, unknown>;
  readonly error?: string;
}

export function projectInteractiveUseFrameFromToolResult(
  input: InteractiveUseToolResultFrameInput,
): Extract<GuiInboundFrame, { type: "interactive_use_updated" }> | null {
  const metadata = input.metadata;
  if (!metadata || metadata.kind !== "interactive") {
    return null;
  }
  const target = readTarget(metadata.target);
  if (!target) {
    return null;
  }

  const observation = readRecord(metadata.observation);
  const action = readRecord(metadata.action);
  const error = input.error ?? readString(metadata.error) ?? readString(metadata.errorCode);
  const snapshot: GuiInteractiveUseSnapshot = {
    target,
    status: input.status,
    updatedAt: input.timestamp,
    ...(input.kilnSessionId ? { kilnSessionId: input.kilnSessionId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...stringField("provider", metadata.provider),
    ...stringField("sessionId", metadata.sessionId),
    ...stringField("operation", metadata.operation),
    ...stringField("url", observation?.url),
    ...stringField("title", observation?.title),
    ...stringField("visibleText", observation?.visibleText),
    ...stringField("windowTitle", observation?.windowTitle),
    ...stringField("application", observation?.application),
    ...stringField("screenshotUri", observation?.screenshotUri),
    ...stringField("screenshotDataUrl", observation?.screenshotDataUrl),
    ...stringField("actionSummary", summarizeAction(action)),
    ...(error ? { error } : {}),
  };

  const browserSession = target === "browser"
    ? browserSessionStateFromSnapshot(snapshot, metadata, observation)
    : null;

  return {
    type: "interactive_use_updated",
    snapshot,
    ...(browserSession ? { browserSession } : {}),
  };
}

function readTarget(value: unknown): GuiInteractiveUseSnapshot["target"] | null {
  return value === "browser" || value === "computer" ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringField<TName extends string>(name: TName, value: unknown): Record<TName, string> | Record<string, never> {
  const text = readString(value);
  return text ? { [name]: text } as Record<TName, string> : {};
}

function browserSessionStateFromSnapshot(
  snapshot: GuiInteractiveUseSnapshot,
  metadata: Record<string, unknown>,
  observation: Record<string, unknown> | null,
): GuiBrowserSessionState {
  return {
    target: "browser",
    status: snapshot.status,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.kilnSessionId ? { kilnSessionId: snapshot.kilnSessionId } : {}),
    ...(snapshot.toolCallId ? { toolCallId: snapshot.toolCallId } : {}),
    ...(snapshot.toolName ? { toolName: snapshot.toolName } : {}),
    ...(snapshot.provider ? { provider: snapshot.provider } : {}),
    ...(snapshot.sessionId ? { sessionId: snapshot.sessionId } : {}),
    ...(snapshot.operation ? { operation: snapshot.operation } : {}),
    ...(snapshot.url ? { url: snapshot.url } : {}),
    ...(snapshot.title ? { title: snapshot.title } : {}),
    ...(snapshot.visibleText ? { visibleText: snapshot.visibleText } : {}),
    ownership: snapshot.operation === "session_stop" ? "released" : "agent",
    viewMode: "snapshot",
    stream: {
      status: "unavailable",
      reason: BROWSER_STREAM_UNAVAILABLE_REASON,
    },
    ...captureField(metadata, observation, snapshot.screenshotUri),
    ...(snapshot.actionSummary ? { actionSummary: snapshot.actionSummary } : {}),
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

function captureField(
  metadata: Record<string, unknown>,
  observation: Record<string, unknown> | null,
  screenshotUri: string | undefined,
): { readonly latestCapture: GuiBrowserSessionCapture } | Record<string, never> {
  const capture = latestCapture(metadata, screenshotUri);
  if (capture) {
    return { latestCapture: capture };
  }
  const observedUri = readString(observation?.screenshotUri);
  return observedUri ? { latestCapture: { uri: observedUri, relation: "snapshot" } } : {};
}

function latestCapture(metadata: Record<string, unknown>, screenshotUri: string | undefined): GuiBrowserSessionCapture | null {
  const links = Array.isArray(metadata.resourceLinks) ? metadata.resourceLinks : [];
  const captures = links
    .map(readCapture)
    .filter((capture): capture is GuiBrowserSessionCapture => Boolean(capture));
  if (captures.length === 0) {
    return screenshotUri ? { uri: screenshotUri, relation: "snapshot" } : null;
  }
  return captures.find((capture) => capture.uri === screenshotUri)
    ?? captures.find((capture) => capture.relation === "snapshot")
    ?? captures[0]
    ?? null;
}

function readCapture(value: unknown): GuiBrowserSessionCapture | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const uri = readString(record.uri);
  if (!uri) {
    return null;
  }
  const sizeBytes = typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) ? record.sizeBytes : null;
  return {
    uri,
    ...stringField("label", record.label),
    ...stringField("relation", record.relation),
    ...stringField("mimeType", record.mimeType),
    ...(sizeBytes !== null ? { sizeBytes } : {}),
  };
}

function summarizeAction(action: Record<string, unknown> | null): string | null {
  if (!action) {
    return null;
  }
  const type = readString(action.type);
  if (!type) {
    return null;
  }
  const selector = readString(action.selector);
  if (selector) {
    return `${type} ${selector}`;
  }
  const x = typeof action.x === "number" && Number.isFinite(action.x) ? action.x : null;
  const y = typeof action.y === "number" && Number.isFinite(action.y) ? action.y : null;
  if (x !== null && y !== null) {
    return `${type} ${x},${y}`;
  }
  const keys = Array.isArray(action.keys) ? action.keys.filter((item): item is string => typeof item === "string") : [];
  if (keys.length > 0) {
    return `${type} ${keys.join("+")}`;
  }
  return type;
}
