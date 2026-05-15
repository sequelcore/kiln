import type {
  OperatorSessionEvent,
} from "./frames.js";
import type {
  OperatorEventTone,
  ToolResultResourceLinkPresentation,
} from "./operator-event-presentation.js";
import {
  presentOperatorSessionEvent,
} from "./operator-event-presentation.js";
import type {
  OperatorCockpitActionTarget,
} from "./operator-cockpit-target.js";

export const OPERATOR_COCKPIT_ATTACH_TARGET_KINDS = [
  "local",
  "remote",
  "simulated-remote",
  "team",
  "cloud",
  "ci",
] as const;

export type OperatorCockpitAttachTargetKind = typeof OPERATOR_COCKPIT_ATTACH_TARGET_KINDS[number];

export interface OperatorCockpitAttachTarget {
  readonly instanceId: string;
  readonly label: string;
  readonly kind: OperatorCockpitAttachTargetKind;
  readonly gatewayUrl?: string;
}

export type OperatorCockpitAttachConnectionKind =
  | "operator-gateway"
  | "app-gateway"
  | "simulated-app-gateway";

export type OperatorCockpitAttachTransport =
  | "http-ws"
  | "simulated-http-ws";

export interface OperatorCockpitReadOnlyAttachPlanInput {
  readonly plannedAt: string;
  readonly attachTargets: readonly OperatorCockpitAttachTarget[];
}

export interface OperatorCockpitReadOnlyAttachPlanTarget {
  readonly instanceId: string;
  readonly label: string;
  readonly kind: OperatorCockpitAttachTargetKind;
  readonly gatewayUrl: string;
  readonly connectionKind: OperatorCockpitAttachConnectionKind;
  readonly transport: OperatorCockpitAttachTransport;
  readonly connectionState: "planned";
  readonly mutationDispatch: "disabled";
}

export interface OperatorCockpitReadOnlyAttachPlan {
  readonly mode: "read-only";
  readonly plannedAt: string;
  readonly targetCount: number;
  readonly mutationDispatch: "disabled";
  readonly targets: readonly OperatorCockpitReadOnlyAttachPlanTarget[];
}

export interface OperatorCockpitReadOnlyProjectionInput {
  readonly projectedAt: string;
  readonly attachTargets: readonly OperatorCockpitAttachTarget[];
  readonly events: readonly OperatorSessionEvent[];
}

export interface OperatorCockpitInstanceProjection {
  readonly instanceId: string;
  readonly label: string;
  readonly kind: OperatorCockpitAttachTargetKind;
  readonly gatewayUrl?: string;
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly managedInvocationCount: number;
  readonly toolCallCount: number;
  readonly resourceLinkCount: number;
  readonly totalCostUsd: number;
}

export interface OperatorCockpitSessionProjection {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly eventCount: number;
  readonly managedInvocationCount: number;
  readonly toolCallCount: number;
  readonly resourceLinkCount: number;
  readonly totalCostUsd: number;
  readonly authority: string;
  readonly latestEventId: string;
  readonly latestEventTitle: string;
}

export interface OperatorCockpitResourceLinkProjection {
  readonly uri: string;
  readonly title?: string;
  readonly label?: string;
  readonly sequence?: number;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: string;
  readonly target: OperatorCockpitActionTarget;
}

export interface OperatorCockpitTimelineEntry {
  readonly eventId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: OperatorSessionEvent["kind"];
  readonly target: OperatorCockpitActionTarget;
  readonly title: string;
  readonly compactText: string;
  readonly tone: OperatorEventTone;
  readonly resourceLinks?: readonly OperatorCockpitResourceLinkProjection[];
}

export type OperatorCockpitInvocationStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface OperatorCockpitInvocationProjection {
  readonly managedInvocationId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly status: OperatorCockpitInvocationStatus;
  readonly eventCount: number;
  readonly latestEventId: string;
  readonly title: string;
}

export type OperatorCockpitToolStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";

