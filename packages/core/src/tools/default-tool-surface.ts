import type { ToolDefinition } from "../agents/index.js";
import type { Capability } from "../engine/domain/capability.js";
import type { EventBus } from "../events/index.js";
import { MemoryGraphResourceProvider, type MemoryGraphResourceProviderOptions } from "../memory/resources/index.js";
import { GoalRunStore, WorkItemStore } from "../work-governance/index.js";
import { MemoryMutationService } from "../memory/service.js";
import type { MemoryRepository } from "../memory/repository.js";
import { ToolCatalogIndex } from "./domain/tool-catalog.js";
import {
  ToolResourceNotificationHub,
  type ToolResourceNotificationHubOptions,
} from "./domain/tool-resource-notifications.js";
import { ToolResourceRegistry } from "./domain/tool-resource-registry.js";
import { DevToolRegistry } from "./domain/tool-registry.js";
import { DEV_TOOL_OUTPUT_SCHEMA, type DevTool, type DevToolAnnotations } from "./domain/tool.js";
import { ArtifactToolResourceLinker } from "./infrastructure/artifact-tool-resource-linker.js";
import {
  AnalysisStateStore,
  type AnalysisStateStoreOptions,
} from "./infrastructure/analysis-state-store.js";
import {
  ArtifactResourceProvider,
  MemoryArtifactResourceStore,
  type ArtifactResourceStore,
} from "./infrastructure/artifact-resource-store.js";
import { BashTool, type BashToolOptions } from "./infrastructure/bash-tool.js";
import { CodeIntelligenceTool, type CodeIntelligenceToolOptions } from "./infrastructure/code-intelligence-tool.js";
import { EditTool } from "./infrastructure/edit-tool.js";
import { GitTool, type GitToolOptions } from "./infrastructure/git-tool.js";
import { GlobTool, type GlobToolOptions } from "./infrastructure/glob-tool.js";
import { GrepTool, type GrepToolOptions } from "./infrastructure/grep-tool.js";
import {
  BrowserClickTool,
  BrowserKeypressTool,
  BrowserNavigateTool,
  BrowserObserveTool,
  BrowserScrollTool,
  BrowserSessionStartTool,
  BrowserSessionStopTool,
  BrowserTypeTool,
  ComputerCloseApplicationTool,
  ComputerClickTool,
  ComputerFocusApplicationTool,
  ComputerKeypressTool,
  ComputerMinimizeApplicationTool,
  ComputerObserveTool,
  ComputerOpenApplicationTool,
  ComputerTypeTool,
  type InteractiveUseToolOptions,
} from "./infrastructure/interactive-use-tool.js";
import { MemorySaveTool, type MemorySaveToolCallerContext } from "./infrastructure/memory-save-tool.js";
import {
  MonitorListTool,
  MonitorReadTool,
  MonitorRegistry,
  MonitorStartTool,
  MonitorStopTool,
  type MonitorRegistryOptions,
} from "./infrastructure/monitor-tools.js";
import { OcrImageTool } from "./infrastructure/ocr-image-tool.js";
import { OperatorElicitationTool, type OperatorElicitationToolOptions } from "./infrastructure/operator-elicitation-tool.js";
import { PatchTool } from "./infrastructure/patch-tool.js";
import { ReadManyTool } from "./infrastructure/read-many-tool.js";
import { ReadTool } from "./infrastructure/read-tool.js";
import { ResourceListTool, ResourceReadTool, ResourceTemplateListTool } from "./infrastructure/resource-tools.js";
import {
  PlanStateStore,
  type PlanStateStoreOptions,
} from "./infrastructure/plan-state-store.js";
import {
  type SpecificationStateStoreOptions,
  SpecificationStateStore,
} from "./infrastructure/specification-state-store.js";
import { StatTool } from "./infrastructure/stat-tool.js";
import {
  TaskListTool,
  TaskStateStore,
  type TaskStateStoreOptions,
  TaskUpdateTool,
} from "./infrastructure/task-state-tools.js";
import { ToolCatalogSearchTool } from "./infrastructure/tool-catalog-search-tool.js";
import { TreeTool } from "./infrastructure/tree-tool.js";
import { ViewImageTool } from "./infrastructure/view-image-tool.js";
import { WebExtractTool, type WebExtractToolOptions } from "./infrastructure/web-extract-tool.js";
import { WebFetchTool, type WebFetchToolOptions } from "./infrastructure/web-fetch-tool.js";
import { WebSearchTool, type WebSearchToolOptions } from "./infrastructure/web-search-tool.js";
import { WorkspaceResourceProvider, type WorkspaceResourceProviderOptions } from "./infrastructure/workspace-resource-provider.js";
import { WriteTool } from "./infrastructure/write-tool.js";
import { DevToolExecutionBridge } from "./tool-executor.js";

