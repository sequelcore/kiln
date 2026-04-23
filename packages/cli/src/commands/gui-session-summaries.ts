import type { GuiDashboardSnapshot } from "@kilnai/runtime";
import { resolveSessionSummary, mergeProvidersUsed } from "../application/session-metadata.js";
import type { SessionStore, TranscriptStore } from "../wrapper/session-store.js";

export function toProviderLabel(provider: string): string {
  switch (provider) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "codex-oauth":
      return "Codex OAuth";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "deepseek":
      return "DeepSeek";
    case "ollama":
      return "Ollama";
    case "anthropic":
      return "Anthropic";
    default:
      return provider;
  }
}

function buildSessionSummary(input: {
  summary?: string;
  canonicalTitle?: string;
  title?: string;
  task?: string;
  provider: string;
}): string {
  return resolveSessionSummary({
    summary: input.summary,
    canonicalTitle: input.canonicalTitle ?? input.title,
    task: input.task,
    providerLabel: toProviderLabel(input.provider),
  });
}

function isGenericSummary(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "interactive" || normalized === "untitled session" || normalized.endsWith(" session");
}

export async function loadSessionSummaries(
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
): Promise<GuiDashboardSnapshot["sessions"]> {
  const sessions = await sessionStore.list();
  const loadableSessionIds = new Set(await transcriptStore.listSessions());
  const summaries = new Map<string, {
    id: string;
    providersUsed: string[];
    lastProvider: string;
    completedAt: string;
    cost: number;
    taskSummary: string;
  }>();

  for (const session of sessions) {
    if (!loadableSessionIds.has(session.sessionId)) {
      continue;
    }
    const existing = summaries.get(session.sessionId);
    if (!existing) {
      summaries.set(session.sessionId, {
        id: session.sessionId,
        providersUsed: mergeProvidersUsed(session.providersUsed, [session.provider]),
        lastProvider: session.provider,
        completedAt: session.completedAt,
        cost: session.cost,
        taskSummary: buildSessionSummary({
          summary: session.summary,
          canonicalTitle: session.canonicalTitle,
          title: session.title,
          task: session.task,
          provider: session.provider,
        }),
      });
      continue;
    }

    existing.providersUsed = mergeProvidersUsed(existing.providersUsed, [
      ...(session.providersUsed ?? []),
      session.provider,
    ]);
    const candidateSummary = buildSessionSummary({
      summary: session.summary,
      canonicalTitle: session.canonicalTitle,
      title: session.title,
      task: session.task,
      provider: session.provider,
    });
    if (isGenericSummary(existing.taskSummary) && !isGenericSummary(candidateSummary)) {
      existing.taskSummary = candidateSummary;
    }
    existing.cost += session.cost;
  }

  return [...summaries.values()].slice(0, 20);
}
