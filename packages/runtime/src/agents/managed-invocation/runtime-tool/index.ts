// Public surface of the managed-invocation runtime tool module. Internal
// modules (request-preparation, working-directory-lease, tool-executors,
// orchestration-work-items, lifecycle-tool-executors, result-projection,
// evidence-validation, route-resolution, catalog-descriptions, input-parsing)
// are not re-exported here; only the declarative tool/capability surface, the
// factories used to attach it to a runtime session, and the economic
// candidate collection surface (collectManagedEconomicCandidates and its
// committed-request/candidate types, consumed directly by CLI config and by
// managed-jobs) are public.
export {
  MANAGED_AGENT_CANCEL_CAPABILITY,
  MANAGED_AGENT_CANCEL_TOOL,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  MANAGED_AGENT_JOIN_CAPABILITY,
  MANAGED_AGENT_JOIN_TOOL,
  MANAGED_AGENT_LIST_CAPABILITY,
  MANAGED_AGENT_LIST_TOOL,
  MANAGED_AGENT_ORCHESTRATE_CAPABILITY,
  MANAGED_AGENT_ORCHESTRATE_TOOL,
  MANAGED_AGENT_START_CAPABILITY,
  MANAGED_AGENT_START_TOOL,
  MANAGED_AGENT_STATUS_CAPABILITY,
  MANAGED_AGENT_STATUS_TOOL,
} from "./tool-schema.js";
export {
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_TOOL_NAME,
} from "../tool-names.js";
export {
  createManagedAgentInvokeToolDefinition,
  createManagedAgentOrchestrateToolDefinition,
  createManagedAgentStartToolDefinition,
  createManagedInvocationLifecycleToolExecutors,
  createManagedInvocationToolAttachment,
  createManagedInvocationToolExecutor,
  resolveManagedInvocationService,
  withManagedInvocationService,
} from "./tool-factories.js";
export {
  attachManagedInvocationSessionEventSink,
  createManagedInvocationToolCallMetadataResolver,
} from "./session-event-publishing.js";
export {
  collectManagedEconomicCandidates,
} from "./economic-candidate-collection.js";
export type {
  ManagedEconomicCandidateDescriptor,
  ManagedEconomicCandidateRejection,
  ManagedEconomicCandidateRejectionReason,
  ManagedEconomicCandidateSet,
  ManagedEconomicInvocationCommand,
} from "./economic-candidate-collection.js";
export {
  ManagedCommittedRouteMismatchError,
} from "./request-preparation.js";
export type {
  ManagedCommittedInvocationRequest,
  ManagedCommittedRouteMismatchEvidence,
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationContextResolution,
  ManagedInvocationContextResolver,
  ManagedInvocationContextResolverInput,
  ManagedInvocationRouteProfile,
  ManagedInvocationSessionEventSink,
  ManagedInvocationSkillCatalogEntry,
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
  ManagedInvocationToolOptionsWithService,
  ManagedInvocationToolRoute,
  ManagedInvocationUnavailableRoute,
  ManagedInvocationWorkingDirectoryLease,
} from "./types.js";
