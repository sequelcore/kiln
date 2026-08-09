import type {
  GuiInboundFrame,
  GuiManagedAgentControlAction,
  GuiManagedAgentControlResultFrame,
  OperatorCockpitEconomicAttemptProjection,
  OperatorCockpitEvidenceRejection,
  OperatorCockpitManagedAgentViewItem,
  OperatorCockpitManagedAgentViewState,
  OperatorCockpitInvocationProjection,
  OperatorCockpitReadOnlyProjection,
  OperatorGovernedWorkItemProjection,
  OperatorSessionEvent,
  OperatorWorkspaceHomeProjection,
} from "@kilnai/gateway-contracts";
import {
  createOperatorCockpitReadOnlyViewState,
  createOperatorWorkspaceHomeProjection,
  normalizeManagedAgentOperatorReplayEvents,
  projectOperatorGovernedWorkItems,
  projectOperatorCockpitReadOnlyView,
} from "@kilnai/gateway-contracts";
import type { KilnAppConfig } from "../config.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";

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

export interface ManagedAgentCockpitTranscriptProjection {
  readonly projection: OperatorCockpitReadOnlyProjection;
  readonly events: readonly OperatorSessionEvent[];
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
  const root = resolveProjectRoot({ explicitPath: options.projectPath }).rootPath;
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
  const cockpit = await loadManagedAgentCockpitTranscriptProjection(transcriptStore, sessionId, { projectedAt });
  const { projection, events } = cockpit;
  const cockpitView = createOperatorCockpitReadOnlyViewState({
    projection,
    viewState: {},
  });
  const managedAgents = cockpitView.managedAgents;
  const economicAttempts = cockpitView.economicAttempts;
  const unprojectableEvidence = cockpitView.unprojectableEvidence;
  const workspaceHome = createOperatorWorkspaceHomeProjection({
    projectedAt,
    cockpitView,
    events,
  });
  const governedWorkItems = projectOperatorGovernedWorkItems(events);

