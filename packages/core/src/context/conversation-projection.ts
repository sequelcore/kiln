import type { AgentMessage } from "../agents/index.js";
import type { ToolResultPart } from "../engine/domain/content.js";
import { estimateTextTokens } from "./projected-context.js";

export const DEFAULT_CONVERSATION_TOOL_RESULT_PROJECTION_POLICY: ConversationToolResultProjectionPolicy = {
  triggerToolResultTokens: 24_000,
  retainRecentToolResults: 3,
};

export interface ConversationToolResultProjectionPolicy {
  readonly triggerToolResultTokens: number;
  readonly retainRecentToolResults: number;
}

export interface ConversationProjectionEvidence {
  readonly policyId: "tool-result-clearing-v1";
  readonly triggerToolResultTokens: number;
  readonly retainRecentToolResults: number;
  readonly originalToolResultCount: number;
  readonly projectedToolResultCount: number;
  readonly originalToolResultTokens: number;
  readonly projectedToolResultTokens: number;
  readonly clearedToolResultCount: number;
  readonly clearedToolUseIds: readonly string[];
  readonly overflow: boolean;
}

export interface ProjectedConversation {
  readonly messages: readonly AgentMessage[];
  readonly evidence: ConversationProjectionEvidence;
}

interface ToolResultLocation {
  readonly messageIndex: number;
  readonly partIndex: number;
  readonly part: ToolResultPart;
  readonly estimatedTokens: number;
}

export function projectConversationForModel(
  messages: readonly AgentMessage[],
  policy: ConversationToolResultProjectionPolicy = DEFAULT_CONVERSATION_TOOL_RESULT_PROJECTION_POLICY,
): ProjectedConversation {
  validatePolicy(policy);
  const locations = collectToolResults(messages);
  const originalToolResultTokens = locations.reduce((total, location) => total + location.estimatedTokens, 0);
  const baseEvidence = {
    policyId: "tool-result-clearing-v1" as const,
    triggerToolResultTokens: policy.triggerToolResultTokens,
    retainRecentToolResults: policy.retainRecentToolResults,
    originalToolResultCount: locations.length,
    projectedToolResultCount: locations.length,
    originalToolResultTokens,
  };

  if (originalToolResultTokens <= policy.triggerToolResultTokens) {
    return {
      messages: [...messages],
      evidence: {
        ...baseEvidence,
        projectedToolResultTokens: originalToolResultTokens,
        clearedToolResultCount: 0,
        clearedToolUseIds: [],
        overflow: false,
      },
    };
  }

  const clearableCount = Math.max(0, locations.length - policy.retainRecentToolResults);
  const replacements = new Map<number, Map<number, ToolResultPart>>();
  const clearedToolUseIds: string[] = [];
  let projectedToolResultTokens = originalToolResultTokens;

  for (const location of locations.slice(0, clearableCount)) {
    if (projectedToolResultTokens <= policy.triggerToolResultTokens) break;
    const replacement = clearedToolResult(location.part);
    projectedToolResultTokens -= location.estimatedTokens;
    projectedToolResultTokens += estimateToolResultTokens(replacement);
    const messageReplacements = replacements.get(location.messageIndex) ?? new Map<number, ToolResultPart>();
    messageReplacements.set(location.partIndex, replacement);
    replacements.set(location.messageIndex, messageReplacements);
    clearedToolUseIds.push(location.part.toolUseId);
  }

  const projectedMessages = replacements.size === 0
    ? [...messages]
    : messages.map((message, messageIndex) => {
        const messageReplacements = replacements.get(messageIndex);
        if (!messageReplacements) return message;
        return {
          ...message,
          parts: message.parts.map((part, partIndex) => messageReplacements.get(partIndex) ?? part),
        };
      });

  return {
    messages: projectedMessages,
    evidence: {
      ...baseEvidence,
      projectedToolResultTokens,
      clearedToolResultCount: clearedToolUseIds.length,
      clearedToolUseIds,
      overflow: projectedToolResultTokens > policy.triggerToolResultTokens,
    },
  };
}

function collectToolResults(messages: readonly AgentMessage[]): readonly ToolResultLocation[] {
  const locations: ToolResultLocation[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type !== "tool_result") continue;
      locations.push({
        messageIndex,
        partIndex,
        part,
        estimatedTokens: estimateToolResultTokens(part),
      });
    }
  }
  return locations;
}

function estimateToolResultTokens(part: ToolResultPart): number {
  const payload = part.contentParts?.length
    ? `${part.content}\n${JSON.stringify(part.contentParts)}`
    : part.content;
  return estimateTextTokens(payload);
}

function clearedToolResult(part: ToolResultPart): ToolResultPart {
  return {
    type: "tool_result",
    toolUseId: part.toolUseId,
    content: `[cleared:${part.toolUseId}]`,
    ...(part.isError !== undefined ? { isError: part.isError } : {}),
  };
}

function validatePolicy(policy: ConversationToolResultProjectionPolicy): void {
  if (!Number.isInteger(policy.triggerToolResultTokens) || policy.triggerToolResultTokens <= 0) {
    throw new Error("triggerToolResultTokens must be a positive integer.");
  }
  if (!Number.isInteger(policy.retainRecentToolResults) || policy.retainRecentToolResults < 0) {
    throw new Error("retainRecentToolResults must be a non-negative integer.");
  }
}
