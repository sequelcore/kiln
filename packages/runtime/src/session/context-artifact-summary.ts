import {
  collectResumeSignalsFromPresence,
  decideResumePolicy,
  normalizeTaskShapeKey,
  type ResumeFeedbackSignal,
  type ResumePolicyDecision,
  type ContextArtifact,
  type ContextArtifactCache,
} from "@kilnai/core";
import type { ModeBSession } from "./mode-b-session.js";

function buildRuntimeThreadArtifactKey(session: Pick<ModeBSession, "appName" | "tenantId" | "userId">): string {
  return `runtime-thread-summary:${session.appName}:${session.tenantId}:${session.userId}`;
}

function buildRuntimeHandoffArtifactKey(session: Pick<ModeBSession, "appName" | "tenantId" | "userId">): string {
  return `runtime-handoff-summary:${session.appName}:${session.tenantId}:${session.userId}`;
}

function buildRuntimeContextBundleKey(input: {
  appName: string;
  tenantId: string;
  channel: string;
  provider: string;
  taskShape: string;
}): string {
  return `runtime-context-bundle:${input.appName}:${input.tenantId}:${input.channel}:${input.provider}:${input.taskShape}`;
}

function buildRuntimeToolBundleKey(input: {
  appName: string;
  tenantId: string;
  channel: string;
  taskShape: string;
}): string {
  return `runtime-tool-bundle:${input.appName}:${input.tenantId}:${input.channel}:${input.taskShape}`;
}

function buildRuntimeContinuityOutcomeKey(input: {
  appName: string;
  tenantId: string;
  userId: string;
  channel: string;
}): string {
  return `runtime-continuity-outcome:${input.appName}:${input.tenantId}:${input.userId}:${input.channel}`;
}

const RUNTIME_CONTINUITY_HISTORY_LIMIT = 6;
const MIN_RUNTIME_FEEDBACK_SAMPLES = 2;
export type RuntimeSupportArtifactSource = "thread" | "handoff" | "context" | "tools";

interface RuntimeContinuityOutcomeSample {
  readonly strategy: "cache-first" | "fallback-replay";
  readonly responded: boolean;
  readonly tokens: number;
}

interface RuntimeContinuityOutcomeStats {
  readonly samples: number;
  readonly respondedRate: number;
  readonly averageTokens: number;
}

function parseRuntimeContinuityOutcomeLine(line: string): RuntimeContinuityOutcomeSample | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return undefined;
  const parts = trimmed.slice(2).split(" ");
  const values = new Map<string, string>();
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    values.set(part.slice(0, separator), part.slice(separator + 1));
  }
  const strategy = values.get("strategy");
  if (strategy !== "cache-first" && strategy !== "fallback-replay") {
    return undefined;
  }
  const phase = values.get("phase");
  const tokens = Number(values.get("tokens") ?? "0");
  return {
    strategy,
    responded: phase === "responded",
    tokens: Number.isFinite(tokens) ? tokens : 0,
  };
}

function buildRuntimeContinuityStats(
  samples: readonly RuntimeContinuityOutcomeSample[],
): RuntimeContinuityOutcomeStats | undefined {
  if (samples.length === 0) return undefined;
  const totals = samples.reduce((acc, sample) => ({
    responded: acc.responded + (sample.responded ? 1 : 0),
    tokens: acc.tokens + sample.tokens,
  }), { responded: 0, tokens: 0 });
  return {
    samples: samples.length,
    respondedRate: totals.responded / samples.length,
    averageTokens: totals.tokens / samples.length,
  };
}

