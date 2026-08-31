// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Parsing, dependency ordering, route resolution for managed_agent.orchestrate
// work items, plus its executor.
import {
  buildManagedAgentBackgroundJobOrchestrationRequest,
  buildManagedAgentDecompositionOrchestrationRequest,
  buildManagedAgentReviewSwarmOrchestrationRequest,
  decideManagedAgentCoordination,
} from "@kilnai/core";
import type {
  ManagedAgentAccess,
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentRequestedAuthority,
  ManagedAgentWorkingDirectory,
} from "@kilnai/core";
import type { PresentationIntent } from "@kilnai/gateway-contracts";
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import { resolveManagedInvocationAgentProfile } from "../agent-profile-catalog.js";
import { resolveManagedInvocationCallerIdentity } from "../caller-capability-policy.js";
import { runManagedAgentOrchestrationLifecycle } from "../orchestration-lifecycle.js";
import { MANAGED_AGENT_ORCHESTRATE_TOOL_NAME } from "../tool-names.js";
import type {
  ManagedInvocationToolOptions,
  ManagedInvocationToolOptionsWithService,
  ManagedInvocationToolResult,
  ManagedInvocationToolRoute,
} from "./types.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../../session/effective-authority-admission-bundle.js";
import { unique } from "./catalog-descriptions.js";
import { MANAGED_AGENT_ORCHESTRATION_ACCESS } from "./tool-schema.js";
import { errorResult, readText } from "./input-parsing.js";
import { requireManagedInvocationSessionContext } from "./lifecycle-tool-executors.js";
import { resolveManagedInvocationRouteProfile } from "./profile-resolution.js";
import {
  appendAndPublishManagedInvocationStartSessionEvents,
  appendAndPublishManagedInvocationTerminalSessionEvent,
} from "./session-event-publishing.js";

interface ManagedOrchestrationWorkItemInput {
  readonly id: string;
  readonly roleIntent: string;
  readonly task: string;
  readonly agentProfile?: string;
  readonly routeId?: string;
  readonly dependencies: readonly string[];
}

interface ResolvedManagedOrchestrationWorkItem extends ManagedOrchestrationWorkItemInput {
  readonly routeId: string;
}

