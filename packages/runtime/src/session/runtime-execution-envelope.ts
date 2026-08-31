import { resolveTurnConvergencePolicy, type ResolvedTurnConvergencePolicy, type TurnConvergencePolicyInput } from "@kilnai/core/agents";
import { type ConversationToolResultProjectionPolicy } from "@kilnai/core/context";
import { digestManagedEconomicValue } from "@kilnai/core/cost";
import { KilnError } from "@kilnai/core/engine";
import type { RuntimeConversationExecutionEnvelope, RuntimeExecutionEnvelope } from "./runtime-session-orchestrator.types.js";

export const RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_ID = "kiln.attached-turn.default";

const RUNTIME_DEFAULT_TURN_CONVERGENCE_LIMITS = Object.freeze({
  providerRequests: 40,
  toolRounds: 32,
  toolCalls: 128,
  cumulativeInputTokens: 2_000_000,
  elapsedMs: 7_200_000,
  activeMs: 7_200_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
});

/** The finite limits used when a Runtime turn does not provide an envelope. */
export const RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT = Object.freeze({
  policyId: RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_ID,
  configurationHash: digestManagedEconomicValue({
    policyId: RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_ID,
    ...RUNTIME_DEFAULT_TURN_CONVERGENCE_LIMITS,
  }),
  ...RUNTIME_DEFAULT_TURN_CONVERGENCE_LIMITS,
}) satisfies TurnConvergencePolicyInput;

/** The validated, immutable default policy owned by Runtime. */
export const RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY: ResolvedTurnConvergencePolicy =
  resolveTurnConvergencePolicy(RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT);

export type RuntimeConvergencePolicyOverrides = Pick<TurnConvergencePolicyInput, "policyId">
  & Partial<Omit<TurnConvergencePolicyInput, "policyId" | "configurationHash">>;

/**
 * Derive a complete policy input from one named override and a complete base.
 * The base defaults to Runtime's canonical policy; the configuration identity
 * is always recomputed from the resulting finite limits.
 */
export function deriveRuntimeConvergencePolicyInput(
  overrides: RuntimeConvergencePolicyOverrides,
  base: TurnConvergencePolicyInput = RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
): TurnConvergencePolicyInput {
  const merged = { ...base, ...overrides };
  const limits = {
    providerRequests: merged.providerRequests,
    toolRounds: merged.toolRounds,
    toolCalls: merged.toolCalls,
    cumulativeInputTokens: merged.cumulativeInputTokens,
    elapsedMs: merged.elapsedMs,
    activeMs: merged.activeMs,
    recoveryAttempts: merged.recoveryAttempts,
    consecutiveNoProgressSteps: merged.consecutiveNoProgressSteps,
  };
  const derived = {
    policyId: merged.policyId,
    configurationHash: digestManagedEconomicValue({ policyId: merged.policyId, ...limits }),
    ...limits,
  };
  resolveTurnConvergencePolicy(derived);
  return Object.freeze(derived);
}

export interface RuntimeResolvedExecutionEnvelope {
  readonly convergence: ResolvedTurnConvergencePolicy;
  readonly conversation?: RuntimeConversationExecutionEnvelope;
}

/** Resolve one raw Runtime envelope into a finite policy and independent conversation projection. */
export function resolveRuntimeExecutionEnvelope(
  value: RuntimeExecutionEnvelope | undefined,
): RuntimeResolvedExecutionEnvelope {
  const conversation = value?.conversation;
  return Object.freeze({
    convergence: value?.convergence === undefined
      ? RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY
      : resolveTurnConvergencePolicy(value.convergence),
    ...(conversation !== undefined
      ? { conversation: resolveRuntimeConversationExecutionEnvelope(conversation) }
      : {}),
  });
}

function resolveRuntimeConversationExecutionEnvelope(
  value: RuntimeConversationExecutionEnvelope,
): RuntimeConversationExecutionEnvelope {
  return Object.freeze({
    ...(value.toolResults !== undefined
      ? { toolResults: resolveConversationToolResultPolicy(value.toolResults) }
      : {}),
  });
}

function resolveConversationToolResultPolicy(
  value: ConversationToolResultProjectionPolicy,
): ConversationToolResultProjectionPolicy {
  if (!Number.isSafeInteger(value.triggerToolResultTokens) || value.triggerToolResultTokens <= 0) {
    throw new KilnError(
      "CONFIG_INVALID",
      "executionEnvelope.conversation.toolResults.triggerToolResultTokens must be a positive integer",
    );
  }
  if (!Number.isSafeInteger(value.retainRecentToolResults) || value.retainRecentToolResults < 0) {
    throw new KilnError(
      "CONFIG_INVALID",
      "executionEnvelope.conversation.toolResults.retainRecentToolResults must be a non-negative integer",
    );
  }
  return Object.freeze({ ...value });
}
