import type { ProviderAdapter, ContentPart, ToolDefinition, ToolCall } from "@kilnai/core";
import type { McpClient } from "@kilnai/core";
import type { ModeBSession } from "./mode-b-session.js";

const MAX_TOOL_ROUNDS = 10;

export interface OrchestratorDeps {
  readonly provider: ProviderAdapter;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolDefinition[];
  readonly mcpClients?: readonly McpClient[];
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

    const hasTools = this.deps.tools && this.deps.tools.length > 0 && this.deps.mcpClients && this.deps.mcpClients.length > 0;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const messages = [...session.conversationHistory];

      const response = await this.deps.provider.createMessage({
        system,
        messages,
        tools: hasTools ? this.deps.tools : undefined,
        maxTokens: this.deps.maxTokens,
      });

      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;
      totalCacheRead += response.cacheReadTokens;
      totalCacheWrite += response.cacheWriteTokens;

      if (!hasTools || response.toolCalls.length === 0) {
        // No tool calls -- final response
        session.addAssistantMessage(response.parts);
        return {
          parts: response.parts,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheRead,
          cacheWriteTokens: totalCacheWrite,
        };
      }

      // Build assistant message with text + tool_use parts
      const assistantParts: ContentPart[] = [...response.parts];
      for (const tc of response.toolCalls) {
        assistantParts.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      session.addAssistantMessage(assistantParts);

      // Execute tools and build tool_result parts
      const resultParts: ContentPart[] = [];
      for (const tc of response.toolCalls) {
        const result = await this.executeTool(tc);
        resultParts.push({
          type: "tool_result",
          toolUseId: tc.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
          isError: false,
        });
      }
      session.addUserMessage(resultParts);
    }

    // Safety: max rounds exceeded, return last available response
    const finalMessages = [...session.conversationHistory];
    const finalResponse = await this.deps.provider.createMessage({
      system,
      messages: finalMessages,
      maxTokens: this.deps.maxTokens,
    });

    totalInputTokens += finalResponse.inputTokens;
    totalOutputTokens += finalResponse.outputTokens;
    totalCacheRead += finalResponse.cacheReadTokens;
    totalCacheWrite += finalResponse.cacheWriteTokens;

    session.addAssistantMessage(finalResponse.parts);
    return {
      parts: finalResponse.parts,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
    };
  }

  private async executeTool(tc: ToolCall): Promise<unknown> {
    if (!this.deps.mcpClients) {
      return `Error: no MCP clients configured`;
    }

    for (const client of this.deps.mcpClients) {
      try {
        return await client.executeTool(tc.name, tc.input);
      } catch {
        // Tool not found on this client, try next
        continue;
      }
    }

    return `Error: tool "${tc.name}" not found on any MCP server`;
  }
}
