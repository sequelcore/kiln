// Agent resolver: single integration point for multi-agent routing in all channel handlers.
// Resolves which agent handles a message, builds the agent-specific system prompt and tool context.

import type { ContentPart, TenantConfig, TenantAgentConfig } from "@kilnai/core";
import { buildTenantSystemPrompt } from "./system-prompt-builder.js";
import { buildTenantToolContext } from "../gateway/tenant-tool-factory.js";
import type { TenantToolContext } from "../gateway/tenant-tool-factory.js";
import { DefaultTenantRouter } from "./tenant-router.js";
import type { RoutingResult } from "./tenant-router.js";
import type { ModeBSession } from "../session/mode-b-session.js";

export interface ResolvedAgentContext {
  readonly systemPrompt: string;
  readonly tenantToolContext: TenantToolContext;
  readonly activeAgentId?: string;
  readonly activeAgentName?: string;
  readonly routingResult?: RoutingResult;
  readonly previousAgentId?: string;
}

export function buildAgentSystemPrompt(basePrompt: string, agent: TenantAgentConfig): string {
  const parts: string[] = [basePrompt];

  parts.push("");
  parts.push("## Your Agent Identity");
  parts.push(`You are "${agent.name}" — ${agent.role}.`);
  parts.push(`Your primary goal: ${agent.goal}`);

  if (agent.backstory) {
    parts.push(`Background: ${agent.backstory}`);
  }

  if (agent.instructions) {
    parts.push("");
    parts.push("## Operating Instructions");
    parts.push(agent.instructions);
  }

  return parts.join("\n");
}

export function resolveAgentContext(
  tenant: TenantConfig,
  userParts: readonly ContentPart[],
  channel?: "web" | "whatsapp" | "instagram" | "messenger" | "email",
  session?: ModeBSession,
  existingBuiltins?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
): ResolvedAgentContext {
  const basePrompt = buildTenantSystemPrompt(tenant, channel);

  // No agents or single agent without routing → single-agent mode
  if (!tenant.agents || tenant.agents.length === 0) {
    return {
      systemPrompt: basePrompt,
      tenantToolContext: buildTenantToolContext(tenant, existingBuiltins),
    };
  }

  if (tenant.agents.length === 1) {
    const agent = tenant.agents[0]!;
    const systemPrompt = buildAgentSystemPrompt(basePrompt, agent);
    const toolCtx = buildAgentToolContext(tenant, agent, existingBuiltins);
    return {
      systemPrompt,
      tenantToolContext: toolCtx,
      activeAgentId: agent.id,
      activeAgentName: agent.name,
    };
  }

  // Multi-agent: route to the correct agent
  if (!tenant.routing) {
    // No routing config → fall back to first agent
    const agent = tenant.agents[0]!;
    const systemPrompt = buildAgentSystemPrompt(basePrompt, agent);
    const toolCtx = buildAgentToolContext(tenant, agent, existingBuiltins);
    return {
      systemPrompt,
      tenantToolContext: toolCtx,
      activeAgentId: agent.id,
      activeAgentName: agent.name,
    };
  }

  const router = new DefaultTenantRouter(tenant.routing);
  const routingResult = router.route(userParts);

  // Find the selected agent
  let selectedAgent = tenant.agents.find((a) => a.id === routingResult.agentId);
  if (!selectedAgent) {
    // Fail-open: use default agent or first agent
    selectedAgent = tenant.agents.find((a) => a.isDefault) ?? tenant.agents[0]!;
  }

  const previousAgentId = session?.activeAgentId;
  const systemPrompt = buildAgentSystemPrompt(basePrompt, selectedAgent);
  const toolCtx = buildAgentToolContext(tenant, selectedAgent, existingBuiltins);

  return {
    systemPrompt,
    tenantToolContext: toolCtx,
    activeAgentId: selectedAgent.id,
    activeAgentName: selectedAgent.name,
    routingResult,
    previousAgentId,
  };
}

function buildAgentToolContext(
  tenant: TenantConfig,
  agent: TenantAgentConfig,
  existingBuiltins?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
): TenantToolContext {
  // Build full tenant tool context first
  const fullCtx = buildTenantToolContext(tenant, existingBuiltins);

  // If agent has no tool restriction, inherit full tenant allowlist
  if (!agent.tools || agent.tools.length === 0) {
    return fullCtx;
  }

  // Intersect agent tools with tenant allowlist
  const agentToolSet = new Set(agent.tools);
  let intersectedAllowlist: Set<string>;

  if (fullCtx.toolAllowlist) {
    intersectedAllowlist = new Set<string>();
    for (const tool of agentToolSet) {
      if (fullCtx.toolAllowlist.has(tool)) {
        intersectedAllowlist.add(tool);
      }
    }
  } else {
    intersectedAllowlist = agentToolSet;
  }

  return {
    callBuiltinTools: fullCtx.callBuiltinTools,
    toolDefinitions: fullCtx.toolDefinitions,
    toolAllowlist: intersectedAllowlist,
    rateLimiter: fullCtx.rateLimiter,
    maxToolRounds: fullCtx.maxToolRounds,
  };
}
