// McpClient: connects to MCP servers via Streamable HTTP transport

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Capability, CapabilityAnnotations } from "../engine/domain/capability.js";
import type { McpServerConfig } from "../engine/domain/mcp-config.js";
import { KilnError } from "../engine/errors.js";

export class McpClient {
  readonly serverName: string;
  private readonly config: McpServerConfig;
  private client: Client | undefined;

  constructor(config: McpServerConfig) {
    this.serverName = config.name;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new KilnError("MCP_CONNECTION_FAILED", "MCP server URL is required", {
        context: { serverName: this.serverName },
      });
    }

    this.client = new Client(
      { name: "kiln", version: "1.0.0" },
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
      return result.tools.map((tool) => this.mapToolToCapability(tool));
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
      const result = await this.client!.callTool({ name, arguments: args });

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
}
