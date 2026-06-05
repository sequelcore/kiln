import { createHash } from "node:crypto";
import { createSessionEvent } from "@kilnai/core";
import type {
  CanonicalAgentInvocationPromptAdmittedEvent,
  CanonicalAgentInvocationPromptRecoveredEvent,
  SessionEventSource,
} from "@kilnai/core";
import type { RuntimeSession } from "../../session/runtime-session.js";

export type ManagedInvocationPromptDeliveryMode = "steer" | "queue";
export type ManagedInvocationPromptDeliveryState = "available" | "queued" | "delivered" | "stale";

export interface AppendManagedInvocationPromptAdmissionSessionEventInput {
  readonly session: RuntimeSession;
  readonly promptAdmissionId?: string;
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentTurnId?: string;
  readonly prompt: string;
  readonly deliveryMode: ManagedInvocationPromptDeliveryMode;
  readonly deliveryState?: ManagedInvocationPromptDeliveryState;
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly wakeRequested: boolean;
  readonly timestamp?: Date;
  readonly source?: SessionEventSource;
}

export interface AppendManagedInvocationPromptRecoverySessionEventInput {
  readonly session: RuntimeSession;
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentTurnId?: string;
  readonly promptAdmissionId: string;
  readonly deliveryMode: ManagedInvocationPromptDeliveryMode;
  readonly previousDeliveryState: ManagedInvocationPromptDeliveryState;
  readonly recoveryReason: string;
  readonly recoveredAt?: Date;
  readonly timestamp?: Date;
  readonly source?: SessionEventSource;
}

export class ManagedInvocationPromptAdmissionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedInvocationPromptAdmissionConflictError";
  }
}

export function appendManagedInvocationPromptAdmissionSessionEvent(
  input: AppendManagedInvocationPromptAdmissionSessionEventInput,
): CanonicalAgentInvocationPromptAdmittedEvent {
  const prompt = validateNonEmpty(input.prompt, "Managed invocation prompt admission prompt");
  const invocationId = validateNonEmpty(input.invocationId, "Managed invocation prompt admission invocationId");
  const agentId = validateNonEmpty(input.agentId, "Managed invocation prompt admission agentId");
  const promptAdmissionId = input.promptAdmissionId
    ? validateNonEmpty(input.promptAdmissionId, "Managed invocation prompt admission id")
    : buildPromptAdmissionId(input.session.id, invocationId, input.session.nextSessionEventSequence());
  const promptHash = hashPrompt(prompt);
  const existing = findPromptAdmissionEvent(input.session, promptAdmissionId);
  if (existing) {
    assertSamePromptAdmission(existing, {
      invocationId,
      agentId,
      promptHash,
      deliveryMode: input.deliveryMode,
      deliveryState: input.deliveryState,
      wakeRequested: input.wakeRequested,
      requestedBy: input.requestedBy,
      requestSource: input.requestSource,
    });
    return existing;
  }

  const sequence = input.session.nextSessionEventSequence();
  const event = createSessionEvent<"agent_invocation_prompt_admitted">({
    eventId: `${sanitizeId(promptAdmissionId)}:event`,
    kilnSessionId: input.session.id,
    sequence,
    kind: "agent_invocation_prompt_admitted",
    ...(input.parentTurnId ? { turnId: input.parentTurnId, parentTurnId: input.parentTurnId } : {}),
    ...(input.source ? { source: input.source } : { source: { actor: "runtime", surface: "runtime", component: "managed-invocation" } }),
    timestamp: input.timestamp ?? new Date(),
    invocationId,
    agentId,
    parentSessionId: input.session.id,
    ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
    ...(input.requestSource ? { requestSource: input.requestSource } : {}),
    promptAdmissionId,
    deliveryMode: input.deliveryMode,
    ...(input.deliveryState !== undefined ? { deliveryState: input.deliveryState } : {}),
    admissionState: "admitted",
    inputSummary: summarizePrompt(prompt),
    promptHash,
    wakeRequested: input.wakeRequested,
  });
  input.session.appendSessionEvents([event]);
  return event;
}

