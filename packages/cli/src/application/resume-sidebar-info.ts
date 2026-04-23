import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";

export interface ResumeSidebarInfo {
  readonly strategy?: ResumeStrategy;
  readonly feedbackLabel?: string;
}

export function formatResumeFeedback(feedback: ResumeFeedback | undefined): string | undefined {
  if (!feedback) {
    return undefined;
  }
  const source = feedback.influencedChoice ? "applied" : "observed";
  const preferred = feedback.preferredStrategy ? ` ${feedback.preferredStrategy}` : "";
  return `${source}${preferred} · ${feedback.sampleSize}`;
}

export async function loadResumeSidebarInfo(
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
  providerIds: readonly string[],
): Promise<Record<string, ResumeSidebarInfo>> {
  const info: Record<string, ResumeSidebarInfo> = {};
  const orderedRecords = await sessionStore.list();
  const latestByProvider = new Map<string, string>();

  for (const record of orderedRecords) {
    if (!providerIds.includes(record.provider)) {
      continue;
    }
    if (!latestByProvider.has(record.provider)) {
      latestByProvider.set(record.provider, record.sessionId);
    }
    if (latestByProvider.size >= providerIds.length) {
      break;
    }
  }

  for (const provider of providerIds) {
    const sessionId = latestByProvider.get(provider);
    if (!sessionId) {
      continue;
    }
    const meta = await transcriptStore.readMeta(sessionId);
    if (!meta?.resumeStrategy || meta.resumeStrategy === "none") {
      continue;
    }
    info[provider] = {
      strategy: meta.resumeStrategy,
      feedbackLabel: formatResumeFeedback(meta.resumeFeedback),
    };
  }

  return info;
}
