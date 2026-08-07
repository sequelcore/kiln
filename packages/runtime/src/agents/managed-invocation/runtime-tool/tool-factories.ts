// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Functions turning ToolDefinitions and executors into instances bound to
// ManagedInvocationToolOptions (route-enum injection, executor map assembly,
// service resolution).
import type { ManagedAgentCallerAttachmentIdentity, ToolDefinition } from "@kilnai/core";
import type { RuntimeBuiltinToolExecutor } from "../../../session/runtime-session-orchestrator.types.js";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../index.js";
import {
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_TOOL_NAME,
} from "../tool-names.js";
import type {
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
  ManagedInvocationToolOptionsWithService,
} from "./types.js";
import {
  MANAGED_AGENT_INVOKE_TOOL,
  MANAGED_AGENT_ORCHESTRATE_TOOL,
  MANAGED_AGENT_START_TOOL,
} from "./tool-schema.js";
import {
  buildManagedAgentSelectionDescription,
  buildManagedRouteCatalogDescription,
  cloneToolSchema,
  managedInvocationAgentProfileNames,
  managedInvocationSkillNames,
  readSchemaProperties,
  readSchemaProperty,
  unique,
} from "./catalog-descriptions.js";
import { executeManagedInvocationTool, executeManagedInvocationStartTool } from "./tool-executors.js";
import {
  executeManagedInvocationCancelTool,
  executeManagedInvocationJoinTool,
  executeManagedInvocationListTool,
  executeManagedInvocationStatusTool,
} from "./lifecycle-tool-executors.js";
import { executeManagedAgentOrchestrationTool } from "./orchestration-work-items.js";
import { managedInvocationCredentialRouteIds } from "./session-event-publishing.js";

export function createManagedAgentInvokeToolDefinition(
  options: ManagedInvocationToolOptions,
): ToolDefinition {
  const routeIds = unique([
    ...options.routes.map((route) => route.routeId),
    ...(options.unavailableRoutes ?? []).map((route) => route.routeId),
  ]);
  const providerIds = unique([
    ...options.routes.map((route) => route.providerId),
    ...(options.unavailableRoutes ?? []).map((route) => route.providerId),
  ]);
  const schema = cloneToolSchema(MANAGED_AGENT_INVOKE_TOOL.inputSchema);
  const properties = readSchemaProperties(schema);
  const routeId = readSchemaProperty(properties.routeId);
  if (routeId && routeIds.length > 0) {
    routeId.enum = routeIds;
    routeId.description = "Configured managed invocation route id. Prefer this when selecting a child route.";
  }
  const providerRoute = readSchemaProperty(properties.providerRoute);
  const providerRouteProperties = readSchemaProperties(providerRoute);
  const providerId = readSchemaProperty(providerRouteProperties.providerId);
  if (providerId && providerIds.length > 0) {
    providerId.enum = providerIds;
    providerId.description = "Configured managed provider id. It must correspond to the selected route.";
  }
  const agentProfile = readSchemaProperty(properties.agentProfile);
  const agentProfileNames = managedInvocationAgentProfileNames(options);
  if (agentProfile && agentProfileNames.length > 0) {
    agentProfile.enum = agentProfileNames;
    agentProfile.description = "Optional configured Kiln agent profile to request for the child. Use only one of these admitted names or aliases; omit for a generic governed child.";
  }
  const skills = readSchemaProperty(properties.skills);
  const skillNames = managedInvocationSkillNames(options);
  if (skills) {
    const items = readSchemaProperty(skills.items);
    if (skillNames.length > 0 && items) {
      items.enum = skillNames;
      skills.description = "Optional configured Kiln skills to request for the child. Use only these admitted skill names.";
    } else {
      skills.maxItems = 0;
      skills.description = "No Kiln skills are configured for managed child invocation. Omit skills.";
    }
  }
  return {
    ...MANAGED_AGENT_INVOKE_TOOL,
    description: [
      MANAGED_AGENT_INVOKE_TOOL.description,
      "",
      buildManagedRouteCatalogDescription(options),
      "",
      buildManagedAgentSelectionDescription(options),
      "",
      "For comparison tasks, invoke one managed child per selected route, then compare only successful handoffs. Report unavailable, failed, cancelled, or timed-out child invocations separately as missing evidence; do not treat them as opinions.",
      "For delegated work, choose an admitted agentProfile from the configured agent catalog when a profile clearly matches the child task. If no profile matches, omit agentProfile and invoke a generic governed child with the narrowest read-only route. Do not invent agentProfile names.",
      "When a selected agentProfile lists routeId or providerRoute hints, follow those hints. A route, provider, or model that contradicts the selected agentProfile hint fails closed.",
      "Only request skills that are listed on a configured agent profile or otherwise known from the Kiln skill catalog. Do not invent skill names; unknown skills fail closed.",
      "When the child is executing a governed work item, pass workItemId, expectedEvidence, requiredResultFields, doneCriteria, roleIntent, and residualRiskRequired so the handoff is auditable across surfaces.",
      "Use contextMode=isolated unless you are also passing governed resourceUris. Do not use contextMode=resources without resourceUris.",
      "Do not put resource_read in requiredToolNames just because contextMode=resources is used; the parent runtime hydrates admitted resourceUris before the child starts, and resource_read is only a child tool when the selected authority profile explicitly allows it.",
      "Use routeId when the user asks for a specific route or when more than one route shares a provider and no selected agentProfile route hint applies. Omit providerRoute.model unless the user explicitly selected an exact configured model.",
      "For broad repository review, long reasoning, or multi-file analysis, choose a route with a sufficient timeout budget or split the work into smaller children.",
    ].join("\n"),
    inputSchema: schema,
  };
}

