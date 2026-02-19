export type SessionStatus = "idle" | "starting" | "running" | "error" | "completed";

export interface StateSnapshot {
  phase: string;
  tasks: TaskNode[];
  cost: CostSummary;
  sessionActive: boolean;
  sessionStatus: SessionStatus;
  statusMessage: string;
  workers: WorkerStatus[];
  qualityGates: QualityGate[];
  output: string[];
  events: Array<{ event: string; data: Record<string, unknown>; timestamp: number }>;
}

export interface TaskNode {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "pruned";
  depth: number;
  children: TaskNode[];
}

export interface CostSummary {
  total: number;
  byRole: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
}

export interface WorkerStatus {
  id: string;
  role: string;
  status: "idle" | "working" | "done" | "error";
  currentTask?: string;
}

export interface QualityGate {
  name: string;
  passed: boolean;
  message?: string;
}

export interface SnapshotMessage {
  type: "snapshot";
  data: StateSnapshot;
}

export interface EventMessage {
  type: "event";
  event: string;
  data: Record<string, unknown>;
}

export interface OutputMessage {
  type: "output";
  stream: "stdout" | "stderr";
  text: string;
}

export interface SessionStartedMessage {
  type: "session_started";
  sessionId: string;
}

export interface ExitMessage {
  type: "exit";
  code: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface SessionStatusMessage {
  type: "session_status";
  status: SessionStatus;
  message?: string;
}

export interface PongMessage {
  type: "pong";
}

export type ServerMessage =
  | SnapshotMessage
  | EventMessage
  | OutputMessage
  | SessionStartedMessage
  | ExitMessage
  | ErrorMessage
  | SessionStatusMessage
  | PongMessage;

export interface PingMessage {
  type: "ping";
}

export interface StartSessionMessage {
  type: "start_session";
  task: string;
}

export interface StopSessionMessage {
  type: "stop_session";
}

export type ClientMessage = PingMessage | StartSessionMessage | StopSessionMessage;
