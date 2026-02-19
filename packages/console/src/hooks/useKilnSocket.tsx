import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";
import type {
  ClientMessage,
  CostSummary,
  QualityGate,
  ServerMessage,
  SessionStatus,
  TaskNode,
  WorkerStatus,
} from "../lib/protocol";

export interface SocketState {
  connected: boolean;
  sessionActive: boolean;
  sessionStatus: SessionStatus;
  statusMessage: string;
  phase: string;
  tasks: TaskNode[];
  cost: CostSummary;
  workers: WorkerStatus[];
  qualityGates: QualityGate[];
  output: string[];
  events: Array<{ event: string; data: Record<string, unknown>; timestamp: number }>;
  error: string | null;
}

type SocketAction =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "snapshot"; message: ServerMessage & { type: "snapshot" } }
  | { type: "event"; message: ServerMessage & { type: "event" } }
  | { type: "output"; message: ServerMessage & { type: "output" } }
  | { type: "session_started" }
  | { type: "exit" }
  | { type: "error"; message: string }
  | { type: "session_status"; status: SessionStatus; message?: string };

const MAX_OUTPUT_LINES = 500;
const MAX_EVENTS = 200;

const DEFAULT_COST: CostSummary = { total: 0, byRole: {}, inputTokens: 0, outputTokens: 0 };

const initialState: SocketState = {
  connected: false,
  sessionActive: false,
  sessionStatus: "idle",
  statusMessage: "",
  phase: "idle",
  tasks: [],
  cost: DEFAULT_COST,
  workers: [],
  qualityGates: [],
  output: [],
  events: [],
  error: null,
};

function deriveSessionActive(status: SessionStatus): boolean {
  return status === "starting" || status === "running";
}

function reducer(state: SocketState, action: SocketAction): SocketState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: true, error: null };
    case "disconnected":
      return { ...state, connected: false };
    case "snapshot": {
      const d = action.message.data;
      const sessionStatus = d.sessionStatus ?? (d.sessionActive ? "running" : "idle");
      return {
        ...state,
        phase: d.phase ?? "idle",
        tasks: d.tasks ?? [],
        cost: d.cost ?? DEFAULT_COST,
        sessionActive: deriveSessionActive(sessionStatus),
        sessionStatus,
        statusMessage: d.statusMessage ?? "",
        workers: d.workers ?? [],
        qualityGates: d.qualityGates ?? [],
        output: d.output ?? state.output,
        events: d.events ?? state.events,
      };
    }
    case "event":
      return {
        ...state,
        events: [
          ...state.events.slice(-(MAX_EVENTS - 1)),
          { event: action.message.event, data: action.message.data, timestamp: Date.now() },
        ],
      };
    case "output":
      return {
        ...state,
        output: [...state.output.slice(-(MAX_OUTPUT_LINES - 1)), action.message.text],
      };
    case "session_status": {
      const status = action.status;
      return {
        ...state,
        sessionStatus: status,
        statusMessage: action.message ?? "",
        sessionActive: deriveSessionActive(status),
        error: status === "error" ? (action.message ?? "Unknown error") : state.error,
      };
    }
    case "session_started":
      return { ...state, sessionActive: true, sessionStatus: "running", statusMessage: "Session active", output: [], events: [], error: null };
    case "exit":
      return { ...state, sessionActive: false, sessionStatus: "completed", statusMessage: "Session completed" };
    case "error":
      return { ...state, error: action.message, sessionStatus: "error", statusMessage: action.message ?? "", sessionActive: false };
  }
}

interface KilnSocketValue {
  state: SocketState;
  startSession: (task: string) => void;
  stopSession: () => void;
  connected: boolean;
}

const KilnSocketContext = createContext<KilnSocketValue | null>(null);

export function KilnSocketProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      dispatch({ type: "connected" });
    };

    ws.onclose = () => {
      dispatch({ type: "disconnected" });
      reconnectTimerRef.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        switch (msg.type) {
          case "snapshot":
            dispatch({ type: "snapshot", message: msg });
            break;
          case "event":
            dispatch({ type: "event", message: msg });
            break;
          case "output":
            dispatch({ type: "output", message: msg });
            break;
          case "session_started":
            dispatch({ type: "session_started" });
            break;
          case "exit":
            dispatch({ type: "exit" });
            break;
          case "error":
            dispatch({ type: "error", message: msg.message });
            break;
          case "session_status":
            dispatch({ type: "session_status", status: msg.status, message: msg.message });
            break;
          case "pong":
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }, []);

  useEffect(() => {
    connect();
    const pingInterval = setInterval(() => {
      send({ type: "ping" });
    }, 30000);
    return () => {
      clearInterval(pingInterval);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect, send]);

  const startSession = useCallback(
    (task: string) => {
      send({ type: "start_session", task });
    },
    [send],
  );

  const stopSession = useCallback(() => {
    send({ type: "stop_session" });
  }, [send]);

  return (
    <KilnSocketContext value={{ state, startSession, stopSession, connected: state.connected }}>
      {children}
    </KilnSocketContext>
  );
}

export function useKilnSocket(): KilnSocketValue {
  const ctx = useContext(KilnSocketContext);
  if (!ctx) throw new Error("useKilnSocket must be used within KilnSocketProvider");
  return ctx;
}
