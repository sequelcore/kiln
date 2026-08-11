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
      goalControlFailure: null,
    });
    return true;
  },

  onGoalControlResult: (frame) => {
    const pending = get().goalControlPending;
    if (!pending || pending.requestId !== frame.requestId) return;
    set({
      goalControlPending: null,
      goalControlFailure: frame.status === "failed"
        ? {
            requestId: frame.requestId,
            goalRunId: frame.goalRunId,
            action: frame.action,
            message: frame.reason ?? "Goal control failed.",
          }
        : null,
    });
  },

  onApprovalResponseResult: (frame) => {
    const state = get();
    const pending = state.approvalResponsesPending.find((entry) => entry.requestId === frame.requestId);
    if (!pending || pending.approvalId !== frame.approvalId || pending.decision !== frame.decision) return;
    set({
      approvalResponsesPending: state.approvalResponsesPending.filter((entry) => entry.requestId !== frame.requestId),
      approvalResponseFailure: frame.status === "failed"
        ? {
            requestId: frame.requestId,
            approvalId: frame.approvalId,
            decision: frame.decision,
            message: frame.reason ?? "Approval response failed.",
          }
        : state.approvalResponseFailure?.requestId === frame.requestId ? null : state.approvalResponseFailure,
    });
  },

  sendApprovalResponse: (approved, reason, approvalId, options = {}) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) return false;
    const requestId = createMessageId();
    const decision = approved ? "approve" : "reject";
    set({
      approvalResponsesPending: [
        ...state.approvalResponsesPending.filter((entry) => entry.approvalId !== approvalId),
        { requestId, approvalId, decision },
      ],
      approvalResponseFailure: state.approvalResponseFailure?.approvalId === approvalId
        ? null
        : state.approvalResponseFailure,
    });
    if (approved) {
      outboundSend({
        type: "approve",
        requestId,
        approvalId,
        ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      });
    } else {
      outboundSend({
        type: "reject",
        requestId,
        reason: reason ?? "rejected by user",
        approvalId,
        ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      });
    }
    return true;
  },
});
