import {
  collectResumeSignalsFromPresence,
  decideResumePolicy,
  type ContextArtifactCache,
  type ResumeFeedbackSignal,
  type ResumePolicyDecision,
  type ResumeSignalSet,
} from "@kilnai/core";
import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import type { ProviderId } from "../wrapper/session-registry.js";

export type ResumeStrategyDecision = Omit<ResumePolicyDecision, "resumeStrategy" | "resumeFeedback"> & {
  readonly resumeStrategy: ResumeStrategy;
  readonly resumeFeedback?: ResumeFeedback;
};

export function prefersProviderNativeResume(provider: ProviderId | undefined): boolean {
  return provider === "codex" || provider === "opencode";
}

export function hasArtifactContent(cache: ContextArtifactCache, key: string | undefined): boolean {
  return key !== undefined && cache.get(key)?.content.trim() !== "";
}

export function countCachedResumeSignals(input: {
  cache: ContextArtifactCache;
  keys: readonly (string | undefined)[];
  includeModules?: boolean;
}): number {
  const keySignals = input.keys
    .map((key) => hasArtifactContent(input.cache, key))
    .filter(Boolean).length;
  return keySignals + (input.includeModules ? 1 : 0);
}

export function collectResumeSignals(input: {
  cache: ContextArtifactCache;
  keys: readonly (string | undefined)[];
  includeModules?: boolean;
}): ResumeSignalSet {
  return collectResumeSignalsFromPresence({
    signals: [
      ...input.keys.map((key) => hasArtifactContent(input.cache, key)),
      Boolean(input.includeModules),
    ],
  });
}

export function decideResumeStrategy(input: {
  resumeSessionId?: string;
  preferredProvider?: ProviderId;
  signals: ResumeSignalSet;
  feedback?: ResumeFeedback;
}): ResumeStrategyDecision {
  const decision = decideResumePolicy({
    resumeSessionId: input.resumeSessionId,
    nativeResumeEligible: prefersProviderNativeResume(input.preferredProvider),
    signals: input.signals,
    feedback: input.feedback as ResumeFeedbackSignal | undefined,
  });
  return {
    ...decision,
    resumeStrategy: decision.resumeStrategy as ResumeStrategy,
    resumeFeedback: decision.resumeFeedback as ResumeFeedback | undefined,
  };
}
