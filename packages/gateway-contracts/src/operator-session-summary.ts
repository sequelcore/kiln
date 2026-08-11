import { z } from "zod";

export const OperatorSessionTurnOutcomeSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
  "paused",
]);

export type OperatorSessionTurnOutcome = z.infer<typeof OperatorSessionTurnOutcomeSchema>;

export interface OperatorSessionRouteIdentity {
  readonly provider: string;
  readonly model?: string;
}

export interface OperatorSessionSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly providersUsed: readonly string[];
  readonly lastRoute?: OperatorSessionRouteIdentity;
  readonly lastTurnOutcome?: OperatorSessionTurnOutcome;
  readonly updatedAt: string;
  readonly costUsd: number;
}

export interface OperatorSessionHistoryResponse {
  readonly sessions: readonly OperatorSessionSummary[];
}

export const OperatorSessionRouteIdentitySchema: z.ZodType<OperatorSessionRouteIdentity> = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
});

export const OperatorSessionSummarySchema: z.ZodType<OperatorSessionSummary> = z.object({
  sessionId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)),
  providersUsed: z.array(z.string().trim().min(1)),
  lastRoute: OperatorSessionRouteIdentitySchema.optional(),
  lastTurnOutcome: OperatorSessionTurnOutcomeSchema.optional(),
  updatedAt: z.string().datetime({ offset: true }),
  costUsd: z.number().finite().nonnegative(),
});

export const OperatorSessionHistoryResponseSchema: z.ZodType<OperatorSessionHistoryResponse> = z.object({
  sessions: z.array(OperatorSessionSummarySchema),
});

export interface OperatorSessionTranscriptEvidence {
  readonly sessionId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly providersUsed?: readonly string[];
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly task: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly lastTurnOutcome?: OperatorSessionTurnOutcome;
  readonly costUsd?: number;
}

export interface OperatorSessionLedgerEvidence {
  readonly provider: string;
  readonly model?: string;
  readonly providersUsed?: readonly string[];
  readonly title?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly task?: string;
  readonly completedAt: string;
  readonly accumulatedCostUsd: number;
}

export interface OperatorSessionSummaryProjectionInput {
  readonly transcript: OperatorSessionTranscriptEvidence;
  readonly ledger?: OperatorSessionLedgerEvidence;
}

function meaningful(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.toLowerCase() === "interactive") return undefined;
  return normalized;
}

function unique(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function latestTimestamp(left: string, right: string | undefined): string {
  return right && right.localeCompare(left) > 0 ? right : left;
}

export function projectOperatorSessionSummary(
  input: OperatorSessionSummaryProjectionInput,
): OperatorSessionSummary {
  const transcript = input.transcript;
  const ledger = input.ledger;
  const transcriptTimestamp = transcript.completedAt ?? transcript.startedAt;
  const ledgerIsNewer = Boolean(ledger && ledger.completedAt.localeCompare(transcriptTimestamp) > 0);
  const primary = ledgerIsNewer ? ledger : transcript;
  const secondary = ledgerIsNewer ? transcript : ledger;
  const title = meaningful(primary?.title)
    ?? meaningful(secondary?.title)
    ?? meaningful(primary?.summary)
    ?? meaningful(secondary?.summary)
    ?? meaningful(primary?.task)
    ?? meaningful(secondary?.task)
    ?? "Untitled session";
  const summary = meaningful(primary?.summary) ?? meaningful(secondary?.summary);
  const routeEvidence = primary?.provider?.trim()
    ? primary
    : secondary?.provider?.trim()
      ? secondary
      : undefined;
  const lastProvider = routeEvidence?.provider?.trim();
  const lastModel = routeEvidence?.model?.trim();
  const costUsd = ledger?.accumulatedCostUsd ?? transcript.costUsd ?? 0;

  return OperatorSessionSummarySchema.parse({
    sessionId: transcript.sessionId,
    title,
    ...(summary ? { summary } : {}),
    tags: unique([...(transcript.tags ?? []), ...(ledger?.tags ?? [])]),
    providersUsed: unique(ledgerIsNewer ? [
      ...(ledger?.providersUsed ?? []),
      ledger?.provider,
      ...(transcript.providersUsed ?? []),
      transcript.provider,
    ] : [
      ...(transcript.providersUsed ?? []),
      transcript.provider,
      ...(ledger?.providersUsed ?? []),
      ledger?.provider,
    ]),
    ...(lastProvider ? {
      lastRoute: {
        provider: lastProvider,
        ...(lastModel ? { model: lastModel } : {}),
      },
    } : {}),
    ...(transcript.lastTurnOutcome ? { lastTurnOutcome: transcript.lastTurnOutcome } : {}),
    updatedAt: latestTimestamp(transcriptTimestamp, ledger?.completedAt),
    costUsd,
  });
}