function inferRuntimeResumeFeedback(
  cache: ContextArtifactCache,
  input: {
    session: Pick<ModeBSession, "appName" | "tenantId" | "userId">;
    channel: string;
  },
): ResumeFeedbackSignal | undefined {
  const artifact = cache.get(buildRuntimeContinuityOutcomeKey({
    appName: input.session.appName,
    tenantId: input.session.tenantId,
    userId: input.session.userId,
    channel: input.channel,
  }));
  if (!artifact) return undefined;

  const samples = artifact.content
    .split("\n")
    .map(parseRuntimeContinuityOutcomeLine)
    .filter((sample): sample is RuntimeContinuityOutcomeSample => sample !== undefined);
  if (samples.length === 0) return undefined;

  const cacheFirstStats = buildRuntimeContinuityStats(samples.filter((sample) => sample.strategy === "cache-first"));
  const fallbackStats = buildRuntimeContinuityStats(samples.filter((sample) => sample.strategy === "fallback-replay"));
  const sampleSize = samples.length;

  if (
    cacheFirstStats === undefined
    || fallbackStats === undefined
    || cacheFirstStats.samples < MIN_RUNTIME_FEEDBACK_SAMPLES
    || fallbackStats.samples < MIN_RUNTIME_FEEDBACK_SAMPLES
  ) {
    return { sampleSize, influencedChoice: false };
  }

  if (
    cacheFirstStats.respondedRate >= fallbackStats.respondedRate + 0.25
    || (
      cacheFirstStats.respondedRate >= fallbackStats.respondedRate
      && cacheFirstStats.averageTokens <= fallbackStats.averageTokens * 0.85
    )
  ) {
    return { preferredStrategy: "cache-first", sampleSize, influencedChoice: false };
  }

  if (
    fallbackStats.respondedRate >= cacheFirstStats.respondedRate + 0.25
    || (
      fallbackStats.respondedRate >= cacheFirstStats.respondedRate
      && fallbackStats.averageTokens <= cacheFirstStats.averageTokens * 0.85
    )
  ) {
    return { preferredStrategy: "fallback-replay", sampleSize, influencedChoice: false };
  }

  return { sampleSize, influencedChoice: false };
}

export function normalizeRuntimeTaskShape(text: string): string {
  return normalizeTaskShapeKey(text, 48);
}

export function readRuntimeSupportArtifacts(
  cache: ContextArtifactCache | undefined,
  input: {
    session: Pick<ModeBSession, "appName" | "tenantId" | "userId" | "exactArtifacts" | "sessionLedger">;
    channel: string;
    providerHint?: string;
    taskShape: string;
  },
): string | undefined {
  return readRuntimeSupportArtifactsDetailed(cache, input).content;
}

