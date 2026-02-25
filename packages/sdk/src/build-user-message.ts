import type { ContentPart } from "@kilnai/core";
import type { ChatMessage } from "./types.js";

/** Build a ChatMessage from user input (string or multimodal ContentPart[]). */
export function buildUserMessage(content: string | ContentPart[], id: string): ChatMessage {
  const isText = typeof content === "string";
  return {
    id,
    role: "user",
    content: isText ? content : "",
    parts: isText ? undefined : content,
    timestamp: Date.now(),
  };
}
