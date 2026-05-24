import type {
  GuiInboundFrame,
  GuiManagedAgentControlAction,
  GuiManagedAgentControlResultFrame,
  OperatorCockpitInvocationProjection,
  OperatorCockpitReadOnlyProjection,
  OperatorSessionEvent,
  OperatorSessionEventKind,
} from "@kilnai/gateway-contracts";
import {
  projectOperatorCockpitReadOnlyView,
} from "@kilnai/gateway-contracts";
import type { KilnAppConfig } from "../config.js";
import { SessionStore, TranscriptStore, type PersistedTranscriptEvent } from "../wrapper/session-store.js";

const MANAGED_AGENT_EVENT_KINDS: readonly OperatorSessionEventKind[] = [
  "agent_invocation_requested",
  "agent_invocation_started",
  "agent_invocation_completed",
  "agent_invocation_failed",
  "agent_invocation_cancelled",
];
const MANAGED_AGENT_WORK_ITEM_EVENT_KINDS: readonly OperatorSessionEventKind[] = [
  "work_item_updated",
  "work_item_execution_started",
  "work_item_execution_finished",
];

export interface ManagedAgentCommandOptions {
  readonly projectPath?: string;
  readonly projectedAt?: () => string;
  readonly controlRequestId?: () => string;
  readonly controlTimeoutMs?: number;
  readonly webSocketFactory?: ManagedAgentGatewayWebSocketFactory;
}

export interface ManagedAgentGatewaySocket {
  onopen?: (() => void) | null;
  onmessage?: ((event: { readonly data: unknown }) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onclose?: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type ManagedAgentGatewayWebSocketFactory = (url: string) => ManagedAgentGatewaySocket;

export interface ManagedAgentCancelControlInput {
  readonly gatewayUrl: string;
  readonly sessionId: string;
  readonly invocationId: string;
  readonly reason?: string;
  readonly requestId?: string;
  readonly timeoutMs?: number;
  readonly webSocketFactory?: ManagedAgentGatewayWebSocketFactory;
}

export interface ManagedAgentJoinControlInput {
  readonly gatewayUrl: string;
  readonly sessionId: string;
  readonly invocationId: string;
  readonly requestId?: string;
  readonly timeoutMs?: number;
  readonly webSocketFactory?: ManagedAgentGatewayWebSocketFactory;
}

export interface ManagedAgentJoinControlResult {
  readonly result: GuiManagedAgentControlResultFrame;
  readonly terminalEvent?: OperatorSessionEvent;
}

const DEFAULT_MANAGED_AGENT_GATEWAY_URL = "http://localhost:4810";
const DEFAULT_MANAGED_AGENT_CONTROL_TIMEOUT_MS = 10_000;
const CLI_MANAGED_AGENT_OPERATOR_ID = "cli-operator";

export async function managedAgentCommand(
  _appConfig: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
  options: ManagedAgentCommandOptions = {},
): Promise<void> {
  const root = options.projectPath ?? process.cwd();
  const transcriptStore = new TranscriptStore(root);

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printManagedAgentHelp();
    return;
  }

  const sessionId = await resolveManagedAgentCommandSessionId(root, args);
  if (!sessionId) {
    throw new Error("No session selected. Pass --session <id> or run a Kiln session first.");
  }

  const projectedAt = options.projectedAt?.() ?? new Date().toISOString();
  const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, sessionId, { projectedAt });

