// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Selecting a route from (input, agentProfile); building route/profile-conflict
// recovery payloads.
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import { MANAGED_AGENT_INVOKE_TOOL_NAME } from "../tool-names.js";
import type {
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationToolInput,
  ManagedInvocationToolRoute,
} from "./types.js";
import { unique } from "./catalog-descriptions.js";
import { resolveManagedInvocationParentTurnId, sanitizeId } from "./input-parsing.js";
import { resolveManagedInvocationRouteProfile } from "./profile-resolution.js";

export function resolveRoute(
  routes: readonly ManagedInvocationToolRoute[],
  input: ManagedInvocationToolInput,
  agentProfile?: ManagedInvocationAgentCatalogEntry,
): {
  readonly status: "found";
  readonly route: ManagedInvocationToolRoute;
} | {
  readonly status: "missing";
} | {
  readonly status: "ambiguous";
  readonly reason: string;
} {
  const hintedRouteId = input.routeId ?? agentProfile?.routeId;
  const hintedModel = input.providerRoute.model
    ?? (agentProfile?.providerRoute?.providerId === input.providerRoute.providerId
      ? agentProfile.providerRoute.model
      : undefined);
  if (hintedRouteId) {
    const exactMatches = routes.filter((route) =>
      route.providerId === input.providerRoute.providerId
      && route.routeId === hintedRouteId
      && (!hintedModel || route.model === hintedModel)
      && resolveManagedInvocationRouteProfile(route, input.profile, agentProfile) !== undefined
    );
    if (exactMatches.length === 1) {
      return { status: "found", route: exactMatches[0]! };
    }
    if (exactMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: `Managed invocation route selection is ambiguous for route '${hintedRouteId}' and provider '${input.providerRoute.providerId}'. Matching routes: ${exactMatches.map((route) => route.routeId).join(", ")}.`,
      };
    }
  }
  const matches = routes.filter((route) =>
    route.providerId === input.providerRoute.providerId
    && (!hintedRouteId || route.routeId === hintedRouteId)
    && (!hintedModel || route.model === hintedModel)
    && resolveManagedInvocationRouteProfile(route, input.profile, agentProfile) !== undefined
  );
  if (matches.length === 1) {
    return { status: "found", route: matches[0]! };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      reason: `Managed invocation route selection is ambiguous for provider '${input.providerRoute.providerId}' and profile '${input.profile}'. Specify routeId. Matching routes: ${matches.map((route) => route.routeId).join(", ")}.`,
    };
  }
  return { status: "missing" };
}

export function validateAgentRouteHint(
  input: ManagedInvocationToolInput,
  agentProfile: ManagedInvocationAgentCatalogEntry | undefined,
  toolName = MANAGED_AGENT_INVOKE_TOOL_NAME,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (!agentProfile) {
    return { ok: true };
  }
  const label = input.agentProfile ?? agentProfile.name;
  if (agentProfile.admissionProfile !== input.profile) {
    return {
      ok: false,
      error: `${toolName} profile '${input.profile}' contradicts configured agentProfile '${label}' authority binding.`,
    };
  }
  if (agentProfile.routeId && input.routeId && agentProfile.routeId !== input.routeId) {
    return {
      ok: false,
      error: `${toolName} routeId '${input.routeId}' contradicts configured agentProfile '${label}' route hint '${agentProfile.routeId}'.`,
    };
  }
  const hintedProvider = agentProfile.providerRoute?.providerId;
  if (hintedProvider && hintedProvider !== input.providerRoute.providerId) {
    return {
      ok: false,
      error: `${toolName} provider '${input.providerRoute.providerId}' contradicts configured agentProfile '${label}' provider hint '${hintedProvider}'.`,
    };
  }
  const hintedModel = agentProfile.providerRoute?.model;
  if (hintedModel && input.providerRoute.model && hintedModel !== input.providerRoute.model) {
    return {
      ok: false,
      error: `${toolName} model '${input.providerRoute.model}' contradicts configured agentProfile '${label}' model hint '${hintedModel}'.`,
    };
  }
  return { ok: true };
}

export function buildRouteProfileConflictRecovery(
  input: ManagedInvocationToolInput,
  validation: { readonly ok: false; readonly error: string },
  context: RuntimeBuiltinToolExecutionContext,
  toolName: string,
): {
  readonly output: string;
  readonly metadata: Record<string, unknown>;
} {
  const forbiddenInputFields = unique([...(input.forbiddenInputFields ?? []), "agentProfile"]);
  const parentTurnId = resolveManagedInvocationParentTurnId(context);
  const invocationId = buildRouteProfileConflictInvocationId(context);
  const payload = {
    status: "route_profile_conflict",
    lifecycleState: "route_profile_conflict",
    error: validation.error,
    managedInvocationId: invocationId,
    invocationId,
    parentSessionId: context.session.id,
    parentTurnId,
    nextTool: toolName,
    retryInputTemplate: buildManagedInvocationRetryInputTemplate(input, forbiddenInputFields),
    forbiddenInputFields,
    correction: "Retry managed_agent.invoke with retryInputTemplate exactly; do not add agentProfile when a route-owned request forbids it.",
  };
  return {
    output: JSON.stringify(payload, null, 2),
    metadata: payload,
  };
}

function buildRouteProfileConflictInvocationId(context: RuntimeBuiltinToolExecutionContext): string {
  return `${sanitizeId(context.session.id)}:${sanitizeId(context.toolCall.id)}:route-profile-conflict`;
}

function buildManagedInvocationRetryInputTemplate(
  input: ManagedInvocationToolInput,
  forbiddenInputFields: readonly string[],
): Record<string, unknown> {
  return {
    profile: input.profile,
    ...(input.routeId ? { routeId: input.routeId } : {}),
    providerRoute: {
      providerId: input.providerRoute.providerId,
      ...(input.providerRoute.model ? { model: input.providerRoute.model } : {}),
      ...(input.providerRoute.deliberationIntent ? { deliberationIntent: input.providerRoute.deliberationIntent } : {}),
      ...(input.providerRoute.communicationIntent ? { communicationIntent: input.providerRoute.communicationIntent } : {}),
    },
    ...(input.requestedAuthority ? { requestedAuthority: input.requestedAuthority } : {}),
    task: input.task,
    summary: input.summary,
    ...(input.resourceUris ? { resourceUris: input.resourceUris } : {}),
    forbiddenInputFields,
    ...(input.skills ? { skills: input.skills } : {}),
    contextMode: input.contextMode,
    ...(input.goalRunId ? { goalRunId: input.goalRunId } : {}),
    ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.roleIntent ? { roleIntent: input.roleIntent } : {}),
    ...(input.expectedEvidence ? { expectedEvidence: input.expectedEvidence } : {}),
    ...(input.requiredToolNames ? { requiredToolNames: input.requiredToolNames } : {}),
    ...(input.requiredResultFields ? { requiredResultFields: input.requiredResultFields } : {}),
    ...(input.doneCriteria ? { doneCriteria: input.doneCriteria } : {}),
    ...(input.residualRiskRequired !== undefined ? { residualRiskRequired: input.residualRiskRequired } : {}),
    ...(input.executionPhase ? { executionPhase: input.executionPhase } : {}),
  };
}
