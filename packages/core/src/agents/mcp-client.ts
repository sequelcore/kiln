// McpClient: connects to MCP servers via SSE or stdio and discovers tools

import type { Capability, CapabilityAnnotations } from "../engine/domain/capability.js";
import type { McpServerConfig } from "../engine/domain/mcp-config.js";
import { KilnError } from "../engine/errors.js";
import { CircuitBreaker } from "./circuit-breaker.js";

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

interface McpToolsListResult {
  tools: McpTool[];
}

interface McpToolCallResult {
  content: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}

export class McpClient {
  readonly serverName: string;
  private readonly config: McpServerConfig;
  private readonly circuitBreaker: CircuitBreaker;
  private requestId = 0;

  constructor(config: McpServerConfig) {
    this.serverName = config.name;
    this.config = config;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 30000,
      halfOpenMaxAttempts: 1,
    });
  }

  async connect(): Promise<void> {
    if (this.config.transport === "sse" && this.config.url) {
      const response = await this.sendRawRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "kiln", version: "1.0.0" },
      });

      if (response.error) {
        throw new KilnError("MCP_CONNECTION_FAILED", `Failed to initialize: ${response.error.message}`, {
          context: { serverName: this.serverName },
        });
      }
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close for simple HTTP transport
  }

  async discoverTools(): Promise<readonly Capability[]> {
    try {
      const result = await this.circuitBreaker.execute(async () => {
        const response = await this.sendRequest<McpToolsListResult>("tools/list");
        return response;
      });

      if (!result?.tools) {
        throw new KilnError("MCP_DISCOVERY_FAILED", "tools/list response missing tools array", {
          context: { serverName: this.serverName },
        });
      }

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
    try {
      const result = await this.circuitBreaker.execute(async () => {
        const response = await this.sendRequest<McpToolCallResult>("tools/call", {
          name,
          arguments: args,
        });
        return response;
      });

      if (!result?.content) {
        throw new KilnError("MCP_SERVER_ERROR", "tools/call response missing content", {
          context: { serverName: this.serverName, toolName: name },
        });
      }

      if (result.isError) {
        const errorMessage = result.content.map((c) => c.text ?? String(c.data)).join("\n");
        throw new KilnError("MCP_SERVER_ERROR", errorMessage, {
          context: { serverName: this.serverName, toolName: name },
        });
      }

      if (result.content.length === 1 && result.content[0]?.type === "text") {
        const text = result.content[0].text ?? "";
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      return result.content;
    } catch (err) {
      if (err instanceof KilnError) throw err;
      throw new KilnError("MCP_SERVER_ERROR", `Tool execution failed: ${err}`, {
        context: { serverName: this.serverName, toolName: name },
        cause: err,
      });
    }
  }

  private mapToolToCapability(tool: McpTool): Capability {
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

  private async sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.sendRawRequest<T>(method, params);

    if (response.error) {
      throw new KilnError("MCP_SERVER_ERROR", response.error.message, {
        context: { serverName: this.serverName, code: response.error.code, method },
      });
    }

    return response.result as T;
  }

  private async sendRawRequest<T>(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse<T>> {
    const id = ++this.requestId;

    if (this.config.transport === "sse" && this.config.url) {
      return this.sendHttpRequest<T>(this.config.url, id, method, params);
    }

    throw new KilnError("MCP_CONNECTION_FAILED", "stdio transport not yet implemented", {
      context: { serverName: this.serverName, transport: this.config.transport },
    });
  }

  private async sendHttpRequest<T>(url: string, id: number, method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse<T>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch (err) {
      throw new KilnError("MCP_CONNECTION_FAILED", `Request failed: ${err}`, {
        context: { serverName: this.serverName, url, method },
        cause: err,
      });
    }

    if (!response.ok) {
      throw new KilnError("MCP_CONNECTION_FAILED", `Request failed with status ${response.status}`, {
        context: { serverName: this.serverName, url, method, status: response.status },
      });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new KilnError("MCP_CONNECTION_FAILED", `Failed to parse response: ${err}`, {
        context: { serverName: this.serverName, url, method },
        cause: err,
      });
    }

    return data as JsonRpcResponse<T>;
  }
}