export function appendManagedInvocationPromptRecoverySessionEvent(
  input: AppendManagedInvocationPromptRecoverySessionEventInput,
): CanonicalAgentInvocationPromptRecoveredEvent {
  const invocationId = validateNonEmpty(input.invocationId, "Managed invocation prompt recovery invocationId");
  const agentId = validateNonEmpty(input.agentId, "Managed invocation prompt recovery agentId");
  const promptAdmissionId = validateNonEmpty(input.promptAdmissionId, "Managed invocation prompt recovery promptAdmissionId");
  const recoveryReason = validateNonEmpty(input.recoveryReason, "Managed invocation prompt recovery reason");
  const recoveredAt = input.recoveredAt ?? input.timestamp ?? new Date();
  const existing = findPromptRecoveryEvent(input.session, promptAdmissionId);
  if (existing) {
    return existing;
  }

  const event = createSessionEvent<"agent_invocation_prompt_recovered">({
    eventId: `${sanitizeId(promptAdmissionId)}:recovered:event`,
    kilnSessionId: input.session.id,
    sequence: input.session.nextSessionEventSequence(),
    kind: "agent_invocation_prompt_recovered",
    ...(input.parentTurnId ? { turnId: input.parentTurnId, parentTurnId: input.parentTurnId } : {}),
    ...(input.source ? { source: input.source } : { source: { actor: "runtime", surface: "runtime", component: "managed-invocation" } }),
    timestamp: input.timestamp ?? recoveredAt,
    invocationId,
    agentId,
    parentSessionId: input.session.id,
    promptAdmissionId,
    deliveryMode: input.deliveryMode,
    previousDeliveryState: input.previousDeliveryState,
    deliveryState: "stale",
    recoveryReason,
    recoveredAt: recoveredAt.toISOString(),
  });
  input.session.appendSessionEvents([event]);
  return event;
}

function findPromptAdmissionEvent(
  session: RuntimeSession,
  promptAdmissionId: string,
): CanonicalAgentInvocationPromptAdmittedEvent | undefined {
  return session.sessionEvents.find((event): event is CanonicalAgentInvocationPromptAdmittedEvent =>
    event.kind === "agent_invocation_prompt_admitted"
    && event.promptAdmissionId === promptAdmissionId
  );
}

function findPromptRecoveryEvent(
  session: RuntimeSession,
  promptAdmissionId: string,
): CanonicalAgentInvocationPromptRecoveredEvent | undefined {
  return session.sessionEvents.find((event): event is CanonicalAgentInvocationPromptRecoveredEvent =>
    event.kind === "agent_invocation_prompt_recovered"
    && event.promptAdmissionId === promptAdmissionId
  );
}

function assertSamePromptAdmission(
  existing: CanonicalAgentInvocationPromptAdmittedEvent,
  candidate: {
    readonly invocationId: string;
    readonly agentId: string;
    readonly promptHash: string;
    readonly deliveryMode: ManagedInvocationPromptDeliveryMode;
    readonly deliveryState?: ManagedInvocationPromptDeliveryState;
    readonly wakeRequested: boolean;
    readonly requestedBy?: string;
    readonly requestSource?: string;
  },
): void {
  if (
    existing.invocationId !== candidate.invocationId
    || existing.agentId !== candidate.agentId
    || existing.promptHash !== candidate.promptHash
    || existing.deliveryMode !== candidate.deliveryMode
    || existing.deliveryState !== candidate.deliveryState
    || existing.wakeRequested !== candidate.wakeRequested
    || existing.requestedBy !== candidate.requestedBy
    || existing.requestSource !== candidate.requestSource
  ) {
    throw new ManagedInvocationPromptAdmissionConflictError(
      `Managed invocation prompt admission id already exists with different evidence: ${existing.promptAdmissionId}`,
    );
  }
}

function hashPrompt(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt, "utf8").digest("hex")}`;
}

function summarizePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/gu, " ").trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function buildPromptAdmissionId(sessionId: string, invocationId: string, sequence: number): string {
  return `managed-prompt-${sanitizeId(sessionId)}-${sanitizeId(invocationId)}-${sequence}`;
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:-]/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  return sanitized.length > 0 ? sanitized.slice(0, 128) : "prompt-admission";
}

function validateNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}