export function createManagedAgentStartToolDefinition(
  options: ManagedInvocationToolOptions,
): ToolDefinition {
  const invokeDefinition = createManagedAgentInvokeToolDefinition(options);
  return {
    ...invokeDefinition,
    name: MANAGED_AGENT_START_TOOL_NAME,
    description: [
      MANAGED_AGENT_START_TOOL.description,
      "",
      invokeDefinition.description,
    ].join("\n"),
  };
}

export function createManagedInvocationToolExecutor(
  attachment: ManagedInvocationToolAttachment,
  service = resolveManagedInvocationService(attachment.options),
  scopeAdmission: "required" | "already-admitted" = "required",
): RuntimeBuiltinToolExecutor {
  return async (input, context) => executeManagedInvocationTool(input, context, attachment, service, scopeAdmission);
}

export function createManagedAgentOrchestrateToolDefinition(
  options: ManagedInvocationToolOptions,
): ToolDefinition {
  const schema = cloneToolSchema(MANAGED_AGENT_ORCHESTRATE_TOOL.inputSchema);
  const properties = readSchemaProperties(schema);
  const workItems = readSchemaProperty(properties.workItems);
  const itemProperties = readSchemaProperties(readSchemaProperty(workItems?.items));
  const agentProfile = readSchemaProperty(itemProperties.agentProfile);
  const agentProfileNames = managedInvocationAgentProfileNames(options);
  if (agentProfile && agentProfileNames.length > 0) {
    agentProfile.enum = agentProfileNames;
    agentProfile.description = "Configured Kiln agent profile for this team member. Its governed route hint is authoritative.";
  }
  const routeId = readSchemaProperty(itemProperties.routeId);
  const routeIds = unique([
    ...options.routes.map((route) => route.routeId),
    ...(options.unavailableRoutes ?? []).map((route) => route.routeId),
  ]);
  if (routeId && routeIds.length > 0) {
    routeId.enum = routeIds;
    routeId.description = "Explicit governed route for this team member. It must agree with the selected agent profile.";
  }
  return {
    ...MANAGED_AGENT_ORCHESTRATE_TOOL,
    description: [
      MANAGED_AGENT_ORCHESTRATE_TOOL.description,
      "Assign each work item an admitted agentProfile whenever a configured specialist matches. Runtime resolves and validates that profile's route independently for each team member.",
      "Use dependencies to pass completed bounded handoffs and resource URIs to downstream team members. A failed dependency blocks its dependents.",
      "Independent review requires distinct provider/model identities; duplicate aliases of one model do not count as independent evidence.",
      buildManagedAgentSelectionDescription(options),
    ].join("\n\n"),
    inputSchema: schema,
  };
}

export function createManagedInvocationLifecycleToolExecutors(
  attachment: ManagedInvocationToolAttachment,
  service = resolveManagedInvocationService(attachment.options),
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> {
  const options = attachment.options;
  return new Map([
    [MANAGED_AGENT_INVOKE_TOOL_NAME, createManagedInvocationToolExecutor(attachment, service)],
    [MANAGED_AGENT_START_TOOL_NAME, async (input, context) => executeManagedInvocationStartTool(input, context, attachment, service)],
    [MANAGED_AGENT_STATUS_TOOL_NAME, async (input, context) => executeManagedInvocationStatusTool(input, context, service)],
    [MANAGED_AGENT_LIST_TOOL_NAME, async (_input, context) => executeManagedInvocationListTool(context, service)],
    [MANAGED_AGENT_JOIN_TOOL_NAME, async (input, context) => executeManagedInvocationJoinTool(input, context, options, service)],
    [MANAGED_AGENT_CANCEL_TOOL_NAME, async (input, context) => executeManagedInvocationCancelTool(input, context, options, service)],
    [MANAGED_AGENT_ORCHESTRATE_TOOL_NAME, async (input, context) => executeManagedAgentOrchestrationTool(input, context, attachment.callerIdentity, {
      ...options,
      invocationService: service,
    })],
  ]);
}

export function createManagedInvocationToolAttachment(
  options: ManagedInvocationToolOptions,
  callerIdentity: ManagedAgentCallerAttachmentIdentity,
): ManagedInvocationToolAttachment {
  return { options, callerIdentity };
}

export function withManagedInvocationService(
  options: ManagedInvocationToolOptions,
): ManagedInvocationToolOptionsWithService {
  const invocationService = resolveManagedInvocationService(options);
  return options.invocationService === invocationService
    ? options as ManagedInvocationToolOptionsWithService
    : { ...options, invocationService };
}

export function resolveManagedInvocationService(
  options: ManagedInvocationToolOptions,
): RuntimeManagedAgentInvocationService {
  return options.invocationService ?? createManagedInvocationService(options);
}

function createManagedInvocationService(
  options: ManagedInvocationToolOptions,
): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: managedInvocationCredentialRouteIds(options.routes),
    }),
  });
}