export interface OperatorCockpitToolSummaryProjection {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly status: OperatorCockpitToolStatus;
  readonly eventCount: number;
  readonly resourceLinkCount: number;
  readonly resourceLinks: readonly OperatorCockpitResourceLinkProjection[];
  readonly latestEventId: string;
}

export interface OperatorCockpitCostProjection {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalUsd: number;
  readonly providerRoutes: readonly string[];
}

export interface OperatorCockpitReadOnlyProjection {
  readonly mode: "read-only";
  readonly projectedAt: string;
  readonly instances: readonly OperatorCockpitInstanceProjection[];
  readonly sessions: readonly OperatorCockpitSessionProjection[];
  readonly timeline: readonly OperatorCockpitTimelineEntry[];
  readonly invocations: readonly OperatorCockpitInvocationProjection[];
  readonly toolSummaries: readonly OperatorCockpitToolSummaryProjection[];
  readonly cost: OperatorCockpitCostProjection;
}

interface InstanceAccumulator {
  readonly target: OperatorCockpitAttachTarget;
  readonly sessions: Set<string>;
  readonly invocations: Set<string>;
  readonly tools: Set<string>;
  readonly resourceLinks: Set<string>;
  eventCount: number;
  totalCostUsd: number;
}

interface SessionAccumulator {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly invocations: Set<string>;
  readonly tools: Set<string>;
  readonly resourceLinks: Set<string>;
  eventCount: number;
  totalCostUsd: number;
  authority: string;
  latestEventId: string;
  latestEventTitle: string;
}

interface InvocationAccumulator {
  readonly managedInvocationId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  status: OperatorCockpitInvocationStatus;
  eventCount: number;
  latestEventId: string;
  title: string;
}

interface ToolAccumulator {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly resourceLinks: Map<string, OperatorCockpitResourceLinkProjection>;
  status: OperatorCockpitToolStatus;
  eventCount: number;
  latestEventId: string;
}

export function createOperatorCockpitReadOnlyAttachPlan(
  input: OperatorCockpitReadOnlyAttachPlanInput,
): OperatorCockpitReadOnlyAttachPlan {
  createAttachTargetMap(input.attachTargets);

  const targets = input.attachTargets.map((target) => ({
    instanceId: target.instanceId,
    label: target.label,
    kind: target.kind,
    gatewayUrl: readAttachGatewayUrl(target),
    connectionKind: connectionKindForAttachTarget(target),
    transport: target.kind === "simulated-remote" ? "simulated-http-ws" : "http-ws",
    connectionState: "planned",
    mutationDispatch: "disabled",
  } satisfies OperatorCockpitReadOnlyAttachPlanTarget));

  return {
    mode: "read-only",
    plannedAt: input.plannedAt,
    targetCount: targets.length,
    mutationDispatch: "disabled",
    targets,
  };
}

