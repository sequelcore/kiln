// Builds per-request tool infrastructure from a TenantConfig.
// Called once per inbound message in channel handlers.

import type {
  TenantConfig,
  ToolDefinition,
  RateLimiter,
  CredentialResolver,
  Capability,
  AuthorityDescriptor,
} from "@kilnai/core";
import { SlidingWindowRateLimiter } from "@kilnai/core";
import { WebhookToolExecutor } from "./webhook-tool-executor.js";
import type { WebhookToolConfig } from "./webhook-tool-executor.js";
import type { IntegrationRegistry } from "./integration-registry.js";
import { IntegrationExecutor } from "./integration-executor.js";
import {
  authorityFromCapability,
  classifyAuthorityFromCapability,
  rollupIntegrationAuthority,
  type ToolAuthorityClassification,
} from "./tool-authority.js";

export interface TenantToolContext {
  readonly callBuiltinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor>;
  readonly toolAuthorityClassification: ReadonlyMap<string, ToolAuthorityClassification>;
  readonly integrationAuthorityRollup: ReadonlyMap<string, ToolAuthorityClassification | "unknown">;
  readonly toolAllowlist?: ReadonlySet<string>;
  readonly rateLimiter?: RateLimiter;
  readonly maxToolRounds?: number;
}

export interface IntegrationDeps {
  readonly registry: IntegrationRegistry;
  readonly credentialResolver: CredentialResolver;
}

let _integrationDeps: IntegrationDeps | undefined;

/** Configure integration dependencies once at gateway startup. */
export function configureIntegrationDeps(deps: IntegrationDeps): void {
  _integrationDeps = deps;
}

/** Clear integration deps (for testing). */
export function clearIntegrationDeps(): void {
  _integrationDeps = undefined;
}

/** Read-only access to integration deps (for MCP server wiring). */
export function getIntegrationDeps(): IntegrationDeps | undefined {
  return _integrationDeps;
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 30_000;

export function buildTenantToolContext(
  tenant: TenantConfig,
  existingBuiltins?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
): TenantToolContext {
  const callBuiltinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  const toolDefinitions: ToolDefinition[] = [];
  const capabilities = new Map<string, Capability>();
  const toolAuthority = new Map<string, AuthorityDescriptor>();
  const toolAuthorityClassification = new Map<string, ToolAuthorityClassification>();
  const integrationAuthorityRollup = new Map<string, ToolAuthorityClassification | "unknown">();

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

  // 2. Build integration tools
  if (_integrationDeps && tenant.integrations && tenant.integrations.length > 0) {
    const { registry, credentialResolver } = _integrationDeps;
    for (const integration of tenant.integrations) {
      const adapter = registry.get(integration.provider);
      if (!adapter) continue; // Skip unregistered providers silently

      const executor = new IntegrationExecutor(adapter, credentialResolver, tenant.tenantId, integration.provider);
      const defs = registry.getToolDefinitions(integration.provider, integration.operations);

      for (const def of defs) {
        const opName = def.name.slice(integration.provider.length + 1);
        callBuiltinTools.set(def.name, (input) => executor.execute(opName, input));
      }
      toolDefinitions.push(...defs);

      // Collect capabilities with annotations for tool authorization/caching
      const caps = registry.getCapabilities(integration.provider, integration.operations);
      for (const [name, cap] of caps) {
        capabilities.set(name, cap);
        toolAuthorityClassification.set(name, classifyAuthorityFromCapability(cap));
        toolAuthority.set(name, authorityFromCapability(name, cap));
      }

      let hasMissingClassification = false;
      const classificationsForProvider: ToolAuthorityClassification[] = [];
      for (const def of defs) {
        const classification = toolAuthorityClassification.get(def.name);
        if (!classification) {
          hasMissingClassification = true;
          break;
        }
        classificationsForProvider.push(classification);
      }

      if (hasMissingClassification) {
        integrationAuthorityRollup.set(integration.provider, "unknown");
      } else if (classificationsForProvider.length > 0) {
        integrationAuthorityRollup.set(
          integration.provider,
          rollupIntegrationAuthority(classificationsForProvider),
        );
      }
    }
  }

  // 3. Merge existing builtins (existing take precedence on collision)
  if (existingBuiltins) {
    for (const [name, fn] of existingBuiltins) {
      callBuiltinTools.set(name, fn);
    }
  }

  // 4. Build allowlist
  let toolAllowlist: Set<string> | undefined;
  if (tenant.tools) {
    toolAllowlist = new Set(tenant.tools);
    // Also add webhook tool names to the allowlist
    for (const wt of tenant.webhookTools ?? []) {
      toolAllowlist.add(wt.name);
    }
    // Also add integration tool names to the allowlist
    if (_integrationDeps && tenant.integrations) {
      for (const intg of tenant.integrations) {
        const defs = _integrationDeps.registry.getToolDefinitions(intg.provider, intg.operations);
        for (const def of defs) {
          toolAllowlist.add(def.name);
        }
      }
    }
  }

  // 5. Build rate limiter
  let rateLimiter: RateLimiter | undefined;
  if (tenant.toolConfig?.rateLimits) {
    rateLimiter = new SlidingWindowRateLimiter(tenant.toolConfig.rateLimits);
  }

  // 6. Max tool rounds
  const maxToolRounds = tenant.toolConfig?.maxIterationsPerSession;

  return {
    callBuiltinTools,
    toolDefinitions,
    capabilities,
    toolAuthority,
    toolAuthorityClassification,
    integrationAuthorityRollup,
    toolAllowlist,
    rateLimiter,
    maxToolRounds,
  };
}