  switch (subcommand) {
    case "list": {
      console.log(args.includes("--json")
        ? JSON.stringify({ sessionId, invocations: projection.invocations }, null, 2)
        : formatManagedAgentList(sessionId, projection.invocations));
      return;
    }
    case "status": {
      const invocationId = requirePositional(args, "managed invocation id");
      const invocation = findInvocation(projection, invocationId);
      console.log(args.includes("--json")
        ? JSON.stringify({ sessionId, invocation }, null, 2)
        : formatManagedAgentStatus(sessionId, invocation));
      return;
    }
    case "transcript": {
      const invocationId = requirePositional(args, "managed invocation id");
      const invocation = findInvocation(projection, invocationId);
      console.log(args.includes("--json")
        ? JSON.stringify({ sessionId, invocationId, transcript: invocation.transcript }, null, 2)
        : formatManagedAgentTranscript(invocationId, invocation.transcript));
      return;
    }
    case "resources": {
      const invocationId = requirePositional(args, "managed invocation id");
      const invocation = findInvocation(projection, invocationId);
      console.log(args.includes("--json")
        ? JSON.stringify({
          sessionId,
          invocation,
        }, null, 2)
        : formatManagedAgentResources(invocation));
      return;
    }
    case "cancel": {
      const invocationId = requirePositional(args, "managed invocation id");
      findInvocation(projection, invocationId);
      const result = await sendManagedAgentCancelControl({
        gatewayUrl: readFlag(args, "--gateway") ?? DEFAULT_MANAGED_AGENT_GATEWAY_URL,
        sessionId,
        invocationId,
        reason: readFlag(args, "--reason") ?? "Operator cancelled the managed child from the CLI cockpit.",
        requestId: options.controlRequestId?.() ?? `cli-managed-agent-control-${Date.now()}`,
        timeoutMs: options.controlTimeoutMs,
        webSocketFactory: options.webSocketFactory,
      });
      if (args.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      }
      if (result.status === "failed") {
        throw new Error(`Managed-agent cancel failed: ${result.reason ?? "gateway rejected cancellation"}`);
      }
      if (!args.includes("--json")) {
        console.log(formatManagedAgentCancelResult(result));
      }
      return;
    }
    case "join": {
      const invocationId = requirePositional(args, "managed invocation id");
      findInvocation(projection, invocationId);
      const join = await sendManagedAgentJoinControl({
        gatewayUrl: readFlag(args, "--gateway") ?? DEFAULT_MANAGED_AGENT_GATEWAY_URL,
        sessionId,
        invocationId,
        requestId: options.controlRequestId?.() ?? `cli-managed-agent-join-${Date.now()}`,
        timeoutMs: options.controlTimeoutMs,
        webSocketFactory: options.webSocketFactory,
      });
      if (args.includes("--json")) {
        console.log(JSON.stringify(join, null, 2));
      }
      if (join.result.status === "failed") {
        throw new Error(`Managed-agent join failed: ${join.result.reason ?? "gateway rejected join"}`);
      }
      if (!args.includes("--json")) {
        console.log(formatManagedAgentJoinResult(join));
      }
      return;
    }
    default:
      throw new Error(`Unknown managed-agent subcommand: ${subcommand}`);
  }
}

