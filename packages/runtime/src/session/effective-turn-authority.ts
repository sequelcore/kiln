import type {
  AuthorityDescriptor,
  Capability,
} from "@kilnai/core";
import type {
  EffectiveTurnAuthorityAdmissionContext,
  EffectiveTurnAuthorityLevel,
  EffectiveTurnAuthorityPolicyBound,
  EffectiveTurnAuthorityPolicyInput,
  EffectiveTurnAuthorityPolicyMaximum,
  EffectiveTurnAuthoritySnapshot,
  GoalAuthorityEnvelopePolicyBound,
  PerCallToolConfig,
  WorkItemAuthorityPolicyBound,
} from "./runtime-session-orchestrator.types.js";

export type {
  EffectiveTurnAuthorityAdmissionContext,
  EffectiveTurnAuthorityPolicyBound,
  EffectiveTurnAuthorityPolicyMaximum,
  GoalAuthorityEnvelopePolicyBound,
  WorkItemAuthorityPolicyBound,
} from "./runtime-session-orchestrator.types.js";

export interface ProjectEffectiveTurnAuthorityInput {
  readonly config?: PerCallToolConfig;
  readonly executionMode: EffectiveTurnAuthoritySnapshot["executionMode"];
  readonly requestedAuthority?: EffectiveTurnAuthoritySnapshot["requestedAuthority"];
  readonly reason: string;
  readonly sourcePolicy?: EffectiveTurnAuthoritySnapshot["sourcePolicy"];
  readonly sandboxProjection?: EffectiveTurnAuthoritySnapshot["sandboxProjection"];
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
  readonly authorityDescriptorFromCapability?: (
    toolName: string,
    capability: Capability | undefined,
  ) => AuthorityDescriptor | undefined;
}

export function projectEffectiveTurnAuthorityPerCallConfig(
  input: ProjectEffectiveTurnAuthorityInput,
): PerCallToolConfig | undefined {
  const requestedAuthority = input.executionMode === "plan"
    ? "planning"
    : input.requestedAuthority;
  if (!requestedAuthority) {
    return input.config;
  }

  const authorityContext = input.authorityContext ?? input.config?.authorityContext;
  const candidateNames = candidateToolNames(input.config);
  const maximumAuthority = resolveMaximumAuthority({
    executionMode: input.executionMode,
    requestedAuthority,
    authorityContext,
  });
  if (maximumAuthority === "fail_closed") {
    return {
      ...input.config,
      ...(authorityContext ? { authorityContext } : {}),
      toolAllowlist: new Set<string>(),
      toolAuthority: new Map<string, AuthorityDescriptor>(),
      additionalTools: [],
      perCallCapabilities: new Map<string, Capability>(),
      effectiveTurnAuthority: buildSnapshot({
        input,
        authorityContext,
        requestedAuthority,
        admittedAuthority: "fail_closed",
        toolCount: 0,
        deniedToolCount: candidateNames.size,
      }),
    };
  }

  const targetMaximum = requestedAuthority === "auto"
    ? maximumAuthority
    : minAuthority(maximumAuthority, requestedAuthorityMaximum(requestedAuthority));
  const admittedToolNames = filterToolNames({
    config: input.config,
    candidateNames,
    maximumAuthority: targetMaximum,
    authorityDescriptorFromCapability: input.authorityDescriptorFromCapability,
  });
  const admittedToolAuthority = filterAuthorityMap(
    input.config?.toolAuthority,
    admittedToolNames,
    input.config?.perCallCapabilities,
    input.authorityDescriptorFromCapability,
  );
  const admittedAuthority = admittedAuthorityFor({
    requestedAuthority,
    maximumAuthority: targetMaximum,
    admittedToolNames,
    toolAuthority: admittedToolAuthority,
  });

  return {
    ...input.config,
    ...(authorityContext ? { authorityContext } : {}),
    toolAllowlist: admittedToolNames,
    toolAuthority: admittedToolAuthority,
    additionalTools: (input.config?.additionalTools ?? []).filter((tool) => admittedToolNames.has(tool.name)),
    perCallCapabilities: filterCapabilityMap(input.config?.perCallCapabilities, admittedToolNames),
    effectiveTurnAuthority: buildSnapshot({
      input,
      authorityContext,
      requestedAuthority,
      admittedAuthority,
      toolCount: admittedToolNames.size,
      deniedToolCount: Math.max(0, candidateNames.size - admittedToolNames.size),
    }),
  };
}

