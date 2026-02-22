import type { ProviderAdapter, ContentPart } from "@kilnai/core";
import type { ModeBSession } from "./mode-b-session.js";

export interface OrchestratorDeps {
  readonly provider: ProviderAdapter;
  readonly maxTokens?: number;
}

export interface OrchestrateResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export class ModeBOrchestrator {
  private readonly deps: OrchestratorDeps;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  async processMessage(
    session: ModeBSession,
    userParts: readonly ContentPart[],
    recalledMemory?: string,
  ): Promise<OrchestrateResult> {
    session.addUserMessage(userParts);

    let system = session.systemPrompt;
    if (recalledMemory) {
      system += "\n\n--- Recalled Memory ---\n" + recalledMemory;
    }

    const messages = [...session.conversationHistory];

    const response = await this.deps.provider.createMessage({
      system,
      messages,
      maxTokens: this.deps.maxTokens,
    });

    session.addAssistantMessage(response.parts);

    return {
      parts: response.parts,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cacheReadTokens: response.cacheReadTokens,
      cacheWriteTokens: response.cacheWriteTokens,
    };
  }
}