export function resolveManagedAgentGatewayWebSocketUrl(
  gatewayUrl: string,
  userId = CLI_MANAGED_AGENT_OPERATOR_ID,
): string {
  let url: URL;
  try {
    url = new URL(gatewayUrl);
  } catch {
    throw new Error("Managed-agent gateway URL must be absolute.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Managed-agent gateway URL must use http, https, ws, or wss.");
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.pathname = "/gui/ws";
  url.search = "";
  url.searchParams.set("userId", userId);
  return url.toString();
}

export async function sendManagedAgentCancelControl(
  input: ManagedAgentCancelControlInput,
): Promise<GuiManagedAgentControlResultFrame> {
  return sendManagedAgentControl({
    action: "cancel",
    input,
    requestId: input.requestId ?? `cli-managed-agent-control-${Date.now()}`,
  });
}

export async function sendManagedAgentJoinControl(
  input: ManagedAgentJoinControlInput,
): Promise<ManagedAgentJoinControlResult> {
  let terminalEvent: OperatorSessionEvent | undefined;
  const result = await sendManagedAgentControl({
    action: "join",
    input,
    requestId: input.requestId ?? `cli-managed-agent-join-${Date.now()}`,
    onTerminalEvent: (event) => {
      terminalEvent = event;
    },
  });
  return {
    result,
    ...(terminalEvent ? { terminalEvent } : {}),
  };
}

async function sendManagedAgentControl(input: {
  readonly action: GuiManagedAgentControlAction;
  readonly input: ManagedAgentCancelControlInput | ManagedAgentJoinControlInput;
  readonly requestId: string;
  readonly onTerminalEvent?: (event: OperatorSessionEvent) => void;
}): Promise<GuiManagedAgentControlResultFrame> {
  const { action, requestId } = input;
  const controlInput = input.input;
  const wsUrl = resolveManagedAgentGatewayWebSocketUrl(controlInput.gatewayUrl);
  const socket = (controlInput.webSocketFactory ?? defaultManagedAgentGatewayWebSocketFactory)(wsUrl);
  const timeoutMs = controlInput.timeoutMs ?? DEFAULT_MANAGED_AGENT_CONTROL_TIMEOUT_MS;

  return new Promise<GuiManagedAgentControlResultFrame>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settleReject(new Error(`Managed-agent ${action} timed out waiting for gateway acknowledgement.`));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Ignore close errors after the control request has reached a terminal state.
      }
    };

    const settleResolve = (result: GuiManagedAgentControlResultFrame): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const settleReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({
          type: "managed_agent_control",
          action,
          sessionId: controlInput.sessionId,
          invocationId: controlInput.invocationId,
          ...("reason" in controlInput && controlInput.reason ? { reason: controlInput.reason } : {}),
          requestId,
        }));
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    socket.onmessage = (event) => {
      const frame = readManagedAgentGatewayFrame(event.data);
      if (!frame) {
        return;
      }
      if (frame.type === "session_event" && isManagedAgentTerminalEvent(frame.event, controlInput.invocationId)) {
        input.onTerminalEvent?.(frame.event);
        return;
      }
      if (frame.type !== "managed_agent_control_result") {
        return;
      }
      if (
        frame.action !== action ||
        frame.sessionId !== controlInput.sessionId ||
        frame.invocationId !== controlInput.invocationId ||
        frame.requestId !== requestId
      ) {
        return;
      }
      settleResolve(frame);
    };

    socket.onerror = () => {
      settleReject(new Error("Managed-agent gateway control socket failed."));
    };

    socket.onclose = () => {
      settleReject(new Error("Managed-agent gateway control socket closed before acknowledgement."));
    };
  });
}

export async function loadManagedAgentCockpitFromTranscript(
  transcriptStore: TranscriptStore,
  sessionId: string,
  input: { readonly projectedAt: string },
): Promise<OperatorCockpitReadOnlyProjection> {
  const events = (await transcriptStore.readTranscript(sessionId))
    .flatMap((event) => toOperatorManagedAgentEvent(event));
  return projectOperatorCockpitReadOnlyView({
    projectedAt: input.projectedAt,
    attachTargets: [{
      instanceId: "local",
      label: "Local CLI",
      kind: "local",
      gatewayUrl: "http://localhost",
    }],
    events,
  });
}

function toOperatorManagedAgentEvent(event: PersistedTranscriptEvent): readonly OperatorSessionEvent[] {
  if (!matchesTranscriptEnvelopeSession(event)) {
    return [];
  }
  if (isManagedAgentWorkItemEventKind(event.kind)) {
    if (!hasManagedOrchestrationAdoptionGate(event.payload)) {
      return [];
    }
    return [toOperatorSessionEvent(event, {
      ...event.payload,
      instanceId: readString(event.payload.instanceId) ?? "local",
      sessionId: event.kilnSessionId,
    })];
  }
  if (!isManagedAgentEventKind(event.kind)) return [];
  const payload = {
    ...event.payload,
    instanceId: readString(event.payload.instanceId) ?? "local",
    sessionId: event.kilnSessionId,
    managedInvocationId: readString(event.payload.managedInvocationId) ?? readString(event.payload.invocationId),
  };
  if (!payload.managedInvocationId) {
    return [];
  }
  return [toOperatorSessionEvent(event, payload)];
}

