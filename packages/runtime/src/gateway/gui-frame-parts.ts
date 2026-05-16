import { textParts, type ContentPart } from "@kilnai/core";
import type { GuiOutboundFrame } from "@kilnai/gateway-contracts";

export function guiOutboundMessageParts(
  frame: Extract<GuiOutboundFrame, { type: "message" }>,
): readonly ContentPart[] {
  const content = frame.content.trim();
  const explicitParts = Array.isArray(frame.parts) && frame.parts.length > 0
    ? frame.parts as readonly ContentPart[]
    : undefined;
  if (!explicitParts) {
    return textParts(content);
  }
  const hasTextPart = explicitParts.some((part) => part.type === "text");
  if (content && !hasTextPart) {
    return [{ type: "text", text: content }, ...explicitParts];
  }
  return explicitParts;
}
