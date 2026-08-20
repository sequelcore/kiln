import type { OperatorAdoptionDecisionAuthority } from "../../events/operator-adoption-decision.js";

/** Runtime-only authority transport for goal.create. */
export const OPERATOR_ADOPTION_DECISION_TRANSPORT: unique symbol = Symbol(
  "kiln.operator-adoption-decision-transport",
);

export type OperatorAdoptionDecisionTransport = OperatorAdoptionDecisionAuthority;
