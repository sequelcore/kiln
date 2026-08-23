import type { ManagedAgentInvocationRecord, ManagedAgentLifecycleState } from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { cloneJson } from "./runtime-primitives.js";
import type {
  ManagedAgentRuntimeInvocationEntry,
  ManagedAgentRuntimeInvocationProgressEvent,
  ManagedAgentRuntimeInvocationSnapshot,
  ManagedAgentRuntimeInvocationTerminal,
  ManagedAgentRuntimeInvocationTerminalNotification,
  ManagedAgentRuntimeInvocationResult,
} from "./invocation-service.js";

/**
 * A timed-out adapter has already recorded terminal timeout evidence, but its
 * provider-side settlement may ignore abort indefinitely. Owner shutdown gives
 * that settlement one short cleanup opportunity without claiming it settled.
 */
export const MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS = 100;

export function isTerminalLifecycleState(state: ManagedAgentLifecycleState): boolean {
  return state === "completed" ||
    state === "failed" ||
    state === "timed_out" ||
    state === "cancelled" ||
    state === "stale" ||
    state === "recovered";
}

export function deferredTerminal(): ManagedAgentRuntimeInvocationTerminal {
  let resolve!: (value: Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function snapshotInvocation(entry: ManagedAgentRuntimeInvocationEntry): ManagedAgentRuntimeInvocationSnapshot {
  return {
    invocationId: entry.request.invocationId,
    agentId: entry.request.agentId,
    parentSessionId: entry.request.parentSessionId,
    parentTurnId: entry.request.parentTurnId,
    profile: entry.request.profile,
    providerRoute: cloneJson(entry.request.providerRoute),
    adapterKind: entry.request.adapterKind,
    executionMode: entry.request.executionMode,
    authorityProfileId: entry.request.authority.authorityProfileId,
    lifecycleState: entry.lifecycleState,
    startedAt: entry.startedAt.toISOString(),
    ...(entry.finishedAt !== undefined ? { finishedAt: entry.finishedAt.toISOString() } : {}),
    ...(entry.finishedAt !== undefined ? { durationMs: entry.finishedAt.getTime() - entry.startedAt.getTime() } : {}),
    request: cloneJson(entry.request),
    decision: cloneJson(entry.decision),
    ...(snapshotRecord(entry) !== undefined ? { record: cloneJson(snapshotRecord(entry)) } : {}),
    ...(entry.progressEvents.length > 0 ? { progressEvents: cloneJson(entry.progressEvents) } : {}),
    ...(entry.promptInbox.length > 0 ? { promptInbox: cloneJson(entry.promptInbox) } : {}),
    ...(entry.error !== undefined ? { error: { message: entry.error.message } } : {}),
    ...(entry.resultPending !== undefined ? { resultPending: cloneJson(entry.resultPending) } : {}),
  };
}

export function snapshotRecord(entry: ManagedAgentRuntimeInvocationEntry): ManagedAgentInvocationRecord | undefined {
  if (entry.record === undefined || entry.leaseFinalization !== undefined) {
    return undefined;
  }
  return entry.record;
}

export function appendProgressEvent(
  entry: ManagedAgentRuntimeInvocationEntry,
  event: ManagedAgentRuntimeInvocationProgressEvent,
): void {
  entry.progressEvents = [...entry.progressEvents, cloneJson(event)].slice(-100);
}

export function registerAdapterCompletionOnEntry(
  entry: ManagedAgentRuntimeInvocationEntry,
  completion: PromiseLike<unknown>,
): void {
  if (entry.adapterCompletion !== undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed adapter registered execution completion more than once");
  }
  entry.adapterCompletion = Promise.resolve(completion).then(
    () => undefined,
    () => undefined,
  );
}

export function notifyTerminalObserver(entry: ManagedAgentRuntimeInvocationEntry): void {
  const observer = entry.terminalObserver;
  if (entry.terminalObserverNotified || observer === undefined || entry.record === undefined) {
    return;
  }
  entry.terminalObserverNotified = true;
  const durationMs = entry.finishedAt === undefined
    ? undefined
    : entry.finishedAt.getTime() - entry.startedAt.getTime();
  const notification: ManagedAgentRuntimeInvocationTerminalNotification = {
    request: cloneJson(entry.request),
    decision: cloneJson(entry.decision),
    record: cloneJson(entry.record),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
  entry.terminalObserverSettlement = Promise.resolve()
    .then(() => observer(notification))
    .then(() => undefined, () => undefined);
}

export async function waitForOwnerShutdownExecutionSettlement(entry: ManagedAgentRuntimeInvocationEntry): Promise<void> {
  if (!entry.adapterCompletion || entry.lifecycleState !== "timed_out") {
    await entry.adapterCompletion;
    return;
  }
  await Promise.race([
    entry.adapterCompletion,
    new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, Math.min(
        entry.request.authority.timeoutMs,
        MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS,
      ));
      entry.adapterCompletion!.finally(() => clearTimeout(timeout));
    }),
  ]);
}
