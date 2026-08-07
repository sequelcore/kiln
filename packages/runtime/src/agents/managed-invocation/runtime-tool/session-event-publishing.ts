// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Appending/publishing CanonicalSessionEvents, plus the tool-call metadata
// resolver sharing that parse->route pipeline.
import type {
  CanonicalSessionEvent,
  ManagedAgentAdmissionDecision,
  ManagedAgentCredentialRoute,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import { resolveManagedInvocationAgentProfile } from "../agent-profile-catalog.js";
import {
  appendManagedInvocationStartSessionEvents,
  appendManagedInvocationTerminalSessionEvent,
} from "../session-events.js";
import { projectManagedInvocationRecordResources } from "../resource-projection.js";
import type {
  ManagedInvocationSessionEventSink,
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
  ManagedInvocationToolRoute,
} from "./types.js";
import { unique } from "./catalog-descriptions.js";
import { validateAgentRouteHint, resolveRoute } from "./route-resolution.js";
import { canonicalizeManagedInvocationRawInput } from "./request-preparation.js";
import {
  buildHandoffContract,
  parseInput,
  resolveManagedInvocationRequestedAuthority,
} from "./input-parsing.js";

export async function publishManagedInvocationSessionEvents(
  options: ManagedInvocationToolOptions,
  context: RuntimeBuiltinToolExecutionContext,
  events: readonly CanonicalSessionEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  await options.sessionEventSink?.publish(events, context);
}

export async function appendAndPublishManagedInvocationStartSessionEvents(input: {
  readonly options: ManagedInvocationToolOptions;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: ManagedAgentAdmissionDecision;
}): Promise<readonly CanonicalSessionEvent[]> {
  const events = appendManagedInvocationStartSessionEvents({
    session: input.context.session,
    request: input.request,
    decision: input.decision,
  });
  await publishManagedInvocationSessionEvents(input.options, input.context, events);
  return events;
}

export async function appendAndPublishManagedInvocationTerminalSessionEvent(input: {
  readonly options: ManagedInvocationToolOptions;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly request: ManagedAgentInvocationRequest;
  readonly record: ManagedAgentInvocationRecord;
  readonly durationMs?: number;
}): Promise<readonly CanonicalSessionEvent[]> {
  const record = projectManagedInvocationRecordResources(input.record, { artifactStore: input.options.artifactStore });
  const events = appendManagedInvocationTerminalSessionEvent({
    session: input.context.session,
    request: input.request,
    record,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  });
  await publishManagedInvocationSessionEvents(input.options, input.context, events);
  return events;
}

function managedInvocationTerminalSessionEventIds(
  context: RuntimeBuiltinToolExecutionContext,
  invocationId: string,
): readonly string[] {
  return context.session.sessionEvents
    .filter((event) => isManagedInvocationTerminalSessionEvent(event, invocationId))
    .map((event) => event.eventId);
}

export function terminalSessionEventIdsForResult(input: {
  readonly events: readonly CanonicalSessionEvent[];
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly invocationId: string;
}): readonly string[] {
  return input.events.length > 0
    ? input.events.map((event) => event.eventId)
    : managedInvocationTerminalSessionEventIds(input.context, input.invocationId);
}

function isManagedInvocationTerminalSessionEvent(event: CanonicalSessionEvent, invocationId: string): boolean {
  return (event.kind === "agent_invocation_completed" ||
    event.kind === "agent_invocation_failed" ||
    event.kind === "agent_invocation_cancelled") &&
    "invocationId" in event &&
    event.invocationId === invocationId;
}

export function managedInvocationCredentialRouteIds(
  routes: readonly ManagedInvocationToolRoute[],
): readonly string[] {
  return unique(routes.flatMap((route) =>
    Object.values(route.profiles).flatMap((profile) => {
      if (profile?.credentialRoute?.mode === "credentialless") {
        return [];
      }
      return [normalizeManagedInvocationCredentialRouteId(profile.credentialRoute.routeId)];
    })
  ));
}

export function normalizeManagedInvocationCredentialRoute(
  route: ManagedAgentCredentialRoute,
): ManagedAgentCredentialRoute {
  if (route.mode === "credentialless") {
    return route;
  }
  return {
    ...route,
    routeId: normalizeManagedInvocationCredentialRouteId(route.routeId),
  };
}

function normalizeManagedInvocationCredentialRouteId(routeId: string): string {
  return routeId.trim();
}

export function createManagedInvocationToolCallMetadataResolver(
  options: ManagedInvocationToolOptions,
): (input: Record<string, unknown>) => Record<string, unknown> | undefined {
  return (rawInput) => {
    const canonicalizedRawInput = canonicalizeManagedInvocationRawInput(rawInput, options.routes);
    const parsed = parseInput(canonicalizedRawInput.input);
    if (!parsed.ok) {
      return undefined;
    }
    const agentProfile = resolveManagedInvocationAgentProfile(options, parsed.input.agentProfile);
    if (agentProfile?.economicPolicyId && agentProfile.economicPolicyRevision) {
      return {
        kind: "managed-economic-invocation-precommit",
        profile: parsed.input.profile,
        economicPolicyId: agentProfile.economicPolicyId,
        economicPolicyRevision: agentProfile.economicPolicyRevision,
        ...(parsed.input.routeId ? { routeIdConstraint: parsed.input.routeId } : {}),
        ...(parsed.input.providerRoute.providerId
          ? {
              providerRouteConstraint: {
                providerId: parsed.input.providerRoute.providerId,
                ...(parsed.input.providerRoute.model ? { model: parsed.input.providerRoute.model } : {}),
              },
            }
          : {}),
      };
    }
    const agentRouteValidation = validateAgentRouteHint(parsed.input, agentProfile);
    if (!agentRouteValidation.ok) {
      return undefined;
    }
    const routeResolution = resolveRoute(options.routes, parsed.input, agentProfile);
    if (routeResolution.status !== "found") {
      return undefined;
    }
    const route = routeResolution.route;
    if (!route.adapter) {
      return undefined;
    }
    const profileDefaults = route.profiles[parsed.input.profile];
    if (!profileDefaults) {
      return undefined;
    }
    const handoffContract = buildHandoffContract(parsed.input);
    return {
      kind: "managed-invocation",
      profile: parsed.input.profile,
      routeId: route.routeId,
      providerRoute: {
        providerId: route.providerId,
        surface: route.surface ?? route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
        ...(parsed.input.providerRoute.model ?? route.model ? { model: parsed.input.providerRoute.model ?? route.model } : {}),
        ...(parsed.input.providerRoute.deliberationIntent ? { deliberationIntent: parsed.input.providerRoute.deliberationIntent } : {}),
      },
      adapterKind: route.adapter.descriptor.adapterKind,
      executionMode: route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
      requestedAuthority: resolveManagedInvocationRequestedAuthority(parsed.input.requestedAuthority),
      authorityProfileId: profileDefaults.authorityProfileId,
      task: parsed.input.task,
      summary: parsed.input.summary,
      ...(handoffContract ? { handoffContract } : {}),
    };
  };
}

export function attachManagedInvocationSessionEventSink(
  attachment: ManagedInvocationToolAttachment | undefined,
  sessionEventSink: ManagedInvocationSessionEventSink,
): ManagedInvocationToolAttachment | undefined {
  if (!attachment) {
    return undefined;
  }
  const { options } = attachment;
  return {
    get callerIdentity() {
      return attachment.callerIdentity;
    },
    get options() {
      return {
        ...options,
        sessionEventSink: {
          publish: async (
            events: readonly CanonicalSessionEvent[],
            context: RuntimeBuiltinToolExecutionContext,
          ) => {
            const sinks = [options.sessionEventSink, sessionEventSink].filter((sink): sink is ManagedInvocationSessionEventSink => (
              sink !== undefined
            ));
            await Promise.allSettled(sinks.map((sink) => sink.publish(events, context)));
          },
        },
      };
    },
  };
}