export interface DevToolSchemaProjection {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

export interface DefaultBuiltinToolRegistryOptions {
  readonly additionalTools?: readonly DevTool[];
  readonly bash?: BashToolOptions;
  readonly grep?: GrepToolOptions;
  readonly glob?: GlobToolOptions;
  readonly webFetch?: WebFetchToolOptions;
  readonly webExtract?: WebExtractToolOptions;
  readonly webSearch?: WebSearchToolOptions;
  readonly browserUse?: InteractiveUseToolOptions;
  readonly computerUse?: InteractiveUseToolOptions;
  readonly git?: GitToolOptions;
  readonly codeIntelligence?: CodeIntelligenceToolOptions;
  readonly monitor?: MonitorRegistryOptions;
  readonly monitorRegistry?: MonitorRegistry;
  readonly taskState?: TaskStateStoreOptions;
  readonly taskStateStore?: TaskStateStore;
  readonly analysisState?: AnalysisStateStoreOptions;
  readonly analysisStateStore?: AnalysisStateStore;
  readonly planState?: PlanStateStoreOptions;
  readonly planStateStore?: PlanStateStore;
  readonly specificationState?: SpecificationStateStoreOptions;
  readonly specificationStateStore?: SpecificationStateStore;
  readonly workItemStore?: WorkItemStore;
  readonly goalRunStore?: GoalRunStore;
  readonly operatorElicitation?: OperatorElicitationToolOptions;
  readonly toolProjection?: DefaultBuiltinToolProjectionOptions;
  readonly workspaceResources?: WorkspaceResourceProviderOptions;
  readonly memoryResources?: MemoryGraphResourceProviderOptions;
  readonly memoryMutations?: DefaultMemoryMutationOptions;
  readonly artifactResources?: DefaultArtifactResourceOptions;
  readonly resourceNotifications?: ToolResourceNotificationHub | ToolResourceNotificationHubOptions;
  readonly resourceRegistry?: () => ToolResourceRegistry | undefined;
}

export interface DefaultArtifactResourceOptions {
  readonly store: ArtifactResourceStore;
}

export interface DefaultMemoryMutationOptions {
  readonly service?: MemoryMutationService;
  readonly createService?: (options: DefaultMemoryMutationServiceFactoryOptions) => MemoryMutationService;
  readonly callerContext?: DefaultMemoryMutationCallerContext;
  readonly eventBus?: EventBus;
  readonly sessionId?: string;
  readonly tenantId?: string;
}

export interface DefaultMemoryMutationCallerContext extends MemorySaveToolCallerContext {}

export interface DefaultMemoryMutationServiceFactoryOptions {
  readonly repository?: MemoryRepository;
  readonly callerContext: DefaultMemoryMutationCallerContext;
  readonly eventBus?: EventBus;
}

export interface DefaultBuiltinToolProjectionOptions {
  readonly mode?: "all" | "deferred";
  readonly alwaysOnTools?: readonly string[];
}

export interface DefaultBuiltinToolRegistryView {
  lookup(name: string): DevTool | undefined;
  list(): readonly DevTool[];
  has(name: string): boolean;
  readonly size: number;
}

export interface DefaultBuiltinToolSurface {
  readonly tools: readonly DevTool[];
  readonly toolNames: readonly string[];
  readonly registry: DefaultBuiltinToolRegistryView;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly bridge: DevToolExecutionBridge;
  readonly catalog: ToolCatalogIndex;
  readonly resources: ToolResourceRegistry;
  readonly resourceNotifications: ToolResourceNotificationHub;
  readonly artifactStore: ArtifactResourceStore;
  readonly monitorRegistry: MonitorRegistry;
  readonly taskStateStore: TaskStateStore;
  readonly analysisStateStore?: AnalysisStateStore;
  readonly planStateStore?: PlanStateStore;
  readonly specificationStateStore?: SpecificationStateStore;
  readonly workItemStore?: WorkItemStore;
  readonly goalRunStore?: GoalRunStore;
}

export function createSessionBuiltinToolOptions(
  options: DefaultBuiltinToolRegistryOptions = {},
): DefaultBuiltinToolRegistryOptions {
  const resourceNotifications = resolveResourceNotificationHub(options.resourceNotifications);
  const monitorRegistry = options.monitorRegistry ?? new MonitorRegistry({
    ...options.monitor,
    resourceNotifications,
  });
  monitorRegistry.setResourceChangeNotifier(resourceNotifications);
  const taskStateStore = options.taskStateStore ?? new TaskStateStore({
    ...options.taskState,
    resourceNotifications,
  });
  taskStateStore.setResourceChangeNotifier(resourceNotifications);
  const analysisStateStore = options.analysisStateStore ?? new AnalysisStateStore({
    ...options.analysisState,
    resourceNotifications,
  });
  analysisStateStore.setResourceChangeNotifier(resourceNotifications);
  const planStateStore = options.planStateStore ?? new PlanStateStore({
    ...options.planState,
    resourceNotifications,
  });
  planStateStore.setResourceChangeNotifier(resourceNotifications);
  const specificationStateStore = options.specificationStateStore ?? new SpecificationStateStore({
    ...options.specificationState,
    resourceNotifications,
  });
  specificationStateStore.setResourceChangeNotifier(resourceNotifications);
  const workItemStore = options.workItemStore;
  workItemStore?.setResourceChangeNotifier(resourceNotifications);
  const goalRunStore = options.goalRunStore;
  goalRunStore?.setResourceChangeNotifier(resourceNotifications);
  const artifactStore = options.artifactResources?.store ?? new MemoryArtifactResourceStore({ resourceNotifications });
  artifactStore.setResourceChangeNotifier?.(resourceNotifications);

  return {
    ...options,
    resourceNotifications,
    monitorRegistry,
    taskStateStore,
    analysisStateStore,
    planStateStore,
    specificationStateStore,
    ...(workItemStore ? { workItemStore } : {}),
    ...(goalRunStore ? { goalRunStore } : {}),
    artifactResources: { store: artifactStore },
  };
}

export function createDefaultBuiltinTools(
  options: DefaultBuiltinToolRegistryOptions = {},
): readonly DevTool[] {
  let catalog = new ToolCatalogIndex([]);
  const monitorRegistry = options.monitorRegistry ?? new MonitorRegistry(options.monitor);
  const taskStateStore = options.taskStateStore ?? new TaskStateStore(options.taskState);
  const memoryMutationCallerContext = resolveMemoryMutationCallerContext(options);
  const artifactStore = options.artifactResources?.store;
  const browserUse = artifactStore
    ? { ...(options.browserUse ?? {}), artifactStore }
    : options.browserUse;
  const computerUse = artifactStore
    ? { ...(options.computerUse ?? {}), artifactStore }
    : options.computerUse;
  const tools = [
    new BashTool(options.bash),
    new ReadTool(),
    new ReadManyTool(),
    new WriteTool(),
    new EditTool(),
    new PatchTool(),
    new StatTool(),
    new TreeTool(),
    new ViewImageTool(),
    new OcrImageTool(),
    new WebSearchTool(options.webSearch),
    new WebFetchTool(options.webFetch),
    new WebExtractTool(options.webExtract),
    new BrowserSessionStartTool(browserUse),
    new BrowserNavigateTool(browserUse),
    new BrowserObserveTool(browserUse),
    new BrowserClickTool(browserUse),
    new BrowserTypeTool(browserUse),
    new BrowserKeypressTool(browserUse),
    new BrowserScrollTool(browserUse),
    new BrowserSessionStopTool(browserUse),
    new ComputerObserveTool(computerUse),
    new ComputerClickTool(computerUse),
    new ComputerTypeTool(computerUse),
    new ComputerKeypressTool(computerUse),
    new ComputerOpenApplicationTool(computerUse),
    new ComputerFocusApplicationTool(computerUse),
    new ComputerMinimizeApplicationTool(computerUse),
    new ComputerCloseApplicationTool(computerUse),
    new GrepTool(options.grep),
    new GlobTool(options.glob),
    new GitTool(options.git),
    new CodeIntelligenceTool(options.codeIntelligence),
    new MonitorStartTool({ registry: monitorRegistry }),
    new MonitorReadTool({ registry: monitorRegistry }),
    new MonitorStopTool({ registry: monitorRegistry }),
    new MonitorListTool({ registry: monitorRegistry }),
    new TaskListTool({ store: taskStateStore }),
    new TaskUpdateTool({ store: taskStateStore }),
    new OperatorElicitationTool(options.operatorElicitation),
    new ToolCatalogSearchTool(() => catalog),
    new MemorySaveTool({
      callerContext: memoryMutationCallerContext,
      service: (callerContext) => resolveMemoryMutationService(options, callerContext),
    }),
    new ResourceListTool({ resources: options.resourceRegistry ?? (() => undefined) }),
    new ResourceTemplateListTool({ resources: options.resourceRegistry ?? (() => undefined) }),
    new ResourceReadTool({ resources: options.resourceRegistry ?? (() => undefined) }),
    ...(options.additionalTools ?? []),
  ];
  catalog = ToolCatalogIndex.fromTools(tools);
  return tools;
}

export function createDefaultBuiltinToolRegistry(
  options: DefaultBuiltinToolRegistryOptions = {},
): DevToolRegistry {
  const registry = new DevToolRegistry();
  for (const tool of createDefaultBuiltinTools(options)) {
    registry.register(tool);
  }
  return registry;
}

export function createDefaultBuiltinToolSurface(
  options: DefaultBuiltinToolRegistryOptions = {},
): DefaultBuiltinToolSurface {
  const resourceNotifications = resolveResourceNotificationHub(options.resourceNotifications);
  const monitorRegistry = options.monitorRegistry ?? new MonitorRegistry({
    ...options.monitor,
    resourceNotifications,
  });
  if (options.monitorRegistry) {
    options.monitorRegistry.setResourceChangeNotifier(resourceNotifications);
  }
  const taskStateStore = options.taskStateStore ?? new TaskStateStore({
    ...options.taskState,
    resourceNotifications,
  });
  if (options.taskStateStore) {
    options.taskStateStore.setResourceChangeNotifier(resourceNotifications);
  }
  const analysisStateStore = options.analysisStateStore
    ?? (options.analysisState
      ? new AnalysisStateStore({
        ...options.analysisState,
        resourceNotifications,
      })
      : undefined);
  options.analysisStateStore?.setResourceChangeNotifier(resourceNotifications);
  const planStateStore = options.planStateStore
    ?? (options.planState
      ? new PlanStateStore({
        ...options.planState,
        resourceNotifications,
      })
      : undefined);
  options.planStateStore?.setResourceChangeNotifier(resourceNotifications);
  const specificationStateStore = options.specificationStateStore
    ?? (options.specificationState
      ? new SpecificationStateStore({
        ...options.specificationState,
        resourceNotifications,
      })
      : undefined);
  options.specificationStateStore?.setResourceChangeNotifier(resourceNotifications);
  const workItemStore = options.workItemStore;
  workItemStore?.setResourceChangeNotifier(resourceNotifications);
  const goalRunStore = options.goalRunStore;
  goalRunStore?.setResourceChangeNotifier(resourceNotifications);
  const artifactStore = options.artifactResources?.store ?? new MemoryArtifactResourceStore({ resourceNotifications });
  artifactStore.setResourceChangeNotifier?.(resourceNotifications);
  let resources: ToolResourceRegistry | undefined;
  const surfaceOptions = {
    ...options,
    monitorRegistry,
    taskStateStore,
    ...(analysisStateStore ? { analysisStateStore } : {}),
    ...(planStateStore ? { planStateStore } : {}),
    ...(specificationStateStore ? { specificationStateStore } : {}),
    ...(workItemStore ? { workItemStore } : {}),
    ...(goalRunStore ? { goalRunStore } : {}),
    artifactResources: { store: artifactStore },
    resourceRegistry: () => resources,
  };
  const registry = createDefaultBuiltinToolRegistry(surfaceOptions);
  const catalog = ToolCatalogIndex.fromTools(registry.list());
  const resourceProviders = [
    ...(options.workspaceResources ? [new WorkspaceResourceProvider(options.workspaceResources)] : []),
    ...(options.memoryResources ? [new MemoryGraphResourceProvider(options.memoryResources)] : []),
    new ArtifactResourceProvider({ store: artifactStore }),
  ];
  const resourceRegistry = new ToolResourceRegistry({
    catalog,
    monitorRegistry,
    taskStateStore,
    ...(analysisStateStore ? { analysisStateStore } : {}),
    ...(planStateStore ? { planStateStore } : {}),
    ...(specificationStateStore ? { specificationStateStore } : {}),
    ...(workItemStore ? { workItemStore } : {}),
    ...(goalRunStore ? { goalRunStore } : {}),
    providers: resourceProviders,
  });
  resources = resourceRegistry;
  const tools = projectTools(registry.list(), options.toolProjection);

  return {
    tools,
    toolNames: tools.map((tool) => tool.name),
    registry: createRegistryView(registry),
    toolDefinitions: projectDevToolDefinitions(tools),
    capabilities: projectDevToolCapabilities(tools),
    bridge: new DevToolExecutionBridge({
      registry,
      resourceLinker: new ArtifactToolResourceLinker({ store: artifactStore }),
    }),
    catalog,
    resources: resourceRegistry,
    resourceNotifications,
    artifactStore,
    monitorRegistry,
    taskStateStore,
    ...(analysisStateStore ? { analysisStateStore } : {}),
    ...(planStateStore ? { planStateStore } : {}),
    ...(specificationStateStore ? { specificationStateStore } : {}),
    workItemStore,
    goalRunStore,
  };
}

export function projectDevToolSchemas(
  tools: readonly DevTool[],
): readonly DevToolSchemaProjection[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: cloneRecord(tool.inputSchema),
    outputSchema: resolveToolOutputSchema(tool),
  }));
}