export function projectOperatorCockpitReadOnlyView(
  input: OperatorCockpitReadOnlyProjectionInput,
): OperatorCockpitReadOnlyProjection {
  const attachTargets = createAttachTargetMap(input.attachTargets);
  const instances = new Map<string, InstanceAccumulator>();
  for (const target of input.attachTargets) {
    instances.set(target.instanceId, {
      target,
      sessions: new Set<string>(),
      invocations: new Set<string>(),
      tools: new Set<string>(),
      resourceLinks: new Set<string>(),
      eventCount: 0,
      totalCostUsd: 0,
    });
  }

  const sessions = new Map<string, SessionAccumulator>();
  const invocations = new Map<string, InvocationAccumulator>();
  const tools = new Map<string, ToolAccumulator>();
  const providerRoutes = new Set<string>();
  const timeline: OperatorCockpitTimelineEntry[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalUsd = 0;

  for (const event of [...input.events].sort(compareEvents)) {
    const payload = asRecord(event.payload);
    const instanceId = readRequiredString(payload.instanceId, `event ${event.eventId} instanceId`);
    if (!attachTargets.has(instanceId)) {
      throw new Error(`Operator cockpit event ${event.eventId} references unattached instance ${instanceId}.`);
    }
    const instance = instances.get(instanceId);
    if (!instance) {
      throw new Error(`Operator cockpit attach target ${instanceId} was not initialized.`);
    }
    const sessionId = readString(payload.sessionId) ?? event.kilnSessionId;
    const managedInvocationId = readString(payload.managedInvocationId);
    const toolCallId = readString(payload.toolCallId);
    const toolName = readString(payload.toolName);
    const target: OperatorCockpitActionTarget = {
      instanceId,
      sessionId,
      eventId: event.eventId,
      ...(managedInvocationId ? { managedInvocationId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
    };
    const presentation = presentOperatorSessionEvent(event);
    const costDeltaUsd = readCostDeltaUsd(payload);
    const resourceLinks = projectResourceLinks(
      presentation.toolPresentation?.resourceLinks ?? [],
      target,
    );

    instance.eventCount += 1;
    instance.sessions.add(sessionId);
    instance.totalCostUsd += costDeltaUsd;
    addResourceUris(instance.resourceLinks, resourceLinks);

    const session = getOrCreateSession(sessions, {
      instanceId,
      sessionId,
      latestEventId: event.eventId,
      latestEventTitle: presentation.title,
    });
    session.eventCount += 1;
    session.totalCostUsd += costDeltaUsd;
    session.latestEventId = event.eventId;
    session.latestEventTitle = presentation.title;
    session.authority = readAuthority(payload) ?? session.authority;
    addResourceUris(session.resourceLinks, resourceLinks);

    if (managedInvocationId) {
      const managedInvocationKey = projectionKey(sessionId, managedInvocationId);
      const invocationTarget: OperatorCockpitActionTarget = {
        instanceId,
        sessionId,
        eventId: event.eventId,
        managedInvocationId,
      };
      const invocation = getOrCreateInvocation(invocations, {
        managedInvocationId,
        instanceId,
        sessionId,
        target: invocationTarget,
        latestEventId: event.eventId,
        title: presentation.title,
      });
      invocation.eventCount += 1;
      invocation.latestEventId = event.eventId;
      invocation.title = presentation.title;
      invocation.status = readInvocationStatus(event, payload);
      instance.invocations.add(managedInvocationKey);
      session.invocations.add(managedInvocationId);
    }

    if (toolCallId && toolName) {
      const toolTarget: OperatorCockpitActionTarget = {
        instanceId,
        sessionId,
        eventId: event.eventId,
        toolCallId,
      };
      const tool = getOrCreateTool(tools, {
        toolCallId,
        toolName,
        instanceId,
        sessionId,
        target: toolTarget,
        latestEventId: event.eventId,
      });
      tool.eventCount += 1;
      tool.latestEventId = event.eventId;
      tool.status = readToolStatus(event, payload);
      addResourceLinks(tool.resourceLinks, resourceLinks);
      instance.tools.add(toolCallId);
      session.tools.add(toolCallId);
    }

    inputTokens += readNumber(payload.inputTokens) ?? 0;
    outputTokens += readNumber(payload.outputTokens) ?? 0;
    totalUsd += costDeltaUsd;
    const providerRoute = readProviderRoute(payload);
    if (providerRoute) {
      providerRoutes.add(providerRoute);
    }

    timeline.push({
      eventId: event.eventId,
      instanceId,
      sessionId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      kind: event.kind,
      target,
      title: presentation.title,
      compactText: presentation.compactText ?? presentation.title,
      tone: presentation.tone,
      ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    });
  }

  return {
    mode: "read-only",
    projectedAt: input.projectedAt,
    instances: Array.from(instances.values()).map(projectInstance).sort(compareByInstanceId),
    sessions: Array.from(sessions.values()).map(projectSession).sort(compareByInstanceThenSession),
    timeline,
    invocations: Array.from(invocations.values()).map(projectInvocation).sort(compareByInstanceThenSessionThenInvocation),
    toolSummaries: Array.from(tools.values()).map(projectTool).sort(compareByInstanceThenSessionThenTool),
    cost: {
      inputTokens,
      outputTokens,
      totalUsd,
      providerRoutes: Array.from(providerRoutes).sort(),
    },
  };
}

function createAttachTargetMap(
  targets: readonly OperatorCockpitAttachTarget[],
): ReadonlyMap<string, OperatorCockpitAttachTarget> {
  if (targets.length === 0) {
    throw new Error("Operator cockpit read-only projection requires at least one attach target.");
  }
  const byId = new Map<string, OperatorCockpitAttachTarget>();
  for (const target of targets) {
    if (target.instanceId.trim().length === 0) {
      throw new Error("Operator cockpit attach target requires instanceId.");
    }
    if (target.label.trim().length === 0) {
      throw new Error(`Operator cockpit attach target ${target.instanceId} requires label.`);
    }
    if (!isAttachTargetKind(target.kind)) {
      throw new Error(`Operator cockpit attach target ${target.instanceId} uses unsupported kind.`);
    }
    if (byId.has(target.instanceId)) {
      throw new Error(`Operator cockpit attach target ${target.instanceId} is duplicated.`);
    }
    byId.set(target.instanceId, target);
  }
  return byId;
}

function isAttachTargetKind(value: unknown): value is OperatorCockpitAttachTargetKind {
  return typeof value === "string"
    && OPERATOR_COCKPIT_ATTACH_TARGET_KINDS.includes(value as OperatorCockpitAttachTargetKind);
}

function readAttachGatewayUrl(target: OperatorCockpitAttachTarget): string {
  const gatewayUrl = target.gatewayUrl?.trim();
  if (!gatewayUrl) {
    throw new Error(`Operator cockpit attach target ${target.instanceId} requires gatewayUrl.`);
  }

  const parsed = parseGatewayUrl(gatewayUrl, target.instanceId);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Operator cockpit attach target ${target.instanceId} gatewayUrl must use http:// or https://.`);
  }
  return gatewayUrl;
}

function parseGatewayUrl(value: string, instanceId: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Operator cockpit attach target ${instanceId} gatewayUrl must be a valid URL.`);
  }
}

function connectionKindForAttachTarget(
  target: OperatorCockpitAttachTarget,
): OperatorCockpitAttachConnectionKind {
  if (target.kind === "local") return "operator-gateway";
  if (target.kind === "simulated-remote") return "simulated-app-gateway";
  return "app-gateway";
}

function getOrCreateSession(
  sessions: Map<string, SessionAccumulator>,
  input: {
    readonly instanceId: string;
    readonly sessionId: string;
    readonly latestEventId: string;
    readonly latestEventTitle: string;
  },
): SessionAccumulator {
  const key = projectionKey(input.instanceId, input.sessionId);
  const existing = sessions.get(key);
  if (existing) return existing;
  const created: SessionAccumulator = {
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    invocations: new Set<string>(),
    tools: new Set<string>(),
    resourceLinks: new Set<string>(),
    eventCount: 0,
    totalCostUsd: 0,
    authority: "unknown",
    latestEventId: input.latestEventId,
    latestEventTitle: input.latestEventTitle,
  };
  sessions.set(key, created);
  return created;
}

function getOrCreateInvocation(
  invocations: Map<string, InvocationAccumulator>,
  input: {
    readonly managedInvocationId: string;
    readonly instanceId: string;
    readonly sessionId: string;
    readonly target: OperatorCockpitActionTarget;
    readonly latestEventId: string;
    readonly title: string;
  },
): InvocationAccumulator {
  const key = projectionKey(input.instanceId, input.sessionId, input.managedInvocationId);
  const existing = invocations.get(key);
  if (existing) return existing;
  const created: InvocationAccumulator = {
    managedInvocationId: input.managedInvocationId,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    status: "unknown",
    eventCount: 0,
    latestEventId: input.latestEventId,
    title: input.title,
  };
  invocations.set(key, created);
  return created;
}

function getOrCreateTool(
  tools: Map<string, ToolAccumulator>,
  input: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly instanceId: string;
    readonly sessionId: string;
    readonly target: OperatorCockpitActionTarget;
    readonly latestEventId: string;
  },
): ToolAccumulator {
  const key = projectionKey(input.instanceId, input.sessionId, input.toolCallId);
  const existing = tools.get(key);
  if (existing) return existing;
  const created: ToolAccumulator = {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    resourceLinks: new Map<string, OperatorCockpitResourceLinkProjection>(),
    status: "unknown",
    eventCount: 0,
    latestEventId: input.latestEventId,
  };
  tools.set(key, created);
  return created;
}

function projectInstance(input: InstanceAccumulator): OperatorCockpitInstanceProjection {
  return {
    instanceId: input.target.instanceId,
    label: input.target.label,
    kind: input.target.kind,
    gatewayUrl: input.target.gatewayUrl,
    sessionCount: input.sessions.size,
    eventCount: input.eventCount,
    managedInvocationCount: input.invocations.size,
    toolCallCount: input.tools.size,
    resourceLinkCount: input.resourceLinks.size,
    totalCostUsd: input.totalCostUsd,
  };
}

function projectSession(input: SessionAccumulator): OperatorCockpitSessionProjection {
  return {
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: {
      instanceId: input.instanceId,
      sessionId: input.sessionId,
    },
    eventCount: input.eventCount,
    managedInvocationCount: input.invocations.size,
    toolCallCount: input.tools.size,
    resourceLinkCount: input.resourceLinks.size,
    totalCostUsd: input.totalCostUsd,
    authority: input.authority,
    latestEventId: input.latestEventId,
    latestEventTitle: input.latestEventTitle,
  };
}

function projectInvocation(input: InvocationAccumulator): OperatorCockpitInvocationProjection {
  return {
    managedInvocationId: input.managedInvocationId,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    status: input.status,
    eventCount: input.eventCount,
    latestEventId: input.latestEventId,
    title: input.title,
  };
}

function projectTool(input: ToolAccumulator): OperatorCockpitToolSummaryProjection {
  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    status: input.status,
    eventCount: input.eventCount,
    resourceLinkCount: input.resourceLinks.size,
    resourceLinks: Array.from(input.resourceLinks.values()).sort(compareResourceLinks),
    latestEventId: input.latestEventId,
  };
}

function projectResourceLinks(
  links: readonly ToolResultResourceLinkPresentation[],
  target: OperatorCockpitActionTarget,
): readonly OperatorCockpitResourceLinkProjection[] {
  return links.map((link) => ({
    uri: link.uri,
    ...(link.title ? { title: link.title } : {}),
    ...(link.label ? { label: link.label } : {}),
    ...(link.sequence !== undefined ? { sequence: link.sequence } : {}),
    ...(link.mimeType ? { mimeType: link.mimeType } : {}),
    ...(link.size !== undefined ? { size: link.size } : {}),
    ...(link.relation ? { relation: link.relation } : {}),
    target: {
      ...target,
      resourceUri: link.uri,
    },
  }));
}

function addResourceUris(
  target: Set<string>,
  resourceLinks: readonly OperatorCockpitResourceLinkProjection[],
): void {
  for (const resourceLink of resourceLinks) {
    target.add(resourceLink.uri);
  }
}

function addResourceLinks(
  target: Map<string, OperatorCockpitResourceLinkProjection>,
  resourceLinks: readonly OperatorCockpitResourceLinkProjection[],
): void {
  for (const resourceLink of resourceLinks) {
    target.set(resourceLink.uri, resourceLink);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readRequiredString(value: unknown, field: string): string {
  const text = readString(value);
  if (!text) {
    throw new Error(`Operator cockpit projection requires ${field}.`);
  }
  return text;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCostDeltaUsd(payload: Record<string, unknown>): number {
  const cost = asRecord(payload.cost);
  return readNumber(cost.deltaUsd) ?? readNumber(payload.deltaUsd) ?? 0;
}

function readProviderRoute(payload: Record<string, unknown>): string | null {
  const providerRoute = asRecord(payload.providerRoute);
  const provider = readString(payload.provider) ?? readString(providerRoute.providerId);
  const model = readString(payload.model) ?? readString(providerRoute.model);
  if (!provider) return null;
  return model ? `${provider}/${model}` : provider;
}

function readAuthority(payload: Record<string, unknown>): string | null {
  const authorityStatus = asRecord(payload.authorityStatus);
  return readString(payload.requestedAuthority)
    ?? readString(payload.effectiveAuthority)
    ?? readString(payload.authorityProfileId)
    ?? readString(authorityStatus.effective);
}

function readInvocationStatus(
  event: OperatorSessionEvent,
  payload: Record<string, unknown>,
): OperatorCockpitInvocationStatus {
  const status = readString(payload.status);
  if (status === "running" || status === "completed" || status === "failed" || status === "cancelled" || status === "requested") {
    return status;
  }
  if (event.kind === "agent_invocation_started") return "running";
  if (event.kind === "agent_invocation_completed") return "completed";
  if (event.kind === "agent_invocation_failed") return "failed";
  if (event.kind === "agent_invocation_cancelled") return "cancelled";
  if (event.kind === "agent_invocation_requested") return "requested";
  return "unknown";
}

function readToolStatus(
  event: OperatorSessionEvent,
  payload: Record<string, unknown>,
): OperatorCockpitToolStatus {
  const state = readString(payload.state);
  if (state === "succeeded" || state === "failed" || state === "running") return state;
  if (event.kind === "tool_call_started") return "running";
  if (event.kind === "tool_call_completed") return "succeeded";
  return "unknown";
}

function compareEvents(a: OperatorSessionEvent, b: OperatorSessionEvent): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  const timestampCompare = a.timestamp.localeCompare(b.timestamp);
  return timestampCompare === 0 ? a.eventId.localeCompare(b.eventId) : timestampCompare;
}

function projectionKey(...parts: readonly string[]): string {
  return parts.join("\u001f");
}

function compareByInstanceId(
  a: OperatorCockpitInstanceProjection,
  b: OperatorCockpitInstanceProjection,
): number {
  return a.instanceId.localeCompare(b.instanceId);
}

function compareByInstanceThenSession(
  a: OperatorCockpitSessionProjection,
  b: OperatorCockpitSessionProjection,
): number {
  const instanceCompare = a.instanceId.localeCompare(b.instanceId);
  return instanceCompare === 0 ? a.sessionId.localeCompare(b.sessionId) : instanceCompare;
}

function compareByInstanceThenSessionThenInvocation(
  a: OperatorCockpitInvocationProjection,
  b: OperatorCockpitInvocationProjection,
): number {
  const sessionCompare = compareProjectionLocation(a, b);
  return sessionCompare === 0 ? a.managedInvocationId.localeCompare(b.managedInvocationId) : sessionCompare;
}

function compareByInstanceThenSessionThenTool(
  a: OperatorCockpitToolSummaryProjection,
  b: OperatorCockpitToolSummaryProjection,
): number {
  const sessionCompare = compareProjectionLocation(a, b);
  return sessionCompare === 0 ? a.toolCallId.localeCompare(b.toolCallId) : sessionCompare;
}

function compareResourceLinks(
  a: OperatorCockpitResourceLinkProjection,
  b: OperatorCockpitResourceLinkProjection,
): number {
  return a.uri.localeCompare(b.uri);
}

function compareProjectionLocation(
  a: { readonly instanceId: string; readonly sessionId: string },
  b: { readonly instanceId: string; readonly sessionId: string },
): number {
  const instanceCompare = a.instanceId.localeCompare(b.instanceId);
  return instanceCompare === 0 ? a.sessionId.localeCompare(b.sessionId) : instanceCompare;
}
