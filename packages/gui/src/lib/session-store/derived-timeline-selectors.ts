import { projectOperatorGovernedWorkItemSnapshot } from "@kilnai/gateway-contracts";
import { isObjectRecord, readNumber, readString } from "./unknown-value.js";
import { nowIso } from "./session-store-ids.js";
import {
  isWorkItemTimelineEventKind,
  normalizeLoadedChangeType,
} from "./session-event-projection.js";
import {
  approvalIdFromDetails,
  requiredScopedToolIdentity,
  toolEntryStatusFromPresentation,
  toolInputFromDetails,
  toolNameFromDetails,
} from "./timeline-entry-details.js";
import type {
  ApprovalRequest,
  ChangedFileEntry,
  TimelineEntry,
  ToolCallEntry,
  WorkItemEntry,
} from "./session-timeline-types.js";

/**
 * Read-only selectors that derive presentation collections (tool call log,
 * pending approvals, changed files, work items) from the timeline entry
 * list. Pure, no store dependency.
 */

export function deriveToolCallLog(entries: readonly TimelineEntry[]): readonly ToolCallEntry[] {
  const toolCalls = new Map<string, ToolCallEntry>();
  for (const entry of entries) {
    if (entry.type !== "event") continue;
    if (entry.eventKind === "tool_call_started") {
      const details = isObjectRecord(entry.details) ? entry.details : {};
      const identity = requiredScopedToolIdentity(details, entry.id);
      const input = toolInputFromDetails(entry.details);
      const toolName = toolNameFromDetails(entry.details, entry.title);
      toolCalls.set(identity.key, {
        callId: identity.callId,
        scopeId: identity.scopeId,
        toolName,
        input,
        status: "running",
        startedAt: entry.createdAt,
      });
      continue;
    }
    if (entry.eventKind === "tool_call_completed") {
      const details = isObjectRecord(entry.details) ? entry.details : null;
      const identity = requiredScopedToolIdentity(details ?? {}, entry.id);
      const previous = toolCalls.get(identity.key);
      toolCalls.set(identity.key, {
        callId: identity.callId,
        scopeId: identity.scopeId,
        toolName: toolNameFromDetails(details, entry.title, previous?.toolName),
        input: isObjectRecord(details?.input) ? details.input : previous?.input ?? {},
        result: readString(details?.result) ?? entry.summary ?? undefined,
        status: toolEntryStatusFromPresentation(details?.status, entry.tone) === "running" ? "error" : toolEntryStatusFromPresentation(details?.status, entry.tone),
        startedAt: previous?.startedAt ?? entry.createdAt,
        completedAt: entry.createdAt,
      });
    }
  }
  return [...toolCalls.values()];
}

export function derivePendingApprovals(entries: readonly TimelineEntry[]): readonly ApprovalRequest[] {
  const pending = new Map<string, ApprovalRequest>();
  for (const entry of entries) {
    if (entry.type !== "event") continue;
    if (entry.eventKind === "approval_requested") {
      const approvalId = approvalIdFromDetails(entry.details) ?? entry.id;
      pending.set(approvalId, {
        id: approvalId,
        description: entry.summary ?? entry.title,
        sessionId: entry.sessionId ?? "",
        requestedAt: entry.createdAt,
      });
      continue;
    }
    if (entry.eventKind === "approval_resolved") {
      const approvalId = approvalIdFromDetails(entry.details);
      if (approvalId) {
        pending.delete(approvalId);
        continue;
      }
      if (entry.sessionId) {
        for (const [key, value] of pending.entries()) {
          if (value.sessionId === entry.sessionId) {
            pending.delete(key);
          }
        }
      }
    }
  }
  return [...pending.values()];
}

export function deriveChangedFiles(entries: readonly TimelineEntry[]): readonly ChangedFileEntry[] {
  const changedFiles: ChangedFileEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "event" || entry.eventKind !== "file_changed") {
      continue;
    }
    const details = isObjectRecord(entry.details) ? entry.details : null;
    const path = readString(details?.path);
    const changeType = normalizeLoadedChangeType(details?.changeType);
    if (!path || !changeType) {
      continue;
    }
    changedFiles.push({
      path,
      changeType,
      linesAdded: readNumber(details?.linesAdded) ?? undefined,
      linesRemoved: readNumber(details?.linesRemoved) ?? undefined,
      diffPreview: readString(details?.diffPreview) ?? undefined,
      diffTruncated: typeof details?.diffTruncated === "boolean" ? details.diffTruncated : undefined,
      recordedAt: entry.createdAt,
    });
  }
  return changedFiles;
}

function workItemFromPayload(
  payload: Record<string, unknown>,
  previous?: WorkItemEntry,
  sessionId?: string,
  turnId?: string,
): WorkItemEntry | null {
  return projectOperatorGovernedWorkItemSnapshot({
    workItem: payload.workItem,
    evidence: payload,
    ...(previous ? { previous } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
    observedAt: nowIso(),
  });
}

export function deriveWorkItems(entries: readonly TimelineEntry[]): readonly WorkItemEntry[] {
  const items = new Map<string, WorkItemEntry>();
  for (const entry of entries) {
    if (entry.type !== "event" || !isWorkItemTimelineEventKind(entry.eventKind)) {
      continue;
    }
    const payload = isObjectRecord(entry.details) ? entry.details : null;
    if (!payload) {
      continue;
    }
    const workItemId = readString(isObjectRecord(payload.workItem) ? payload.workItem.id : undefined);
    const itemKey = workItemId ? `${entry.sessionId ?? ""}${workItemId}` : undefined;
    const item = workItemFromPayload(
      payload,
      itemKey ? items.get(itemKey) : undefined,
      entry.sessionId,
      entry.turnId,
    );
    if (item) {
      items.set(`${item.sessionId ?? ""}${item.id}`, item);
    }
  }
  return [...items.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
