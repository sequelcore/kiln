// Deterministic effort scoring inputs. Provider-backed conversation
// enrichment was removed because it had no durable action-claim owner.
export interface EffortComponents {
  readonly userTurns: number;
  readonly clarificationRequests: number;
  readonly toolErrors: number;
  readonly agentHandoffs: number;
  readonly escalated: boolean;
}