export async function executeManagedAgentOrchestrationTool(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  callerIdentity: ManagedAgentCallerAttachmentIdentity,
  options: ManagedInvocationToolOptionsWithService,
  authorityAdmission?: EffectiveAuthorityAdmissionBundle,
): Promise<ManagedInvocationToolResult> {
  const session = requireManagedInvocationSessionContext(context, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  if (!session.ok) return session.result;
  const callerResolution = resolveManagedInvocationCallerIdentity(
    callerIdentity,
    session.context.effectiveTurnAuthority,
  );
  if (!callerResolution.ok) {
    return errorResult(callerResolution.reason, {
      errorCode: "managed_parent_authority_unavailable",
      status: "denied",
    }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const effectiveCallerIdentity = callerResolution.callerIdentity;
  const access = readText(rawInput.access) as ManagedAgentAccess | undefined;
  if (!access || !MANAGED_AGENT_ORCHESTRATION_ACCESS.includes(access)) {
    return errorResult("managed_agent.orchestrate requires a supported access.", {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const taskRisk = readText(rawInput.taskRisk);
  if (taskRisk !== "low" && taskRisk !== "medium" && taskRisk !== "high" && taskRisk !== "unknown") {
    return errorResult("managed_agent.orchestrate requires taskRisk.", {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const parsedWorkItems = readManagedOrchestrationWorkItems(rawInput.workItems);
  if (!parsedWorkItems.ok) {
    return errorResult(parsedWorkItems.message, {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const orderedWorkItems = orderManagedOrchestrationWorkItems(parsedWorkItems.workItems);
  if (!orderedWorkItems.ok) {
    return errorResult(orderedWorkItems.message, {}, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const requestedAgents = orderedWorkItems.workItems
    .map((item) => resolveManagedInvocationAgentProfile(options, item.agentProfile));
  const includesAdHocWork = orderedWorkItems.workItems.some((item) => !item.agentProfile);
  const availableRoutes = eligibleManagedOrchestrationRoutes(
    options,
    access,
    requestedAgents.filter((agent): agent is NonNullable<typeof agent> => agent !== undefined),
    includesAdHocWork,
  );
  const maxParallelWorkers = Math.max(1, options.maxParallelChildren ?? 1);
  const decision = decideManagedAgentCoordination({
    governanceRecommendation: "orchestrate",
    workItemCount: orderedWorkItems.workItems.length,
    dependencyCount: orderedWorkItems.workItems.reduce((count, item) => count + item.dependencies.length, 0),
    requiresIndependentReview: rawInput.requiresIndependentReview === true,
    taskRisk,
    managedRouteCount: availableRoutes.length,
    maxParallelWorkers,
    routeHealth: availableRoutes.length > 0 ? "available" : "unavailable",
    workspace: availableRoutes.length > 0 ? "available" : "unavailable",
  });
  if (decision.status === "denied") {
    return errorResult(decision.reasons.join("; "), {
      operation: "managed_orchestration_denied",
      coordinationDecision: decision,
    }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  if (decision.topology === "direct" || !decision.orchestrationMode) {
    return errorResult("managed_agent.orchestrate cannot execute a direct topology.", {
      operation: "managed_orchestration_direct",
      coordinationDecision: decision,
    }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const resolvedWorkItems = resolveManagedOrchestrationWorkItems(orderedWorkItems.workItems, access, options);
  if (!resolvedWorkItems.ok) {
    return errorResult(resolvedWorkItems.message, { operation: "managed_orchestration_denied" }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
  const routesById = new Map(options.routes.map((route) => [route.routeId, route]));
  const workingDirectoryModes = unique(resolvedWorkItems.workItems.map((item) => {
    const route = routesById.get(item.routeId)!;
    const agent = resolveManagedInvocationAgentProfile(options, item.agentProfile);
    return resolveManagedInvocationRouteProfile(route, access, agent)!.workingDirectory.mode;
  }));
  if (workingDirectoryModes.length !== 1) {
    return errorResult(
      "managed_agent.orchestrate team members must currently share one governed working-directory mode.",
      { operation: "managed_orchestration_denied" },
      MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
    );
  }
  const workingDirectoryMode = workingDirectoryModes[0] as ManagedAgentWorkingDirectory["mode"];
  const orchestrationId = `managed-orchestration:${session.context.session.id}:${session.context.toolCall.id}`;
  const base = {
    orchestrationId,
    parentSessionId: session.context.session.id,
    parentTurnId: session.context.turnId ?? session.context.toolCall.id,
    requestedBy: options.requestedBy ?? "runtime",
    requestSource: options.requestSource ?? MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
    task: resolvedWorkItems.workItems.map((item) => item.task).join("\n"),
    workingDirectoryMode,
  };
  const childPlans = resolvedWorkItems.workItems.map((item) => ({
    key: item.id,
    roleIntent: item.roleIntent,
    task: item.task,
    ...(item.agentProfile ? { agentProfile: item.agentProfile } : {}),
    routeId: item.routeId,
    dependsOn: item.dependencies,
  }));
  const orchestrationRequest = decision.orchestrationMode === "background-job"
    ? buildManagedAgentBackgroundJobOrchestrationRequest({
      ...base,
      key: resolvedWorkItems.workItems[0]!.id,
      roleIntent: resolvedWorkItems.workItems[0]!.roleIntent,
      task: resolvedWorkItems.workItems[0]!.task,
      ...(resolvedWorkItems.workItems[0]!.agentProfile
        ? { agentProfile: resolvedWorkItems.workItems[0]!.agentProfile }
        : {}),
      routeId: resolvedWorkItems.workItems[0]!.routeId,
    })
    : decision.orchestrationMode === "review-swarm"
      ? buildManagedAgentReviewSwarmOrchestrationRequest({
        ...base,
        childPlans,
        maxConcurrentChildren: decision.maxConcurrentChildren,
      })
      : buildManagedAgentDecompositionOrchestrationRequest({
        ...base,
        childPlans,
        maxConcurrentChildren: decision.maxConcurrentChildren,
      });
  try {
    const result = await runManagedAgentOrchestrationLifecycle({
      orchestrationRequest,
      managedInvocation: options,
      access,
      requestedAuthority: managedOrchestrationRequestedAuthority(access),
      callerIdentity: effectiveCallerIdentity,
      economicAdoptedDecisionAt: session.context.session.createdAt.toISOString(),
      ...(authorityAdmission
        ? { authorityAdmission }
        : {}),
      ...(session.context.abortSignal ? { abortSignal: session.context.abortSignal } : {}),
      lifecycleObserver: {
        onAdmissionResolved: async ({ request, decision: admissionDecision }) => {
          await appendAndPublishManagedInvocationStartSessionEvents({
            options,
            context: session.context,
            request,
            decision: admissionDecision,
          });
        },
        onTerminal: async ({ request, record, durationMs }) => {
          await appendAndPublishManagedInvocationTerminalSessionEvent({
            options,
            context: session.context,
            request,
            record,
            ...(durationMs !== undefined ? { durationMs } : {}),
          });
        },
      },
    });
    return {
      output: JSON.stringify({
        status: result.orchestrationResult.status,
        coordinationDecision: decision,
        orchestrationResult: result.orchestrationResult,
      }, null, 2),
      isError: result.orchestrationResult.status === "failed",
      metadata: {
        toolName: MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
        operation: "managed_orchestration_completed",
        orchestrationId,
        coordinationDecision: decision,
        presentationIntent: {
          kind: "timeline",
          title: "Managed orchestration",
          summary: `${decision.topology} · ${result.orchestrationResult.status}`,
          source: MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
          confidence: "high",
          items: result.orchestrationResult.childResults.map((child, index) => ({
            id: child.childId,
            order: child.ordinal,
            label: resolvedWorkItems.workItems[index]?.roleIntent ?? child.childId,
            status: child.success ? "success" : "error",
            summary: child.success
              ? resolvedWorkItems.workItems[index]?.task
              : child.error ?? resolvedWorkItems.workItems[index]?.task,
          })),
        } satisfies PresentationIntent,
      },
    };
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error), {
      operation: "managed_orchestration_failed",
      orchestrationId,
      coordinationDecision: decision,
    }, MANAGED_AGENT_ORCHESTRATE_TOOL_NAME);
  }
}

function managedOrchestrationRequestedAuthority(
  access: ManagedAgentAccess,
): ManagedAgentRequestedAuthority {
  return access === "read-only" ? "read_only" : "audited";
}

function readManagedOrchestrationWorkItems(value: unknown):
  | { readonly ok: true; readonly workItems: readonly ManagedOrchestrationWorkItemInput[] }
  | { readonly ok: false; readonly message: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: "managed_agent.orchestrate requires at least one work item." };
  }
  const workItems: ManagedOrchestrationWorkItemInput[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, message: "managed_agent.orchestrate work items must be objects." };
    }
    const record = candidate as Record<string, unknown>;
    const id = readText(record.id);
    const roleIntent = readText(record.roleIntent);
    const task = readText(record.task);
    const agentProfile = readText(record.agentProfile);
    const routeId = readText(record.routeId);
    if (!id || !roleIntent || !task || ids.has(id)) {
      return { ok: false, message: "managed_agent.orchestrate work items require unique ids, roleIntent, and task." };
    }
    ids.add(id);
    const dependencies = Array.isArray(record.dependencies)
      ? record.dependencies.map(readText).filter((dependency): dependency is string => dependency !== undefined)
      : [];
    if (dependencies.length !== (Array.isArray(record.dependencies) ? record.dependencies.length : 0)) {
      return { ok: false, message: `managed_agent.orchestrate work item '${id}' has invalid dependencies.` };
    }
    workItems.push({
      id,
      roleIntent,
      task,
      ...(agentProfile ? { agentProfile } : {}),
      ...(routeId ? { routeId } : {}),
      dependencies: unique(dependencies),
    });
  }
  const unknownDependency = workItems.flatMap((item) => item.dependencies).find((id) => !ids.has(id));
  if (unknownDependency) {
    return { ok: false, message: `managed_agent.orchestrate dependency '${unknownDependency}' does not reference a work item.` };
  }
  return { ok: true, workItems };
}

function resolveManagedOrchestrationWorkItems(
  workItems: readonly ManagedOrchestrationWorkItemInput[],
  access: ManagedAgentAccess,
  options: ManagedInvocationToolOptions,
):
  | { readonly ok: true; readonly workItems: readonly ResolvedManagedOrchestrationWorkItem[] }
  | { readonly ok: false; readonly message: string } {
  const eligibleById = new Map(options.routes
    .filter((route) => route.profiles.some((candidate) =>
      candidate.access === access && isEligibleManagedOrchestrationProfile(candidate, route, options)
    ))
    .map((route) => [route.routeId, route]));
  const resolved: ResolvedManagedOrchestrationWorkItem[] = [];
  for (const item of workItems) {
    const agent = resolveManagedInvocationAgentProfile(options, item.agentProfile);
    if (item.agentProfile && !agent) {
      return { ok: false, message: `managed_agent.orchestrate work item '${item.id}' references unknown agentProfile '${item.agentProfile}'.` };
    }
    if (item.routeId && agent?.routeId && item.routeId !== agent.routeId) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' routeId '${item.routeId}' contradicts agentProfile '${agent.name}' route hint '${agent.routeId}'.`,
      };
    }
    if (agent && agent.access !== access) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' agentProfile '${agent.name}' requires admission access '${agent.access}', not '${access}'.`,
      };
    }
    const itemEligibleRoutes = options.routes.filter((route) => {
      const routeProfile = resolveManagedInvocationRouteProfile(route, access, agent);
      return routeProfile !== undefined && isEligibleManagedOrchestrationProfile(routeProfile, route, options);
    });
    const routeId = item.routeId
      ?? agent?.routeId
      ?? (itemEligibleRoutes.length === 1 ? itemEligibleRoutes[0]!.routeId : undefined);
    if (!routeId) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' requires an admitted agentProfile or explicit routeId because route selection is ambiguous.`,
      };
    }
    const route = eligibleById.get(routeId);
    if (!route || !resolveManagedInvocationRouteProfile(route, access, agent)) {
      return {
        ok: false,
        message: `managed_agent.orchestrate work item '${item.id}' route '${routeId}' does not expose the requested governed access.`,
      };
    }
    resolved.push({
      ...item,
      ...(agent ? { agentProfile: agent.name } : {}),
      routeId,
    });
  }
  return { ok: true, workItems: resolved };
}

function eligibleManagedOrchestrationRoutes(
  options: ManagedInvocationToolOptions,
  access: ManagedAgentAccess,
  agents: readonly NonNullable<ManagedInvocationToolOptions["agentCatalog"]>[number][] = [],
  includeAdHoc = true,
): readonly ManagedInvocationToolRoute[] {
  return options.routes.filter((route) => {
    const routeProfile = agents
      .map((agent) => resolveManagedInvocationRouteProfile(route, access, agent))
      .find((candidate) => candidate !== undefined)
      ?? (includeAdHoc ? resolveManagedInvocationRouteProfile(route, access) : undefined);
    return routeProfile !== undefined && isEligibleManagedOrchestrationProfile(routeProfile, route, options);
  });
}

function isEligibleManagedOrchestrationProfile(
  routeProfile: ManagedInvocationToolRoute["profiles"][number],
  route: ManagedInvocationToolRoute,
  options: ManagedInvocationToolOptions,
): boolean {
  return routeProfile.workingDirectory.mode !== "workspace-write"
    && (routeProfile.workingDirectory.mode !== "isolated-worktree" || routeProfile.workingDirectoryLease !== undefined)
    && (route.createAdapter !== undefined
      || (options.economicDispatch !== undefined && route.economicCapability?.status === "verified"));
}

function orderManagedOrchestrationWorkItems(workItems: readonly ManagedOrchestrationWorkItemInput[]):
  | { readonly ok: true; readonly workItems: readonly ManagedOrchestrationWorkItemInput[] }
  | { readonly ok: false; readonly message: string } {
  const remaining = new Map(workItems.map((item) => [item.id, item]));
  const completed = new Set<string>();
  const ordered: ManagedOrchestrationWorkItemInput[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((item) => item.dependencies.every((id) => completed.has(id)));
    if (ready.length === 0) {
      return { ok: false, message: "managed_agent.orchestrate work item dependencies contain a cycle." };
    }
    for (const item of ready) {
      ordered.push(item);
      completed.add(item.id);
      remaining.delete(item.id);
    }
  }
  return { ok: true, workItems: ordered };
}
