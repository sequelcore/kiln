// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ContentPart
} from "@kilnai/core";
import {
  sanitizeAssistantEgressText as sanitizeAssistantEgressTextCanonical
} from "../../session/assistant-egress-sanitizer.js";
import type { AdmittedTurnContext } from "./process-admitted-turn.js";

type EgressDestination = "webhook";
export type EgressPermissionDecision = "allow" | "deny" | "redact";
type EgressPayloadType = "assistant-response" | "context-summary" | "tool-result-summary";
export const EGRESS_DENIED_FALLBACK_TEXT = "I cannot share that response.";
export const EGRESS_REDACTED_TEXT = "[REDACTED]";

export function sanitizeAssistantEgressParts(parts: readonly ContentPart[]): readonly ContentPart[] {
  const sanitized = parts.map((part) => {
    if (part.type !== "text") {
      return part;
    }
    return {
      ...part,
      text: sanitizeAssistantEgressText(part.text),
    };
  });
  return compactAssistantTextParts(sanitized);
}

export function sanitizeAssistantEgressText(text: string): string {
  const withoutToolCallMarkup = stripLeakedProviderToolCallMarkup(text);
  const withoutWorkItemPayload = stripLeakedWorkItemUpdatePayloadPrefix(withoutToolCallMarkup);
  const withoutScratchpadPrefix = stripLeakedInternalScratchpadPrefix(withoutWorkItemPayload);
  return sanitizeAssistantEgressTextCanonical(withoutScratchpadPrefix);
}

export function stripLeakedProviderToolCallMarkup(text: string): string {
  const firstLeakedToolCall = text.search(/<assistant\s+to=[^>]+>|to=functions\.[A-Za-z0-9_.-]+/i);
  if (firstLeakedToolCall < 0) {
    return text;
  }
  return text
    .slice(firstLeakedToolCall)
    .replace(/<assistant\s+to=[^>]+>\s*(?:\{[^{}]*\}\s*)*/gi, "")
    .replace(/^\s*to=functions\.[A-Za-z0-9_.-]+\s*(?:\{[^{}]*\}\s*)*/i, "")
    .trimStart();
}

export function stripLeakedInternalScratchpadPrefix(text: string): string {
  const trimmed = text.trimStart();
  if (!startsWithScratchpadCue(trimmed)) {
    return text;
  }
  const anchorIndex = findUserFacingAnchorIndex(trimmed);
  if (anchorIndex > 0 && looksLikeScratchpadPrefix(trimmed.slice(0, anchorIndex))) {
    return trimmed.slice(anchorIndex).trimStart();
  }
  if (looksLikeScratchpadPrefix(trimmed)) {
    return "";
  }
  return text;
}

const SCRATCHPAD_CUE = /^(?:Need|Maybe|Use|Search|Check|Also)\b/i;
const USER_FACING_ANCHOR = /\b(?:I['’]ll|I will|I['’]m|I'm|I created|I started|I found|Current status:|Started governed work|No implementation changes)/i;
const SCRATCHPAD_INTERNAL_MARKER = /\b(?:maybe|perhaps|resource_read|web_extract|web_fetch|web_search|browser|tool|tools|github api|read-only command|Need\b.*\bNeed\b)|\?/i;

function startsWithScratchpadCue(text: string): boolean {
  return SCRATCHPAD_CUE.test(text);
}

function findUserFacingAnchorIndex(text: string): number {
  const match = USER_FACING_ANCHOR.exec(text);
  return match?.index ?? -1;
}

function looksLikeScratchpadPrefix(text: string): boolean {
  return startsWithScratchpadCue(text) && SCRATCHPAD_INTERNAL_MARKER.test(text);
}

export function compactAssistantTextParts(parts: readonly ContentPart[]): readonly ContentPart[] {
  const compacted: ContentPart[] = [];
  for (const part of parts) {
    if (part.type !== "text") {
      compacted.push(part);
      continue;
    }
    if (part.text.length === 0) {
      continue;
    }
    const previous = compacted.at(-1);
    if (previous?.type !== "text") {
      compacted.push(part);
      continue;
    }
    compacted[compacted.length - 1] = {
      ...previous,
      text: joinAssistantText(previous.text, part.text),
    };
  }
  return compacted;
}

export function joinAssistantText(left: string, right: string): string {
  if (left.length === 0 || right.length === 0 || /\s$/.test(left) || /^\s/.test(right)) {
    return `${left}${right}`;
  }
  if (/[.!?]$/.test(left) && /^[A-Z`]/.test(right)) {
    return `${left}\n\n${right}`;
  }
  return `${left} ${right}`;
}

export function stripLeakedWorkItemUpdatePayloadPrefix(text: string): string {
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith("{")) {
    return text;
  }
  const leadingJson = readLeadingJsonObject(trimmedStart);
  if (!leadingJson || !looksLikeWorkItemUpdatePayload(leadingJson.value)) {
    return text;
  }
  return trimmedStart.slice(leadingJson.endIndex).trimStart();
}

function readLeadingJsonObject(text: string): { readonly value: Record<string, unknown>; readonly endIndex: number } | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }
    depth -= 1;
    if (depth !== 0) {
      continue;
    }
    try {
      const value = JSON.parse(text.slice(0, index + 1)) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? { value: value as Record<string, unknown>, endIndex: index + 1 }
        : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function looksLikeWorkItemUpdatePayload(value: Record<string, unknown>): boolean {
  return typeof value.id === "string"
    && Array.isArray(value.providedEvidence)
    && Array.isArray(value.verificationGateResults);
}

export interface EgressPermissionRequest {
  readonly tenantId: string;
  readonly channel: string;
  readonly destination: EgressDestination;
  readonly payloadType: EgressPayloadType;
  readonly text: string;
  readonly sessionId: string;
}
function mapChannelToEgressDestination(_channel: string): EgressDestination {
  // Gateway egress in this pipeline exits runtime over external integrations.
  // For this slice, model all channels as webhook-class destinations.
  return "webhook";
}

export async function resolveEgressDecision(
  ctx: AdmittedTurnContext,
  tenantId: string,
  sessionId: string,
  payloadType: EgressPayloadType,
  text: string | undefined,
): Promise<EgressPermissionDecision> {
  if (!ctx.evaluateEgressPermission) return "allow";
  if (!text || text.trim() === "") return "allow";
  try {
    return await ctx.evaluateEgressPermission({
      tenantId,
      channel: ctx.channel,
      destination: mapChannelToEgressDestination(ctx.channel),
      payloadType,
      text,
      sessionId,
    });
  } catch {
    // Fail-open for this foundation slice.
    return "allow";
  }
}

export function redactAssistantParts(parts: readonly ContentPart[]): readonly ContentPart[] {
  let changed = false;
  const redacted = parts.map((part) => {
    if (part.type !== "text") return part;
    changed = true;
    return { type: "text", text: EGRESS_REDACTED_TEXT } as const;
  });
  return changed ? redacted : parts;
}

