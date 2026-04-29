import { KilnError } from "../../engine/errors.js";
import { projectDevToolSchemas } from "../default-tool-surface.js";
import type { ToolResult, ToolResultContentPart } from "../domain/tool.js";
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
  }) => Promise<void>;
}

interface SdkModules {
  Server: new (
    info: { name: string; version: string },
    opts: { capabilities: Record<string, unknown> },
  ) => McpServerInstance;
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
}

function loadSdkModules(): Promise<SdkModules> {
  return Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]).then(([serverModule, typesModule]) => ({
    Server: serverModule.Server as unknown as SdkModules["Server"],
    ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
    CallToolRequestSchema: typesModule.CallToolRequestSchema,
  }));
}

export interface DevToolsMcpServerOptions {
  readonly bridge: DevToolExecutionBridge;
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

export class DevToolsMcpServer {
  private readonly bridge: DevToolExecutionBridge;
  private sdk: SdkModules | undefined;
  private sdkPromise: Promise<SdkModules> | undefined;

  constructor(options: DevToolsMcpServerOptions) {
    this.bridge = options.bridge;
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
    this.sdk = undefined;
  }

  listTools(): readonly DevToolsMcpToolSchema[] {
    return projectDevToolSchemas(this.bridge.listTools());
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

    const { Server, ListToolsRequestSchema, CallToolRequestSchema } = this.sdk;
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } },
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
