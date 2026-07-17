import type {
  GuiInboundFrame,
  GuiOutboundFrame,
  OperatorCockpitManagedAgentDrilldownTarget,
  OperatorSessionEvent,
} from "@kilnai/gateway-contracts";

export type NativeGatewayCockpitConnectionState = "planned" | "open" | "closed" | "error";

export interface NativeGatewayCockpitClosedFrame {
  readonly type: "native_gateway_closed";
  readonly reason: string;
}

export interface NativeGatewayCockpitFrameState {
  readonly connectionState: NativeGatewayCockpitConnectionState;
  readonly events: readonly OperatorSessionEvent[];
  readonly error?: string;
}

export interface NativeWorkItemSummary {
  readonly id: string;
  readonly resourceUri: string;
  readonly summary: string;
  readonly status: string;
  readonly workflowProfile: string;
  readonly authorityProfile?: string;
  readonly assignedAgentProfile?: string;
  readonly expectedEvidence: readonly string[];
  readonly providedEvidence: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly pendingPauseRequirementCount: number;
  readonly updatedAt: string;
}

export function resolveNativeGatewayCockpitWebSocketUrl(
  gatewayUrl: string,
  userId = "native-operator",
): string {
  let url: URL;
  try {
    url = new URL(gatewayUrl);
  } catch {
    url = new URL("http://localhost:4810");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    url = new URL("http://localhost:4810");
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/gui/ws";
  url.search = "";
  url.searchParams.set("userId", userId);
  return url.toString();
}

export function createNativeGatewayCockpitFrameState(): NativeGatewayCockpitFrameState {
  return {
    connectionState: "planned",
    events: [],
  };
}

export function selectNativeManagedAgentDrilldownTarget(
  events: readonly OperatorSessionEvent[],
): OperatorCockpitManagedAgentDrilldownTarget | undefined {
  const event = [...events].sort(compareSessionEvents).findLast((candidate) => {
    const payload = asRecord(candidate.payload);
    return Boolean(readManagedInvocationId(payload));
  });
  if (!event) {
    return undefined;
  }
  const payload = asRecord(event.payload);
  const managedInvocationId = readManagedInvocationId(payload);
  if (!managedInvocationId) {
    return undefined;
  }
  return {
    instanceId: readString(payload.instanceId) ?? "native-local",
    sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
    managedInvocationId,
    replayEventId: event.eventId,
  };
}

export function selectNativeWorkItems(events: readonly OperatorSessionEvent[]): readonly NativeWorkItemSummary[] {
  const items = new Map<string, NativeWorkItemSummary>();
  for (const event of [...events].sort(compareSessionEvents)) {
    if (
      event.kind !== "work_item_updated"
      && event.kind !== "work_item_execution_started"
      && event.kind !== "work_item_execution_finished"
    ) {
      continue;
    }
    const payload = asRecord(event.payload);
    const workItem = asRecord(payload.workItem);
    const id = readString(workItem.id);
    const summary = readString(workItem.summary);
    const status = readString(workItem.status);
    const workflowProfile = readString(workItem.workflowProfile);
    if (!id || !summary || !status || !workflowProfile) {
      continue;
    }
    const expectedEvidence = readStringArray(workItem.expectedEvidence);
    const providedEvidence = readStringArray(workItem.providedEvidence);
    const authorityProfile = readString(workItem.authorityProfile);
    const assignedAgentProfile = readString(workItem.assignedAgentProfile);
    const missingEvidence = [...new Set([
      ...readStringArray(workItem.missingEvidence),
      ...expectedEvidence.filter((evidence) => !providedEvidence.includes(evidence)),
      ...(workItem.missingResidualRisk === true ? ["residual-risk"] : []),
    ])];
    items.set(id, {
      id,
      resourceUri: readString(workItem.resourceUri) ?? `kiln://session/work-items/${encodeURIComponent(id)}`,
      summary,
      status,
      workflowProfile,
      ...(authorityProfile ? { authorityProfile } : {}),
      ...(assignedAgentProfile ? { assignedAgentProfile } : {}),
      expectedEvidence,
      providedEvidence,
      missingEvidence,
      pendingPauseRequirementCount: countPendingPauseRequirements(workItem.pauseRequirements),
      updatedAt: readString(workItem.updatedAt) ?? event.timestamp,
    });
  }
  return [...items.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createNativeManagedAgentCancelControlFrame(input: {
  readonly sessionId: string;
  readonly invocationId: string;
  readonly gatewayTargetId?: string;
  readonly requestId?: string;
  readonly reason?: string;
}): Extract<GuiOutboundFrame, { readonly type: "managed_agent_control" }> {
  const sessionId = input.sessionId.trim();
  const invocationId = input.invocationId.trim();
  if (!sessionId || !invocationId) {
    throw new Error("Native managed-agent cancellation requires sessionId and invocationId.");
  }
  const requestId = input.requestId?.trim();
  const reason = input.reason?.trim();
  return {
    type: "managed_agent_control",
    action: "cancel",
    ...(input.gatewayTargetId?.trim() ? { gatewayTargetId: input.gatewayTargetId.trim() } : {}),
    sessionId,
    invocationId,
    ...(requestId ? { requestId } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function reduceNativeGatewayCockpitFrame(
  state: NativeGatewayCockpitFrameState,
  frame: GuiInboundFrame | NativeGatewayCockpitClosedFrame,
): NativeGatewayCockpitFrameState {
  if (frame.type === "native_gateway_closed") {
    return {
      ...state,
      connectionState: "closed",
      error: frame.reason,
    };
  }

  if (frame.type === "welcome") {
    return {
      ...state,
      connectionState: "open",
      error: undefined,
    };
  }

  if (frame.type === "session_event") {
    if (state.events.some((event) => event.eventId === frame.event.eventId)) {
      return state;
    }
    return {
      ...state,
      connectionState: "open",
      error: undefined,
      events: [...state.events, frame.event],
    };
  }

  if (frame.type === "error") {
    return {
      ...state,
      connectionState: "error",
      error: frame.message,
    };
  }

  return state;
}

export function readNativeGatewayCockpitFrame(value: unknown): GuiInboundFrame | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "welcome") {
    return value as GuiInboundFrame;
  }
  if (value.type === "session_event" && isOperatorSessionEvent(value.event)) {
    return value as GuiInboundFrame;
  }
  if (value.type === "error" && typeof value.message === "string") {
    return value as GuiInboundFrame;
  }
  if (value.type === "managed_agent_control_result") {
    return value as GuiInboundFrame;
  }
  return null;
}

function isOperatorSessionEvent(value: unknown): value is OperatorSessionEvent {
  return isRecord(value)
    && typeof value.eventId === "string"
    && typeof value.kilnSessionId === "string"
    && typeof value.sequence === "number"
    && typeof value.timestamp === "string"
    && typeof value.kind === "string"
    && isRecord(value.payload);
}

function compareSessionEvents(a: OperatorSessionEvent, b: OperatorSessionEvent): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  const timestampCompare = a.timestamp.localeCompare(b.timestamp);
  return timestampCompare === 0 ? a.eventId.localeCompare(b.eventId) : timestampCompare;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const text = readString(entry);
    return text ? [text] : [];
  });
}

function countPendingPauseRequirements(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.filter((entry) => asRecord(entry).status === "pending").length;
}

function readManagedInvocationId(payload: Record<string, unknown>): string | undefined {
  const attempt = asRecord(payload.attempt);
  const workItem = asRecord(payload.workItem);
  const adoptionGate = asRecord(payload.managedOrchestrationAdoptionGate);
  return readString(payload.managedInvocationId)
    ?? readString(payload.invocationId)
    ?? readString(payload.latestManagedInvocationId)
    ?? readString(attempt.managedInvocationId)
    ?? readString(workItem.latestManagedInvocationId)
    ?? readString(adoptionGate.childId);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
