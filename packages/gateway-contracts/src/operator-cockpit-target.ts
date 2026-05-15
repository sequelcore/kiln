import { z } from "zod";
import {
  OPERATOR_SURFACE_KINDS,
} from "./operator-surface-capability.js";

export const OPERATOR_COCKPIT_ACTIONS = [
  "inspect",
  "replay",
  "focus_session",
  "filter_events",
  "open_resource",
  "cancel",
] as const;

export type OperatorCockpitAction = typeof OPERATOR_COCKPIT_ACTIONS[number];

export const OPERATOR_COCKPIT_READ_ONLY_ACTIONS = [
  "inspect",
  "replay",
  "focus_session",
  "filter_events",
  "open_resource",
] as const;

export type OperatorCockpitReadOnlyAction = typeof OPERATOR_COCKPIT_READ_ONLY_ACTIONS[number];

export const OperatorCockpitActionTargetSchema = z.object({
  instanceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  resourceUri: z.string().min(1).optional(),
  workItemId: z.string().min(1).optional(),
  managedInvocationId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
});

export type OperatorCockpitActionTarget = z.infer<typeof OperatorCockpitActionTargetSchema>;

export interface OperatorCockpitActionAdmissionInput {
  readonly action: OperatorCockpitAction;
  readonly target: OperatorCockpitActionTarget;
}

export interface OperatorCockpitReadOnlyActionIntentInput {
  readonly action: OperatorCockpitAction;
  readonly requestedAt: string;
  readonly target: OperatorCockpitActionTarget;
}

export interface OperatorCockpitReadOnlyActionIntent {
  readonly mode: "read-only";
  readonly action: OperatorCockpitReadOnlyAction;
  readonly requestedAt: string;
  readonly dispatch: "not-dispatched";
  readonly target: OperatorCockpitActionTarget;
}

export function operatorCockpitActionAllowed(
  input: OperatorCockpitActionAdmissionInput,
): boolean {
  if (!input.target.instanceId) return false;

  if (input.action === "inspect") return true;
  if (input.action === "filter_events") return true;
  if (input.action === "focus_session") return Boolean(input.target.sessionId);
  if (input.action === "replay") return Boolean(input.target.sessionId && input.target.eventId);
  if (input.action === "open_resource") return Boolean(input.target.resourceUri);
  if (input.action === "cancel") {
    return Boolean(
      input.target.sessionId
      && (input.target.workItemId || input.target.managedInvocationId),
    );
  }

  return false;
}

export function createOperatorCockpitReadOnlyActionIntent(
  input: OperatorCockpitReadOnlyActionIntentInput,
): OperatorCockpitReadOnlyActionIntent {
  if (!isOperatorCockpitReadOnlyAction(input.action)) {
    throw new Error(`Operator cockpit action ${input.action} is not available in read-only cockpit mode.`);
  }
  if (!operatorCockpitActionAllowed(input)) {
    throw new Error(`Operator cockpit read-only action ${input.action} requires an explicit target.`);
  }

  return {
    mode: "read-only",
    action: input.action,
    requestedAt: input.requestedAt,
    dispatch: "not-dispatched",
    target: OperatorCockpitActionTargetSchema.parse(input.target),
  };
}

function isOperatorCockpitReadOnlyAction(
  value: OperatorCockpitAction,
): value is OperatorCockpitReadOnlyAction {
  return OPERATOR_COCKPIT_READ_ONLY_ACTIONS.includes(value as OperatorCockpitReadOnlyAction);
}

export const OperatorCockpitCancellationRequestSchema = z.object({
  requestId: z.string().min(1),
  requestedAt: z.string().min(1),
  requestedBySurface: z.enum(OPERATOR_SURFACE_KINDS),
  target: OperatorCockpitActionTargetSchema.refine((target) => {
    return operatorCockpitActionAllowed({
      action: "cancel",
      target,
    });
  }, "Cancellation requires instanceId, sessionId, and workItemId or managedInvocationId."),
  reason: z.string().min(1).optional(),
});

export type OperatorCockpitCancellationRequest = z.infer<typeof OperatorCockpitCancellationRequestSchema>;

export function createOperatorCockpitCancellationRequest(
  input: OperatorCockpitCancellationRequest,
): OperatorCockpitCancellationRequest {
  return OperatorCockpitCancellationRequestSchema.parse(input);
}