function isManagedAgentEventKind(kind: string): kind is OperatorSessionEventKind {
  return MANAGED_AGENT_EVENT_KINDS.includes(kind as OperatorSessionEventKind);
}

function isManagedAgentWorkItemEventKind(kind: string): kind is OperatorSessionEventKind {
  return MANAGED_AGENT_WORK_ITEM_EVENT_KINDS.includes(kind as OperatorSessionEventKind);
}

function matchesTranscriptEnvelopeSession(event: PersistedTranscriptEvent): boolean {
  const payloadSessionId = readString(event.payload.sessionId);
  return payloadSessionId === undefined || payloadSessionId === event.kilnSessionId;
}

function hasManagedOrchestrationAdoptionGate(payload: Record<string, unknown>): boolean {
  const gate = asRecord(payload.managedOrchestrationAdoptionGate);
  return typeof gate.required === "boolean"
    && isAdoptionGateStatus(gate.status)
    && readString(gate.childId) !== undefined
    && isStringArray(gate.resourceUris)
    && isStringArray(gate.blockingEvidence)
    && (gate.rejection === undefined || isAdoptionGateRejection(gate.rejection));
}

function isAdoptionGateStatus(value: unknown): boolean {
  return value === "not_required"
    || value === "pending_review"
    || value === "adopted"
    || value === "rejected"
    || value === "blocked";
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function isAdoptionGateRejection(value: unknown): boolean {
  const rejection = asRecord(value);
  return readString(rejection.gate) !== undefined
    && isStringArray(rejection.evidence)
    && (rejection.summary === undefined || readString(rejection.summary) !== undefined)
    && (rejection.completedAt === undefined || readString(rejection.completedAt) !== undefined);
}

function toOperatorSessionEvent(
  event: PersistedTranscriptEvent,
  payload: Record<string, unknown>,
): OperatorSessionEvent {
  return {
    eventId: event.eventId,
    kilnSessionId: event.kilnSessionId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind: event.kind,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.parentEventId ? { parentEventId: event.parentEventId } : {}),
    ...(event.source ? { source: event.source } : {}),
    payload,
  };
}

function findInvocation(
  projection: OperatorCockpitReadOnlyProjection,
  invocationId: string,
): OperatorCockpitInvocationProjection {
  const invocation = projection.invocations.find((candidate) => candidate.managedInvocationId === invocationId);
  if (!invocation) {
    throw new Error(`Managed invocation not found: ${invocationId}`);
  }
  return invocation;
}

function formatManagedAgentList(
  sessionId: string,
  invocations: readonly OperatorCockpitInvocationProjection[],
): string {
  if (invocations.length === 0) {
    return `No managed children found for session ${sessionId}.`;
  }
  return [
    `Managed children for session ${sessionId}:`,
    ...invocations.map((invocation) => formatManagedAgentListRow(invocation)),
  ].join("\n");
}

function formatManagedAgentListRow(invocation: OperatorCockpitInvocationProjection): string {
  return [
    invocation.managedInvocationId.padEnd(24),
    invocation.status.padEnd(10),
    (invocation.lifecycleState ?? "unknown").padEnd(12),
    invocation.providerRoute ?? "unknown-provider",
    invocation.resourceLease?.worktreeReview?.status === "required" ? "review:required" : undefined,
    invocation.adoptionGate ? `adoption:${invocation.adoptionGate.status}` : undefined,
  ].filter((part): part is string => part !== undefined).join("  ");
}

