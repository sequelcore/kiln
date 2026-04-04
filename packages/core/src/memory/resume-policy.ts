import type { ResumeSignalSet } from "./resume-signals.js";

export type ResumeStrategyKind = "none" | "cache-first" | "provider-native" | "fallback-replay";

export interface ResumeFeedbackSignal {
  readonly sampleSize: number;
  readonly preferredStrategy?: Extract<ResumeStrategyKind, "cache-first" | "provider-native" | "fallback-replay">;
  readonly influencedChoice: boolean;
}

export interface ResumePolicyDecision {
  readonly cachedResumeSignalCount: number;
  readonly hasCachedResumeContext: boolean;
  readonly resumeStrategy: ResumeStrategyKind;
  readonly resumeFeedback?: ResumeFeedbackSignal;
  readonly shouldUseProviderNativeResume: boolean;
}

export function decideResumePolicy(input: {
  resumeSessionId?: string;
  nativeResumeEligible: boolean;
  signals: ResumeSignalSet;
  feedback?: ResumeFeedbackSignal;
}): ResumePolicyDecision {
  if (input.resumeSessionId === undefined) {
    return {
      cachedResumeSignalCount: input.signals.cachedResumeSignalCount,
      hasCachedResumeContext: false,
      resumeStrategy: "none",
      resumeFeedback: input.feedback,
      shouldUseProviderNativeResume: false,
    };
  }

  const hasCachedResumeContext = input.signals.hasCachedResumeContext;

  if (input.signals.cachedResumeSignalCount >= 2) {
    return {
      cachedResumeSignalCount: input.signals.cachedResumeSignalCount,
      hasCachedResumeContext,
      resumeStrategy: "cache-first",
      resumeFeedback: input.feedback,
      shouldUseProviderNativeResume: false,
    };
  }

  if (!input.nativeResumeEligible) {
    const fallbackStrategy: Extract<ResumeStrategyKind, "cache-first" | "fallback-replay"> = input.signals.cachedResumeSignalCount >= 1
      ? "cache-first"
      : "fallback-replay";
    const preferredStrategy = input.feedback?.preferredStrategy;
    const chosenStrategy = input.signals.cachedResumeSignalCount === 1
      && (preferredStrategy === "cache-first" || preferredStrategy === "fallback-replay")
      ? preferredStrategy
      : fallbackStrategy;
    const resumeFeedback = input.feedback
      ? {
          ...input.feedback,
          influencedChoice: preferredStrategy !== undefined && preferredStrategy !== fallbackStrategy,
        }
      : undefined;
    return {
      cachedResumeSignalCount: input.signals.cachedResumeSignalCount,
      hasCachedResumeContext,
      resumeStrategy: chosenStrategy,
      resumeFeedback,
      shouldUseProviderNativeResume: false,
    };
  }

  if (input.signals.cachedResumeSignalCount === 0) {
    return {
      cachedResumeSignalCount: input.signals.cachedResumeSignalCount,
      hasCachedResumeContext,
      resumeStrategy: "provider-native",
      resumeFeedback: input.feedback,
      shouldUseProviderNativeResume: true,
    };
  }

  const fallbackStrategy: Extract<ResumeStrategyKind, "cache-first" | "provider-native"> = "cache-first";
  const chosenStrategy = input.feedback?.preferredStrategy ?? fallbackStrategy;
  const resumeFeedback = input.feedback
    ? {
        ...input.feedback,
        influencedChoice: input.feedback.preferredStrategy !== undefined
          && input.feedback.preferredStrategy !== fallbackStrategy,
      }
    : undefined;

  return {
    cachedResumeSignalCount: input.signals.cachedResumeSignalCount,
    hasCachedResumeContext,
    resumeStrategy: chosenStrategy,
    resumeFeedback,
    shouldUseProviderNativeResume: chosenStrategy === "provider-native" && input.signals.cachedResumeSignalCount < 2,
  };
}
