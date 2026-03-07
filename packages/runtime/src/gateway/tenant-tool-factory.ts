// Builds per-request tool infrastructure from a TenantConfig.
// Called once per inbound message in channel handlers.

import type { TenantConfig, ToolDefinition, RateLimiter } from "@kilnai/core";
import { SlidingWindowRateLimiter } from "@kilnai/core";
import { WebhookToolExecutor } from "./webhook-tool-executor.js";
import type { WebhookToolConfig } from "./webhook-tool-executor.js";

export interface TenantToolContext {
  readonly callBuiltinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly toolAllowlist?: ReadonlySet<string>;
  readonly rateLimiter?: RateLimiter;
  readonly maxToolRounds?: number;
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 30_000;

export function buildTenantToolContext(
  tenant: TenantConfig,
  existingBuiltins?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
): TenantToolContext {
  const callBuiltinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  const toolDefinitions: ToolDefinition[] = [];

  // 1. Build webhook tools
  if (tenant.webhookTools && tenant.webhookTools.length > 0) {
    const webhookConfigs: WebhookToolConfig[] = tenant.webhookTools.map((wt) => ({
      name: wt.name,
      description: wt.description ?? `Webhook tool: ${wt.name}`,
      url: wt.url,
      secret: wt.secret,
      timeoutMs: wt.timeout ? wt.timeout * 1000 : DEFAULT_WEBHOOK_TIMEOUT_MS,
      inputSchema: wt.inputSchema,
    }));

    const executor = new WebhookToolExecutor(webhookConfigs);

    for (const config of webhookConfigs) {
      callBuiltinTools.set(config.name, (input) => executor.execute(config.name, input));
    }

    toolDefinitions.push(...executor.getToolDefinitions());
  }

  // 2. Merge existing builtins (existing take precedence on collision)
  if (existingBuiltins) {
    for (const [name, fn] of existingBuiltins) {
      callBuiltinTools.set(name, fn);
    }
  }

  // 3. Build allowlist
  let toolAllowlist: Set<string> | undefined;
  if (tenant.tools) {
    toolAllowlist = new Set(tenant.tools);
    // Also add webhook tool names to the allowlist
    for (const wt of tenant.webhookTools ?? []) {
      toolAllowlist.add(wt.name);
    }
  }

  // 4. Build rate limiter
  let rateLimiter: RateLimiter | undefined;
  if (tenant.toolConfig?.rateLimits) {
    rateLimiter = new SlidingWindowRateLimiter(tenant.toolConfig.rateLimits);
  }

  // 5. Max tool rounds
  const maxToolRounds = tenant.toolConfig?.maxIterationsPerSession;

  return {
    callBuiltinTools,
    toolDefinitions,
    toolAllowlist,
    rateLimiter,
    maxToolRounds,
  };
}
