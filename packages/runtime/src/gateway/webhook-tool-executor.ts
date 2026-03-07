// Infrastructure adapter: execute external HTTP endpoints as tools

import { signHmacSha256 } from "../utils/hmac.js";
import { KilnError } from "@kilnai/core";
import type { ToolDefinition } from "@kilnai/core";

export interface WebhookToolConfig {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly secret: string;
  readonly timeoutMs: number;
  readonly inputSchema?: Record<string, unknown>;
}

export class WebhookToolExecutor {
  private readonly configs: ReadonlyMap<string, WebhookToolConfig>;

  constructor(configs: readonly WebhookToolConfig[]) {
    this.configs = new Map(configs.map((c) => [c.name, c]));
  }

  handles(toolName: string): boolean {
    return this.configs.has(toolName);
  }

  async execute(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const config = this.configs.get(toolName);
    if (!config) {
      throw new KilnError("WEBHOOK_TOOL_FAILED", `Webhook tool "${toolName}" not configured`, {
        context: { toolName },
        retryable: false,
      });
    }

    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ tool: toolName, input, timestamp });
    const signature = signHmacSha256(config.secret, payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kiln-Signature": `sha256=${signature}`,
          "X-Kiln-Timestamp": timestamp,
        },
        body: payload,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new KilnError(
          "WEBHOOK_TOOL_FAILED",
          `Webhook tool "${toolName}" returned HTTP ${response.status}`,
          {
            context: { toolName, url: config.url, status: response.status },
            retryable: response.status >= 500,
          },
        );
      }

      return await response.json();
    } catch (err) {
      if (err instanceof KilnError) throw err;

      const message =
        err instanceof Error && err.name === "AbortError"
          ? `Webhook tool "${toolName}" timed out after ${config.timeoutMs}ms`
          : `Webhook tool "${toolName}" failed: ${err instanceof Error ? err.message : String(err)}`;

      throw new KilnError("WEBHOOK_TOOL_FAILED", message, {
        context: { toolName, url: config.url },
        retryable: true,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.configs.values()).map((c) => ({
      name: c.name,
      description: c.description,
      inputSchema: c.inputSchema ?? {},
      tags: new Set<string>(),
    }));
  }
}
