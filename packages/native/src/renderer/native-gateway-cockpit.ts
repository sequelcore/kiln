import type {
  GuiInboundFrame,
  GuiOutboundFrame,
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

export function createNativeManagedAgentCancelControlFrame(input: {
  readonly sessionId: string;
  readonly invocationId: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
