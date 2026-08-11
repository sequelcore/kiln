import type { SessionStatus } from "../lib/session-store/index.js";
import type { OperatorSurfaceKind } from "./operator-surface-tabs.js";

export type ChatLayout = "landing" | "active";

interface ChatLayoutState {
  readonly activeSurface: OperatorSurfaceKind;
  readonly conversationEntryCount: number;
  readonly pendingApprovalCount: number;
  readonly hasForegroundGoal: boolean;
  readonly sessionStatus: SessionStatus;
}

export function resolveChatLayout(state: ChatLayoutState): ChatLayout {
  const isEmptyReadyChat =
    state.activeSurface === "chat" &&
    state.conversationEntryCount === 0 &&
    state.pendingApprovalCount === 0 &&
    !state.hasForegroundGoal &&
    state.sessionStatus === "ready";

  return isEmptyReadyChat ? "landing" : "active";
}
