import type {
  EffectiveTurnAuthorityPolicyInput,
  EffectiveTurnAuthoritySnapshot,
} from "./runtime-session-orchestrator.types.js";

export function buildEffectiveTurnAuthorityPolicyInputs(input: {
  readonly executionMode: EffectiveTurnAuthoritySnapshot["executionMode"];
  readonly tenantId?: string;
  readonly requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"];
  readonly admittedAuthority: EffectiveTurnAuthoritySnapshot["admittedAuthority"];
  readonly routeReason: string;
  readonly parentAuthority?: EffectiveTurnAuthoritySnapshot;
}): readonly EffectiveTurnAuthorityPolicyInput[] {
  return [
    {
      source: "requested_authority",
      status: "applied",
      requestedAuthority: input.requestedAuthority,
      reason: `Operator requested ${input.requestedAuthority} authority.`,
    },
    {
      source: "session_policy",
      status: "applied",
      admittedAuthority: "unknown",
      reason: "No narrower session authority policy is configured for this turn.",
    },
    {
      source: "tenant_policy",
      status: input.tenantId ? "applied" : "unresolved",
      ...(input.tenantId ? { subjectId: input.tenantId } : {}),
      admittedAuthority: "unknown",
      reason: input.tenantId
        ? `Tenant ${input.tenantId} contributes the runtime tool surface policy.`
        : "Tenant policy input is unavailable for this turn.",
    },
    {
      source: "route_policy",
      status: "applied",
      admittedAuthority: input.admittedAuthority,
      reason: input.routeReason,
    },
    input.parentAuthority
      ? {
        source: "parent_authority",
        status: "applied",
        admittedAuthority: input.parentAuthority.admittedAuthority,
        reason: "Parent managed-agent authority contributes an upper bound for this turn.",
      }
      : {
        source: "parent_authority",
        status: "not_applicable",
        reason: "Operator turns have no parent managed-agent authority.",
      },
    {
      source: "plan_approval",
      status: input.executionMode === "plan" ? "applied" : "not_applicable",
      ...(input.executionMode === "plan" ? { admittedAuthority: "read_only" as const } : {}),
      reason: input.executionMode === "plan"
        ? "Plan mode applies the plan approval workflow read-only authority envelope."
        : "Execute-mode turns are not governed by plan-mode approval policy.",
    },
    {
      source: "goal_envelope",
      status: "not_applicable",
      reason: "Goal envelopes are introduced by Slice 6 and are not available to this Slice 5 admission.",
    },
    {
      source: "work_item_authority",
      status: "not_applicable",
      reason: "Work-item authority envelopes are introduced by Slice 7 and are not available to this Slice 5 admission.",
    },
  ];
}
