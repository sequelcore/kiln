// McpClient: connects to MCP servers via Streamable HTTP transport

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Capability, CapabilityAnnotations } from "../engine/domain/capability.js";
import type { McpServerConfig } from "../engine/domain/mcp-config.js";
import { KilnError } from "../engine/errors.js";
import type { PromptScanner } from "../security/prompt-scanner.js";

/** Package identity for MCP client registration */
const CLIENT_NAME = "kilnai";
const CLIENT_VERSION = "0.5.0";
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_BUFFER_MS = 30_000;

export interface McpClientOptions {
  /** Override the client name reported to MCP servers */
  readonly clientName?: string;
  /** Override the client version reported to MCP servers */
  readonly clientVersion?: string;
  /** Optional prompt scanner to filter tools with injection patterns in descriptions */
  readonly promptScanner?: PromptScanner;
}

export class McpClient {
  readonly serverName: string;
  private readonly config: McpServerConfig;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly promptScanner?: PromptScanner;
  private client: Client | undefined;

  constructor(config: McpServerConfig, options?: McpClientOptions) {
    this.serverName = config.name;
    this.config = config;
    this.clientName = options?.clientName ?? CLIENT_NAME;
    this.clientVersion = options?.clientVersion ?? CLIENT_VERSION;
    this.promptScanner = options?.promptScanner;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new KilnError("MCP_CONNECTION_FAILED", "MCP server URL is required", {
        context: { serverName: this.serverName },
      });
    }

    this.client = new Client(
      { name: this.clientName, version: this.clientVersion },
      { capabilities: {} },
    );

    const transport = new StreamableHTTPClientTransport(new URL(this.config.url));
    await this.client.connect(transport);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
  }

  async discoverTools(): Promise<readonly Capability[]> {
    if (!this.client) {
      await this.connect();
    }

    try {
      const result = await this.client!.listTools();
      const capabilities: Capability[] = [];

      for (const tool of result.tools) {
        if (this.promptScanner && tool.description) {
          const scanResult = this.promptScanner.scanHeuristic(tool.description);
          if (!scanResult.safe) {
            console.warn(
              `[McpClient] Skipping MCP tool "${tool.name}" from server "${this.serverName}": description contains injection patterns (${scanResult.threats.map((t) => t.pattern).join(", ")})`,
            );
            continue;
          }
        }
        capabilities.push(this.mapToolToCapability(tool));
      }

      return capabilities;
    } catch (err) {
      if (err instanceof KilnError) throw err;
      throw new KilnError("MCP_DISCOVERY_FAILED", `Failed to discover tools: ${err}`, {
        context: { serverName: this.serverName },
        cause: err,
      });
    }
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      await this.connect();
    }

    try {
      const result = await this.client!.callTool({ name, arguments: args }, undefined, {
        timeout: this.resolveRequestTimeoutMs(args),
        resetTimeoutOnProgress: true,
        onprogress: () => undefined,
      });

      if (result.isError) {
        const content = result.content as readonly { type: string; text?: string }[];
        const errorMessage = content.map((c) => c.text ?? "").join("\n");
        throw new KilnError("MCP_SERVER_ERROR", errorMessage, {
          context: { serverName: this.serverName, toolName: name },
        });
      }

      const content = result.content as readonly { type: string; text?: string }[];
      if (content.length === 1 && content[0]?.type === "text") {
        const text = content[0].text ?? "";
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      return content;
    } catch (err) {
      if (err instanceof KilnError) throw err;
      throw new KilnError("MCP_SERVER_ERROR", `Tool execution failed: ${err}`, {
        context: { serverName: this.serverName, toolName: name },
        cause: err,
      });
    }
  }

  private mapToolToCapability(tool: {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
    };
  }): Capability {
    const annotations: CapabilityAnnotations | undefined = tool.annotations
      ? {
          readOnly: tool.annotations.readOnlyHint,
          destructive: tool.annotations.destructiveHint,
          idempotent: tool.annotations.idempotentHint,
        }
      : undefined;

    return {
      name: tool.name,
      description: tool.description ?? `MCP tool: ${tool.name}`,
      schema: tool.inputSchema ?? {},
      tags: ["mcp", this.serverName],
      ...(annotations ? { annotations } : {}),
    };
  }

  private resolveRequestTimeoutMs(args: Record<string, unknown>): number {
    const configuredTimeout = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const toolTimeout = args["timeout"];

    if (typeof toolTimeout !== "number" || !Number.isFinite(toolTimeout) || toolTimeout <= 0) {
      return configuredTimeout;
    }

    return Math.max(configuredTimeout, Math.ceil(toolTimeout + REQUEST_TIMEOUT_BUFFER_MS));
  }
}
