import type {
  GuiBrowserSessionCapture,
  GuiBrowserSessionState,
  GuiInteractiveUseSnapshot,
  GuiSessionEvent,
} from "@kilnai/gateway-contracts";
import { isObjectRecord, readString, stringField } from "./unknown-value.js";

/**
 * Projects the runtime's interactive-use (browser/computer tool) evidence out
 * of a persisted `tool_call_completed` event, and derives the browser-session
 * snapshot shape from it. Pure, no store dependency.
 */

const BROWSER_STREAM_UNAVAILABLE_REASON = "No live browser stream transport is configured.";

export function interactiveSnapshotFromPersistedToolEvent(
  sessionId: string,
  event: GuiSessionEvent,
  payload: Record<string, unknown>,
  status: Record<string, unknown> | null,
): GuiInteractiveUseSnapshot | null {
  const metadata = isObjectRecord(payload.metadata) ? payload.metadata : null;
  if (metadata?.kind !== "interactive") {
    return null;
  }
  const target = readInteractiveTarget(metadata.target);
  if (!target) {
    return null;
  }
  const observation = isObjectRecord(metadata.observation) ? metadata.observation : {};
  return {
    target,
    status: readInteractiveStatus(status?.state),
    updatedAt: event.timestamp,
    kilnSessionId: sessionId,
    ...stringField("toolCallId", readString(payload.toolCallId)),
    ...stringField("toolCallScopeId", readString(payload.toolCallScopeId)),
    ...stringField("toolName", readString(payload.toolName)),
    ...stringField("provider", readString(metadata.provider)),
    ...stringField("sessionId", readString(metadata.sessionId)),
    ...stringField("operation", readString(metadata.operation)),
    ...stringField("url", readString(observation.url)),
    ...stringField("title", readString(observation.title)),
    ...stringField("visibleText", readString(observation.visibleText)),
    ...stringField("windowTitle", readString(observation.windowTitle)),
    ...stringField("application", readString(observation.application)),
    ...stringField("closeMethod", readString(observation.closeMethod)),
    ...stringField("screenshotUri", readString(observation.screenshotUri)),
    ...stringField("screenshotDataUrl", readString(observation.screenshotDataUrl)),
    ...stringField("error", readString(payload.output)),
  };
}

export function browserSessionStateFromSnapshot(
  snapshot: GuiInteractiveUseSnapshot | null,
): GuiBrowserSessionState | null {
  if (snapshot?.target !== "browser") {
    return null;
  }
  return {
    target: "browser",
    status: snapshot.status,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.kilnSessionId ? { kilnSessionId: snapshot.kilnSessionId } : {}),
    ...(snapshot.toolCallId ? { toolCallId: snapshot.toolCallId } : {}),
    ...(snapshot.toolCallScopeId ? { toolCallScopeId: snapshot.toolCallScopeId } : {}),
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
    ...browserCaptureField(snapshot.screenshotUri),
    ...(snapshot.actionSummary ? { actionSummary: snapshot.actionSummary } : {}),
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

function browserCaptureField(
  screenshotUri: string | undefined,
): { readonly latestCapture: GuiBrowserSessionCapture } | Record<string, never> {
  return screenshotUri ? { latestCapture: { uri: screenshotUri, relation: "snapshot" } } : {};
}

function readInteractiveTarget(value: unknown): GuiInteractiveUseSnapshot["target"] | null {
  return value === "browser" || value === "computer" ? value : null;
}

function readInteractiveStatus(value: unknown): GuiInteractiveUseSnapshot["status"] {
  return value === "failed" ? "failed" : value === "running" ? "running" : "succeeded";
}
