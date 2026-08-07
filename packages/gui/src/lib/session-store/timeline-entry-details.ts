import { isObjectRecord, readString } from "./unknown-value.js";
import type { TimelineEventEntry, ToolCallStatus } from "./session-timeline-types.js";

/**
 * Reads structured fields (tool identity, approval id, tool status) out of a
 * timeline entry's opaque `details` blob. Pure, no store dependency.
 */

export function approvalIdFromDetails(details: unknown): string | null {
  const record = isObjectRecord(details) ? details : null;
  if (!record) return null;
  return readString(record.approvalId);
}

export function toolCallIdFromDetails(details: unknown): string | null {
  const record = isObjectRecord(details) ? details : null;
  if (!record) return null;
  return readString(record.toolCallId);
}

export function toolCallScopeIdFromDetails(details: unknown): string | null {
  const record = isObjectRecord(details) ? details : null;
  if (!record) return null;
  return readString(record.toolCallScopeId);
}

export function requiredScopedToolIdentity(
  payload: Record<string, unknown>,
  eventId: string,
): { readonly callId: string; readonly scopeId: string; readonly key: string } {
  const callId = readString(payload.toolCallId);
  const scopeId = readString(payload.toolCallScopeId);
  if (!callId || !scopeId) {
    throw new TypeError(`Tool event "${eventId}" requires scoped tool identity.`);
  }
  return { callId, scopeId, key: `${scopeId}\0${callId}` };
}

export function toolNameFromDetails(details: unknown, fallbackTitle: string, fallbackToolName?: string): string {
  const detailRecord = isObjectRecord(details) ? details : null;
  const explicitToolName = readString(detailRecord?.toolName);
  if (explicitToolName) return explicitToolName;
  const titleMatch = /^(?:Tool started:|Tool completed:|Using|Completed)\s+(.+)$/u.exec(fallbackTitle);
  return titleMatch?.[1]?.trim() || fallbackToolName || "tool";
}

export function toolInputFromDetails(details: unknown): Record<string, unknown> {
  const detailRecord = isObjectRecord(details) ? details : null;
  if (!detailRecord) return {};
  if (isObjectRecord(detailRecord.input)) return detailRecord.input;
  return Object.fromEntries(
    Object.entries(detailRecord).filter(([key]) => (
      key !== "toolCallId"
      && key !== "toolCallScopeId"
      && key !== "toolName"
      && key !== "status"
      && key !== "result"
    )),
  );
}

export function toolEntryStatus(value: unknown): ToolCallStatus {
  if (value === "succeeded" || value === "success") {
    return "success";
  }
  if (value === "failed" || value === "cancelled" || value === "timed_out" || value === "error") {
    return "error";
  }
  return "running";
}

export function toolEntryStatusFromPresentation(value: unknown, tone: TimelineEventEntry["tone"]): ToolCallStatus {
  if (tone === "error") {
    return "error";
  }
  if (tone === "success") {
    return "success";
  }
  return toolEntryStatus(value);
}