export function readRuntimeSupportArtifactsDetailed(
  cache: ContextArtifactCache | undefined,
  input: {
    session: Pick<ModeBSession, "appName" | "tenantId" | "userId" | "exactArtifacts" | "sessionLedger">;
    channel: string;
    providerHint?: string;
    taskShape: string;
  },
): {
  content?: string;
  decision: ResumePolicyDecision;
  supportArtifactCount: number;
  supportArtifactSources: readonly RuntimeSupportArtifactSource[];
  fallbackLabel?: string;
  usedCachedSupport: boolean;
  selectionReason?: string;
} {
  const emptyDecision = decideResumePolicy({
    nativeResumeEligible: false,
    resumeSessionId: undefined,
    signals: { cachedResumeSignalCount: 0, hasCachedResumeContext: false },
  });
  if (!cache) {
    return {
      decision: emptyDecision,
      supportArtifactCount: 0,
      supportArtifactSources: [],
      fallbackLabel: "no-cache",
      usedCachedSupport: false,
      selectionReason: "no-cache",
    };
  }
  if (input.session.exactArtifacts.length > 0 || input.session.sessionLedger.lastSummary) {
    return {
      supportArtifactCount: 0,
      supportArtifactSources: [],
      fallbackLabel: "live-session",
      usedCachedSupport: false,
      selectionReason: "live-session",
      decision: {
        ...emptyDecision,
        resumeStrategy: "fallback-replay",
      },
    };
  }
  const provider = input.providerHint ?? "unknown";
  const artifactEntries: readonly {
    readonly source: RuntimeSupportArtifactSource;
    readonly content?: string;
  }[] = [
    {
      source: "thread",
      content: cache.get(buildRuntimeThreadArtifactKey(input.session))?.content,
    },
    {
      source: "handoff",
      content: cache.get(buildRuntimeHandoffArtifactKey(input.session))?.content,
    },
    {
      source: "context",
      content: cache.get(buildRuntimeContextBundleKey({
        appName: input.session.appName,
        tenantId: input.session.tenantId,
        channel: input.channel,
        provider,
        taskShape: input.taskShape,
      }))?.content,
    },
    {
      source: "tools",
      content: cache.get(buildRuntimeToolBundleKey({
        appName: input.session.appName,
        tenantId: input.session.tenantId,
        channel: input.channel,
        taskShape: input.taskShape,
      }))?.content,
    },
  ];
  const contents = artifactEntries.map((entry) => entry.content);
  const supportArtifactSources = artifactEntries
    .filter((entry) => Boolean(entry.content && entry.content.trim() !== ""))
    .map((entry) => entry.source);
  const signals = collectResumeSignalsFromPresence({
    signals: contents.map((content) => Boolean(content && content.trim() !== "")),
  });
  const feedback = inferRuntimeResumeFeedback(cache, {
    session: input.session,
    channel: input.channel,
  });
  const decision = decideResumePolicy({
    // Runtime continuity is thread-scoped and cache-backed; there is no
    // provider-native resume surface here, so the core policy should resolve
    // to cache-first or fallback behavior only.
    resumeSessionId: buildRuntimeThreadArtifactKey(input.session),
    nativeResumeEligible: false,
    signals,
    feedback,
  });
  if (decision.resumeStrategy !== "cache-first") {
    return {
      decision,
      supportArtifactCount: signals.cachedResumeSignalCount,
      supportArtifactSources,
      fallbackLabel: signals.cachedResumeSignalCount > 0 ? "sources-not-selected" : "no-sources",
      usedCachedSupport: false,
      selectionReason: signals.cachedResumeSignalCount > 0 ? "withheld-by-policy" : "no-sources",
    };
  }
  const resolvedContents = contents.filter((content): content is string => Boolean(content && content.trim() !== ""));

  return {
    content: resolvedContents.length > 0 ? resolvedContents.join("\n\n") : undefined,
    decision,
    supportArtifactCount: signals.cachedResumeSignalCount,
    supportArtifactSources,
    fallbackLabel: undefined,
    usedCachedSupport: resolvedContents.length > 0,
    selectionReason: signals.cachedResumeSignalCount >= 2 ? "multi-source-cache" : "single-source-cache",
  };
}

export function writeRuntimeThreadSummaryArtifact(
  cache: ContextArtifactCache | undefined,
  session: Pick<ModeBSession, "appName" | "tenantId" | "userId" | "sessionLedger" | "exactArtifacts">,
): void {
  if (!cache) return;

  const content = [
    `Runtime thread: ${session.appName}/${session.tenantId}/${session.userId}`,
    `Phase: ${session.sessionLedger.currentPhase}`,
    ...(session.sessionLedger.lastProvider ? [`Last provider: ${session.sessionLedger.lastProvider}`] : []),
    ...(session.sessionLedger.toolCallCount !== undefined ? [`Tool calls: ${session.sessionLedger.toolCallCount}`] : []),
    ...(session.sessionLedger.turnDepth !== undefined ? [`Turn depth: ${session.sessionLedger.turnDepth}`] : []),
    ...(session.sessionLedger.lastSummary ? [`Last summary: ${session.sessionLedger.lastSummary}`] : []),
    ...(session.exactArtifacts.length > 0
      ? ["Recent exact artifacts:", ...session.exactArtifacts.slice(-8).map((artifact) => `- ${artifact}`)]
      : []),
  ].join("\n");

  const now = new Date();
  const artifact: ContextArtifact = {
    key: buildRuntimeThreadArtifactKey(session),
    kind: "runtime-thread-summary",
    content,
    createdAt: now,
    updatedAt: now,
    tags: [session.appName, session.tenantId, session.userId],
  };
  cache.set(artifact);
}

