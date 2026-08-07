import type { StateCreator } from "zustand";
import { createMessageId } from "./session-store-ids.js";
import type { ApprovalGoalActions, SessionStore } from "./session-store-state.js";

/**
 * Operator responses to the runtime: approval decisions (approve/reject a
 * pending tool call) and goal control (pause/resume/update/cancel a running
 * goal), plus the acknowledgement for the latter.
 */

export const createApprovalGoalSlice: StateCreator<
  SessionStore,
  [],
  [],
  ApprovalGoalActions
> = (set, get) => ({
  controlGoal: (input) => {
    const state = get();
    if (!state.outboundSend || state.goalControlPending) {
      return false;
    }
    const requestId = createMessageId();
    state.outboundSend({
      type: "goal_control",
      requestId,
      goalRunId: input.goalRunId,
      action: input.action,
      ...(input.objective ? { objective: input.objective } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    });
    set({
      goalControlPending: {
        requestId,
        goalRunId: input.goalRunId,
        action: input.action,
      },
      errorBanner: null,
    });
    return true;
  },

  onGoalControlResult: (frame) => {
    const pending = get().goalControlPending;
    if (!pending || pending.requestId !== frame.requestId) return;
    set({
      goalControlPending: null,
      ...(frame.status === "failed" ? { errorBanner: frame.reason ?? "Goal control failed." } : {}),
    });
  },

  sendApprovalResponse: (approved, reason, approvalId, options = {}) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) return false;
    if (approved) {
      outboundSend({
        type: "approve",
        approvalId,
        ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      });
    } else {
      outboundSend({
        type: "reject",
        reason: reason ?? "rejected by user",
        approvalId,
        ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      });
    }
    return true;
  },
});
