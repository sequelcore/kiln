import { KilnError } from "../../engine/errors.js";
import { projectDevToolSchemas } from "../default-tool-surface.js";
import type { DevTool, ToolResult, ToolResultContentPart } from "../domain/tool.js";
import type {
  ToolResourceNotification,
  ToolResourceNotificationHub,
} from "../domain/tool-resource-notifications.js";
import type {
  ToolResourceDescriptor,
  ToolResourceListOptions,
  ToolResourceReadResult,
  ToolResourceRegistry,
  ToolResourceTemplateDescriptor,
} from "../domain/tool-resource-registry.js";
import type { OperatorElicitationResponder } from "../infrastructure/operator-elicitation-tool.js";
import { DevToolExecutionBridge } from "../tool-executor.js";

const SERVER_NAME = "kilnai-dev-tools";
const SERVER_VERSION = "0.1.0";
const PROGRESS_INTERVAL_MS = 30_000;

interface McpServerInstance {
  setRequestHandler(
    schema: unknown,
    handler: (
      request: { params: Record<string, unknown> },
      extra?: McpRequestHandlerExtra,
    ) => unknown,
  ): void;
}

interface McpRequestHandlerExtra {
  readonly _meta?: {
    readonly progressToken?: string | number;
  };
  readonly sendNotification?: (notification: {
    readonly method: "notifications/progress";
    readonly params: {
      readonly progressToken: string | number;
      readonly progress: number;
      readonly message: string;
    };
  } | ToolResourceNotification) => Promise<void>;
  readonly sessionId?: string;
  readonly elicit?: OperatorElicitationResponder["elicit"];
}

interface SdkModules {
  Server: new (
    info: { name: string; version: string },
    opts: { capabilities: Record<string, unknown> },
  ) => McpServerInstance;
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
  ListResourcesRequestSchema: unknown;
  ListResourceTemplatesRequestSchema: unknown;
  ReadResourceRequestSchema: unknown;
  SubscribeRequestSchema: unknown;
  UnsubscribeRequestSchema: unknown;
}

function loadSdkModules(): Promise<SdkModules> {
  return Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]).then(([serverModule, typesModule]) => ({
    Server: serverModule.Server as unknown as SdkModules["Server"],
    ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
    CallToolRequestSchema: typesModule.CallToolRequestSchema,
    ListResourcesRequestSchema: typesModule.ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema: typesModule.ListResourceTemplatesRequestSchema,
    ReadResourceRequestSchema: typesModule.ReadResourceRequestSchema,
    SubscribeRequestSchema: typesModule.SubscribeRequestSchema,
    UnsubscribeRequestSchema: typesModule.UnsubscribeRequestSchema,
  }));
}

export interface DevToolsMcpServerOptions {
  readonly bridge: DevToolExecutionBridge;
  readonly tools?: readonly DevTool[];
  readonly resources?: ToolResourceRegistry;
  readonly resourceNotifications?: ToolResourceNotificationHub;
  readonly resourcePageSize?: number;
}

export interface DevToolsMcpToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

