import {
  type DevTool,
  type DevToolExecutionBridge,
  KilnError,
  type OperatorElicitationResponder,
  projectDevToolSchemas,
  type ToolResourceDescriptor,
  type ToolResourceListOptions,
  type ToolResourceNotification,
  type ToolResourceNotificationHub,
  type ToolResourceReadResult,
  type ToolResourceRegistry,
  type ToolResourceTemplateDescriptor,
  type ToolResult,
  type ToolResultContentPart,
} from "@kilnai/core";

const SERVER_NAME = "kilnai-dev-tools";
const SERVER_VERSION = "0.1.0";
const PROGRESS_INTERVAL_MS = 30_000;
const MCP_PROTOCOL_REVISION = "2026-07-28" as const;

interface McpServerInstance {
  setRequestHandler(
    method: string,
    handler: (request: { params: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => unknown,
  ): void;
  sendResourceUpdated(params: { readonly uri: string }): Promise<void>;
  sendResourceListChanged(): Promise<void>;
}

interface McpRequestHandlerExtra {
  readonly _meta?: {
    readonly progressToken?: string | number;
  };
  readonly sendNotification?: (
    notification:
      | {
          readonly method: "notifications/progress";
          readonly params: {
            readonly progressToken: string | number;
            readonly progress: number;
            readonly message: string;
          };
        }
      | ToolResourceNotification,
  ) => Promise<void>;
  readonly sessionId?: string;
  readonly elicit?: OperatorElicitationResponder["elicit"];
  /** v2 context keeps request metadata and notification helpers under mcpReq. */
  readonly mcpReq?: {
    readonly _meta?: {
      readonly progressToken?: string | number;
    };
    readonly notify?: (
      notification:
        | ToolResourceNotification
        | {
            readonly method: "notifications/progress";
            readonly params: {
              readonly progressToken: string | number;
              readonly progress: number;
              readonly message: string;
            };
          },
    ) => Promise<void>;
  };
}

interface SdkModules {
  Server: new (
    info: { name: string; version: string },
    opts: {
      capabilities: Record<string, unknown>;
      supportedProtocolVersions: readonly string[];
    },
  ) => McpServerInstance;
}

async function loadSdkModules(): Promise<SdkModules> {
  const serverModule = await import("@modelcontextprotocol/server");
  return {
    Server: serverModule.Server as unknown as SdkModules["Server"],
  };
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
    return projectDevToolSchemas(this.tools ?? this.bridge.listTools()).filter(
      (tool) => tool.name !== "operator_elicit",
    );
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
        ...(resolveMcpElicitation(extra)
          ? { sandbox: { operatorElicitation: { elicit: resolveMcpElicitation(extra) } } }
          : {}),
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

    const { Server } = this.sdk;
    const resourceCapabilities = this.resources
      ? {
          ...(this.resourceNotifications ? { listChanged: true } : {}),
        }
      : {};
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      {
        capabilities: { tools: {}, resources: resourceCapabilities },
        supportedProtocolVersions: [MCP_PROTOCOL_REVISION],
      },
    );

    server.setRequestHandler(
      "resources/list",
      async (request: { params?: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.registerResourceSession(server, extra);
        return this.listResources(parseResourceListParams(request.params));
      },
    );

    server.setRequestHandler(
      "resources/templates/list",
      async (request: { params?: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.registerResourceSession(server, extra);
        return this.listResourceTemplates(parseResourceListParams(request.params));
      },
    );

    server.setRequestHandler(
      "resources/read",
      async (request: { params: Record<string, unknown> }, extra?: McpRequestHandlerExtra) => {
        this.registerResourceSession(server, extra);
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

    server.setRequestHandler("tools/list", async () => ({
      tools: this.listTools(),
    }));

    server.setRequestHandler(
      "tools/call",
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

  private registerResourceSession(server: McpServerInstance, extra: McpRequestHandlerExtra | undefined): void {
    if (!this.resourceNotifications) {
      return;
    }
    const sessionId = resolveMcpSessionId(extra);
    this.subscribedSessionIds.add(sessionId);
    this.resourceNotifications.registerSession({
      sessionId,
      receivesAllResourceUpdates: true,
      sendNotification: async (notification) => {
        if (notification.method === "notifications/resources/updated") {
          await server.sendResourceUpdated(notification.params);
          return;
        }
        await server.sendResourceListChanged();
      },
    });
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
    const progressToken = extra?._meta?.progressToken ?? extra?.mcpReq?._meta?.progressToken;
    const sendNotification = resolveMcpNotificationSender(extra);
    if (!progressToken || !sendNotification) {
      return { stop: () => undefined };
    }

    let progress = 0;
    const timer = setInterval(() => {
      progress += 1;
      void sendNotification({
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

function projectToolResult(result: ToolResult): Omit<ToolResult, "content" | "resourcePayload"> {
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

function resolveMcpSessionId(extra: McpRequestHandlerExtra | undefined): string {
  return extra?.sessionId ?? "stdio";
}

function resolveMcpNotificationSender(
  extra: McpRequestHandlerExtra | undefined,
): McpRequestHandlerExtra["sendNotification"] {
  if (extra?.sendNotification) return extra.sendNotification;
  if (extra?.mcpReq?.notify) return extra.mcpReq.notify;
  return undefined;
}

function resolveMcpElicitation(
  extra: McpRequestHandlerExtra | undefined,
): OperatorElicitationResponder["elicit"] | undefined {
  return extra?.elicit;
}
