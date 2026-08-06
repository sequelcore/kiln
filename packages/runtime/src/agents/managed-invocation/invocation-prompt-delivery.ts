import { createHash } from "node:crypto";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { cloneJson } from "./runtime-primitives.js";
import { isTerminalLifecycleState } from "./invocation-lifecycle-events.js";
import type {
  ManagedAgentRuntimeInvocationEntry,
  ManagedAgentRuntimePromptAdmissionInput,
  ManagedAgentRuntimePromptAdmissionRecord,
  ManagedAgentRuntimePromptAdmissionResult,
  ManagedAgentRuntimePromptDeliveryBoundary,
  ManagedAgentRuntimePromptDeliveryClaimInput,
  ManagedAgentRuntimePromptDeliveryClaimResult,
  ManagedAgentRuntimePromptDeliveryMode,
  ManagedAgentRuntimePromptDeliveryState,
  ManagedAgentRuntimePromptStuckRecoveryInput,
  ManagedAgentRuntimePromptStuckRecoveryResult,
} from "./invocation-service.js";

export function assertValidRuntimeDate(value: Date, message: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new ManagedAgentRuntimeAdmissionError(message);
  }
}

export function admitPrompt(
  entry: ManagedAgentRuntimeInvocationEntry,
  input: ManagedAgentRuntimePromptAdmissionInput,
): ManagedAgentRuntimePromptAdmissionResult {
  if (isTerminalLifecycleState(entry.lifecycleState)) {
    throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime invocation is already terminal: ${entry.lifecycleState}`);
  }
  const prompt = validatePromptText(input.prompt);
  const admittedAt = input.admittedAt ?? new Date();
  assertValidRuntimeDate(admittedAt, "Managed agent prompt admission timestamp is invalid");
  const promptAdmissionId = input.promptAdmissionId
    ? validatePromptId(input.promptAdmissionId)
    : `runtime-prompt-${entry.request.invocationId}-${entry.promptInbox.length + 1}`;
  const existing = entry.promptInbox.find((record) => record.promptAdmissionId === promptAdmissionId);
  if (existing) {
    assertSameRuntimePromptAdmission(existing, {
      prompt,
      deliveryMode: input.deliveryMode,
      wakeRequested: input.wakeRequested,
      requestedBy: input.requestedBy,
      requestSource: input.requestSource,
    });
    return {
      status: "admitted",
      prompt: cloneJson(existing),
    };
  }
  const promptRecord: ManagedAgentRuntimePromptAdmissionRecord = {
    promptAdmissionId,
    invocationId: entry.request.invocationId,
    agentId: entry.request.agentId,
    parentSessionId: entry.request.parentSessionId,
    parentTurnId: entry.request.parentTurnId,
    prompt,
    inputSummary: summarizeRuntimePrompt(prompt),
    promptHash: hashRuntimePrompt(prompt),
    deliveryMode: input.deliveryMode,
    deliveryState: input.deliveryMode === "steer" ? "available" : "queued",
    wakeRequested: input.wakeRequested,
    ...(input.requestedBy !== undefined ? { requestedBy: input.requestedBy } : {}),
    ...(input.requestSource !== undefined ? { requestSource: input.requestSource } : {}),
    admittedAt: admittedAt.toISOString(),
    updatedAt: admittedAt.toISOString(),
  };
  entry.promptInbox.push(promptRecord);
  return {
    status: "admitted",
    prompt: cloneJson(promptRecord),
  };
}

export function claimPromptDeliveries(
  entry: ManagedAgentRuntimeInvocationEntry,
  input: ManagedAgentRuntimePromptDeliveryClaimInput,
): ManagedAgentRuntimePromptDeliveryClaimResult {
  const claimedAt = input.claimedAt ?? new Date();
  assertValidRuntimeDate(claimedAt, "Managed agent prompt delivery claim timestamp is invalid");
  const claimed: ManagedAgentRuntimePromptAdmissionRecord[] = [];
  for (const prompt of entry.promptInbox) {
    if (!isPromptClaimable(prompt, input.boundary)) {
      continue;
    }
    const mutablePrompt = prompt as {
      deliveryState: ManagedAgentRuntimePromptDeliveryState;
      deliveredAt?: string;
      updatedAt: string;
    };
    mutablePrompt.deliveryState = "delivered";
    mutablePrompt.deliveredAt = claimedAt.toISOString();
    mutablePrompt.updatedAt = claimedAt.toISOString();
    claimed.push(cloneJson(prompt));
  }
  return {
    claimed,
  };
}

export function recoverStuckPromptAdmissions(
  invocations: ReadonlyMap<string, ManagedAgentRuntimeInvocationEntry>,
  input: ManagedAgentRuntimePromptStuckRecoveryInput,
): ManagedAgentRuntimePromptStuckRecoveryResult {
  if (!Number.isFinite(input.staleAfterMs) || input.staleAfterMs <= 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt stale threshold must be greater than zero");
  }
  const now = input.now ?? new Date();
  assertValidRuntimeDate(now, "Managed agent prompt recovery timestamp is invalid");
  const reason = stuckPromptRecoveryReason(input.reason);
  const recovered: ManagedAgentRuntimePromptAdmissionRecord[] = [];
  for (const entry of invocations.values()) {
    if (isTerminalLifecycleState(entry.lifecycleState)) {
      continue;
    }
    for (const prompt of entry.promptInbox) {
      if (prompt.deliveryState !== "available" && prompt.deliveryState !== "queued") {
        continue;
      }
      const ageMs = now.getTime() - new Date(prompt.admittedAt).getTime();
      if (ageMs < input.staleAfterMs) {
        continue;
      }
      const mutablePrompt = prompt as {
        deliveryState: ManagedAgentRuntimePromptDeliveryState;
        updatedAt: string;
        recovery?: {
          reason: string;
          recoveredAt: string;
        };
      };
      mutablePrompt.deliveryState = "stale";
      mutablePrompt.updatedAt = now.toISOString();
      mutablePrompt.recovery = {
        reason,
        recoveredAt: now.toISOString(),
      };
      recovered.push(cloneJson(prompt));
    }
  }
  return {
    recovered,
  };
}

function validatePromptText(value: string): string {
  if (typeof value !== "string") {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt is required");
  }
  return trimmed;
}

function validatePromptId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt admission id is required");
  }
  return trimmed;
}

function summarizeRuntimePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/gu, " ").trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function hashRuntimePrompt(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt, "utf8").digest("hex")}`;
}

function assertSameRuntimePromptAdmission(
  existing: ManagedAgentRuntimePromptAdmissionRecord,
  candidate: {
    readonly prompt: string;
    readonly deliveryMode: ManagedAgentRuntimePromptDeliveryMode;
    readonly wakeRequested: boolean;
    readonly requestedBy?: string;
    readonly requestSource?: string;
  },
): void {
  if (
    existing.prompt !== candidate.prompt ||
    existing.deliveryMode !== candidate.deliveryMode ||
    existing.wakeRequested !== candidate.wakeRequested ||
    existing.requestedBy !== candidate.requestedBy ||
    existing.requestSource !== candidate.requestSource
  ) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt admission id already exists with different evidence");
  }
}

function isPromptClaimable(
  prompt: ManagedAgentRuntimePromptAdmissionRecord,
  boundary: ManagedAgentRuntimePromptDeliveryBoundary,
): boolean {
  if (prompt.deliveryState === "available") {
    return boundary === "immediate" || boundary === "safe-turn";
  }
  if (prompt.deliveryState === "queued") {
    return boundary === "safe-turn";
  }
  return false;
}

function stuckPromptRecoveryReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Managed invocation prompt marked stale by runtime recovery.";
}