export function projectDevToolDefinitions(
  tools: readonly DevTool[],
): readonly ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: cloneRecord(tool.inputSchema),
    outputSchema: resolveToolOutputSchema(tool),
    tags: new Set<string>(),
  }));
}

export function projectDevToolCapabilities(
  tools: readonly DevTool[],
): ReadonlyMap<string, Capability> {
  const capabilityMap = new Map<string, Capability>();
  for (const tool of tools) {
    capabilityMap.set(tool.name, {
      name: tool.name,
      description: tool.description,
      schema: cloneRecord(tool.inputSchema),
      tags: [],
      annotations: cloneAnnotations(tool.annotations),
      outputSchema: resolveToolOutputSchema(tool),
    });
  }
  return capabilityMap;
}

function resolveToolOutputSchema(tool: DevTool): Record<string, unknown> {
  return cloneRecord(tool.outputSchema ?? DEV_TOOL_OUTPUT_SCHEMA);
}

function createRegistryView(registry: DevToolRegistry): DefaultBuiltinToolRegistryView {
  return {
    lookup: (name: string) => registry.lookup(name),
    list: () => registry.list(),
    has: (name: string) => registry.has(name),
    get size() {
      return registry.size;
    },
  };
}

function resolveResourceNotificationHub(
  options: ToolResourceNotificationHub | ToolResourceNotificationHubOptions | undefined,
): ToolResourceNotificationHub {
  return options instanceof ToolResourceNotificationHub
    ? options
    : new ToolResourceNotificationHub(options);
}

