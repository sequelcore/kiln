import type {
  ConversationEnricher,
  CompletedSession,
  EnrichmentStore,
} from "@kilnai/core";
import type { ConversationEventEmitter } from "../gateway/conversation-event-emitter.js";

export interface EnrichmentRunnerConfig {
  readonly enricher: ConversationEnricher;
  readonly store: EnrichmentStore;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly timeoutMs?: number;
}

export class EnrichmentRunner {
  private readonly config: EnrichmentRunnerConfig;
  private readonly timeoutMs: number;

  constructor(config: EnrichmentRunnerConfig) {
    this.config = config;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  /** Run enrichment for a completed session. Fire-and-forget. */
  runPostConversation(session: CompletedSession): void {
    this.executeEnrichment(session).catch((err) => {
      console.warn("[enrichment] Post-conversation enrichment failed:", err);
    });
  }

  private async executeEnrichment(session: CompletedSession): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const enrichment = await Promise.race([
        this.config.enricher.enrich(session),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error("Enrichment timeout")),
          );
        }),
      ]);

      if (enrichment) {
        await this.config.store.save(enrichment);

        // Emit CONVERSATION_ENRICHED conversation event
        if (this.config.eventEmitter) {
          this.config.eventEmitter.emit({
            eventType: "CONVERSATION_ENRICHED",
            tenantId: session.tenantId,
            channel: "unknown",
            externalUserId: "",
            sessionId: session.sessionId,
            schemaVersion: "1",
            timestamp: new Date().toISOString(),
          });
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