export function buildEffectiveTurnAuthorityPolicyInputs(input: {
  readonly executionMode: EffectiveTurnAuthoritySnapshot["executionMode"];
  readonly tenantId?: string;
  readonly requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"];
  readonly admittedAuthority: EffectiveTurnAuthoritySnapshot["admittedAuthority"];
  readonly routeReason: string;
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
}): readonly EffectiveTurnAuthorityPolicyInput[] {
  return [
    {
      source: "requested_authority",
      status: "applied",
      requestedAuthority: input.requestedAuthority,
      reason: `Operator requested ${input.requestedAuthority} authority.`,
    },
    policyInput("session_policy", input.authorityContext?.sessionPolicy, {
      reason: "No narrower session authority policy is configured for this turn.",
    }),
    policyInput("tenant_policy", input.authorityContext?.tenantPolicy, {
      subjectId: input.tenantId,
      reason: input.tenantId
        ? `Tenant ${input.tenantId} has no narrower authority policy configured for this turn.`
        : "Tenant policy input is unavailable for this turn.",
      unresolved: !input.tenantId,
    }),
    policyInput("route_policy", input.authorityContext?.routePolicy, {
      admittedAuthority: input.admittedAuthority,
      reason: input.routeReason,
    }),
    input.authorityContext?.parentAuthority
      ? {
        source: "parent_authority",
        status: "applied",
        admittedAuthority: input.authorityContext.parentAuthority.admittedAuthority,
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
    goalEnvelopePolicyInput(input.requestedAuthority, input.authorityContext?.goalEnvelope),
    workItemAuthorityPolicyInput(input.requestedAuthority, input.authorityContext?.workItemAuthority),
  ];
}

function buildSnapshot(input: {
  readonly input: ProjectEffectiveTurnAuthorityInput;
  readonly authorityContext?: EffectiveTurnAuthorityAdmissionContext;
  readonly requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"];
  readonly admittedAuthority: EffectiveTurnAuthorityLevel;
  readonly toolCount: number;
  readonly deniedToolCount: number;
}): EffectiveTurnAuthoritySnapshot {
  return {
    executionMode: input.input.executionMode,
    requestedAuthority: input.requestedAuthority,
    admittedAuthority: input.admittedAuthority,
    sourcePolicy: input.input.sourcePolicy ?? "runtime_surface_projection",
    reason: input.input.reason,
    completeness: "authoritative",
    toolCount: input.toolCount,
    deniedToolCount: input.deniedToolCount,
    ...(input.input.sandboxProjection ? { sandboxProjection: input.input.sandboxProjection } : {}),
    policyInputs: buildEffectiveTurnAuthorityPolicyInputs({
      executionMode: input.input.executionMode,
      tenantId: input.input.config?.tenantId,
      requestedAuthority: input.requestedAuthority,
      admittedAuthority: input.admittedAuthority,
      routeReason: input.input.reason,
      authorityContext: input.authorityContext,
    }),
  };
}

function resolveMaximumAuthority(input: {
  readonly executionMode: EffectiveTurnAuthoritySnapshot["executionMode"];
  readonly requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"];
  readonly authorityContext: EffectiveTurnAuthorityAdmissionContext | undefined;
}): EffectiveTurnAuthorityPolicyMaximum | "fail_closed" {
  if (input.executionMode === "plan" || input.requestedAuthority === "planning") {
    return "read_only";
  }
  const bounds: EffectiveTurnAuthorityPolicyMaximum[] = ["destructive"];
  const context = input.authorityContext;
  if (context?.sessionPolicy) bounds.push(context.sessionPolicy.maximumAuthority);
  if (context?.tenantPolicy) bounds.push(context.tenantPolicy.maximumAuthority);
  if (context?.routePolicy) bounds.push(context.routePolicy.maximumAuthority);
  if (context?.parentAuthority && context.parentAuthority.admittedAuthority !== "unknown") {
    bounds.push(maximumFromAdmittedAuthority(context.parentAuthority.admittedAuthority));
  }
  if (context?.goalEnvelope) bounds.push(context.goalEnvelope.maximumAuthority);
  if (context?.workItemAuthority) bounds.push(context.workItemAuthority.maximumAuthority);

  if (input.requestedAuthority === "destructive" && (!context?.goalEnvelope || !context.workItemAuthority)) {
    return "fail_closed";
  }
  return bounds.reduce((left, right) => minAuthority(left, right));
}

function policyInput(
  source: "session_policy" | "tenant_policy" | "route_policy",
  bound: EffectiveTurnAuthorityPolicyBound | undefined,
  fallback: {
    readonly reason: string;
    readonly subjectId?: string;
    readonly admittedAuthority?: EffectiveTurnAuthorityLevel;
    readonly unresolved?: boolean;
  },
): EffectiveTurnAuthorityPolicyInput {
  if (bound) {
    return {
      source,
      status: "applied",
      ...(bound.subjectId ?? fallback.subjectId ? { subjectId: bound.subjectId ?? fallback.subjectId } : {}),
      admittedAuthority: bound.maximumAuthority,
      reason: bound.reason,
    };
  }
  return {
    source,
    status: fallback.unresolved ? "unresolved" : "not_applicable",
    ...(fallback.subjectId ? { subjectId: fallback.subjectId } : {}),
    ...(fallback.admittedAuthority ? { admittedAuthority: fallback.admittedAuthority } : {}),
    reason: fallback.reason,
  };
}

function goalEnvelopePolicyInput(
  requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"],
  bound: GoalAuthorityEnvelopePolicyBound | undefined,
): EffectiveTurnAuthorityPolicyInput {
  if (bound) {
    return {
      source: "goal_envelope",
      status: "applied",
      subjectId: bound.goalRunId,
      admittedAuthority: bound.maximumAuthority,
      reason: bound.reason,
    };
  }
  return {
    source: "goal_envelope",
    status: requestedAuthority === "destructive" ? "unresolved" : "not_applicable",
    reason: requestedAuthority === "destructive"
      ? "Destructive operator authority requires a bound goal authority envelope."
      : "No goal authority envelope is bound to this turn.",
  };
}

function workItemAuthorityPolicyInput(
  requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"],
  bound: WorkItemAuthorityPolicyBound | undefined,
): EffectiveTurnAuthorityPolicyInput {
  if (bound) {
    return {
      source: "work_item_authority",
      status: "applied",
      subjectId: bound.workItemId,
      admittedAuthority: bound.maximumAuthority,
      reason: bound.reason,
    };
  }
  return {
    source: "work_item_authority",
    status: requestedAuthority === "destructive" ? "unresolved" : "not_applicable",
    reason: requestedAuthority === "destructive"
      ? "Destructive operator authority requires a bound materialized work-item authority envelope."
      : "No work-item authority envelope is bound to this turn.",
  };
}

function candidateToolNames(config: PerCallToolConfig | undefined): Set<string> {
  return config?.toolAllowlist
    ? new Set(config.toolAllowlist)
    : new Set((config?.additionalTools ?? []).map((tool) => tool.name));
}

function filterToolNames(input: {
  readonly config: PerCallToolConfig | undefined;
  readonly candidateNames: ReadonlySet<string>;
  readonly maximumAuthority: EffectiveTurnAuthorityPolicyMaximum;
  readonly authorityDescriptorFromCapability?: (
    toolName: string,
    capability: Capability | undefined,
  ) => AuthorityDescriptor | undefined;
}): Set<string> {
  const admitted = new Set<string>();
  for (const toolName of input.candidateNames) {
    const capability = input.config?.perCallCapabilities?.get(toolName);
    const authority = resolveAuthorityDescriptor({
      toolName,
      capability,
      toolAuthority: input.config?.toolAuthority,
      authorityDescriptorFromCapability: input.authorityDescriptorFromCapability,
    });
    if (!authority) {
      continue;
    }
    const approvalGated = isApprovalGatedCapability(capability);
    if ((!authority.allowed || authority.requiresApproval) && !approvalGated) {
      continue;
    }
    if (authority.level <= maximumLevel(input.maximumAuthority)) {
      admitted.add(toolName);
    }
  }
  return admitted;
}

function isApprovalGatedCapability(capability: Capability | undefined): boolean {
  return capability?.tags?.includes("operator-approval") === true;
}

function admittedAuthorityFor(input: {
  readonly requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"];
  readonly maximumAuthority: EffectiveTurnAuthorityPolicyMaximum;
  readonly admittedToolNames: ReadonlySet<string>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor> | undefined;
}): EffectiveTurnAuthorityLevel {
  if (input.admittedToolNames.size === 0) {
    return "fail_closed";
  }
  if (input.requestedAuthority !== "auto") {
    return input.maximumAuthority;
  }
  return minAuthority(input.maximumAuthority, rollupAdmittedAuthority(input.admittedToolNames, input.toolAuthority));
}

function requestedAuthorityMaximum(
  requestedAuthority: EffectiveTurnAuthoritySnapshot["requestedAuthority"],
): EffectiveTurnAuthorityPolicyMaximum {
  if (requestedAuthority === "planning" || requestedAuthority === "read_only") {
    return "read_only";
  }
  if (requestedAuthority === "audited") {
    return "audited";
  }
  return "destructive";
}

function maximumFromAdmittedAuthority(authority: EffectiveTurnAuthorityLevel): EffectiveTurnAuthorityPolicyMaximum {
  if (authority === "read_only" || authority === "fail_closed") {
    return "read_only";
  }
  if (authority === "idempotent" || authority === "audited") {
    return "audited";
  }
  return "destructive";
}

function minAuthority(
  left: EffectiveTurnAuthorityPolicyMaximum,
  right: EffectiveTurnAuthorityPolicyMaximum,
): EffectiveTurnAuthorityPolicyMaximum {
  return maximumLevel(left) <= maximumLevel(right) ? left : right;
}

function maximumLevel(authority: EffectiveTurnAuthorityPolicyMaximum): number {
  if (authority === "read_only") return 1;
  if (authority === "audited") return 2;
  return 4;
}

function rollupAdmittedAuthority(
  toolAllowlist: ReadonlySet<string>,
  toolAuthority: ReadonlyMap<string, AuthorityDescriptor> | undefined,
): EffectiveTurnAuthorityPolicyMaximum {
  let sawDestructive = false;
  let sawAudited = false;
  for (const toolName of toolAllowlist) {
    const descriptor = toolAuthority?.get(toolName);
    if (!descriptor) {
      sawAudited = true;
      continue;
    }
    if (descriptor.level >= 4) {
      sawDestructive = true;
      continue;
    }
    if (descriptor.level >= 2) {
      sawAudited = true;
    }
  }
  if (sawDestructive) return "destructive";
  if (sawAudited) return "audited";
  return "read_only";
}

function filterCapabilityMap(
  capabilities: ReadonlyMap<string, Capability> | undefined,
  allowlist: ReadonlySet<string>,
): ReadonlyMap<string, Capability> | undefined {
  if (!capabilities) {
    return undefined;
  }
  const filtered = new Map<string, Capability>();
  for (const [name, capability] of capabilities.entries()) {
    if (allowlist.has(name)) {
      filtered.set(name, capability);
    }
  }
  return filtered;
}

function filterAuthorityMap(
  authority: ReadonlyMap<string, AuthorityDescriptor> | undefined,
  allowlist: ReadonlySet<string>,
  capabilities: ReadonlyMap<string, Capability> | undefined,
  authorityDescriptorFromCapability: (
    toolName: string,
    capability: Capability | undefined,
  ) => AuthorityDescriptor | undefined = () => undefined,
): ReadonlyMap<string, AuthorityDescriptor> | undefined {
  if (!authority && !capabilities) {
    return undefined;
  }
  const filtered = new Map<string, AuthorityDescriptor>();
  for (const name of allowlist) {
    const descriptor = resolveAuthorityDescriptor({
      toolName: name,
      capability: capabilities?.get(name),
      toolAuthority: authority,
      authorityDescriptorFromCapability,
    });
    if (descriptor) {
      filtered.set(name, descriptor);
    }
  }
  return filtered;
}

function resolveAuthorityDescriptor(input: {
  readonly toolName: string;
  readonly capability: Capability | undefined;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor> | undefined;
  readonly authorityDescriptorFromCapability?: (
    toolName: string,
    capability: Capability | undefined,
  ) => AuthorityDescriptor | undefined;
}): AuthorityDescriptor | undefined {
  return input.toolAuthority?.get(input.toolName)
    ?? input.authorityDescriptorFromCapability?.(input.toolName, input.capability);
}