function resolveMemoryMutationService(
  options: DefaultBuiltinToolRegistryOptions,
  callerContext: DefaultMemoryMutationCallerContext,
): MemoryMutationService | undefined {
  if (options.memoryMutations?.service) {
    return options.memoryMutations.service;
  }
  if (options.memoryMutations?.createService) {
    return options.memoryMutations.createService({
      repository: options.memoryResources?.repository,
      callerContext,
      eventBus: options.memoryMutations.eventBus,
    });
  }
  if (!options.memoryResources) {
    return undefined;
  }
  return new MemoryMutationService({
    repository: options.memoryResources.repository,
    eventBus: options.memoryMutations?.eventBus,
    sessionId: callerContext.sessionId,
    tenantId: callerContext.tenantId,
    authority: options.memoryResources.authority,
  });
}

function resolveMemoryMutationCallerContext(
  options: DefaultBuiltinToolRegistryOptions,
): DefaultMemoryMutationCallerContext {
  return {
    ...options.memoryMutations?.callerContext,
    sessionId: options.memoryMutations?.callerContext?.sessionId ?? options.memoryMutations?.sessionId,
    tenantId: options.memoryMutations?.callerContext?.tenantId ?? options.memoryMutations?.tenantId,
  };
}

function projectTools(
  tools: readonly DevTool[],
  projection: DefaultBuiltinToolProjectionOptions | undefined,
): readonly DevTool[] {
  if (projection?.mode !== "deferred") {
    return tools;
  }

  const requested = new Set<string>([
    ...(projection.alwaysOnTools ?? ["read", "grep", "glob"]),
    "tool_catalog_search",
    "resource_list",
    "resource_template_list",
    "resource_read",
    "kiln_config.read",
    "kiln_config.propose_change",
    "kiln_config.apply_change",
  ]);
  return tools.filter((tool) => requested.has(tool.name));
}

function cloneAnnotations(
  annotations: DevToolAnnotations | undefined,
): DevToolAnnotations | undefined {
  return annotations ? { ...annotations } : undefined;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneJsonValue(value) as Record<string, unknown>;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }

  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      clone[key] = cloneJsonValue(nestedValue);
    }
    return clone;
  }

  return value;
}
