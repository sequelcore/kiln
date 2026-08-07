// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// The four session-scoped lifecycle executors (status/list/join/cancel) and
// their shared session/invocation-id guards.
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import {
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_STATUS_TOOL_NAME,
} from "../tool-names.js";
import { appendManagedInvocationRuntimeFailureSessionEvent, appendManagedInvocationTerminalSessionEvent } from "../session-events.js";
import {
  projectManagedInvocationPublicResourceUri,
  projectManagedInvocationRecordResources,
  projectManagedInvocationResourceLeaseResources,
} from "../resource-projection.js";
import type { ManagedAgentRuntimeInvocationResult, RuntimeManagedAgentInvocationService } from "../index.js";
import type { ManagedInvocationToolOptions, ManagedInvocationToolResult } from "./types.js";
import { readText } from "./input-parsing.js";
import { errorResult } from "./input-parsing.js";
import {
  publishManagedInvocationSessionEvents,
  terminalSessionEventIdsForResult,
} from "./session-event-publishing.js";
import {
  managedInvocationSnapshotErrorMetadata,
  managedInvocationSnapshotResult,
  projectManagedInvocationSnapshot,
  terminalManagedInvocationResult,
  visibleManagedInvocationSnapshot,
} from "./result-projection.js";

export async function executeManagedInvocationStatusTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_STATUS_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocationId = readInvocationId(rawInput, MANAGED_AGENT_STATUS_TOOL_NAME);
  if (!invocationId.ok) {
    return invocationId.result;
  }
  const snapshot = service.status(invocationId.value);
  const visibility = visibleManagedInvocationSnapshot(snapshot, session.context.session.id, MANAGED_AGENT_STATUS_TOOL_NAME);
  if (!visibility.ok) {
    return visibility.result;
  }
  return managedInvocationSnapshotResult(MANAGED_AGENT_STATUS_TOOL_NAME, visibility.snapshot);
}

export async function executeManagedInvocationListTool(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_LIST_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocations = service.list().filter((snapshot) => snapshot.parentSessionId === session.context.session.id);
  return {
    output: JSON.stringify({
      status: "listed",
      count: invocations.length,
      invocations: invocations.map(projectManagedInvocationSnapshot),
    }, null, 2),
    isError: false,
    metadata: {
      toolName: MANAGED_AGENT_LIST_TOOL_NAME,
      kind: "managed-invocation",
      status: "listed",
      count: invocations.length,
      invocations: invocations.map(projectManagedInvocationSnapshot),
    },
  };
}

export async function executeManagedInvocationJoinTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  options: ManagedInvocationToolOptions,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_JOIN_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocationId = readInvocationId(rawInput, MANAGED_AGENT_JOIN_TOOL_NAME);
  if (!invocationId.ok) {
    return invocationId.result;
  }
  const snapshot = service.status(invocationId.value);
  const visibility = visibleManagedInvocationSnapshot(snapshot, session.context.session.id, MANAGED_AGENT_JOIN_TOOL_NAME);
  if (!visibility.ok) {
    return visibility.result;
  }
  const startedAt = Date.now();
  let invocationResult: ManagedAgentRuntimeInvocationResult;
  try {
    invocationResult = await service.join(invocationId.value);
  } catch (error) {
    const failedSnapshot = service.status(invocationId.value);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const events = failedSnapshot
      ? appendManagedInvocationRuntimeFailureSessionEvent({
          session: session.context.session,
          request: failedSnapshot.request,
          decision: failedSnapshot.decision,
          errorMessage,
        })
      : [];
    await publishManagedInvocationSessionEvents(options, session.context, events);
    return errorResult(
      `Managed invocation join failed: ${errorMessage}`,
      {
        invocationId: invocationId.value,
        status: failedSnapshot?.lifecycleState ?? "failed",
        lifecycleState: failedSnapshot?.lifecycleState ?? "failed",
        ...(failedSnapshot ? { routeId: failedSnapshot.decision.capabilitySnapshot.routeId } : {}),
        ...(failedSnapshot ? { routeSource: failedSnapshot.decision.capabilitySnapshot.routeSource } : {}),
        ...(failedSnapshot ? { parentSessionId: failedSnapshot.parentSessionId, parentTurnId: failedSnapshot.parentTurnId } : {}),
        error: failedSnapshot?.error,
        sessionEventIds: failedSnapshot
          ? terminalSessionEventIdsForResult({ events, context: session.context, invocationId: invocationId.value })
          : [],
      },
      MANAGED_AGENT_JOIN_TOOL_NAME,
    );
  }
  if (invocationResult.status === "denied") {
    return errorResult(
      `Managed invocation denied: ${invocationResult.decision.reason}`,
      {
        invocationId: invocationId.value,
        routeId: invocationResult.decision.routeId,
        routeSource: invocationResult.decision.routeSource,
        status: "denied",
        lifecycleState: "failed",
        missingCapabilities: invocationResult.decision.missingCapabilities,
        ...(invocationResult.decision.resourceLease
          ? {
              resourceLease: projectManagedInvocationResourceLeaseResources(
                invocationResult.decision.resourceLease,
                projectManagedInvocationPublicResourceUri,
              ),
            }
          : {}),
      },
      MANAGED_AGENT_JOIN_TOOL_NAME,
    );
  }
  const routeId = invocationResult.record.capabilitySnapshot.routeId;
  const record = projectManagedInvocationRecordResources(invocationResult.record, { artifactStore: options.artifactStore });
  const terminalSnapshot = service.status(invocationId.value);
  const durationMs = terminalSnapshot?.durationMs ?? Date.now() - startedAt;
  const events = appendManagedInvocationTerminalSessionEvent({
    session: session.context.session,
    request: visibility.snapshot.request,
    record,
    durationMs,
  });
  await publishManagedInvocationSessionEvents(options, session.context, events);
  return terminalManagedInvocationResult({
    toolName: MANAGED_AGENT_JOIN_TOOL_NAME,
    rawInput,
    routeId,
    voiceProfile: visibility.snapshot.decision.capabilitySnapshot.childIdentity.voiceProfile,
    contextMode: visibility.snapshot.decision.capabilitySnapshot.contextMode,
    request: visibility.snapshot.request,
    record,
    pauseRequirementResolver: options.pauseRequirementResolver,
    progressEvents: terminalSnapshot?.progressEvents,
    sessionEventIds: terminalSessionEventIdsForResult({ events, context: session.context, invocationId: invocationId.value }),
  });
}

export async function executeManagedInvocationCancelTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  options: ManagedInvocationToolOptions,
  service: RuntimeManagedAgentInvocationService,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_CANCEL_TOOL_NAME);
  if (!session.ok) {
    return session.result;
  }
  const invocationId = readInvocationId(rawInput, MANAGED_AGENT_CANCEL_TOOL_NAME);
  if (!invocationId.ok) {
    return invocationId.result;
  }
  const snapshot = service.status(invocationId.value);
  const visibility = visibleManagedInvocationSnapshot(snapshot, session.context.session.id, MANAGED_AGENT_CANCEL_TOOL_NAME);
  if (!visibility.ok) {
    return visibility.result;
  }
  const reason = readText(rawInput.reason) ?? "Managed invocation cancelled.";
  let terminalResult: Awaited<ReturnType<RuntimeManagedAgentInvocationService["join"]>>;
  try {
    await service.cancel(invocationId.value, reason);
    terminalResult = await service.join(invocationId.value);
  } catch (error) {
    const failedSnapshot = service.status(invocationId.value) ?? visibility.snapshot;
    return errorResult(
      `Managed invocation cancel failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        ...managedInvocationSnapshotErrorMetadata(failedSnapshot),
        status: failedSnapshot.lifecycleState,
        lifecycleState: failedSnapshot.lifecycleState,
      },
      MANAGED_AGENT_CANCEL_TOOL_NAME,
    );
  }
  if (terminalResult.status !== "completed") {
    return errorResult(
      "Managed invocation cancel failed: terminal record was not available after cancellation",
      {
        ...managedInvocationSnapshotErrorMetadata(visibility.snapshot),
        status: terminalResult.status,
        lifecycleState: visibility.snapshot.lifecycleState,
      },
      MANAGED_AGENT_CANCEL_TOOL_NAME,
    );
  }
  const record = projectManagedInvocationRecordResources(terminalResult.record, { artifactStore: options.artifactStore });
  const cancelledSnapshot = service.status(invocationId.value);
  const events = appendManagedInvocationTerminalSessionEvent({
    session: session.context.session,
    request: visibility.snapshot.request,
    record,
    durationMs: cancelledSnapshot?.durationMs,
  });
  await publishManagedInvocationSessionEvents(options, session.context, events);
  return terminalManagedInvocationResult({
    toolName: MANAGED_AGENT_CANCEL_TOOL_NAME,
    rawInput,
    routeId: record.capabilitySnapshot.routeId,
    voiceProfile: visibility.snapshot.decision.capabilitySnapshot.childIdentity.voiceProfile,
    contextMode: visibility.snapshot.decision.capabilitySnapshot.contextMode,
    request: visibility.snapshot.request,
    record,
    pauseRequirementResolver: options.pauseRequirementResolver,
    expectedTerminalLifecycleState: "cancelled",
    progressEvents: cancelledSnapshot?.progressEvents,
    sessionEventIds: terminalSessionEventIdsForResult({ events, context: session.context, invocationId: invocationId.value }),
  });
}

export function requireManagedInvocationSessionContext(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  toolName: string,
): { readonly ok: true; readonly context: RuntimeBuiltinToolExecutionContext } | { readonly ok: false; readonly result: ManagedInvocationToolResult } {
  if (!context) {
    return { ok: false, result: errorResult(`${toolName} requires runtime session context.`, {}, toolName) };
  }
  return { ok: true, context };
}

function readInvocationId(
  rawInput: Record<string, unknown>,
  toolName: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly result: ManagedInvocationToolResult } {
  const invocationId = readText(rawInput.invocationId);
  if (!invocationId) {
    return { ok: false, result: errorResult(`${toolName} requires invocationId.`, {}, toolName) };
  }
  return { ok: true, value: invocationId };
}