  switch (subcommand) {
    case "list": {
      console.log(args.includes("--json")
        ? JSON.stringify({ sessionId, managedAgents, governedWorkItems, workspaceHome, invocations: projection.invocations, economicAttempts, unprojectableEvidence }, null, 2)
        : formatManagedAgentList(sessionId, managedAgents, workspaceHome, governedWorkItems, economicAttempts, unprojectableEvidence));
      return;
    }
    case "status": {
      const invocationId = requirePositional(args, "managed invocation id");
      const invocation = findInvocation(projection, invocationId);
      const item = findManagedAgentViewItem(managedAgents, invocationId);
      console.log(args.includes("--json")
        ? JSON.stringify({ sessionId, managedAgent: item, invocation, governedWorkItems, workspaceHome }, null, 2)
        : formatManagedAgentStatus(sessionId, item, invocation, workspaceHome, governedWorkItems));
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
      const item = findManagedAgentViewItem(managedAgents, invocationId);
      console.log(args.includes("--json")
        ? JSON.stringify({
          sessionId,
          invocation,
        }, null, 2)
        : formatManagedAgentResources(item, invocation));
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
  return (await loadManagedAgentCockpitTranscriptProjection(transcriptStore, sessionId, input)).projection;
}

export async function loadManagedAgentCockpitTranscriptProjection(
  transcriptStore: TranscriptStore,
  sessionId: string,
  input: { readonly projectedAt: string },
): Promise<ManagedAgentCockpitTranscriptProjection> {
  const transcriptEvents = await transcriptStore.readTranscript(sessionId);
  const events = normalizeManagedAgentOperatorReplayEvents(transcriptEvents, { defaultInstanceId: "local" });
  return {
    projection: projectOperatorCockpitReadOnlyView({
      projectedAt: input.projectedAt,
      attachTargets: [{
        instanceId: "local",
        label: "Local CLI",
        kind: "local",
        gatewayUrl: "http://localhost",
      }],
      events,
    }),
    events,
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

function findManagedAgentViewItem(
  viewState: OperatorCockpitManagedAgentViewState,
  invocationId: string,
): OperatorCockpitManagedAgentViewItem {
  const item = viewState.items.find((candidate) => candidate.managedInvocationId === invocationId);
  if (!item) {
    throw new Error(`Managed invocation not found: ${invocationId}`);
  }
  return item;
}

function formatManagedAgentList(
  sessionId: string,
  viewState: OperatorCockpitManagedAgentViewState,
  workspaceHome: OperatorWorkspaceHomeProjection,
  governedWorkItems: readonly OperatorGovernedWorkItemProjection[],
  economicAttempts: readonly OperatorCockpitEconomicAttemptProjection[] = [],
  unprojectableEvidence: readonly OperatorCockpitEvidenceRejection[] = [],
): string {
  if (viewState.items.length === 0 && economicAttempts.length === 0 && unprojectableEvidence.length === 0) {
    return `No managed children found for session ${sessionId}.`;
  }
  return [
    `Managed children for session ${sessionId}:`,
    `attention: ${viewState.attentionCount}  active: ${viewState.activeCount}`,
    formatManagedAgentGovernanceSummary(workspaceHome),
    ...formatGovernedWorkItemLines(governedWorkItems),
    ...viewState.items.map((item) => formatManagedAgentListRow(item)),
    ...formatEconomicAttemptLines(economicAttempts),
    ...formatUnprojectableEvidenceLines(unprojectableEvidence),
  ].join("\n");
}

// Economic attempts are not joined to a specific managed invocation (jobId carries no durable
// invocationId link yet), so they are listed as their own section rather than nested per row.
function formatEconomicAttemptLines(
  economicAttempts: readonly OperatorCockpitEconomicAttemptProjection[],
): readonly string[] {
  if (economicAttempts.length === 0) {
    return [];
  }
  return [
    "Economic attempts:",
    ...economicAttempts.map((attempt) => formatEconomicAttemptRow(attempt)),
  ];
}

// A non-empty rejection list means the cockpit below is a degraded view of the session. Reporting
// the gap is the whole point: a listing that silently omits evidence reads as a complete one.
function formatUnprojectableEvidenceLines(
  unprojectableEvidence: readonly OperatorCockpitEvidenceRejection[],
): readonly string[] {
  if (unprojectableEvidence.length === 0) {
    return [];
  }
  return [
    `Unprojectable evidence (${unprojectableEvidence.length}) - this view is incomplete:`,
    ...unprojectableEvidence.map((rejection) => [
      rejection.kind.padEnd(30),
      rejection.reason.padEnd(24),
      rejection.field ? `field:${rejection.field}` : undefined,
      `event:${rejection.eventId}`,
    ].filter((part): part is string => part !== undefined).join("  ")),
  ];
}

function formatEconomicAttemptRow(attempt: OperatorCockpitEconomicAttemptProjection): string {
  return [
    attempt.jobId.padEnd(48),
    attempt.transition.padEnd(18),
    `policy:${attempt.policyId}`,
    attempt.selectedRoute ? `route:${attempt.selectedRoute.providerId}/${attempt.selectedRoute.modelId}` : undefined,
    attempt.selectedAccount ? `account:${attempt.selectedAccount.kind}` : undefined,
    attempt.settlementKind ? `settlement:${attempt.settlementKind}` : undefined,
    attempt.reason ? `reason:${attempt.reason}` : undefined,
    ...(attempt.rejections ?? []).map((rejection) => `rejection:${rejection.stage}:${rejection.reason}`),
  ].filter((part): part is string => part !== undefined).join("  ");
}

function formatManagedAgentListRow(item: OperatorCockpitManagedAgentViewItem): string {
  return [
    item.managedInvocationId.padEnd(24),
    item.attentionState.padEnd(12),
    item.status.padEnd(10),
    (item.lifecycleState ?? "unknown").padEnd(12),
    item.parentTurnId ? `parent:${item.parentTurnId}` : undefined,
    item.routeId ? `route:${item.routeId}` : undefined,
    item.routeSource ? `source:${item.routeSource}` : undefined,
    item.externalRuntimeAttachment
      ? `attachment:${item.externalRuntimeAttachment.runtimeId}/${item.externalRuntimeAttachment.attachmentId}`
      : undefined,
    ...(item.externalToolFailures ?? []).map((failure) => (
      `external-failure:${failure.selector}:${failure.category}`
    )),
    item.providerRoute ?? "unknown-provider",
    item.dirtyWorkspaceReviewRequired ? "review:required" : undefined,
    item.worktreeConflict?.status ? `conflict:${item.worktreeConflict.status}` : undefined,
    item.adoptionGate ? `adoption:${item.adoptionGate.status}` : undefined,
    item.resourceUris.length > 0 ? `resources:${item.resourceUris.length}` : undefined,
    `cancel:${item.cancelControl.status}`,
  ].filter((part): part is string => part !== undefined).join("  ");
}

function formatManagedAgentStatus(
  sessionId: string,
  item: OperatorCockpitManagedAgentViewItem,
  invocation: OperatorCockpitInvocationProjection,
  workspaceHome: OperatorWorkspaceHomeProjection,
  governedWorkItems: readonly OperatorGovernedWorkItemProjection[],
): string {
  return [
    `Managed child: ${invocation.managedInvocationId}`,
    `Session: ${sessionId}`,
    `Attention: ${item.attentionState}`,
    `Status: ${invocation.status}`,
    `Lifecycle: ${invocation.lifecycleState ?? "unknown"}`,
    invocation.parentTurnId ? `Parent turn: ${invocation.parentTurnId}` : undefined,
    invocation.routeId ? `Route: ${invocation.routeId}` : undefined,
    invocation.routeSource ? `Route source: ${invocation.routeSource}` : undefined,
    invocation.externalRuntimeAttachment
      ? `External runtime: ${invocation.externalRuntimeAttachment.runtimeId}/${invocation.externalRuntimeAttachment.attachmentId}`
      : undefined,
    ...(item.externalToolFailures ?? []).map((failure) => (
      `External failure: ${failure.selector} | ${failure.category} | ${failure.diagnostic}`
    )),
    `Provider: ${invocation.providerRoute ?? "unknown"}`,
    `Events: ${invocation.eventCount}`,
    `Resources: ${item.resourceUris.length}`,
    formatManagedAgentGovernanceSummary(workspaceHome),
    ...formatGovernedWorkItemLines(governedWorkItems),
    invocation.sourceResourceUris.length > 0 ? `Source resources: ${invocation.sourceResourceUris.join(", ")}` : undefined,
    `Cancel: ${item.cancelControl.status} · ${item.cancelControl.reason}`,
    invocation.resourceLease ? `Lease: ${invocation.resourceLease.leaseId}` : undefined,
    invocation.resourceLease ? `Worktree: ${invocation.resourceLease.workingDirectoryPath}` : undefined,
    invocation.resourceLease ? `Lease health: ${invocation.resourceLease.healthStatus}` : undefined,
    invocation.resourceLease ? `Lease cleanup: ${invocation.resourceLease.cleanupStatus}` : undefined,
    invocation.accountLease ? `Account: ${invocation.accountLease.accountRef}` : undefined,
    invocation.accountLease ? `Account lease: ${invocation.accountLease.leaseId}` : undefined,
    invocation.accountLease ? `Account policy: ${invocation.accountLease.accountPolicyId}` : undefined,
    invocation.accountLease ? `Account selection: ${invocation.accountLease.selectionReason}` : undefined,
    invocation.accountLease?.usageEvidence
      ? `Account usage: ${invocation.accountLease.usageEvidence.freshness} | ${invocation.accountLease.usageEvidence.availability ?? "unknown"}`
      : undefined,
    invocation.accountLease?.usageEvidence?.observedAt
      ? `Account usage observed: ${invocation.accountLease.usageEvidence.observedAt}`
      : undefined,
    invocation.accountLease ? `Account lease state: ${invocation.accountLease.lifecycleState}` : undefined,
    ...formatManagedAgentWorktreeReviewLines(invocation),
    ...formatManagedAgentWorktreeConflictLines(invocation),
    ...formatManagedAgentAdoptionGateStatusLines(invocation),
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatManagedAgentGovernanceSummary(home: OperatorWorkspaceHomeProjection): string {
  return `Governed work: ${home.work.blockedCount} blocked / ${home.work.totalCount} total | approvals: ${home.approvals.pendingCount} pending`;
}

function formatGovernedWorkItemLines(
  items: readonly OperatorGovernedWorkItemProjection[],
): readonly string[] {
  return items.flatMap((item) => {
    const evidence = [
      ...(item.missingEvidence.length > 0 ? [`missing:${item.missingEvidence.join(",")}`] : []),
      ...(item.missingGoalEvidence.length > 0 ? [`missing-goal:${item.missingGoalEvidence.join(",")}`] : []),
      ...(item.missingVerificationGates.length > 0
        ? [`missing-gates:${item.missingVerificationGates.join(",")}`]
        : []),
      ...(item.failedVerificationGates.length > 0
        ? [`failed-gates:${item.failedVerificationGates.join(",")}`]
        : []),
      ...(item.missingResidualRisk ? ["missing:residual-risk"] : []),
    ];
    return [
      `Work item: ${item.id} | ${item.status} | authority:${item.authorityProfile ?? "unknown"} | pauses:${item.pendingPauseRequirementCount}`,
      ...evidence.map((entry) => `  ${entry}`),
    ];
  });
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

function formatManagedAgentWorktreeConflictLines(
  invocation: OperatorCockpitInvocationProjection,
): readonly (string | undefined)[] {
  const worktreeConflict = invocation.resourceLease?.worktreeConflict;
  if (!worktreeConflict) {
    return [];
  }
  return [
    `Worktree conflict: ${worktreeConflict.status} · ${worktreeConflict.reason}`,
    `Requested invocation: ${worktreeConflict.requestedInvocationId}`,
    `Conflicting invocation: ${worktreeConflict.conflictingInvocationId}`,
    `Conflict worktree: ${worktreeConflict.workingDirectoryMode} · ${worktreeConflict.workingDirectoryPath}`,
    `Conflict policy: ${worktreeConflict.policyId}`,
    worktreeConflict.retryAfterInvocationIds.length > 0
      ? `Retry after: ${worktreeConflict.retryAfterInvocationIds.join(", ")}`
      : undefined,
    worktreeConflict.resourceUris.length > 0
      ? `Conflict resources: ${worktreeConflict.resourceUris.join(", ")}`
      : undefined,
    worktreeConflict.diagnosticUris.length > 0
      ? `Conflict diagnostics: ${worktreeConflict.diagnosticUris.join(", ")}`
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

function formatManagedAgentResources(
  item: OperatorCockpitManagedAgentViewItem,
  invocation: OperatorCockpitInvocationProjection,
): string {
  const { managedInvocationId } = invocation;
  const sourceResourceUris = invocation.sourceResourceUris;
  const sourceResourceUriSet = new Set(sourceResourceUris);
  const evidenceResourceUris = item.resourceUris.filter((uri) => !sourceResourceUriSet.has(uri));
  if (sourceResourceUris.length === 0 && evidenceResourceUris.length === 0) {
    return [
      `No resource pointers found for managed child ${managedInvocationId}.`,
      ...formatManagedAgentWorktreeReviewLines(invocation),
      ...formatManagedAgentWorktreeConflictLines(invocation),
      ...formatManagedAgentAdoptionGateStatusLines(invocation),
    ].join("\n");
  }
  return [
    `Resources for managed child ${managedInvocationId}:`,
    ...formatManagedAgentResourceSection("Source resources", sourceResourceUris),
    ...formatManagedAgentResourceSection("Evidence resources", evidenceResourceUris),
    ...formatManagedAgentWorktreeReviewLines(invocation),
    ...formatManagedAgentWorktreeConflictLines(invocation),
    ...formatManagedAgentAdoptionGateStatusLines(invocation),
  ].join("\n");
}

function formatManagedAgentResourceSection(label: string, resourceUris: readonly string[]): readonly string[] {
  return resourceUris.length > 0
    ? [label + ":", ...resourceUris.map((uri) => `- ${uri}`)]
    : [];
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
