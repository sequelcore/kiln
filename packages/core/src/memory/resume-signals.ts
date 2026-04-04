export interface ResumeSignalSet {
  readonly cachedResumeSignalCount: number;
  readonly hasCachedResumeContext: boolean;
}

export function collectResumeSignalsFromPresence(input: {
  signals: readonly boolean[];
}): ResumeSignalSet {
  const cachedResumeSignalCount = input.signals.filter(Boolean).length;
  return {
    cachedResumeSignalCount,
    hasCachedResumeContext: cachedResumeSignalCount > 0,
  };
}