function formatManagedAgentStatus(
  sessionId: string,
  invocation: OperatorCockpitInvocationProjection,
): string {
  return [
    `Managed child: ${invocation.managedInvocationId}`,
    `Session: ${sessionId}`,
    `Status: ${invocation.status}`,
    `Lifecycle: ${invocation.lifecycleState ?? "unknown"}`,
    `Provider: ${invocation.providerRoute ?? "unknown"}`,
    `Events: ${invocation.eventCount}`,
    invocation.resourceLease ? `Lease: ${invocation.resourceLease.leaseId}` : undefined,
    invocation.resourceLease ? `Worktree: ${invocation.resourceLease.workingDirectoryPath}` : undefined,
    invocation.resourceLease ? `Lease health: ${invocation.resourceLease.healthStatus}` : undefined,
    invocation.resourceLease ? `Lease cleanup: ${invocation.resourceLease.cleanupStatus}` : undefined,
    ...formatManagedAgentWorktreeReviewLines(invocation),
    ...formatManagedAgentAdoptionGateStatusLines(invocation),
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatManagedAgentWorktreeReviewLines(
  invocation: OperatorCockpitInvocationProjection,
): readonly (string | undefined)[] {
  const worktreeReview = invocation.resourceLease?.worktreeReview;
  if (!worktreeReview) {
    return [];
  }
  return [
    `Worktree review: ${worktreeReview.status} · ${worktreeReview.reason}`,
    worktreeReview.resourceUris.length > 0
      ? `Worktree review resources: ${worktreeReview.resourceUris.join(", ")}`
      : undefined,
    worktreeReview.diagnosticUris.length > 0
      ? `Worktree review diagnostics: ${worktreeReview.diagnosticUris.join(", ")}`
      : undefined,
  ];
}

function formatManagedAgentAdoptionGateStatusLines(
  invocation: OperatorCockpitInvocationProjection,
): readonly (string | undefined)[] {
  const adoptionGate = invocation.adoptionGate;
  if (!adoptionGate) {
    return [];
  }
  return [
    `Adoption: ${adoptionGate.status}`,
    adoptionGate.adoptedBy ? `Adopted by: ${adoptionGate.adoptedBy}` : undefined,
    adoptionGate.adoptedAt ? `Adopted at: ${adoptionGate.adoptedAt}` : undefined,
    adoptionGate.blockingEvidence.length > 0
      ? `Adoption blocking evidence: ${adoptionGate.blockingEvidence.join(", ")}`
      : undefined,
    adoptionGate.rejection ? `Adoption rejection gate: ${adoptionGate.rejection.gate}` : undefined,
    adoptionGate.rejection?.summary ? `Adoption rejection summary: ${adoptionGate.rejection.summary}` : undefined,
    adoptionGate.rejection?.evidence.length
      ? `Adoption rejection evidence: ${adoptionGate.rejection.evidence.join(", ")}`
      : undefined,
  ];
}

function formatManagedAgentTranscript(invocationId: string, transcript: unknown): string {
  const pointer = asRecord(transcript);
  const uri = readString(pointer.uri);
  if (!uri) {
    return `No transcript pointer found for managed child ${invocationId}.`;
  }
  return [
    `Managed child: ${invocationId}`,
    `Transcript: ${uri}`,
    readString(pointer.format) ? `Format: ${readString(pointer.format)}` : undefined,
    readString(pointer.redaction) ? `Redaction: ${readString(pointer.redaction)}` : undefined,
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatManagedAgentResources(invocation: OperatorCockpitInvocationProjection): string {
  const { managedInvocationId, evidenceResourceUris } = invocation;
  if (evidenceResourceUris.length === 0) {
    return [
      `No resource pointers found for managed child ${managedInvocationId}.`,
      ...formatManagedAgentWorktreeReviewLines(invocation),
      ...formatManagedAgentAdoptionGateStatusLines(invocation),
    ].join("\n");
  }
  return [
    `Resources for managed child ${managedInvocationId}:`,
    ...evidenceResourceUris.map((uri) => `- ${uri}`),
    ...formatManagedAgentWorktreeReviewLines(invocation),
    ...formatManagedAgentAdoptionGateStatusLines(invocation),
  ].join("\n");
}

function formatManagedAgentCancelResult(result: GuiManagedAgentControlResultFrame): string {
  return [
    `Cancel accepted for managed child ${result.invocationId}.`,
    `Session: ${result.sessionId}`,
    `Handled at: ${result.handledAt}`,
  ].join("\n");
}

function formatManagedAgentJoinResult(join: ManagedAgentJoinControlResult): string {
  const payload = asRecord(join.terminalEvent?.payload);
  const lifecycleState = readString(payload.lifecycleState) ?? "unknown";
  const resultSummary = readString(payload.resultSummary);
  return [
    `Join completed for managed child ${join.result.invocationId}.`,
    `Session: ${join.result.sessionId}`,
    `Lifecycle: ${lifecycleState}`,
    resultSummary ? `Summary: ${resultSummary}` : undefined,
    `Handled at: ${join.result.handledAt}`,
  ].filter((line): line is string => line !== undefined).join("\n");
}

function readManagedAgentGatewayFrame(value: unknown): GuiInboundFrame | undefined {
  const raw = typeof value === "string" ? value : String(value);
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isGuiInboundFrame(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isGuiInboundFrame(value: unknown): value is GuiInboundFrame {
  const record = asRecord(value);
  const type = readString(record.type);
  if (type === "welcome" || type === "session_event" || type === "error") {
    return true;
  }
  if (type !== "managed_agent_control_result") {
    return false;
  }
  return (record.action === "cancel" || record.action === "join") &&
    typeof record.sessionId === "string" &&
    typeof record.invocationId === "string" &&
    (record.status === "accepted" || record.status === "failed") &&
    typeof record.handledAt === "string";
}

function isManagedAgentTerminalEvent(event: OperatorSessionEvent, invocationId: string): boolean {
  if (
    event.kind !== "agent_invocation_completed" &&
    event.kind !== "agent_invocation_failed" &&
    event.kind !== "agent_invocation_cancelled"
  ) {
    return false;
  }
  const payload = asRecord(event.payload);
  return readString(payload.managedInvocationId) === invocationId || readString(payload.invocationId) === invocationId;
}

function defaultManagedAgentGatewayWebSocketFactory(url: string): ManagedAgentGatewaySocket {
  const WebSocketCtor = (globalThis as {
    readonly WebSocket?: new (url: string) => ManagedAgentGatewaySocket;
  }).WebSocket;
  if (!WebSocketCtor) {
    throw new Error("Managed-agent gateway control requires WebSocket support.");
  }
  return new WebSocketCtor(url);
}

async function resolveManagedAgentCommandSessionId(root: string, args: readonly string[]): Promise<string | undefined> {
  const explicit = readFlag(args, "--session");
  if (explicit) {
    return explicit;
  }
  const latest = await new SessionStore(root).last();
  return latest?.sessionId;
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  }
  const prefix = `${flag}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function requirePositional(args: readonly string[], label: string): string {
  const positional = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
  if (!positional) {
    throw new Error(`Managed-agent ${label} is required.`);
  }
  return positional;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function printManagedAgentHelp(): void {
  console.log("\nUsage: kiln managed-agent <list|status|transcript|resources|cancel|join> [options]\n");
  console.log("Subcommands:");
  console.log("  list                    List managed children from a canonical session transcript");
  console.log("  status <invocation-id>  Inspect lifecycle and lease state for one managed child");
  console.log("  transcript <id>         Print the managed child transcript resource pointer");
  console.log("  resources <id>          Print handoff, lease, and diagnostic resource pointers");
  console.log("  cancel <id>             Request runtime-owned cancellation through the gateway");
  console.log("  join <id>               Wait for runtime-owned terminal evidence through the gateway");
  console.log("");
  console.log("Options:");
  console.log("  --session <id>          Session id to read; defaults to latest recorded session");
  console.log("  --gateway <url>         Gateway URL; defaults to http://localhost:4810");
  console.log("  --reason <text>         Cancellation reason");
  console.log("  --json                  Print JSON");
  console.log("");
}