export interface DevToolsMcpCallResult {
  readonly content: readonly ToolResultContentPart[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

export interface DevToolsMcpListResourcesResult {
  readonly resources: readonly ToolResourceDescriptor[];
  readonly nextCursor?: string;
}

export interface DevToolsMcpListResourceTemplatesResult {
  readonly resourceTemplates: readonly ToolResourceTemplateDescriptor[];
  readonly nextCursor?: string;
}

export class DevToolsMcpServer {
  private readonly bridge: DevToolExecutionBridge;
  private readonly tools?: readonly DevTool[];
  private readonly resources?: ToolResourceRegistry;
  private readonly resourceNotifications?: ToolResourceNotificationHub;
  private readonly resourcePageSize: number | undefined;
  private readonly subscribedSessionIds = new Set<string>();
  private sdk: SdkModules | undefined;
  private sdkPromise: Promise<SdkModules> | undefined;

  constructor(options: DevToolsMcpServerOptions) {
    this.bridge = options.bridge;
    this.tools = options.tools;
    this.resources = options.resources;
    this.resourceNotifications = options.resourceNotifications;
    this.resourcePageSize = options.resourcePageSize;
  }

  async initialize(): Promise<void> {
    this.sdkPromise ??= loadSdkModules();
    try {
      this.sdk = await this.sdkPromise;
    } catch (error) {
      this.sdkPromise = undefined;
      throw error;
    }
  }

  close(): void {
    for (const sessionId of this.subscribedSessionIds) {
      this.resourceNotifications?.disposeSession(sessionId);
    }
    this.subscribedSessionIds.clear();
    this.sdk = undefined;
  }

  listTools(): readonly DevToolsMcpToolSchema[] {
    return projectDevToolSchemas(this.tools ?? this.bridge.listTools());
  }

  listResources(options: Pick<ToolResourceListOptions, "cursor"> = {}): DevToolsMcpListResourcesResult {
    const page = this.resources?.listPage({
      cursor: options.cursor,
      limit: this.resourcePageSize,
    });
    return {
      resources: page?.items ?? [],
      ...(page?.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  listResourceTemplates(options: Pick<ToolResourceListOptions, "cursor"> = {}): DevToolsMcpListResourceTemplatesResult {
    const page = this.resources?.listTemplatePage({
      cursor: options.cursor,
      limit: this.resourcePageSize,
    });
    return {
      resourceTemplates: page?.items ?? [],
      ...(page?.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  async readResource(uri: string): Promise<ToolResourceReadResult> {
    if (!this.resources) {
      throw new KilnError("INTERNAL_ERROR", "No MCP resource registry is configured", {
        context: { uri },
        retryable: false,
      });
    }
    return await this.resources.read(uri);
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    extra?: McpRequestHandlerExtra,
  ): Promise<DevToolsMcpCallResult> {
    const progress = this.startProgressNotifications(name, extra);
    try {
      const execution = await this.bridge.execute({
        name,
        input: args,
        ...(extra?.elicit ? { sandbox: { operatorElicitation: { elicit: extra.elicit } } } : {}),
      });

      const payload = {
        result: projectToolResult(execution.result),
        attempts: execution.attempts,
        fallbackUsed: execution.fallbackUsed,
      };

      return this.jsonResult(payload, execution.result.content, execution.result.isError);
    } catch (error) {
      return this.errorResult(this.formatErrorMessage(error));
    } finally {
      progress.stop();
    }
  }

  createServer(): McpServerInstance {
    if (!this.sdk) {
      throw new Error("Dev tools MCP server not initialized");
    }

    const {
      Server,
      ListToolsRequestSchema,
      CallToolRequestSchema,
      ListResourcesRequestSchema,
      ListResourceTemplatesRequestSchema,
      ReadResourceRequestSchema,
      SubscribeRequestSchema,
      UnsubscribeRequestSchema,
    } = this.sdk;
    const resourceCapabilities = this.resources
      ? {
        ...(this.resourceNotifications ? { subscribe: true, listChanged: true } : {}),
      }
      : {};
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {}, resources: resourceCapabilities } },
    );

    server.setRequestHandler(
      ListResourcesRequestSchema,
      async (request: { params?: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.registerResourceSession(extra);
        return this.listResources(parseResourceListParams(request.params));
      },
    );

    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (request: { params?: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.registerResourceSession(extra);
        return this.listResourceTemplates(parseResourceListParams(request.params));
      },
    );

    server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: { params: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.registerResourceSession(extra);
        const uri = request.params["uri"];
        if (typeof uri !== "string") {
          throw new KilnError("INTERNAL_ERROR", "Invalid MCP resource URI", {
            context: { uri },
            retryable: false,
          });
        }
        return await this.readResource(uri);
      },
    );

    server.setRequestHandler(
      SubscribeRequestSchema,
      async (request: { params: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.subscribeResource(parseResourceUriParam(request.params), extra);
        return {};
      },
    );

    server.setRequestHandler(
      UnsubscribeRequestSchema,
      async (request: { params: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.unsubscribeResource(parseResourceUriParam(request.params), extra);
        return {};
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.listTools(),
    }));

    server.setRequestHandler(
      CallToolRequestSchema,
      async (request: { params: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        const params = request.params as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        return this.callTool(params.name, params.arguments ?? {}, extra);
      },
    );

    return server;
  }

  private jsonResult(
    data: unknown,
    content: readonly ToolResultContentPart[] = [],
    isError = false,
  ): DevToolsMcpCallResult {
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }, ...content],
      structuredContent: data,
      ...(isError ? { isError: true } : {}),
    };
  }

  private registerResourceSession(extra: McpRequestHandlerExtra | undefined): void {
    if (!this.resourceNotifications || !extra?.sendNotification) {
      return;
    }
    const sessionId = resolveMcpSessionId(extra);
    this.subscribedSessionIds.add(sessionId);
    this.resourceNotifications.registerSession({
      sessionId,
      sendNotification: async (notification) => {
        await extra.sendNotification?.(notification);
      },
    });
  }

  private subscribeResource(uri: string, extra: McpRequestHandlerExtra | undefined): void {
    if (!this.resourceNotifications) {
      throw new KilnError("INTERNAL_ERROR", "MCP resource subscriptions are not configured", {
        context: { uri },
        retryable: false,
      });
    }
    if (!extra?.sendNotification) {
      throw new KilnError("INTERNAL_ERROR", "MCP resource subscription requires notification support", {
        context: { uri },
        retryable: false,
      });
    }
    const sessionId = resolveMcpSessionId(extra);
    this.subscribedSessionIds.add(sessionId);
    this.resourceNotifications.subscribeResource({
      sessionId,
      uri,
      sendNotification: async (notification) => {
        await extra.sendNotification?.(notification);
      },
    });
  }

  private unsubscribeResource(uri: string, extra: McpRequestHandlerExtra | undefined): void {
    if (!this.resourceNotifications) {
      return;
    }
    const sessionId = resolveMcpSessionId(extra);
    this.resourceNotifications.unsubscribeResource({ sessionId, uri });
  }

  private errorResult(message: string): DevToolsMcpCallResult {
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }

  private formatErrorMessage(error: unknown): string {
    if (error instanceof KilnError) {
      return `${error.code}: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private startProgressNotifications(
    toolName: string,
    extra: McpRequestHandlerExtra | undefined,
  ): { stop: () => void } {
    const progressToken = extra?._meta?.progressToken;
    if (!progressToken || !extra?.sendNotification) {
      return { stop: () => undefined };
    }

    let progress = 0;
    const timer = setInterval(() => {
      progress += 1;
      void extra.sendNotification?.({
        method: "notifications/progress",
        params: {
          progressToken,
          progress,
          message: `Tool "${toolName}" is still running`,
        },
      });
    }, PROGRESS_INTERVAL_MS);
    timer.unref?.();

    return {
      stop: () => {
        clearInterval(timer);
      },
    };
  }
}

function projectToolResult(result: ToolResult): Omit<ToolResult, "content"> {
  return {
    output: result.output,
    isError: result.isError,
    ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
  };
}

function parseResourceListParams(params: Record<string, unknown> | undefined): Pick<ToolResourceListOptions, "cursor"> {
  const cursor = params?.["cursor"];
  if (cursor === undefined) {
    return {};
  }
  if (typeof cursor !== "string") {
    throw new KilnError("INTERNAL_ERROR", "Invalid MCP resource cursor", {
      context: { cursor },
      retryable: false,
    });
  }
  return { cursor };
}

function parseResourceUriParam(params: Record<string, unknown>): string {
  const uri = params["uri"];
  if (typeof uri !== "string") {
    throw new KilnError("INTERNAL_ERROR", "Invalid MCP resource URI", {
      context: { uri },
      retryable: false,
    });
  }
  return uri;
}

function resolveMcpSessionId(extra: McpRequestHandlerExtra | undefined): string {
  return extra?.sessionId ?? "stdio";
}