export function writeRuntimeHandoffSummaryArtifact(
  cache: ContextArtifactCache | undefined,
  input: {
    session: Pick<ModeBSession, "appName" | "tenantId" | "userId">;
    handoffBrief?: string;
    handoffBlocked?: boolean;
    handoffBlockReason?: string;
    escalationReason?: string;
    escalationDetail?: string;
  },
): void {
  if (!cache) return;
  if (
    !input.handoffBrief
    && !input.handoffBlocked
    && !input.escalationReason
    && !input.escalationDetail
  ) {
    return;
  }

  const now = new Date();
  const artifact: ContextArtifact = {
    key: buildRuntimeHandoffArtifactKey(input.session),
    kind: "runtime-handoff-summary",
    content: [
      `Runtime handoff/escalation summary: ${input.session.appName}/${input.session.tenantId}/${input.session.userId}`,
      ...(input.handoffBrief ? [`Handoff brief: ${input.handoffBrief}`] : []),
      ...(input.handoffBlocked ? [`Handoff blocked: ${input.handoffBlockReason ?? "unknown"}`] : []),
      ...(input.escalationReason ? [`Escalation reason: ${input.escalationReason}`] : []),
      ...(input.escalationDetail ? [`Escalation detail: ${input.escalationDetail}`] : []),
    ].join("\n"),
    createdAt: now,
    updatedAt: now,
    tags: [input.session.appName, input.session.tenantId, input.session.userId],
  };
  cache.set(artifact);
}

export function writeRuntimeContextBundleArtifact(
  cache: ContextArtifactCache | undefined,
  input: {
    appName: string;
    tenantId: string;
    channel: string;
    provider: string;
    taskShape: string;
    activeAgentId?: string;
    routingTier?: string;
    contextSummary?: string;
  },
): void {
  if (!cache || !input.contextSummary || input.contextSummary.trim() === "") return;

  const now = new Date();
  const artifact: ContextArtifact = {
    key: buildRuntimeContextBundleKey(input),
    kind: "runtime-context-bundle",
    content: [
      `Runtime context bundle: ${input.appName}/${input.tenantId}`,
      `Channel: ${input.channel}`,
      `Provider: ${input.provider}`,
      `Task shape: ${input.taskShape}`,
      ...(input.activeAgentId ? [`Active agent: ${input.activeAgentId}`] : []),
      ...(input.routingTier ? [`Routing tier: ${input.routingTier}`] : []),
      `Context summary: ${input.contextSummary}`,
    ].join("\n"),
    createdAt: now,
    updatedAt: now,
    tags: [input.appName, input.tenantId, input.channel, input.provider, input.taskShape],
  };
  cache.set(artifact);
}

export function writeRuntimeToolBundleArtifact(
  cache: ContextArtifactCache | undefined,
  input: {
    appName: string;
    tenantId: string;
    channel: string;
    taskShape: string;
    toolExecutions?: readonly {
      toolName: string;
      success: boolean;
      resultSummary: string;
    }[];
  },
): void {
  if (!cache || !input.toolExecutions || input.toolExecutions.length === 0) return;

  const summarized = input.toolExecutions
    .filter((exec) => exec.resultSummary.trim() !== "")
    .slice(0, 6)
    .map((exec) => `- ${exec.toolName} (${exec.success ? "success" : "error"}): ${exec.resultSummary}`);
  if (summarized.length === 0) return;

  const now = new Date();
  const artifact: ContextArtifact = {
    key: buildRuntimeToolBundleKey(input),
    kind: "runtime-tool-bundle",
    content: [
      `Runtime tool bundle: ${input.appName}/${input.tenantId}`,
      `Channel: ${input.channel}`,
      `Task shape: ${input.taskShape}`,
      "Recent tool outcomes:",
      ...summarized,
    ].join("\n"),
    createdAt: now,
    updatedAt: now,
    tags: [input.appName, input.tenantId, input.channel, input.taskShape],
  };
  cache.set(artifact);
}

export function writeRuntimeContinuityOutcomeArtifact(
  cache: ContextArtifactCache | undefined,
  input: {
    session: Pick<ModeBSession, "appName" | "tenantId" | "userId">;
    channel: string;
    taskShape: string;
    decision: ResumePolicyDecision;
    queued: boolean;
    inputTokens: number;
    outputTokens: number;
    toolCount?: number;
    provider?: string;
    model?: string;
  },
): void {
  if (!cache) return;

  const key = buildRuntimeContinuityOutcomeKey({
    appName: input.session.appName,
    tenantId: input.session.tenantId,
    userId: input.session.userId,
    channel: input.channel,
  });
  const existing = cache.get(key)?.content;
  const previousEntries = existing
    ?.split("\n")
    .filter((line) => line.startsWith("- "))
    ?? [];
  const outcomeLine = [
    `- strategy=${input.decision.resumeStrategy}`,
    `signals=${input.decision.cachedResumeSignalCount}`,
    `cache=${input.decision.resumeStrategy === "cache-first" ? "yes" : "no"}`,
    `phase=${input.queued ? "queued" : "responded"}`,
    `task=${input.taskShape}`,
    `tokens=${input.inputTokens + input.outputTokens}`,
    `tools=${input.toolCount ?? 0}`,
    ...(input.provider ? [`provider=${input.provider}`] : []),
    ...(input.model ? [`model=${input.model}`] : []),
  ].join(" ");
  const entries = [outcomeLine, ...previousEntries].slice(0, RUNTIME_CONTINUITY_HISTORY_LIMIT);

  const now = new Date();
  const artifact: ContextArtifact = {
    key,
    kind: "runtime-continuity-outcome",
    content: [
      `Runtime continuity outcomes: ${input.session.appName}/${input.session.tenantId}/${input.session.userId}`,
      `Channel: ${input.channel}`,
      "Recent outcomes:",
      ...entries,
    ].join("\n"),
    createdAt: now,
    updatedAt: now,
    tags: [input.session.appName, input.session.tenantId, input.session.userId, input.channel],
  };
  cache.set(artifact);
}

export function formatRuntimeResumeDecision(decision: ResumePolicyDecision): string {
  const feedback = decision.resumeFeedback?.preferredStrategy
    ? `, prefer ${decision.resumeFeedback.preferredStrategy}, samples=${decision.resumeFeedback.sampleSize}`
    : decision.resumeFeedback
      ? `, samples=${decision.resumeFeedback.sampleSize}`
      : "";
  return `Runtime continuity decision: ${decision.resumeStrategy} (signals=${decision.cachedResumeSignalCount}${feedback})`;
}

export function formatRuntimeResumeFeedbackLabel(
  decision: ResumePolicyDecision,
): string | undefined {
  if (!decision.resumeFeedback) {
    return undefined;
  }
  const source = decision.resumeFeedback.influencedChoice ? "applied" : "observed";
  const preferred = decision.resumeFeedback.preferredStrategy
    ? ` ${decision.resumeFeedback.preferredStrategy}`
    : "";
  return `${source}${preferred} · ${decision.resumeFeedback.sampleSize}`;
}

export function classifyRuntimeContextPressure(
  supportArtifactCount: number,
): "none" | "low" | "medium" | "high" {
  if (supportArtifactCount <= 0) return "none";
  if (supportArtifactCount === 1) return "low";
  if (supportArtifactCount === 2) return "medium";
  return "high";
}
